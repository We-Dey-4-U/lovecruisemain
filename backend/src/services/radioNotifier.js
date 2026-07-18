// backend/src/services/radioNotifier.js
//
// Fixes: "🔔 Get notified when shows start ❌ ... no scheduler/
// cron ever fires a notification when a show actually goes live."
//
// Polls radio_shows once a minute for shows starting within the
// next 5 minutes that haven't been notified yet, and pushes a
// notification (DB row + realtime socket event) to every follower
// of that show's station. Call start(io) once at server boot,
// wherever your io instance is created (e.g. server.js / socket
// bootstrap file) — io is optional; without it, notifications
// still persist to the `notifications` table, they just won't
// push live over the socket.

const db = require("../config/db");

const CHECK_INTERVAL_MS = 60_000;
const LOOKAHEAD_MINUTES = 5;

async function notifyFollowers(io, stationId, payload) {
  try {
    const { rows } = await db.query(
      `SELECT user_id FROM radio_station_follows WHERE station_id = $1`,
      [stationId]
    );
    for (const row of rows) {
      try {
        await db.query(
          `INSERT INTO notifications (user_id, type, title, body, data, is_read, created_at)
           VALUES ($1, $2, $3, $4, $5, FALSE, NOW())`,
          [row.user_id, payload.type, payload.title, payload.body, JSON.stringify(payload.data)]
        );
      } catch (e) {
        console.warn("[radioNotifier] notification insert skipped:", e.message);
      }
      if (io) {
        io.to(`user:${row.user_id}`).emit("newNotification", {
          ...payload,
          createdAt: new Date().toISOString()
        });
      }
    }
  } catch (err) {
    console.error("[radioNotifier.notifyFollowers] ❌", err);
  }
}

async function checkUpcomingShows(io) {
  try {
    const { rows } = await db.query(
      `SELECT sh.id, sh.title, sh.station_id, sh.scheduled_at,
              s.title AS station_title
       FROM radio_shows sh
       JOIN radio_stations s ON s.id = sh.station_id
       WHERE sh.is_active = TRUE
         AND sh.notified_at IS NULL
         AND sh.scheduled_at IS NOT NULL
         AND sh.scheduled_at <= NOW() + ($1 || ' minutes')::interval
         AND sh.scheduled_at >= NOW() - INTERVAL '2 minutes'`,
      [LOOKAHEAD_MINUTES]
    );

    for (const show of rows) {
      await notifyFollowers(io, show.station_id, {
        type: "radio_show_starting",
        title: `${show.station_title} starts soon`,
        body: `"${show.title}" is starting shortly`,
        data: { showId: show.id, stationId: show.station_id }
      });
      await db.query(`UPDATE radio_shows SET notified_at = NOW() WHERE id = $1`, [show.id]);
    }
  } catch (err) {
    console.error("[radioNotifier.checkUpcomingShows] ❌", err);
  }
}

let intervalHandle = null;

function start(io) {
  if (intervalHandle) return; // already running
  checkUpcomingShows(io).catch(() => {});
  intervalHandle = setInterval(() => checkUpcomingShows(io).catch(() => {}), CHECK_INTERVAL_MS);
  console.log("📻 [radioNotifier] started (checking every 60s for shows starting soon)");
}

function stop() {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
}

module.exports = { start, stop };