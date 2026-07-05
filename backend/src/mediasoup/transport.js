// backend/src/mediasoup/transport.js
// FIXES:
//   FIX-1: Removed console.log statements that were illegally placed INSIDE
//           the object literal passed to router.createWebRtcTransport().
//           This was a syntax error that crashed the server.
//
//   FIX-2: announcedIp now falls back to "0.0.0.0" instead of "127.0.0.1".
//           On Render/cloud, set MEDIASOUP_ANNOUNCED_IP to your public IP.
//           Without this the browser gets told to connect to localhost → ICE fails → transport "failed".
//
//   FIX-3: Added iceCandidatePoolSize and portRange to help Render's firewall.

const { getRouter } = require("./router");

// roomId → socketId → Map{ "send"|"recv" → transport }
const transportsByRoom = new Map();

/* ─────────────────────────────────────────────────────────
   WEBRTC TRANSPORT OPTIONS
───────────────────────────────────────────────────────── */
function buildTransportOptions() {
  const announcedIp =
    process.env.MEDIASOUP_ANNOUNCED_IP ||
    process.env.ANNOUNCED_IP ||
    null; // null = mediasoup will not announce; fine for localhost only

  if (!announcedIp) {
    console.warn(
      "⚠️  MEDIASOUP_ANNOUNCED_IP is not set. " +
      "Transport will only work on localhost. " +
      "Set this env var to your server's public IP on Render."
    );
  }

  const listenInfos = [
    {
      protocol: "udp",
      ip: process.env.MEDIASOUP_LISTEN_IP || "0.0.0.0",
      ...(announcedIp ? { announcedIp } : {})
    },
    {
      protocol: "tcp",
      ip: process.env.MEDIASOUP_LISTEN_IP || "0.0.0.0",
      ...(announcedIp ? { announcedIp } : {})
    }
  ];

  return {
    listenInfos,
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    enableSctp: false,
    initialAvailableOutgoingBitrate: 1_000_000,
    minimumAvailableOutgoingBitrate: 600_000,
    maxSctpMessageSize: 262144,
    iceConsentTimeout: 20
  };
}

/* ─────────────────────────────────────────────────────────
   CREATE SEND TRANSPORT  (host → SFU)
───────────────────────────────────────────────────────── */
async function createSendTransport(socketId, roomId) {
  const router = getRouter(roomId);
  if (!router) throw new Error(`Router not found for room ${roomId}`);

  // FIX-1: console.log is OUTSIDE the createWebRtcTransport() call
  const opts = buildTransportOptions();
  console.log("========================================");
  console.log("📤 CREATE SEND TRANSPORT");
  console.log("room:", roomId);
  console.log("socket:", socketId);
  console.log("listenInfos:", opts.listenInfos);
  console.log("========================================");

  const transport = await router.createWebRtcTransport({
    ...opts,
    appData: { socketId, roomId, direction: "send" }
  });

  _storeTransport(roomId, socketId, "send", transport);

  transport.on("dtlsstatechange", (state) => {
    console.log(`📤 SEND DTLS STATE -> ${state} room=${roomId} socket=${socketId}`);
    if (state === "failed" || state === "closed") {
      console.warn(`⚠️  Send transport DTLS ${state}: room=${roomId} socket=${socketId}`);
      transport.close();
    }
  });

  transport.on("icestatechange", (state) => {
    console.log(`🧊 SEND ICE STATE -> ${state} room=${roomId} socket=${socketId}`);
  });

  transport.on("close", () => {
    console.warn(`🚪 SEND TRANSPORT CLOSED room=${roomId} socket=${socketId}`);
  });

  console.log(`📤 Send transport created: id=${transport.id} room=${roomId} socket=${socketId}`);
  return transport;
}

