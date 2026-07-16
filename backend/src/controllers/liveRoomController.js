// backend/src/controllers/liveRoomController.js

const db = require("../config/db");

const VALID_MODES = ["social", "podcast"];

const liveRoomController = {

  /* ── CREATE ── */
  async create(req, res, next) {
    try {
      const { title, description, mode } = req.body;
      if (!title || !title.trim()) {
        return res.status(400).json({ success: false, message: "Title is required" });
      }

      // Default to "social" for any caller that doesn't send mode (older
      // clients, direct API use) rather than rejecting the request —
      // Social Live is the original/default room type. Anything sent
      // that isn't one of the two known modes is also treated as an
      // error rather than silently coerced, so a typo in the client
      // never quietly creates a room under the wrong type.
      const resolvedMode = mode || "social";
      if (!VALID_MODES.includes(resolvedMode)) {
        return res.status(400).json({
          success: false,
          message: `Invalid mode "${resolvedMode}" — must be one of: ${VALID_MODES.join(", ")}`
        });
      }

      const channelName = `room_${Date.now()}_${req.user.id.slice(0, 8)}`;

      const { rows } = await db.query(
        `INSERT INTO live_rooms (host_id, title, description, channel_name, mode, status, started_at)
         VALUES ($1, $2, $3, $4, $5, 'live', NOW())
         RETURNING *`,
        [req.user.id, title.trim(), description || "", channelName, resolvedMode]
      );

      return res.status(201).json({ success: true, data: rows[0] });
    } catch (err) {
      next(err);
    }
  },

  /* ── LIST ALL LIVE ROOMS ── */
  async list(req, res, next) {
    try {
      // lr.* already carries `mode` now that the column exists — no
      // change needed here beyond the column being present in the DB.
      // discover.html reads it directly off each room object.
      const { rows } = await db.query(
        `SELECT lr.*, u.username, u.avatar_url, u.display_name
         FROM live_rooms lr
         JOIN users u ON u.id = lr.host_id
         WHERE lr.status = 'live'
         ORDER BY lr.viewer_count DESC, lr.started_at DESC`
      );

      return res.json({ success: true, data: rows });
    } catch (err) {
      next(err);
    }
  },

  /* ── GET SINGLE ROOM ── */
  async getById(req, res, next) {
    try {
      const { rows } = await db.query(
        `SELECT lr.*, u.username, u.avatar_url, u.display_name
         FROM live_rooms lr
         JOIN users u ON u.id = lr.host_id
         WHERE lr.id = $1`,
        [req.params.id]
      );

      if (!rows.length) {
        return res.status(404).json({ success: false, message: "Room not found" });
      }

      return res.json({ success: true, data: rows[0] });
    } catch (err) {
      next(err);
    }
  },

  /* ── JOIN ── */
  async join(req, res, next) {
    try {
      const roomId = req.params.id;
      const userId = req.user.id;

      const { rows: roomRows } = await db.query(
        `SELECT id, host_id FROM live_rooms WHERE id = $1 AND status = 'live'`,
        [roomId]
      );

      if (!roomRows.length) {
        return res.status(404).json({ success: false, message: "Room not found or not live" });
      }

      // Add to room_members
      await db.query(
        `INSERT INTO room_members (room_id, user_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [roomId, userId, roomRows[0].host_id === userId ? "host" : "viewer"]
      );

      // Track viewer entry
      await db.query(
        `INSERT INTO live_room_viewers (room_id, user_id) VALUES ($1, $2)`,
        [roomId, userId]
      );

      // Presence tracking
      await db.query(
        `INSERT INTO user_presence (user_id, is_online, current_room_id, last_seen_at)
         VALUES ($1, TRUE, $2, NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           is_online = TRUE,
           current_room_id = EXCLUDED.current_room_id,
           last_seen_at = NOW()`,
        [userId, roomId]
      );

      // Update viewer count
      await db.query(
        `UPDATE live_rooms SET viewer_count = (
           SELECT COUNT(*) FROM room_members WHERE room_id = $1
         ) WHERE id = $1`,
        [roomId]
      );

      return res.json({ success: true, message: "Joined room" });
    } catch (err) {
      next(err);
    }
  },

  /* ── TOP GIFTERS ── */
  async topGifters(req, res, next) {
    try {
      const { rows } = await db.query(
        `SELECT u.id, u.username, u.avatar_url,
                COALESCE(SUM(gt.total_coins), 0) AS total
         FROM gift_transactions gt
         JOIN users u ON u.id = gt.sender_id
         WHERE gt.context_type = 'live_room' AND gt.context_id = $1
         GROUP BY u.id, u.username, u.avatar_url
         ORDER BY total DESC
         LIMIT 5`,
        [req.params.id]
      );

      return res.json({ success: true, data: rows });
    } catch (err) {
      next(err);
    }
  },

  /* ── LEAVE ── */
  async leave(req, res, next) {
    try {
      const roomId = req.params.id;
      const userId = req.user.id;

      await db.query(
        `DELETE FROM room_members WHERE room_id = $1 AND user_id = $2`,
        [roomId, userId]
      );

      await db.query(
        `UPDATE live_room_viewers SET left_at = NOW()
         WHERE id = (
           SELECT id FROM live_room_viewers
           WHERE room_id = $1 AND user_id = $2 AND left_at IS NULL
           ORDER BY joined_at DESC LIMIT 1
         )`,
        [roomId, userId]
      );

      await db.query(
        `UPDATE user_presence
         SET current_room_id = NULL, last_seen_at = NOW()
         WHERE user_id = $1`,
        [userId]
      );

      await db.query(
        `UPDATE live_rooms SET viewer_count = (
           SELECT COUNT(*) FROM room_members WHERE room_id = $1
         ) WHERE id = $1`,
        [roomId]
      );

      return res.json({ success: true, message: "Left room" });
    } catch (err) {
      next(err);
    }
  },

  /* ── END LIVE ── */
  async end(req, res, next) {
    try {
      // Only host can end
      const { rows } = await db.query(
        `UPDATE live_rooms SET status = 'ended', ended_at = NOW()
         WHERE id = $1 AND host_id = $2
         RETURNING *`,
        [req.params.id, req.user.id]
      );

      if (!rows.length) {
        return res.status(403).json({ success: false, message: "Not authorized or room not found" });
      }

      // Clean up room_members
      await db.query(`DELETE FROM room_members WHERE room_id = $1`, [req.params.id]);

      return res.json({ success: true, message: "Live ended" });
    } catch (err) {
      next(err);
    }
  }
};

module.exports = liveRoomController;