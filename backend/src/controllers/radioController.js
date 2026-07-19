// backend/src/controllers/radioController.js
//
// 📻 Lovecruise Radio
// ------------------------------------------------------------
// PHASE 2 ADDITIONS (this pass):
//   - Co-host/caller request → approve/reject → roster → leave/kick
//     (activates the previously-dead radio_cohosts schema)
//   - Live polls: create / vote / close / get-active
//   - Members-only station gating on join (radio_station_subscriptions)
//   - Admin-settable is_official / is_members_only / status via
//     the station update path already present (adminController.js
//     has its own dedicated moderation endpoints too)
//   - Show-start + go-live notifications (writes to `notifications`
//     table + emits over the shared `user:{id}` socket room so
//     "Remind me" followers actually get pinged, not just followed)
//
// Everything from Phase 1 (categories/stations/shows/broadcasts/
// join/leave/end/top-gifters/song-requests) is unchanged below.

const crypto = require("crypto");
const db = require("../config/db");
const presenceService = require("../services/presenceService");

function generateStreamKey() {
  return crypto.randomBytes(20).toString("hex");
}


function buildHlsUrl(streamKey) {
  return "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8";
}

//function buildHlsUrl(streamKey) {
 // const base = process.env.RADIO_HLS_BASE_URL || "https://radio-ingest.example.com/hls";
//  return `${base}/${streamKey}/index.m3u8`;
//}

// Write a notification row + push it live if the user is connected.
// `req.app.get('io')` is used when available (routes are hit via
// Express, which does have access to the io instance set on app).
async function notifyUser(io, userId, { type, title, body, data = {} }) {
  try {
    await db.query(
      `INSERT INTO notifications (user_id, type, title, body, data, is_read, created_at)
       VALUES ($1, $2, $3, $4, $5, FALSE, NOW())`,
      [userId, type, title, body, JSON.stringify(data)]
    );
  } catch (err) {
    console.warn("[notifyUser] persistence skipped:", err.message);
  }
  if (io) {
    io.to(`user:${userId}`).emit("newNotification", { type, title, body, data, createdAt: new Date().toISOString() });
  }
}

async function notifyStationFollowers(io, stationId, payload) {
  try {
    const { rows } = await db.query(
      `SELECT user_id FROM radio_station_follows WHERE station_id = $1`,
      [stationId]
    );
    for (const row of rows) {
      await notifyUser(io, row.user_id, payload);
    }
  } catch (err) {
    console.error("[notifyStationFollowers] ❌", err);
  }
}

