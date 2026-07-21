// backend/src/middlewares/rateLimiter.js
//
// Distributed rate limiting shared across every API instance via
// Redis (a per-instance in-memory limiter is useless once you run
// more than one process — each instance would allow the full quota
// independently). Sliding-window counter implemented with a Redis
// sorted set: cheap, accurate enough for API protection, no extra
// dependency beyond ioredis already in use.
//
// Usage:
//   const { rateLimiter } = require("./middlewares/rateLimiter");
//   app.use("/api/auth/login", rateLimiter({ windowMs: 60_000, max: 10 }));
//   app.use("/api", rateLimiter({ windowMs: 60_000, max: 300 })); // global default

const { redis } = require("../config/redis");

function rateLimiter({ windowMs = 60_000, max = 100, keyPrefix = "rl" } = {}) {
  return async function rateLimiterMiddleware(req, res, next) {
    try {
      // Prefer authenticated user id (fairer + harder to evade via
      // rotating IPs); fall back to IP for anonymous requests.
      const identity = req.user?.id || req.ip;
      const key = `${keyPrefix}:${req.baseUrl}${req.path}:${identity}`;
      const now = Date.now();
      const windowStart = now - windowMs;

      const pipeline = redis.pipeline();
      pipeline.zremrangebyscore(key, 0, windowStart);
      pipeline.zadd(key, now, `${now}-${Math.random()}`);
      pipeline.zcard(key);
      pipeline.pexpire(key, windowMs);
      const results = await pipeline.exec();

      const count = results[2][1];

      res.set("X-RateLimit-Limit", String(max));
      res.set("X-RateLimit-Remaining", String(Math.max(0, max - count)));

      if (count > max) {
        res.set("Retry-After", String(Math.ceil(windowMs / 1000)));
        return res.status(429).json({
          success: false,
          message: "Too many requests — please slow down and try again shortly.",
        });
      }

      next();
    } catch (err) {
      // Fail OPEN: if Redis is briefly unavailable, don't take the
      // entire API down — log it and let the request through.
      console.error("[rateLimiter] Redis error, failing open:", err.message);
      next();
    }
  };
}

// Convenience presets for common sensitive endpoints.
const presets = {
  global: rateLimiter({ windowMs: 60_000, max: 300 }),
  auth: rateLimiter({ windowMs: 60_000, max: 10, keyPrefix: "rl:auth" }),
  giftSend: rateLimiter({ windowMs: 10_000, max: 20, keyPrefix: "rl:gift" }),
  passwordReset: rateLimiter({ windowMs: 3_600_000, max: 5, keyPrefix: "rl:pwreset" }),
};

module.exports = { rateLimiter, presets };