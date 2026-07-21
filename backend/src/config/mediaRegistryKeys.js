// backend/src/config/mediaRegistryKeys.js
//
// Single source of truth for the Redis key schema shared between
// the API process (roomAssignmentService.js, reads/writes
// assignments) and every media node process (mediaNodeRegistry.js,
// writes its own heartbeat). Keeping this in one file prevents the
// two sides ever drifting out of sync on key naming.

module.exports = {
  NODE_KEY_PREFIX: "media:node:",
  NODE_INDEX_KEY: "media:nodes:index",
  ASSIGNMENT_KEY_PREFIX: "media:assignment:",
  NODE_TTL_SECONDS: 15,          // node considered dead if no heartbeat in this window
  HEARTBEAT_INTERVAL_MS: 5000,
  ASSIGNMENT_TTL_SECONDS: 6 * 60 * 60, // 6 hours; refreshed while room is active
};