const RadioController = {

  /* ============================================================
     CATEGORIES
     ============================================================ */
  async listCategories(req, res, next) {
    try {
      const { rows } = await db.query(
        `SELECT key, label, icon, sort_order
         FROM radio_categories
         WHERE is_active = TRUE
         ORDER BY sort_order`
      );
      res.json({ success: true, data: rows });
    } catch (err) {
      next(err);
    }
  },

  /* ============================================================
     STATIONS
     ============================================================ */
  async createStation(req, res, next) {
    try {
      const { title, description, categoryKey, coverUrl, jingleUrl, isMembersOnly } = req.body;
      if (!title || !title.trim()) {
        return res.status(400).json({ success: false, message: "Station title is required" });
      }

      const { rows } = await db.query(
        `INSERT INTO radio_stations (host_id, title, description, category_key, cover_url, jingle_url, is_members_only)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [req.user.id, title.trim(), description || "", categoryKey || null, coverUrl || null, jingleUrl || null, !!isMembersOnly]
      );

      res.status(201).json({ success: true, data: rows[0] });
    } catch (err) {
      next(err);
    }
  },

  async listStations(req, res, next) {
    try {
      const { category, hostId } = req.query;
      const conditions = [`s.status = 'active'`];
      const params = [];

      if (category) {
        params.push(category);
        conditions.push(`s.category_key = $${params.length}`);
      }
      if (hostId) {
        params.push(hostId);
        conditions.push(`s.host_id = $${params.length}`);
      }

      const { rows } = await db.query(
        `SELECT s.*, u.username, u.display_name, u.avatar_url,
                rc.label AS category_label, rc.icon AS category_icon,
                EXISTS (
                  SELECT 1 FROM radio_broadcasts b
                  WHERE b.station_id = s.id AND b.status = 'live'
                ) AS is_live
         FROM radio_stations s
         JOIN users u ON u.id = s.host_id
         LEFT JOIN radio_categories rc ON rc.key = s.category_key
         WHERE ${conditions.join(" AND ")}
         ORDER BY s.is_official DESC, is_live DESC, s.follower_count DESC, s.created_at DESC`,
        params
      );

      res.json({ success: true, data: rows });
    } catch (err) {
      next(err);
    }
  },

  async getStation(req, res, next) {
    try {
      const { rows } = await db.query(
        `SELECT s.*, u.username, u.display_name, u.avatar_url,
                rc.label AS category_label, rc.icon AS category_icon
         FROM radio_stations s
         JOIN users u ON u.id = s.host_id
         LEFT JOIN radio_categories rc ON rc.key = s.category_key
         WHERE s.id = $1`,
        [req.params.id]
      );
      if (!rows.length) {
        return res.status(404).json({ success: false, message: "Station not found" });
      }

      const { rows: liveRows } = await db.query(
        `SELECT * FROM radio_broadcasts WHERE station_id = $1 AND status = 'live' LIMIT 1`,
        [req.params.id]
      );

      const { rows: followRow } = await db.query(
        `SELECT 1 FROM radio_station_follows WHERE station_id = $1 AND user_id = $2`,
        [req.params.id, req.user.id]
      );

      const { rows: subRow } = await db.query(
        `SELECT 1 FROM radio_station_subscriptions WHERE station_id = $1 AND user_id = $2 AND status = 'active'`,
        [req.params.id, req.user.id]
      );

      res.json({
        success: true,
        data: {
          ...rows[0],
          currentBroadcast: liveRows[0] || null,
          is_following: !!followRow.length,
          is_subscribed: !!subRow.length
        }
      });
    } catch (err) {
      next(err);
    }
  },

  async updateStation(req, res, next) {
    try {
      const { title, description, categoryKey, coverUrl, jingleUrl, isMembersOnly } = req.body;

      const { rows } = await db.query(
        `UPDATE radio_stations SET
           title            = COALESCE($3, title),
           description      = COALESCE($4, description),
           category_key     = COALESCE($5, category_key),
           cover_url        = COALESCE($6, cover_url),
           jingle_url       = COALESCE($7, jingle_url),
           is_members_only  = COALESCE($8, is_members_only)
         WHERE id = $1 AND host_id = $2
         RETURNING *`,
        [req.params.id, req.user.id, title, description, categoryKey, coverUrl, jingleUrl,
          isMembersOnly === undefined ? null : !!isMembersOnly]
      );

      if (!rows.length) {
        return res.status(403).json({ success: false, message: "Not authorized or station not found" });
      }
      res.json({ success: true, data: rows[0] });
    } catch (err) {
      next(err);
    }
  },

  async followStation(req, res, next) {
    try {
      await db.query(
        `INSERT INTO radio_station_follows (station_id, user_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [req.params.id, req.user.id]
      );
      await db.query(
        `UPDATE radio_stations SET follower_count = follower_count + 1 WHERE id = $1`,
        [req.params.id]
      ).catch(() => {});
      res.status(201).json({ success: true, message: "Station followed" });
    } catch (err) {
      next(err);
    }
  },

  async unfollowStation(req, res, next) {
    try {
      await db.query(
        `DELETE FROM radio_station_follows WHERE station_id = $1 AND user_id = $2`,
        [req.params.id, req.user.id]
      );
      await db.query(
        `UPDATE radio_stations SET follower_count = GREATEST(follower_count - 1, 0) WHERE id = $1`,
        [req.params.id]
      ).catch(() => {});
      res.json({ success: true, message: "Station unfollowed" });
    } catch (err) {
      next(err);
    }
  },

  /**
   * MVP "members-only" subscribe endpoint. No payment wiring here —
   * this is the plumbing hook (mirrors how radio_cohosts was schema-
   * only before this pass); wire in Paystack/Flutterwave charge
   * before calling this in production if the station isn't free.
   */
  async subscribeStation(req, res, next) {
    try {
      await db.query(
        `INSERT INTO radio_station_subscriptions (station_id, user_id, status)
         VALUES ($1, $2, 'active')
         ON CONFLICT (station_id, user_id) DO UPDATE SET status = 'active'`,
        [req.params.id, req.user.id]
      );
      res.status(201).json({ success: true, message: "Subscribed to station" });
    } catch (err) {
      next(err);
    }
  },

  /* ============================================================
     SHOWS (schedule)
     ============================================================ */
  async createShow(req, res, next) {
    try {
      const { stationId, title, description, scheduledAt, recurringRule, durationMinutes } = req.body;

      const { rows: stationRows } = await db.query(
        `SELECT id FROM radio_stations WHERE id = $1 AND host_id = $2`,
        [stationId, req.user.id]
      );
      if (!stationRows.length) {
        return res.status(403).json({ success: false, message: "Not authorized for this station" });
      }

      const { rows } = await db.query(
        `INSERT INTO radio_shows (station_id, title, description, scheduled_at, recurring_rule, duration_minutes)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [stationId, title, description || "", scheduledAt || null, recurringRule || null, durationMinutes || 60]
      );

      res.status(201).json({ success: true, data: rows[0] });
    } catch (err) {
      next(err);
    }
  },

  async listUpcomingShows(req, res, next) {
    try {
      const { rows } = await db.query(
        `SELECT sh.*, s.title AS station_title, s.cover_url AS station_cover,
                u.username, u.display_name
         FROM radio_shows sh
         JOIN radio_stations s ON s.id = sh.station_id
         JOIN users u ON u.id = s.host_id
         WHERE sh.is_active = TRUE
           AND (sh.scheduled_at IS NULL OR sh.scheduled_at > NOW() - INTERVAL '1 hour')
         ORDER BY sh.scheduled_at NULLS LAST
         LIMIT 50`
      );
      res.json({ success: true, data: rows });
    } catch (err) {
      next(err);
    }
  },

  /* ============================================================
     BROADCASTS — go live / list live / join / leave / end
     ============================================================ */
  async startBroadcast(req, res, next) {
    try {
      const { stationId, showId, title, description } = req.body;

      const { rows: stationRows } = await db.query(
        `SELECT id, host_id, title FROM radio_stations WHERE id = $1`,
        [stationId]
      );
      if (!stationRows.length) {
        return res.status(404).json({ success: false, message: "Station not found" });
      }
      if (String(stationRows[0].host_id) !== String(req.user.id)) {
        return res.status(403).json({ success: false, message: "Only the station host can go live" });
      }

      const streamKey = generateStreamKey();
      const hlsUrl = buildHlsUrl(streamKey);

      const { rows } = await db.query(
        `INSERT INTO radio_broadcasts
           (station_id, show_id, host_id, title, description, status,
            rtmp_stream_key, hls_playlist_url, started_at)
         VALUES ($1, $2, $3, $4, $5, 'live', $6, $7, NOW())
         RETURNING *`,
        [stationId, showId || null, req.user.id, title, description || "", streamKey, hlsUrl]
      );

      const broadcast = rows[0];

      await presenceService.setPresence(req.user.id, {
        status: "HOSTING_RADIO",
        currentRoomId: broadcast.id,
        hostId: req.user.id
      });

      // ── FIX: "Remind me" followers now actually get a notification
      // when the show goes live, not just a station follow. ──
      const io = req.app.get("io");
      notifyStationFollowers(io, stationId, {
        type: "radio_show_live",
        title: `${stationRows[0].title} is live`,
        body: title || "Tap to tune in now",
        data: { broadcastId: broadcast.id, stationId }
      }).catch(() => {});

      res.status(201).json({
        success: true,
        data: {
          ...broadcast,
          rtmpIngestUrl: `${process.env.RADIO_RTMP_BASE_URL || "rtmp://radio-ingest.example.com/live"}/${streamKey}`
        }
      });
    } catch (err) {
      next(err);
    }
  },

  async listLiveBroadcasts(req, res, next) {
    try {
      const { rows } = await db.query(
        `SELECT b.*, s.title AS station_title, s.cover_url AS station_cover,
                s.category_key, s.is_members_only, rc.label AS category_label, rc.icon AS category_icon,
                u.username, u.display_name, u.avatar_url
         FROM radio_broadcasts b
         JOIN radio_stations s ON s.id = b.station_id
         JOIN users u ON u.id = b.host_id
         LEFT JOIN radio_categories rc ON rc.key = s.category_key
         WHERE b.status = 'live'
         ORDER BY b.listener_count DESC, b.started_at DESC`
      );
      res.json({ success: true, data: rows });
    } catch (err) {
      next(err);
    }
  },

  async getBroadcast(req, res, next) {
    try {
      const { rows } = await db.query(
        `SELECT b.*, s.title AS station_title, s.cover_url AS station_cover, s.is_members_only,
                u.username, u.display_name, u.avatar_url
         FROM radio_broadcasts b
         JOIN radio_stations s ON s.id = b.station_id
         JOIN users u ON u.id = b.host_id
         WHERE b.id = $1`,
        [req.params.id]
      );
      if (!rows.length) {
        return res.status(404).json({ success: false, message: "Broadcast not found" });
      }
      res.json({ success: true, data: rows[0] });
    } catch (err) {
      next(err);
    }
  },

  async joinBroadcast(req, res, next) {
    try {
      const broadcastId = req.params.id;
      const userId = req.user.id;

      const { rows: bRows } = await db.query(
        `SELECT b.id, b.host_id, s.id AS station_id, s.is_members_only
         FROM radio_broadcasts b
         JOIN radio_stations s ON s.id = b.station_id
         WHERE b.id = $1 AND b.status = 'live'`,
        [broadcastId]
      );
      if (!bRows.length) {
        return res.status(404).json({ success: false, message: "Broadcast not found or not live" });
      }

      const room = bRows[0];

      // ── Members-only gate ──
      if (room.is_members_only && String(room.host_id) !== String(userId)) {
        const { rows: subRows } = await db.query(
          `SELECT 1 FROM radio_station_subscriptions
           WHERE station_id = $1 AND user_id = $2 AND status = 'active'`,
          [room.station_id, userId]
        );
        if (!subRows.length) {
          return res.status(402).json({
            success: false,
            message: "This is a members-only station — subscribe to join",
            code: "MEMBERS_ONLY"
          });
        }
      }

      await db.query(
        `INSERT INTO radio_listeners (broadcast_id, user_id) VALUES ($1, $2)`,
        [broadcastId, userId]
      );

      const { rows: countRows } = await db.query(
        `UPDATE radio_broadcasts SET listener_count = listener_count + 1
         WHERE id = $1 RETURNING listener_count`,
        [broadcastId]
      );

      await presenceService.setPresence(userId, {
        status: "LISTENING_RADIO",
        currentRoomId: broadcastId,
        hostId: room.host_id,
        hostName: null
      });

      res.json({ success: true, data: { listenerCount: countRows[0].listener_count } });
    } catch (err) {
      next(err);
    }
  },

  async leaveBroadcast(req, res, next) {
    try {
      const broadcastId = req.params.id;
      const userId = req.user.id;

      await db.query(
        `UPDATE radio_listeners SET left_at = NOW()
         WHERE id = (
           SELECT id FROM radio_listeners
           WHERE broadcast_id = $1 AND user_id = $2 AND left_at IS NULL
           ORDER BY joined_at DESC LIMIT 1
         )`,
        [broadcastId, userId]
      );

      await db.query(
        `UPDATE radio_broadcasts SET listener_count = GREATEST(listener_count - 1, 0)
         WHERE id = $1`,
        [broadcastId]
      );

      await presenceService.setPresence(userId, {
        status: "ONLINE",
        currentRoomId: null,
        hostId: null
      });

      res.json({ success: true, message: "Left broadcast" });
    } catch (err) {
      next(err);
    }
  },

  async endBroadcast(req, res, next) {
    try {
      const { rows } = await db.query(
        `UPDATE radio_broadcasts SET status = 'ended', ended_at = NOW()
         WHERE id = $1 AND host_id = $2
         RETURNING *`,
        [req.params.id, req.user.id]
      );
      if (!rows.length) {
        return res.status(403).json({ success: false, message: "Not authorized or broadcast not found" });
      }

      await presenceService.setPresence(req.user.id, {
        status: "ONLINE", currentRoomId: null, hostId: null
      });

      // Auto-close any still-active poll for a clean end-of-show state.
      await db.query(
        `UPDATE radio_polls SET status = 'closed', closed_at = NOW()
         WHERE broadcast_id = $1 AND status = 'active'`,
        [req.params.id]
      ).catch(() => {});

      res.json({ success: true, message: "Broadcast ended" });
    } catch (err) {
      next(err);
    }
  },

  async topGifters(req, res, next) {
    try {
      const { rows } = await db.query(
        `SELECT u.id, u.username, u.avatar_url,
                COALESCE(SUM(gt.total_coins), 0) AS total
         FROM gift_transactions gt
         JOIN users u ON u.id = gt.sender_id
         WHERE gt.context_type = 'radio_broadcast' AND gt.context_id = $1
         GROUP BY u.id, u.username, u.avatar_url
         ORDER BY total DESC
         LIMIT 5`,
        [req.params.id]
      );
      res.json({ success: true, data: rows });
    } catch (err) {
      next(err);
    }
  },

  async requestSong(req, res, next) {
    try {
      const { songName, artistName } = req.body;
      if (!songName || !songName.trim()) {
        return res.status(400).json({ success: false, message: "Song name is required" });
      }
      const { rows } = await db.query(
        `INSERT INTO radio_song_requests (broadcast_id, user_id, song_name, artist_name)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [req.params.id, req.user.id, songName.trim(), artistName || null]
      );
      res.status(201).json({ success: true, data: rows[0] });
    } catch (err) {
      next(err);
    }
  },

  /* ============================================================
     CO-HOSTS / CALLERS — activates the previously-dead schema.
     Realtime propagation (socket broadcasts to the room + the
     requesting/target user) lives in radio.socket.js; these REST
     endpoints are the durable source of truth the sockets read
     from and write to.
     ============================================================ */
  async requestCohost(req, res, next) {
    try {
      const broadcastId = req.params.id;
      const { rows: bRows } = await db.query(
        `SELECT host_id FROM radio_broadcasts WHERE id = $1 AND status = 'live'`,
        [broadcastId]
      );
      if (!bRows.length) {
        return res.status(404).json({ success: false, message: "Broadcast not found or not live" });
      }
      if (String(bRows[0].host_id) === String(req.user.id)) {
        return res.status(400).json({ success: false, message: "You are already hosting this broadcast" });
      }

      const { rows } = await db.query(
        `INSERT INTO radio_cohosts (broadcast_id, user_id, status)
         VALUES ($1, $2, 'pending')
         ON CONFLICT (broadcast_id, user_id)
         DO UPDATE SET status = 'pending', requested_at = NOW(), approved_at = NULL
         RETURNING *`,
        [broadcastId, req.user.id]
      );

      res.status(201).json({ success: true, data: rows[0] });
    } catch (err) {
      next(err);
    }
  },

  async listCohosts(req, res, next) {
    try {
      const { rows } = await db.query(
        `SELECT rc.*, u.username, u.display_name, u.avatar_url
         FROM radio_cohosts rc
         JOIN users u ON u.id = rc.user_id
         WHERE rc.broadcast_id = $1 AND rc.status IN ('pending', 'approved')
         ORDER BY rc.requested_at ASC`,
        [req.params.id]
      );
      res.json({ success: true, data: rows });
    } catch (err) {
      next(err);
    }
  },

  async respondCohost(req, res, next) {
    try {
      const broadcastId = req.params.id;
      const targetUserId = req.params.userId;
      const { action } = req.body; // 'approve' | 'reject'

      if (!["approve", "reject"].includes(action)) {
        return res.status(400).json({ success: false, message: "Invalid action" });
      }

      const { rows: bRows } = await db.query(
        `SELECT host_id FROM radio_broadcasts WHERE id = $1`,
        [broadcastId]
      );
      if (!bRows.length || String(bRows[0].host_id) !== String(req.user.id)) {
        return res.status(403).json({ success: false, message: "Only the host can respond to caller requests" });
      }

      const newStatus = action === "approve" ? "approved" : "rejected";
      const { rows } = await db.query(
        `UPDATE radio_cohosts SET status = $3, approved_at = CASE WHEN $3 = 'approved' THEN NOW() ELSE approved_at END
         WHERE broadcast_id = $1 AND user_id = $2
         RETURNING *`,
        [broadcastId, targetUserId, newStatus]
      );
      if (!rows.length) {
        return res.status(404).json({ success: false, message: "Request not found" });
      }

      const io = req.app.get("io");
      notifyUser(io, targetUserId, {
        type: action === "approve" ? "radio_cohost_approved" : "radio_cohost_rejected",
        title: action === "approve" ? "You're live as a caller!" : "Caller request declined",
        body: "",
        data: { broadcastId }
      }).catch(() => {});

      res.json({ success: true, data: rows[0] });
    } catch (err) {
      next(err);
    }
  },

  async leaveCohost(req, res, next) {
    try {
      const broadcastId = req.params.id;
      await db.query(
        `UPDATE radio_cohosts SET status = 'left' WHERE broadcast_id = $1 AND user_id = $2`,
        [broadcastId, req.user.id]
      );
      res.json({ success: true, message: "Left caller seat" });
    } catch (err) {
      next(err);
    }
  },

  async kickCohost(req, res, next) {
    try {
      const broadcastId = req.params.id;
      const targetUserId = req.params.userId;

      const { rows: bRows } = await db.query(
        `SELECT host_id FROM radio_broadcasts WHERE id = $1`,
        [broadcastId]
      );
      if (!bRows.length || String(bRows[0].host_id) !== String(req.user.id)) {
        return res.status(403).json({ success: false, message: "Only the host can remove a caller" });
      }

      await db.query(
        `UPDATE radio_cohosts SET status = 'left' WHERE broadcast_id = $1 AND user_id = $2`,
        [broadcastId, targetUserId]
      );

      res.json({ success: true, message: "Caller removed" });
    } catch (err) {
      next(err);
    }
  },

  /* ============================================================
     LIVE POLLS
     ============================================================ */
  async createPoll(req, res, next) {
    try {
      const broadcastId = req.params.id;
      const { question, options } = req.body;

      if (!question || !question.trim()) {
        return res.status(400).json({ success: false, message: "Question is required" });
      }
      if (!Array.isArray(options) || options.length < 2 || options.length > 6) {
        return res.status(400).json({ success: false, message: "Provide 2-6 options" });
      }

      const { rows: bRows } = await db.query(
        `SELECT host_id FROM radio_broadcasts WHERE id = $1`,
        [broadcastId]
      );
      if (!bRows.length || String(bRows[0].host_id) !== String(req.user.id)) {
        return res.status(403).json({ success: false, message: "Only the host can start a poll" });
      }

      // Only one active poll per broadcast at a time.
      await db.query(
        `UPDATE radio_polls SET status = 'closed', closed_at = NOW()
         WHERE broadcast_id = $1 AND status = 'active'`,
        [broadcastId]
      );

      const { rows } = await db.query(
        `INSERT INTO radio_polls (broadcast_id, question, options, status)
         VALUES ($1, $2, $3, 'active')
         RETURNING *`,
        [broadcastId, question.trim(), JSON.stringify(options)]
      );

      res.status(201).json({ success: true, data: { ...rows[0], votes: options.map(() => 0), totalVotes: 0 } });
    } catch (err) {
      next(err);
    }
  },

  async getActivePoll(req, res, next) {
    try {
      const broadcastId = req.params.id;
      const { rows } = await db.query(
        `SELECT * FROM radio_polls WHERE broadcast_id = $1 AND status = 'active'
         ORDER BY created_at DESC LIMIT 1`,
        [broadcastId]
      );
      if (!rows.length) return res.json({ success: true, data: null });

      const poll = rows[0];
      const { rows: voteRows } = await db.query(
        `SELECT option_index, COUNT(*) AS c FROM radio_poll_votes WHERE poll_id = $1 GROUP BY option_index`,
        [poll.id]
      );
      const votes = poll.options.map((_, i) => {
        const found = voteRows.find(v => v.option_index === i);
        return found ? Number(found.c) : 0;
      });

      const { rows: myVoteRows } = await db.query(
        `SELECT option_index FROM radio_poll_votes WHERE poll_id = $1 AND user_id = $2`,
        [poll.id, req.user.id]
      );

      res.json({
        success: true,
        data: {
          ...poll,
          votes,
          totalVotes: votes.reduce((a, b) => a + b, 0),
          myVote: myVoteRows[0]?.option_index ?? null
        }
      });
    } catch (err) {
      next(err);
    }
  },

  async votePoll(req, res, next) {
    try {
      const pollId = req.params.pollId;
      const { optionIndex } = req.body;

      const { rows: pollRows } = await db.query(
        `SELECT * FROM radio_polls WHERE id = $1 AND status = 'active'`,
        [pollId]
      );
      if (!pollRows.length) {
        return res.status(404).json({ success: false, message: "Poll not found or closed" });
      }
      const poll = pollRows[0];
      if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= poll.options.length) {
        return res.status(400).json({ success: false, message: "Invalid option" });
      }

      await db.query(
        `INSERT INTO radio_poll_votes (poll_id, user_id, option_index)
         VALUES ($1, $2, $3)
         ON CONFLICT (poll_id, user_id) DO UPDATE SET option_index = $3`,
        [pollId, req.user.id, optionIndex]
      );

      res.json({ success: true, message: "Vote recorded" });
    } catch (err) {
      next(err);
    }
  },

  async closePoll(req, res, next) {
    try {
      const pollId = req.params.pollId;
      const { rows: pollRows } = await db.query(
        `SELECT rp.*, rb.host_id FROM radio_polls rp
         JOIN radio_broadcasts rb ON rb.id = rp.broadcast_id
         WHERE rp.id = $1`,
        [pollId]
      );
      if (!pollRows.length || String(pollRows[0].host_id) !== String(req.user.id)) {
        return res.status(403).json({ success: false, message: "Only the host can close this poll" });
      }

      await db.query(
        `UPDATE radio_polls SET status = 'closed', closed_at = NOW() WHERE id = $1`,
        [pollId]
      );

      res.json({ success: true, message: "Poll closed" });
    } catch (err) {
      next(err);
    }
  }
};

module.exports = RadioController;