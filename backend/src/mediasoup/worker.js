// backend/src/mediasoup/worker.js
// FIXES:
//   FIX-1: rtcMinPort / rtcMaxPort must be opened in Render's firewall (or via env vars).
//           Default range 40000–49999 is fine but you MUST open these ports.
//           On Render free tier, only HTTP/HTTPS are exposed — you need a paid plan
//           or a TURN server relay for WebRTC UDP to work.
//
//   FIX-2: Added RTC_MIN_PORT / RTC_MAX_PORT env var support so you can override
//           without redeploying.


//get push my update 

const mediasoup = require("mediasoup");

let worker = null;
let workerPromise = null;

/* =========================================================
   CREATE WORKER (SAFE SINGLETON)
========================================================= */
async function createWorker() {
  if (worker) return worker;
  if (workerPromise) return workerPromise;

  const rtcMinPort = parseInt(process.env.RTC_MIN_PORT || "40000", 10);
  const rtcMaxPort = parseInt(process.env.RTC_MAX_PORT || "49999", 10);

  console.log(`[worker] Creating mediasoup worker rtcMinPort=${rtcMinPort} rtcMaxPort=${rtcMaxPort}`);

    // ===== TEMPORARY DEBUG =====
 const fs = require("fs");
const path = require("path");

const releaseDir = path.join(
  process.cwd(),
  "node_modules",
  "mediasoup",
  "worker",
  "out",
  "Release"
);

const linuxWorker = path.join(releaseDir, "mediasoup-worker");
const windowsWorker = path.join(releaseDir, "mediasoup-worker.exe");

console.log("=================================");
console.log("MEDIASOUP WORKER FILE CHECK");
console.log("Release directory:", releaseDir);
console.log("Release directory exists:", fs.existsSync(releaseDir));
console.log("Linux worker exists:", fs.existsSync(linuxWorker));
console.log("Windows worker exists:", fs.existsSync(windowsWorker));

if (fs.existsSync(releaseDir)) {
  console.log("Files:", fs.readdirSync(releaseDir));
}
console.log("=================================");
  // ===== END TEMPORARY DEBUG =====

  workerPromise = mediasoup
    .createWorker({
      rtcMinPort,
      rtcMaxPort,
      logLevel: "warn",
      logTags: ["info", "ice", "dtls", "rtp", "srtp"]
    })
    .then((w) => {
      worker = w;

      worker.on("died", () => {
        console.error("❌ mediasoup worker died — exiting");
        process.exit(1);
      });

      console.log("✅ Mediasoup worker created pid=" + worker.pid);
      return worker;
    });

  return workerPromise;
}

/* =========================================================
   GET WORKER
========================================================= */
function getWorker() {
  if (!worker) {
    throw new Error("Worker not initialized. Call createWorker() first.");
  }
  return worker;
}

/* =========================================================
   READY CHECKvvvvvvvvvvvvvvvvvvvvv waht 
========================================================= */
function isWorkerReady() {
  return !!worker;
}

module.exports = { createWorker, getWorker, isWorkerReady };