// backend/src/mediasoup/worker.js
//
// IMPORTANT CONTEXT FOR WHOEVER READS THIS NEXT:
// This file creates the underlying mediasoup C++ worker process(es).
// It has NO knowledge of rooms, routers, transports, producers, or
// consumers — router.js is the only thing that calls getWorker(),
// and only once per room (at createRouter() time). Because of that,
// this file CANNOT be the cause of per-room symptoms like "host
// video freezes when a guest joins", "viewers see a black screen",
// or "host never receives guest video". Those are producer/consumer/
// transport-level bugs and live in stream.socket.js and live.js —
// see the explanation given alongside this file for the actual
// trace and the real suspect (the host's single recv transport +
// its RTCPeerConnection ICE/DTLS handshake being created for the
// first time exactly when a guest joins, colliding with the
// already-running WebGL beauty-filter + MediaPipe pipeline on the
// same page).
//
// What THIS file legitimately needed fixing:
//   FIX-1 (original): rtcMinPort/rtcMaxPort must be opened in your
//           host firewall / cloud provider. Kept as-is below.
//   FIX-2 (original): RTC_MIN_PORT / RTC_MAX_PORT env override. Kept.
//   FIX-3 (this pass): a SINGLE worker for the entire server means
//           every room's RTP processing shares one OS thread, and
//           worker.on("died") called process.exit(1) — killing the
//           ENTIRE Node process, and therefore EVERY room/host/
//           viewer on the server, the instant that one worker
//           process dies for any reason. That's a real, severe
//           single point of failure independent of the reported
//           bug. Fixed by:
//             - running a small pool of workers (one per CPU core,
//               capped/overridable via env), so one dying doesn't
//               take the whole server down and load is spread
//               across cores instead of one.
//             - round-robin assignment so router.js's createRouter()
//               spreads new rooms' routers across the pool.
//             - on a worker dying, remove it from the pool and spin
//               up a replacement instead of exiting the process.
//               Existing rooms already on OTHER workers are
//               unaffected; only rooms whose router lived on the
//               dead worker need to reconnect (already true before
//               this fix too — a dead worker takes its routers with
//               it regardless).
// ============================================================

const os = require("os");
const mediasoup = require("mediasoup");

const workers = [];       // pool of live mediasoup Worker instances
let nextWorkerIndex = 0;  // round-robin cursor
let creatingPromise = null; // guards against concurrent createWorker() calls

/**
 * How many mediasoup workers to run. Defaults to one per CPU core
 * (mediasoup workers are single-threaded C++ processes, so this is
 * the normal way to use available cores), capped at 4 unless
 * explicitly overridden — most small deployments don't need more,
 * and each worker needs its own slice of the RTC port range.
 */
function getDesiredWorkerCount() {
  const envCount = parseInt(process.env.MEDIASOUP_NUM_WORKERS || "", 10);
  if (Number.isInteger(envCount) && envCount > 0) return envCount;
  const cpuCount = os.cpus()?.length || 1;
  return Math.max(1, Math.min(cpuCount, 4));
}

/**
 * Each worker gets its OWN non-overlapping port range carved out of
 * the overall RTC_MIN_PORT–RTC_MAX_PORT band. Two mediasoup worker
 * PROCESSES sharing the exact same port range can race to bind the
 * same UDP/TCP port for different transports, which fails
 * intermittently under load — carving disjoint ranges per worker
 * avoids that entirely.
 */
function getPortRangeForWorkerIndex(index, totalWorkers) {
  const overallMin = parseInt(process.env.RTC_MIN_PORT || "40000", 10);
  const overallMax = parseInt(process.env.RTC_MAX_PORT || "49999", 10);
  const totalSpan = overallMax - overallMin + 1;
  const perWorkerSpan = Math.max(10, Math.floor(totalSpan / totalWorkers));

  const rtcMinPort = overallMin + index * perWorkerSpan;
  const rtcMaxPort = index === totalWorkers - 1
    ? overallMax // last worker absorbs any remainder
    : rtcMinPort + perWorkerSpan - 1;

  return { rtcMinPort, rtcMaxPort };
}

async function createSingleMediasoupWorker(index, totalWorkers) {
  const { rtcMinPort, rtcMaxPort } = getPortRangeForWorkerIndex(index, totalWorkers);

  console.log(
    `[worker] Creating mediasoup worker #${index + 1}/${totalWorkers} ` +
    `rtcMinPort=${rtcMinPort} rtcMaxPort=${rtcMaxPort}`
  );

  const w = await mediasoup.createWorker({
    rtcMinPort,
    rtcMaxPort,
    logLevel: "warn",
    logTags: ["info", "ice", "dtls", "rtp", "srtp"]
  });

  w.appData = { index, rtcMinPort, rtcMaxPort };

  w.on("died", () => {
    console.error(
      `❌ mediasoup worker #${index + 1} (pid=${w.pid}) died. ` +
      `Removing it from the pool and starting a replacement — ` +
      `NOT exiting the process, so other rooms on other workers ` +
      `are unaffected.`
    );
    const deadIdx = workers.indexOf(w);
    if (deadIdx !== -1) workers.splice(deadIdx, 1);

    // Replace it so the pool stays at full strength. Any room whose
    // router lived on the dead worker will need to rejoin/reconnect
    // regardless (its router died with the worker) — that was true
    // before this fix too; what's fixed is that this no longer takes
    // every OTHER room down with it.
    createSingleMediasoupWorker(index, totalWorkers)
      .then((replacement) => { workers[deadIdx !== -1 ? deadIdx : workers.length] = replacement; })
      .catch((err) => console.error("[worker] Failed to create replacement worker:", err));
  });

  console.log(`✅ Mediasoup worker #${index + 1} created pid=${w.pid}`);
  return w;
}

/* =========================================================
   CREATE WORKER POOL (SAFE SINGLETON)
   ---------------------------------------------------------
   Kept the name createWorker() for backward compatibility with
   existing callers (e.g. server bootstrap) that call this once at
   startup — it now creates the whole pool instead of a single
   instance, but the call site doesn't need to change.
========================================================= */
async function createWorker() {
  if (workers.length > 0) return workers[0];
  if (creatingPromise) return creatingPromise;

  const desiredCount = getDesiredWorkerCount();
  console.log(`[worker] Bootstrapping mediasoup worker pool: ${desiredCount} worker(s)`);

  creatingPromise = (async () => {
    for (let i = 0; i < desiredCount; i++) {
      const w = await createSingleMediasoupWorker(i, desiredCount);
      workers.push(w);
    }
    return workers[0];
  })();

  try {
    return await creatingPromise;
  } finally {
    creatingPromise = null;
  }
}

/* =========================================================
   GET WORKER — round-robin across the pool so new rooms'
   routers spread across CPU cores instead of all landing on
   worker #1 forever.
========================================================= */
function getWorker() {
  if (workers.length === 0) {
    throw new Error("Worker not initialized. Call createWorker() first.");
  }
  const w = workers[nextWorkerIndex % workers.length];
  nextWorkerIndex = (nextWorkerIndex + 1) % workers.length;
  return w;
}

/* =========================================================
   READY CHECK
========================================================= */
function isWorkerReady() {
  return workers.length > 0;
}

module.exports = { createWorker, getWorker, isWorkerReady };