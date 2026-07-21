// backend/src/queues/index.js
//
// Queue-based background jobs on BullMQ (Redis-backed), so slow or
// bursty work — notification fan-out, video/audio transcoding,
// analytics rollups, email/push delivery — never blocks a request
// or a socket event handler. Workers can be scaled independently
// (separate process/container) from the API instances.
//
// Install: npm install bullmq
//
// Wire up in server.js (API process) — only ENQUEUE here:
//   const { queues } = require("./src/queues");
//   await queues.notifications.add("fanout", { userId, payload });
//
// Run a dedicated worker process (e.g. `node src/queues/worker.js`,
// separate from the API/socket process, scaled separately) — see
// worker.js below for consumption.

const { Queue, QueueEvents } = require("bullmq");

const connection = {
  // BullMQ wants raw ioredis connection options, not a client
  // instance shared with other subscribers, to avoid mode conflicts.
  connection: {
    // Parsed from REDIS_URL so this file has one source of truth.
    ...parseRedisUrl(process.env.REDIS_URL || "redis://127.0.0.1:6379"),
  },
};

function parseRedisUrl(url) {
  try {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: Number(u.port || 6379),
      username: u.username || undefined,
      password: u.password || undefined,
      tls: u.protocol === "rediss:" ? {} : undefined,
    };
  } catch (e) {
    return { host: "127.0.0.1", port: 6379 };
  }
}

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 2000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 86400 },
};

const queues = {
  notifications: new Queue("notifications", { ...connection, defaultJobOptions }),
  mediaProcessing: new Queue("mediaProcessing", { ...connection, defaultJobOptions }),
  analytics: new Queue("analytics", { ...connection, defaultJobOptions }),
  email: new Queue("email", { ...connection, defaultJobOptions }),
};

// Optional: surface queue-level failures to logs/monitoring quickly.
Object.entries(queues).forEach(([name, queue]) => {
  const events = new QueueEvents(name, connection);
  events.on("failed", ({ jobId, failedReason }) => {
    console.error(`[queue:${name}] ❌ job ${jobId} failed:`, failedReason);
  });
});

async function shutdown() {
  await Promise.allSettled(Object.values(queues).map((q) => q.close()));
}

module.exports = { queues, connection, shutdown };