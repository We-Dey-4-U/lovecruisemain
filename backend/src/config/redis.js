// backend/src/config/redis.js
//
// Fast in-memory presence cache. Presence reads/writes go through
// Redis first (sub-millisecond), with Postgres as the durable,
// recoverable source of truth (see presenceService.js).
//
// Requires: npm install ioredis

const Redis = require("ioredis");

const redis = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379", {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    return Math.min(times * 200, 2000);
  }
});

redis.on("connect", () => console.log("✅ Redis connected"));
redis.on("error", (err) => console.error("❌ Redis error:", err.message));

module.exports = redis;