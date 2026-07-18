// backend/src/sockets/radio.socket.js
//
// PHASE 2 ADDITIONS:
//   - Co-host/caller request/approve/reject/leave/kick realtime events
//   - Live poll create/vote/close realtime events
// Everything else (join/leave/chat/reactions/end/presence/grace-
// period disconnect) is unchanged from Phase 1.

const db = require("../config/db");
const presenceService = require("../services/presenceService");

async function getUserBrief(userId) {
  if (!userId) return null;
  try {
    const { rows } = await db.query(
      `SELECT id, username, display_name, avatar_url FROM users WHERE id = $1`,
      [userId]
    );
    return rows[0] || null;
  } catch (err) {
    console.error("[radio.getUserBrief] ❌", err);
    return null;
  }
}

async function getUserPrivacy(userId) {
  try {
    const { rows } = await db.query(
      `SELECT allow_followers_see_live, hide_viewing_activity FROM users WHERE id = $1`,
      [userId]
    );
    return rows[0] || {};
  } catch (err) {
    console.error("[radio.getUserPrivacy] ❌", err);
    return {};
  }
}

async function broadcastPresenceToFollowers(io, userId, presencePayload) {
  try {
    const privacy = await getUserPrivacy(userId);
    const isHostingSelf = presencePayload.status === "HOSTING_RADIO";

    let outPayload = { ...presencePayload };
    if (!isHostingSelf && (privacy.allow_followers_see_live === false || privacy.hide_viewing_activity)) {
      outPayload = {
        userId,
        status: presencePayload.status === "OFFLINE" ? "OFFLINE" : "ONLINE",
        currentRoomId: null, hostId: null, hostName: null
      };
    }

    const { rows } = await db.query(
      `SELECT follower_id FROM follows WHERE following_id = $1`,
      [userId]
    );
    for (const row of rows) {
      io.to(`user:${row.follower_id}`).emit("presenceUpdated", outPayload);
    }
  } catch (err) {
    console.error("[radio.broadcastPresenceToFollowers] ❌", err);
  }
}

async function resolveHostName(hostUserId) {
  if (!hostUserId) return null;
  const brief = await getUserBrief(hostUserId);
  return brief?.display_name || brief?.username || null;
}

const radioRooms = new Map();

function getOrCreateRadioRoom(broadcastId) {
  if (!radioRooms.has(broadcastId)) {
    radioRooms.set(broadcastId, {
      hostUserId: null,
      hostSocketId: null,
      listeners: new Map()
    });
  }
  return radioRooms.get(broadcastId);
}

function currentListenerCount(room) {
  return room.listeners.size;
}

const pendingOfflineTimers = new Map();
const OFFLINE_GRACE_MS = 8000;

function cancelPendingOffline(userId) {
  if (!userId) return;
  if (pendingOfflineTimers.has(userId)) {
    clearTimeout(pendingOfflineTimers.get(userId));
    pendingOfflineTimers.delete(userId);
  }
}

async function fetchCohostRoster(broadcastId) {
  const { rows } = await db.query(
    `SELECT rc.*, u.username, u.display_name, u.avatar_url
     FROM radio_cohosts rc
     JOIN users u ON u.id = rc.user_id
     WHERE rc.broadcast_id = $1 AND rc.status IN ('pending', 'approved')
     ORDER BY rc.requested_at ASC`,
    [broadcastId]
  );
  return rows;
}

async function fetchPollWithCounts(pollId) {
  const { rows: pollRows } = await db.query(`SELECT * FROM radio_polls WHERE id = $1`, [pollId]);
  if (!pollRows.length) return null;
  const poll = pollRows[0];
  const { rows: voteRows } = await db.query(
    `SELECT option_index, COUNT(*) AS c FROM radio_poll_votes WHERE poll_id = $1 GROUP BY option_index`,
    [pollId]
  );
  const votes = poll.options.map((_, i) => {
    const found = voteRows.find(v => v.option_index === i);
    return found ? Number(found.c) : 0;
  });
  return { ...poll, votes, totalVotes: votes.reduce((a, b) => a + b, 0) };
}

