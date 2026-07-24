// backend/src/sockets/redisAdapter.js
//
// Attaches @socket.io/redis-adapter to the Socket.IO server so
// io.to(room).emit(...) broadcasts correctly across MULTIPLE
// Node.js processes/instances, using the same REDIS_URL you
// already use for presence (config/redis.js).
//
// On a single instance (your current 1-VPS setup) this changes
// NOTHING observable — Socket.IO's default in-memory adapter
// already handles single-process rooms correctly. This only
// matters the moment you run more than one API/socket process
// behind a load balancer, at which point it becomes load-bearing:
// without it, io.to(`room:${roomId}`) would only reach sockets
// connected to THAT SAME process, silently dropping viewers/guests
// connected to a different instance.
//
// FIX (server crash): pub/sub connections MUST NOT inherit a capped
// maxRetriesPerRequest. A subscribe-mode Redis connection holds
// commands pending indefinitely by design (it's listening, not
// request/response) — capping retries at 3 on THIS specific
// connection is what turned a transient Upstash TLS/ECONNRESET blip
// into a fatal, unhandled MaxRetriesPerRequestError that crashed the
// whole Node process. redis.duplicate() below now explicitly
// overrides maxRetriesPerRequest to null (per the official
// @socket.io/redis-adapter guidance) for both the pub and sub
// clients, while still inheriting the TLS/rediss:// connection
// details and retryStrategy/reconnectOnError behavior from the base
// client in config/redis.js.
//
// MUST be attached BEFORE io.on("connection", ...) is registered
// (see sockets/index.js) — swapping the adapter after sockets have
// already joined rooms under the old adapter can lose those
// room memberships.
//
// npm install @socket.io/redis-adapter

const { createAdapter } = require("@socket.io/redis-adapter");
const redis = require("../config/redis");

module.exports = function attachRedisAdapter(io) {
  try {
    // FIX: override maxRetriesPerRequest to null specifically for
    // these two duplicated connections. Everything else (host, TLS
    // via rediss://, retryStrategy, reconnectOnError) is inherited
    // from the base client's options.
    const pubClient = redis.duplicate({ maxRetriesPerRequest: null });
    const subClient = redis.duplicate({ maxRetriesPerRequest: null });

    pubClient.on("error", (err) => console.error("[redisAdapter] pubClient error:", err.message));
    subClient.on("error", (err) => console.error("[redisAdapter] subClient error:", err.message));

    io.adapter(createAdapter(pubClient, subClient));
    console.log("✅ Socket.IO Redis adapter attached — ready for multi-instance broadcasts");
  } catch (err) {
    console.error(
      "❌ Failed to attach Redis adapter — falling back to the default in-memory adapter " +
      "(fine for a single instance, but broadcasts will NOT reach other instances if you " +
      "scale to more than one process):",
      err.message
    );
  }
};