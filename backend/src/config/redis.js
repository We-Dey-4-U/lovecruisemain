const Redis = require("ioredis");

const redis = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null,

    enableReadyCheck: true,

    retryStrategy(times) {
        return Math.min(times * 100, 2000);
    },

    reconnectOnError() {
        return true;
    }
});

redis.on("connect", () => {
    console.log("✅ Redis connected");
});

redis.on("ready", () => {
    console.log("🚀 Redis ready");
});

redis.on("error", (err) => {
    console.error("❌ Redis:", err.message);
});

module.exports = redis;