module.exports = (io, socket) => {

  /* ══════════════════════════════════════════════════════
     JOIN / LEAVE RADIO
  ══════════════════════════════════════════════════════ */
  socket.on("joinRadio", async ({ broadcastId, userId }) => {
    try {
      if (!broadcastId) return;
      socket.join(`radio:${broadcastId}`);
      socket.currentBroadcastId = broadcastId;
      socket.currentUserId = socket.currentUserId || userId;
      cancelPendingOffline(userId);

      const { rows } = await db.query(
        `SELECT host_id FROM radio_broadcasts WHERE id = $1`,
        [broadcastId]
      );
      const dbHostId = rows[0]?.host_id || null;
      const isActualHost = dbHostId != null && String(dbHostId) === String(userId);

      const room = getOrCreateRadioRoom(broadcastId);
      room.hostUserId = dbHostId;
      if (isActualHost) room.hostSocketId = socket.id;

      const brief = await getUserBrief(userId);
      room.listeners.set(socket.id, {
        userId,
        username: brief?.username || brief?.display_name || null,
        avatarUrl: brief?.avatar_url || null
      });

      const presenceStatus = isActualHost ? "HOSTING_RADIO" : "LISTENING_RADIO";
      const hostName = isActualHost ? null : await resolveHostName(dbHostId);
      const presencePayload = await presenceService.setPresence(userId, {
        status: presenceStatus,
        currentRoomId: broadcastId,
        hostId: dbHostId || userId,
        hostName,
        socketId: socket.id
      });
      broadcastPresenceToFollowers(io, userId, presencePayload).catch(() => {});

      const listenerCount = currentListenerCount(room);
      io.to(`radio:${broadcastId}`).emit("listenerCountUpdated", { broadcastId, listenerCount });

      try {
        await db.query(`UPDATE radio_broadcasts SET listener_count = $2 WHERE id = $1`, [broadcastId, listenerCount]);
      } catch (e) {}

      if (!isActualHost) {
        socket.to(`radio:${broadcastId}`).emit("newRadioComment", {
          broadcastId,
          system: true,
          text: `${brief?.username || brief?.display_name || "Someone"} joined`,
          timestamp: Date.now()
        });
      }

      // Send current roster + active poll snapshot to the joiner.
      const roster = await fetchCohostRoster(broadcastId);
      socket.emit("radioCohostsUpdated", { broadcastId, roster });

      const { rows: activePollRows } = await db.query(
        `SELECT id FROM radio_polls WHERE broadcast_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
        [broadcastId]
      );
      if (activePollRows.length) {
        const poll = await fetchPollWithCounts(activePollRows[0].id);
        if (poll) socket.emit("radioPollUpdated", { broadcastId, poll });
      }
    } catch (err) {
      console.error("[joinRadio] ❌", err);
    }
  });

  async function handleLeaveRadio({ broadcastId, userId }) {
    try {
      const bId = broadcastId || socket.currentBroadcastId;
      if (!bId) return;

      socket.leave(`radio:${bId}`);
      const room = radioRooms.get(bId);
      if (room) {
        room.listeners.delete(socket.id);
        if (room.hostSocketId === socket.id) room.hostSocketId = null;

        const listenerCount = currentListenerCount(room);
        io.to(`radio:${bId}`).emit("listenerCountUpdated", { broadcastId: bId, listenerCount });

        try {
          await db.query(`UPDATE radio_broadcasts SET listener_count = $2 WHERE id = $1`, [bId, listenerCount]);
        } catch (e) {}

        if (room.listeners.size === 0 && !room.hostSocketId) radioRooms.delete(bId);
      }

      const uid = userId || socket.currentUserId;
      if (uid) {
        const payload = await presenceService.setPresence(uid, {
          status: "ONLINE", currentRoomId: null, hostId: null, socketId: socket.id
        });
        broadcastPresenceToFollowers(io, uid, payload).catch(() => {});
      }

      socket.currentBroadcastId = null;
    } catch (err) {
      console.error("[leaveRadio] ❌", err);
    }
  }
  socket.on("leaveRadio", handleLeaveRadio);

  /* ══════════════════════════════════════════════════════
     CHAT / REACTIONS / END
  ══════════════════════════════════════════════════════ */
  socket.on("radioComment", async (payload) => {
    try {
      const { broadcastId, userId, avatar, name, text } = payload;
      if (!broadcastId || !text?.trim() || text.length > 200) return;

      try {
        await db.query(
          `INSERT INTO radio_broadcast_messages (broadcast_id, user_id, body, message_type)
           VALUES ($1, $2, $3, 'comment')`,
          [broadcastId, userId, text.trim()]
        );
      } catch (e) {
        console.warn("[radioComment] persistence skipped:", e.message);
      }

      io.to(`radio:${broadcastId}`).emit("newRadioComment", {
        broadcastId, userId, avatar, name,
        text: text.trim(),
        timestamp: Date.now()
      });
    } catch (err) {
      console.error("[radioComment] ❌", err);
    }
  });

  socket.on("radioReaction", ({ broadcastId, emoji, userId }) => {
    if (!broadcastId || !emoji) return;
    io.to(`radio:${broadcastId}`).emit("newRadioReaction", { emoji, userId, broadcastId });
  });

  socket.on("radioEnded", async ({ broadcastId }) => {
    try {
      if (!broadcastId) return;
      io.to(`radio:${broadcastId}`).emit("radioEnded", { broadcastId });

      const room = radioRooms.get(broadcastId);
      if (room) {
        for (const [, listenerInfo] of room.listeners) {
          if (listenerInfo.userId) {
            const payload = await presenceService.setPresence(listenerInfo.userId, {
              status: "ONLINE", currentRoomId: null, hostId: null
            });
            broadcastPresenceToFollowers(io, listenerInfo.userId, payload).catch(() => {});
          }
        }
        radioRooms.delete(broadcastId);
      }
    } catch (err) {
      console.error("[radioEnded] ❌", err);
    }
  });

  /* ══════════════════════════════════════════════════════
     CO-HOSTS / CALLERS (Phase 2 — activates radio_cohosts)
  ══════════════════════════════════════════════════════ */
  socket.on("radioRequestCohost", async ({ broadcastId, userId }, callback) => {
    try {
      const { rows: bRows } = await db.query(
        `SELECT host_id FROM radio_broadcasts WHERE id = $1 AND status = 'live'`,
        [broadcastId]
      );
      if (!bRows.length) throw new Error("Broadcast not live");
      if (String(bRows[0].host_id) === String(userId)) throw new Error("You're the host");

      await db.query(
        `INSERT INTO radio_cohosts (broadcast_id, user_id, status)
         VALUES ($1, $2, 'pending')
         ON CONFLICT (broadcast_id, user_id)
         DO UPDATE SET status = 'pending', requested_at = NOW(), approved_at = NULL`,
        [broadcastId, userId]
      );

      const roster = await fetchCohostRoster(broadcastId);
      io.to(`radio:${broadcastId}`).emit("radioCohostsUpdated", { broadcastId, roster });

      // Nudge the host specifically so they see the pending badge immediately.
      const room = radioRooms.get(broadcastId);
      if (room?.hostSocketId) {
        io.to(room.hostSocketId).emit("radioCohostRequested", { broadcastId, userId });
      }

      callback?.({ ok: true });
    } catch (err) {
      callback?.({ error: err.message });
    }
  });

  socket.on("radioRespondCohost", async ({ broadcastId, targetUserId, action }, callback) => {
    try {
      const { rows: bRows } = await db.query(
        `SELECT host_id FROM radio_broadcasts WHERE id = $1`,
        [broadcastId]
      );
      if (!bRows.length || String(bRows[0].host_id) !== String(socket.currentUserId)) {
        throw new Error("Only the host can respond");
      }
      const newStatus = action === "approve" ? "approved" : "rejected";

      await db.query(
        `UPDATE radio_cohosts SET status = $3,
           approved_at = CASE WHEN $3 = 'approved' THEN NOW() ELSE approved_at END
         WHERE broadcast_id = $1 AND user_id = $2`,
        [broadcastId, targetUserId, newStatus]
      );

      const roster = await fetchCohostRoster(broadcastId);
      io.to(`radio:${broadcastId}`).emit("radioCohostsUpdated", { broadcastId, roster });

      const room = radioRooms.get(broadcastId);
      const targetEntry = [...(room?.listeners.entries() || [])].find(([, v]) => String(v.userId) === String(targetUserId));
      if (targetEntry) {
        io.to(targetEntry[0]).emit("radioCohostResponse", { broadcastId, action });
      }

      callback?.({ ok: true });
    } catch (err) {
      callback?.({ error: err.message });
    }
  });

  socket.on("radioLeaveCohost", async ({ broadcastId, userId }, callback) => {
    try {
      await db.query(
        `UPDATE radio_cohosts SET status = 'left' WHERE broadcast_id = $1 AND user_id = $2`,
        [broadcastId, userId]
      );
      const roster = await fetchCohostRoster(broadcastId);
      io.to(`radio:${broadcastId}`).emit("radioCohostsUpdated", { broadcastId, roster });
      callback?.({ ok: true });
    } catch (err) {
      callback?.({ error: err.message });
    }
  });

  socket.on("radioKickCohost", async ({ broadcastId, targetUserId }, callback) => {
    try {
      const { rows: bRows } = await db.query(
        `SELECT host_id FROM radio_broadcasts WHERE id = $1`,
        [broadcastId]
      );
      if (!bRows.length || String(bRows[0].host_id) !== String(socket.currentUserId)) {
        throw new Error("Only the host can remove a caller");
      }
      await db.query(
        `UPDATE radio_cohosts SET status = 'left' WHERE broadcast_id = $1 AND user_id = $2`,
        [broadcastId, targetUserId]
      );
      const roster = await fetchCohostRoster(broadcastId);
      io.to(`radio:${broadcastId}`).emit("radioCohostsUpdated", { broadcastId, roster });

      const room = radioRooms.get(broadcastId);
      const targetEntry = [...(room?.listeners.entries() || [])].find(([, v]) => String(v.userId) === String(targetUserId));
      if (targetEntry) io.to(targetEntry[0]).emit("radioCohostKicked", { broadcastId });

      callback?.({ ok: true });
    } catch (err) {
      callback?.({ error: err.message });
    }
  });

  /* ══════════════════════════════════════════════════════
     LIVE POLLS (Phase 2)
  ══════════════════════════════════════════════════════ */
  socket.on("radioCreatePoll", async ({ broadcastId, question, options }, callback) => {
    try {
      const { rows: bRows } = await db.query(
        `SELECT host_id FROM radio_broadcasts WHERE id = $1`,
        [broadcastId]
      );
      if (!bRows.length || String(bRows[0].host_id) !== String(socket.currentUserId)) {
        throw new Error("Only the host can start a poll");
      }
      if (!question?.trim() || !Array.isArray(options) || options.length < 2) {
        throw new Error("Invalid poll");
      }

      await db.query(
        `UPDATE radio_polls SET status = 'closed', closed_at = NOW()
         WHERE broadcast_id = $1 AND status = 'active'`,
        [broadcastId]
      );

      const { rows } = await db.query(
        `INSERT INTO radio_polls (broadcast_id, question, options, status)
         VALUES ($1, $2, $3, 'active') RETURNING *`,
        [broadcastId, question.trim(), JSON.stringify(options)]
      );

      const poll = { ...rows[0], votes: options.map(() => 0), totalVotes: 0 };
      io.to(`radio:${broadcastId}`).emit("radioPollUpdated", { broadcastId, poll });
      callback?.({ ok: true, poll });
    } catch (err) {
      callback?.({ error: err.message });
    }
  });

  socket.on("radioVotePoll", async ({ broadcastId, pollId, optionIndex, userId }, callback) => {
    try {
      const { rows: pollRows } = await db.query(
        `SELECT * FROM radio_polls WHERE id = $1 AND status = 'active'`,
        [pollId]
      );
      if (!pollRows.length) throw new Error("Poll closed");
      if (optionIndex < 0 || optionIndex >= pollRows[0].options.length) throw new Error("Invalid option");

      await db.query(
        `INSERT INTO radio_poll_votes (poll_id, user_id, option_index)
         VALUES ($1, $2, $3)
         ON CONFLICT (poll_id, user_id) DO UPDATE SET option_index = $3`,
        [pollId, userId, optionIndex]
      );

      const poll = await fetchPollWithCounts(pollId);
      io.to(`radio:${broadcastId}`).emit("radioPollUpdated", { broadcastId, poll });
      callback?.({ ok: true });
    } catch (err) {
      callback?.({ error: err.message });
    }
  });

  socket.on("radioClosePoll", async ({ broadcastId, pollId }, callback) => {
    try {
      const { rows: pollRows } = await db.query(
        `SELECT rp.*, rb.host_id FROM radio_polls rp
         JOIN radio_broadcasts rb ON rb.id = rp.broadcast_id
         WHERE rp.id = $1`,
        [pollId]
      );
      if (!pollRows.length || String(pollRows[0].host_id) !== String(socket.currentUserId)) {
        throw new Error("Only the host can close this poll");
      }
      await db.query(`UPDATE radio_polls SET status = 'closed', closed_at = NOW() WHERE id = $1`, [pollId]);
      const poll = await fetchPollWithCounts(pollId);
      io.to(`radio:${broadcastId}`).emit("radioPollClosed", { broadcastId, poll });
      callback?.({ ok: true });
    } catch (err) {
      callback?.({ error: err.message });
    }
  });

  /* ══════════════════════════════════════════════════════
     REGISTER USER / DISCONNECT
  ══════════════════════════════════════════════════════ */
  socket.on("registerUser", (userId) => {
    if (!userId) return;
    socket.join(`user:${userId}`);
    socket.currentUserId = socket.currentUserId || userId;
    cancelPendingOffline(userId);
  });

  socket.on("disconnect", () => {
    const bId = socket.currentBroadcastId;
    const uid = socket.currentUserId;
    if (!bId && !uid) return;

    setTimeout(async () => {
      try {
        if (bId) {
          const room = radioRooms.get(bId);
          if (room && room.listeners.has(socket.id)) {
            room.listeners.delete(socket.id);
            if (room.hostSocketId === socket.id) room.hostSocketId = null;

            const listenerCount = currentListenerCount(room);
            io.to(`radio:${bId}`).emit("listenerCountUpdated", { broadcastId: bId, listenerCount });

            try {
              await db.query(`UPDATE radio_broadcasts SET listener_count = $2 WHERE id = $1`, [bId, listenerCount]);
            } catch (e) {}

            if (room.listeners.size === 0 && !room.hostSocketId) radioRooms.delete(bId);
          }
        }

        if (uid && !pendingOfflineTimers.has(uid)) {
          const payload = await presenceService.setOffline(uid);
          broadcastPresenceToFollowers(io, uid, payload).catch(() => {});
        }
      } catch (err) {
        console.error("[radio disconnect grace] ❌", err);
      }
    }, OFFLINE_GRACE_MS);
  });
};