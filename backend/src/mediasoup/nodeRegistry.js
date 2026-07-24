// backend/src/mediasoup/nodeRegistry.js
//
// Registers THIS process as a "media node" in Redis with a
// periodic heartbeat + live load snapshot. On a single VPS this is
// a pool of one — it changes nothing about how rooms are created
// or found today. What it buys you: the moment you add a second
// media-server box, both nodes are already visible to each other
// in Redis, and getLeastLoadedNode() is ready to use for routing
// new rooms — no new interface to design later, just a call site
// to wire up in whichever gateway/allocator code you add at that
// point.
//
// Nothing in stream.socket.js or radioMedia.socket.js calls this
// directly — only server.js (to start the heartbeat) and
// roomRegistry.js (to stamp which node owns a room).

const os = require("os");
const crypto = require("crypto");
const redis = require("../config/redis");

const NODE_ID =
  process.env.MEDIA_NODE_ID ||
  `${os.hostname()}-${process.pid}-${crypto.randomBytes(3).toString("hex")}`;

const NODE_KEY_PREFIX = "medianode:";
const HEARTBEAT_MS = 10_000;
const NODE_TTL_SECONDS = 30; // if a node stops heartbeating, it disappears from getAllNodes() within 30s

let heartbeatTimer = null;

function nodeKey(id) {
  return `${NODE_KEY_PREFIX}${id}`;
}

async function publishHeartbeat(loadFn) {
  try {
    const load = typeof loadFn === "function" ? await loadFn() : {};
    const payload = JSON.stringify({
      nodeId: NODE_ID,
      updatedAt: Date.now(),
      roomCount: load.roomCount ?? 0,
      producerCount: load.producerCount ?? 0,
      announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP || null
    });
    await redis.set(nodeKey(NODE_ID), payload, "EX", NODE_TTL_SECONDS);
  } catch (err) {
    console.error("[nodeRegistry] heartbeat publish failed:", err.message);
  }
}

/**
 * Starts the periodic heartbeat. `loadFn` is an optional function
 * (sync or async) returning { roomCount, producerCount } — pass
 * getAllRooms()-derived numbers from room.js so other nodes (once
 * you have more than one) can see real load, not just "alive".
 */
function startHeartbeat(loadFn) {
  if (heartbeatTimer) return;
  publishHeartbeat(loadFn);
  heartbeatTimer = setInterval(() => publishHeartbeat(loadFn), HEARTBEAT_MS);
  console.log(`[nodeRegistry] ✅ Heartbeat started for node ${NODE_ID}`);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

/**
 * NOTE: uses redis.keys() — an O(N) scan across the "medianode:*"
 * keyspace. Perfectly fine for the realistic node counts here
 * (single digits to low tens of media servers); if you ever run
 * hundreds of media nodes, switch this to a Redis SET tracked via
 * SADD/SREM instead of a keys() scan.
 */
async function getAllNodes() {
  try {
    const keys = await redis.keys(`${NODE_KEY_PREFIX}*`);
    if (!keys.length) return [];
    const values = await redis.mget(keys);
    return values.filter(Boolean).map((v) => JSON.parse(v));
  } catch (err) {
    console.error("[nodeRegistry] getAllNodes failed:", err.message);
    return [];
  }
}

async function getLeastLoadedNode() {
  const nodes = await getAllNodes();
  if (!nodes.length) return NODE_ID; // no registry data yet — fall back to self
  return nodes.reduce((best, n) => (n.roomCount < best.roomCount ? n : best), nodes[0]).nodeId;
}

module.exports = {
  NODE_ID,
  startHeartbeat,
  stopHeartbeat,
  getAllNodes,
  getLeastLoadedNode
};