// backend/src/mediasoup/roomRegistry.js
//
// Redis-backed roomId -> nodeId map. Written to every time room.js
// creates/closes a room, so — once you're running more than one
// media-server process — anything (a gateway, a health check, an
// admin dashboard) can ask "which node is hosting this room?"
// without guessing.
//
// On a single node this is inert bookkeeping: every room is always
// "owned" by NODE_ID, and nothing currently reads getRoomNode() to
// make a routing decision (that's Tier-2 work, once there's an
// actual second node and a gateway in front of it). Writing it now
// costs nothing and means zero rework later.

const redis = require("../config/redis");
const { NODE_ID } = require("./nodeRegistry");

const ROOM_KEY_PREFIX = "roomnode:";
const ROOM_TTL_SECONDS = 3600; // refreshed via re-registration; a room living longer than 1h just re-registers on its next producer/consumer event in practice, but see note below

function roomKey(roomId) {
  return `${ROOM_KEY_PREFIX}${roomId}`;
}

async function registerRoom(roomId, nodeId = NODE_ID) {
  try {
    await redis.set(roomKey(roomId), nodeId, "EX", ROOM_TTL_SECONDS);
  } catch (err) {
    console.error(`[roomRegistry] registerRoom(${roomId}) failed:`, err.message);
  }
}

async function getRoomNode(roomId) {
  try {
    return await redis.get(roomKey(roomId));
  } catch (err) {
    console.error(`[roomRegistry] getRoomNode(${roomId}) failed:`, err.message);
    return null;
  }
}

async function unregisterRoom(roomId) {
  try {
    await redis.del(roomKey(roomId));
  } catch (err) {
    console.error(`[roomRegistry] unregisterRoom(${roomId}) failed:`, err.message);
  }
}

/**
 * True if no other node claims this room (covers both "this node
 * owns it" and "no registry entry exists yet" — the latter keeps
 * single-node behavior exactly as before registry existed).
 */
async function isRoomOwnedByThisNode(roomId) {
  const owner = await getRoomNode(roomId);
  return !owner || owner === NODE_ID;
}

module.exports = {
  registerRoom,
  getRoomNode,
  unregisterRoom,
  isRoomOwnedByThisNode
};