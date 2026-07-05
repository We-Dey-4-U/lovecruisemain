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
// the client also offers it. Nothing else in this file changed.

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
  if (routers.has(roomId)) return routers.get(roomId);

  const worker = getWorker();
  if (!worker) throw new Error("Mediasoup worker not ready");

  const router = await worker.createRouter({ mediaCodecs: MEDIA_CODECS });

  routers.set(roomId, router);
  console.log(`✅ Premium router created for room ${roomId}`);
  return router;
}

function getRouter(roomId) {
  const router = routers.get(roomId);
  if (!router) throw new Error(`Router not initialized for room ${roomId}`);
  return router;
}

function hasRouter(roomId) {
  return routers.has(roomId);
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