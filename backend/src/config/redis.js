// backend/src/config/redis.js
//
// Fast in-memory presence cache. Presence reads/writes go through
// Redis first (sub-millisecond), with Postgres as the durable,
// recoverable source of truth (see presenceService.js).
//
// FIX (server crash on startup): REDIS_URL points at an Upstash
// endpoint, which REQUIRES TLS. If REDIS_URL still uses the plain
// "redis://" scheme instead of "rediss://", Upstash resets the
// socket on connect (ECONNRESET) every single time, ioredis
// exhausts maxRetriesPerRequest, throws MaxRetriesPerRequestError,
// and — because that rejection is never caught anywhere upstream —
// Node treats it as an unhandled rejection and the whole process
// dies. Two fixes, both required:
//
//   1. .env: REDIS_URL must start with "rediss://" (two s's), not
//      "redis://", when pointing at Upstash.
//   2. This file: reconnectOnError now tells ioredis to actually
//      retry a fresh connection on ECONNRESET/ETIMEDOUT instead of
//      just giving up, and retryStrategy backs off gently instead
//      of hammering Upstash. Even with both of these, a prolonged
//      real outage will still eventually throw — that's what
//      server.js's process-level unhandledRejection/uncaughtException
//      handlers are for now: they log it and keep the process (and
//      your mediasoup workers / live streams) alive instead of
//      crashing everything over a transient Redis blip.
//
// Requires: npm install ioredis

const Redis = require("ioredis");

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

if (!process.env.REDIS_URL) {
  console.warn("⚠️  REDIS_URL not set in .env — falling back to redis://127.0.0.1:6379");
} else if (
  REDIS_URL.includes("upstash.io") &&
  !REDIS_URL.startsWith("rediss://")
) {
  console.warn(
    "⚠️  REDIS_URL points at Upstash but does not use the 'rediss://' " +
    "(TLS) scheme. Upstash requires TLS — this WILL cause repeated " +
    "ECONNRESET errors and can crash the process. Update REDIS_URL in " +
    ".env to start with 'rediss://' instead of 'redis://'."
  );
}

const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  retryStrategy(times) {
    // Gentle backoff instead of hammering Upstash: 200ms, 400ms, ... capped at 2s
    return Math.min(times * 200, 2000);
  },
  reconnectOnError(err) {
    // On these transient errors, tell ioredis to reconnect rather
    // than just failing the in-flight command permanently.
    const shouldReconnect = /ECONNRESET|ETIMEDOUT|EPIPE|READONLY/.test(err.message);
    if (shouldReconnect) {
      console.warn("[redis] reconnectOnError triggered:", err.message);
    }
    return shouldReconnect;
  }
});

redis.on("connect", () => console.log("✅ Redis connected"));
redis.on("error", (err) => console.error("❌ Redis error:", err.message));
redis.on("close", () => console.warn("⚠️  Redis connection closed"));
redis.on("reconnecting", (delay) => console.log(`🔄 Redis reconnecting in ${delay}ms`));

module.exports = redis;