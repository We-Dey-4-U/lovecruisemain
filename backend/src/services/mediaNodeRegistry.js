// backend/src/services/mediaNodeRegistry.js
//
// Redis-backed registry of live media nodes. Media nodes WRITE to
// this (heartbeat every 5s with their current load); the API
// process READS from this to pick where to send a new room.
//
// A node's entry expires automatically (Redis TTL) if its heartbeat
// stops — a crashed/killed node silently drops out of rotation
// within NODE_TTL_SECONDS without anyone needing to detect the
// crash explicitly.

const { redis } = require("../config/redis");
const {
  NODE_KEY_PREFIX,
  NODE_INDEX_KEY,
  ASSIGNMENT_KEY_PREFIX,
  NODE_TTL_SECONDS,
  HEARTBEAT_INTERVAL_MS,
  ASSIGNMENT_TTL_SECONDS,
} = require("../config/mediaRegistryKeys");

function nodeKey(nodeId) {
  return `${NODE_KEY_PREFIX}${nodeId}`;
}
function assignmentKey(roomId) {
  return `${ASSIGNMENT_KEY_PREFIX}${roomId}`;
}

/* ============================================================
   NODE LIFECYCLE (called by media-server.js)
   ============================================================ */
async function registerNode(nodeInfo) {
  await redis.set(nodeKey(nodeInfo.nodeId), JSON.stringify(nodeInfo), "EX", NODE_TTL_SECONDS);
  await redis.sadd(NODE_INDEX_KEY, nodeInfo.nodeId);
}

// Heartbeat is just a re-register with fresh metrics + TTL reset.
async function heartbeat(nodeInfo) {
  await registerNode(nodeInfo);
}

async function deregisterNode(nodeId) {
  await redis.del(nodeKey(nodeId));
  await redis.srem(NODE_INDEX_KEY, nodeId);
}

/* ============================================================
   NODE DISCOVERY (called by the API process)
   ============================================================ */
async function listActiveNodes() {
  const nodeIds = await redis.smembers(NODE_INDEX_KEY);
  if (!nodeIds.length) return [];

  const pipeline = redis.pipeline();
  nodeIds.forEach((id) => pipeline.get(nodeKey(id)));
  const results = await pipeline.exec();

  const nodes = [];
  const staleIds = [];

  results.forEach(([err, val], i) => {
    if (!err && val) {
      try {
        nodes.push(JSON.parse(val));
      } catch (e) {
        staleIds.push(nodeIds[i]);
      }
    } else {
      // Key expired (TTL) but the index set still references it —
      // clean the index lazily instead of running a background sweep.
      staleIds.push(nodeIds[i]);
    }
  });

  if (staleIds.length) {
    redis.srem(NODE_INDEX_KEY, ...staleIds).catch(() => {});
  }

  return nodes;
}

async function getNode(nodeId) {
  const raw = await redis.get(nodeKey(nodeId));
  return raw ? JSON.parse(raw) : null;
}

/* ============================================================
   ROOM -> NODE ASSIGNMENT
   ============================================================ */
async function getAssignment(roomId) {
  const raw = await redis.get(assignmentKey(roomId));
  return raw ? JSON.parse(raw) : null;
}

async function setAssignment(roomId, assignment) {
  await redis.set(assignmentKey(roomId), JSON.stringify(assignment), "EX", ASSIGNMENT_TTL_SECONDS);
}

async function refreshAssignment(roomId) {
  await redis.expire(assignmentKey(roomId), ASSIGNMENT_TTL_SECONDS);
}

async function releaseAssignment(roomId) {
  await redis.del(assignmentKey(roomId));
}

module.exports = {
  NODE_TTL_SECONDS,
  HEARTBEAT_INTERVAL_MS,
  registerNode,
  heartbeat,
  deregisterNode,
  listActiveNodes,
  getNode,
  getAssignment,
  setAssignment,
  refreshAssignment,
  releaseAssignment,
};