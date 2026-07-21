// backend/src/queues/worker.js
//
// Run this as its OWN process/container, scaled independently from
// the API/socket process:
//   node src/queues/worker.js
// or in Docker Compose / k8s as a separate deployment with its own
// replica count and resource limits.

require("dotenv").config();
const { Worker } = require("bullmq");
const { connection } = require("./index");
const db = require("../config/db");

const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || "5", 10);

/* ── NOTIFICATIONS: fan-out to many followers without blocking
   the request that triggered it (e.g. "station went live" to
   10,000 followers). ── */
const notificationsWorker = new Worker(
  "notifications",
  async (job) => {
    const { userIds, type, title, body, data } = job.data;
    for (const userId of userIds) {
      await db.query(
        `INSERT INTO notifications (user_id, type, title, body, data, is_read, created_at)
         VALUES ($1, $2, $3, $4, $5, FALSE, NOW())`,
        [userId, type, title, body, JSON.stringify(data || {})]
      );
    }
    return { delivered: userIds.length };
  },
  { ...connection, concurrency: CONCURRENCY }
);

/* ── MEDIA PROCESSING: audio normalization/transcoding for radio
   song uploads, stream recording post-processing, etc. Delegates
   to the existing audioProcessingService so no logic is duplicated. ── */
const mediaProcessingWorker = new Worker(
  "mediaProcessing",
  async (job) => {
    const { type, payload } = job.data;
    if (type === "processSong") {
      const { processUploadedSong } = require("../services/audioProcessingService");
      return processUploadedSong(payload.localFilePath, payload.originalName, payload.songId);
    }
    throw new Error(`Unknown mediaProcessing job type: ${type}`);
  },
  { ...connection, concurrency: 2 } // CPU-heavy — keep concurrency low per worker instance
);

/* ── ANALYTICS ROLLUPS: e.g. daily radio_analytics_daily aggregation. ── */
const analyticsWorker = new Worker(
  "analytics",
  async (job) => {
    if (job.name === "rollupRadioDaily") {
      await db.query(`
        INSERT INTO radio_analytics_daily (station_id, log_date, total_listeners, total_gift_coins)
        SELECT s.id, CURRENT_DATE,
               COALESCE(SUM(b.listener_count), 0),
               COALESCE((SELECT SUM(gt.total_coins) FROM gift_transactions gt
                         WHERE gt.context_type = 'radio_broadcast'
                           AND gt.context_id IN (SELECT id FROM radio_broadcasts WHERE station_id = s.id)
                           AND gt.created_at::date = CURRENT_DATE), 0)
        FROM radio_stations s
        LEFT JOIN radio_broadcasts b ON b.station_id = s.id AND b.created_at::date = CURRENT_DATE
        GROUP BY s.id
        ON CONFLICT (station_id, log_date) DO UPDATE SET
          total_listeners = EXCLUDED.total_listeners,
          total_gift_coins = EXCLUDED.total_gift_coins
      `);
      return { ok: true };
    }
  },
  { ...connection, concurrency: 1 }
);

/* ── EMAIL ── */
const emailWorker = new Worker(
  "email",
  async (job) => {
    console.log("[email worker] would send:", job.data);
    // Wire in your transactional email provider here (SES/Postmark/etc.)
    return { sent: true };
  },
  { ...connection, concurrency: CONCURRENCY }
);

[notificationsWorker, mediaProcessingWorker, analyticsWorker, emailWorker].forEach((w) => {
  w.on("completed", (job) => console.log(`[worker:${w.name}] ✅ job ${job.id} completed`));
  w.on("failed", (job, err) => console.error(`[worker:${w.name}] ❌ job ${job?.id} failed:`, err.message));
});

console.log(`🚀 Worker process started (concurrency=${CONCURRENCY})`);

async function shutdown() {
  console.log("[worker] Shutting down gracefully...");
  await Promise.allSettled([
    notificationsWorker.close(),
    mediaProcessingWorker.close(),
    analyticsWorker.close(),
    emailWorker.close(),
  ]);
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);