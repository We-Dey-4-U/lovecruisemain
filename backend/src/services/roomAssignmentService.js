// backend/src/services/roomAssignmentService.js
//
// Runs on the API process. Decides WHICH media node a given
// live-room or radio-broadcast should live on, and remembers that
// decision so every subsequent request for the same room returns
// the same node (a room's Mediasoup router only exists on one
// physical node — you can't split it).
//
// Placement strategy: least-loaded node, optionally constrained to
// a preferred region first (geo-routing). "Load" is roomCount /
// capacity — a simple, predictable metric that's easy to reason
// about and tune per node via MEDIA_NODE_CAPACITY.

const mediaNodeRegistry = require("./mediaNodeRegistry");

function loadScore(node) {
  const capacity = node.capacity || 100;
  const roomCount = node.roomCount || 0;
  return roomCount / capacity;
}

async function pickBestNode({ preferredRegion } = {}) {
  const nodes = await mediaNodeRegistry.listActiveNodes();
  if (!nodes.length) return null;

  // Prefer nodes with headroom; if literally every node is at/over
  // capacity, still pick the least-bad one rather than failing hard —
  // better to overload gracefully than reject a broadcast outright.
  const withHeadroom = nodes.filter((n) => (n.roomCount || 0) < (n.capacity || 100));
  const pool = withHeadroom.length ? withHeadroom : nodes;

  let candidates = pool;
  if (preferredRegion) {
    const regional = pool.filter((n) => n.region === preferredRegion);
    if (regional.length) candidates = regional;
  }

  candidates.sort((a, b) => loadScore(a) - loadScore(b));
  return candidates[0];
}

/**
 * Returns { roomId, roomType, nodeId, publicUrl, region, node }
 * Idempotent: calling this again for the same roomId while its
 * assigned node is still alive returns the SAME node (and refreshes
 * the assignment TTL), so a client re-fetching the assignment mid-
 * broadcast never gets bounced to a different node.
 */
async function assignNode({ roomId, roomType = "live", preferredRegion } = {}) {
  if (!roomId) throw new Error("roomId is required for media node assignment");

  const existing = await mediaNodeRegistry.getAssignment(roomId);
  if (existing) {
    const node = await mediaNodeRegistry.getNode(existing.nodeId);
    if (node) {
      await mediaNodeRegistry.refreshAssignment(roomId);
      return { ...existing, node };
    }
    // The previously-assigned node is gone (crashed, scaled down, or
    // its heartbeat lapsed). KNOWN LIMITATION: this does NOT migrate
    // any in-flight WebRTC state — an active broadcast whose node
    // died needs the host to reconnect, which will land on a freshly
    // assigned node and start a new Mediasoup room from scratch.
    // True seamless media failover would require replicating
    // producer/consumer state across nodes, which is a much larger
    // project than reassignment — flagged here rather than silently
    // implied as "solved".
  }

  const node = await pickBestNode({ preferredRegion });
  if (!node) {
    const err = new Error("No media nodes are currently available");
    err.status = 503;
    throw err;
  }

  const assignment = {
    roomId,
    roomType,
    nodeId: node.nodeId,
    publicUrl: node.publicUrl,
    region: node.region,
    assignedAt: new Date().toISOString(),
  };

  await mediaNodeRegistry.setAssignment(roomId, assignment);
  return { ...assignment, node };
}

async function getAssignment(roomId) {
  const assignment = await mediaNodeRegistry.getAssignment(roomId);
  if (!assignment) return null;
  const node = await mediaNodeRegistry.getNode(assignment.nodeId);
  return { ...assignment, node };
}

async function releaseAssignment(roomId) {
  await mediaNodeRegistry.releaseAssignment(roomId);
}

module.exports = { assignNode, getAssignment, releaseAssignment, pickBestNode };