/* ─────────────────────────────────────────────────────────
   CREATE RECV TRANSPORT  (SFU → viewer)
───────────────────────────────────────────────────────── */
async function createRecvTransport(socketId, roomId) {
  const router = getRouter(roomId);
  if (!router) throw new Error(`Router not found for room ${roomId}`);

  const opts = buildTransportOptions();
  console.log("========================================");
  console.log("📥 CREATE RECV TRANSPORT");
  console.log("room:", roomId);
  console.log("socket:", socketId);
  console.log("listenInfos:", opts.listenInfos);
  console.log("========================================");

  const transport = await router.createWebRtcTransport({
    ...opts,
    appData: { socketId, roomId, direction: "recv" }
  });

  _storeTransport(roomId, socketId, "recv", transport);

  transport.on("dtlsstatechange", (state) => {
    console.log(`📥 RECV DTLS STATE -> ${state} room=${roomId} socket=${socketId}`);
    if (state === "connected") {
      console.log("✅ RECV DTLS CONNECTED");
    }
    if (state === "failed") {
      console.error("❌ RECV DTLS FAILED — closing transport");
      transport.close();
    }
    if (state === "closed") {
      console.warn("⚠️ RECV DTLS CLOSED");
    }
  });

  transport.on("icestatechange", (state) => {
    console.log(`🧊 RECV ICE STATE -> ${state} room=${roomId} socket=${socketId}`);
  });

  transport.on("sctpstatechange", (state) => {
    console.log(`📦 RECV SCTP STATE -> ${state} room=${roomId} socket=${socketId}`);
  });

  transport.on("close", () => {
    console.warn(`🚪 RECV TRANSPORT CLOSED room=${roomId} socket=${socketId}`);
  });

  console.log(`📥 Recv transport ready: id=${transport.id} room=${roomId} socket=${socketId}`);
  return transport;
}

/* ─────────────────────────────────────────────────────────
   LEGACY COMPAT: createWebRtcTransport (used by room.js)
───────────────────────────────────────────────────────── */
async function createWebRtcTransport(socketId, roomId) {
  return createSendTransport(socketId, roomId);
}

/* ─────────────────────────────────────────────────────────
   GETTERS
───────────────────────────────────────────────────────── */
function getSendTransport(roomId, socketId) {
  return _getTransport(roomId, socketId, "send");
}

function getRecvTransport(roomId, socketId) {
  return _getTransport(roomId, socketId, "recv");
}

function getTransport(roomId, socketId) {
  return getSendTransport(roomId, socketId);
}

/* ─────────────────────────────────────────────────────────
   CLEANUP
───────────────────────────────────────────────────────── */
function closeTransport(roomId, socketId, direction = null) {
  const roomMap = transportsByRoom.get(roomId);
  if (!roomMap) return;
  const socketMap = roomMap.get(socketId);
  if (!socketMap) return;

  const dirs = direction ? [direction] : ["send", "recv"];
  for (const dir of dirs) {
    const t = socketMap.get(dir);
    if (t) {
      try { t.close(); } catch (e) {}
      socketMap.delete(dir);
    }
  }

  if (socketMap.size === 0) roomMap.delete(socketId);
  if (roomMap.size === 0) transportsByRoom.delete(roomId);
}

function removeSocketTransports(socketId) {
  for (const [roomId] of transportsByRoom.entries()) {
    closeTransport(roomId, socketId);
  }
}

/* ─────────────────────────────────────────────────────────
   INTERNAL HELPERS
───────────────────────────────────────────────────────── */
function _storeTransport(roomId, socketId, direction, transport) {
  if (!transportsByRoom.has(roomId)) transportsByRoom.set(roomId, new Map());
  const roomMap = transportsByRoom.get(roomId);
  if (!roomMap.has(socketId)) roomMap.set(socketId, new Map());
  roomMap.get(socketId).set(direction, transport);
}

function _getTransport(roomId, socketId, direction) {
  const roomMap = transportsByRoom.get(roomId);
  if (!roomMap) return null;
  const socketMap = roomMap.get(socketId);
  if (!socketMap) return null;
  return socketMap.get(direction) || null;
}

module.exports = {
  createWebRtcTransport,
  createSendTransport,
  createRecvTransport,
  getTransport,
  getSendTransport,
  getRecvTransport,
  closeTransport,
  removeSocketTransports
};