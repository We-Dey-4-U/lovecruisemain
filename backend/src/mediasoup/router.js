// backend/src/mediasoup/router.js
// Premium codec configuration: VP9 + H.264 + Opus high-quality
//
// FIX (black screen): VP9 was declared with profile-id "2", which is
// 10-bit HDR VP9. Almost no consumer webcam/browser decoder pipeline
// actually handles that cleanly end-to-end — it very commonly
// negotiates "successfully" (SDP/RTP capable) but then decodes to a
// blank or corrupted frame, which is exactly the "connected but black
// screen" symptom. Standard webcam captures are 8-bit, so VP9 now
// uses profile-id "0" (the standard 8-bit profile) and is listed
// AFTER VP8/H264 so the most broadly-compatible codec wins whenever
// the client also offers it.
//
// FIX (this pass) — "Channel request handler with ID ... not found"
// on createWebRtcTransport: this module cached routers in `routers`
// keyed by roomId FOREVER, with no way to know a cached router had
// since been closed elsewhere (room.js's closeRoom()/close() closes
// the router but had no way to tell THIS module's cache to forget
// it). Radio rooms get closed automatically whenever producers+peers
// both hit 0 (see radioMedia.socket.js cleanupRadioMedia), which is
// exactly what happens between "host goes live" and "a guest gets
// invited/approved later" if the room emptied out in between. The
// next createRouter(roomId) call would then find the stale, CLOSED
// router still sitting in the cache and hand it straight back —
// calling createWebRtcTransport() on a closed router's channel is
// exactly what throws "Channel request handler ... not found".
//
// Fixed two ways (belt and suspenders):
//   1. createRouter() now checks router.closed on any cache hit and
//      transparently creates + caches a fresh one if the cached
//      entry is dead.
//   2. closeRouter() is exported and MUST be called by whatever
//      closes the owning room (see room.js), so the cache is
//      evicted proactively instead of relying only on the lazy
//      check in (1).

const { getWorker } = require("./worker");

const routers = new Map();

const MEDIA_CODECS = [
  // ── AUDIO ── Opus: stereo, 48kHz, FEC, DTX
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
    parameters: {
      "minptime": 10,
      "useinbandfec": 1,
      "usedtx": 1,
      "maxaveragebitrate": 510000,
      "stereo": 1,
      "sprop-stereo": 1
    }
  },

  // ── VIDEO: VP8 (universal fallback — listed FIRST for compatibility) ──
  {
    kind: "video",
    mimeType: "video/VP8",
    clockRate: 90000,
    parameters: {}
  },

  // ── VIDEO: H.264 (hardware-accelerated on most devices) ──
  {
    kind: "video",
    mimeType: "video/H264",
    clockRate: 90000,
    parameters: {
      "packetization-mode": 1,
      "profile-level-id": "42e01f",  // Baseline 3.1 — widest hw compat
      "level-asymmetry-allowed": 1
    }
  },

  // ── VIDEO: H.264 High Profile (better quality on capable devices) ──
  {
    kind: "video",
    mimeType: "video/H264",
    clockRate: 90000,
    parameters: {
      "packetization-mode": 1,
      "profile-level-id": "640032",  // High profile 5.0
      "level-asymmetry-allowed": 1
    }
  },

  // ── VIDEO: VP9 (bonus quality when both sides support it cleanly —
  // FIXED: profile-id 0 = standard 8-bit, not 2/10-bit HDR) ──
  {
    kind: "video",
    mimeType: "video/VP9",
    clockRate: 90000,
    parameters: {
      "profile-id": 0
    }
  }
];

async function createRouter(roomId) {
  const cached = routers.get(roomId);

  // FIX: a cache hit is only valid if the router is still alive.
  // mediasoup's Router exposes a `.closed` getter — if it's true,
  // the underlying worker channel handler is gone and MUST NOT be
  // reused, or every call on it (createWebRtcTransport included)
  // throws "Channel request handler ... not found".
  if (cached) {
    if (!cached.closed) {
      return cached;
    }
    console.warn(`[router] Cached router for room ${roomId} was closed — discarding and creating a fresh one`);
    routers.delete(roomId);
  }

  const worker = getWorker();
  if (!worker) throw new Error("Mediasoup worker not ready");

  const router = await worker.createRouter({ mediaCodecs: MEDIA_CODECS });

  routers.set(roomId, router);
  console.log(`✅ Premium router created for room ${roomId}`);
  return router;
}

function getRouter(roomId) {
  const router = routers.get(roomId);
  if (!router || router.closed) throw new Error(`Router not initialized for room ${roomId}`);
  return router;
}

function hasRouter(roomId) {
  const router = routers.get(roomId);
  return !!router && !router.closed;
}

function closeRouter(roomId) {
  const router = routers.get(roomId);
  if (router) {
    try { router.close(); } catch (e) {}
  }
  routers.delete(roomId);
  console.log(`🗑️  Router closed for room ${roomId}`);
}

module.exports = { createRouter, getRouter, hasRouter, closeRouter };