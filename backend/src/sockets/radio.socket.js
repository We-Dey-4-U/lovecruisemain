// backend/src/sockets/radio.socket.js
//
// PHASE 2: Co-host/caller request/approve/reject/leave/kick realtime
//          events + Live poll create/vote/close realtime events.
// PHASE 4 (Studio redesign) ADDITIONS:
//   - Host-initiated "Invite Guest" flow (radioInviteGuest /
//     radioRespondInvite), alongside the existing listener-
//     initiated "Request to Speak" flow. Both live in the same
//     radio_cohosts table, distinguished by `status`
//     ('invited' | 'pending' | 'approved' | ...). See migration
//     radio_phase4_guest_invites.sql.
//   - Per-guest mic control for the boom-mic grid: mute/unmute,
//     volume (0-100), and lock (prevents the guest from
//     unmuting themselves).
//   - Lightweight relays for the control deck's sound-effects pad
//     and commercial-break trigger (no DB writes needed — these are
//     ephemeral broadcast-room events, same pattern as radioReaction).
//
// PHASE 4.1 (this pass) — DIAGNOSTIC LOGGING:
//   Every guest-booth / poll handler's catch block now logs the raw
//   error via console.error before returning it to the client via the
//   ack callback. Previously these handlers only did
//   `callback?.({ error: err.message })`, which meant a schema-drift
//   error (missing column, missing enum value, etc.) on the DB side
//   left ZERO trace in Render logs — it silently failed on the client
//   with whatever message Postgres produced, and there was no way to
//   diagnose it server-side. Every catch block below now does:
//     console.error("[handlerName] ❌", err);
//   before the callback, so the actual Postgres error (e.g.
//   `column "mic_volume" does not exist` or
//   `invalid input value for enum ...: "invited"`) shows up in your
//   Render log stream immediately when Invite Guest (or any other
//   guest-booth action) is clicked.
//
// Everything else (join/leave/chat/reactions/end/presence/grace-
// period disconnect) is unchanged from Phase 1/2.

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

async function notifyUser(io, userId, { type, title, body, data = {} }) {
  try {
    await db.query(
      `INSERT INTO notifications (user_id, type, title, body, data, is_read, created_at)
       VALUES ($1, $2, $3, $4, $5, FALSE, NOW())`,
      [userId, type, title, body, JSON.stringify(data)]
    );
  } catch (err) {
    console.warn("[radio.notifyUser] persistence skipped:", err.message);
  }
  if (io) {
    io.to(`user:${userId}`).emit("newNotification", { type, title, body, data, createdAt: new Date().toISOString() });
  }
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

// Guest-booth roster: invited (awaiting response), pending (listener
// requested), and approved (live in the booth) all surface in the
// Studio's guest-booth UI — the client sorts/filters by status.
async function fetchCohostRoster(broadcastId) {
  const { rows } = await db.query(
    `SELECT rc.*, u.username, u.display_name, u.avatar_url
     FROM radio_cohosts rc
     JOIN users u ON u.id = rc.user_id
     WHERE rc.broadcast_id = $1 AND rc.status IN ('pending', 'approved', 'invited')
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

      // If this user has a pending invite for this broadcast, re-surface
      // it (covers the case where they reload the page after inviting).
      const mine = roster.find(r => String(r.user_id) === String(userId));
      if (mine?.status === "invited" && !isActualHost) {
        const hostBrief = await getUserBrief(dbHostId);
        socket.emit("radioCohostInvite", {
          broadcastId,
          hostName: hostBrief?.display_name || hostBrief?.username || "The host",
          hostAvatar: hostBrief?.avatar_url || null
        });
      }

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
     STUDIO CONTROL DECK — sound effects pad + commercial break.
     Ephemeral, room-wide relays; no DB write needed (same
     pattern as radioReaction). Host-only, enforced server-side.
  ══════════════════════════════════════════════════════ */
  async function assertBroadcastHost(broadcastId, userId) {
    const { rows } = await db.query(`SELECT host_id FROM radio_broadcasts WHERE id = $1`, [broadcastId]);
    if (!rows.length) throw new Error("Broadcast not found");
    if (String(rows[0].host_id) !== String(userId)) throw new Error("Only the host can do that");
    return rows[0];
  }

  socket.on("radioSoundEffect", async ({ broadcastId, effect }, callback) => {
    try {
      await assertBroadcastHost(broadcastId, socket.currentUserId);
      if (!effect) throw new Error("Missing effect");
      io.to(`radio:${broadcastId}`).emit("radioSoundEffectPlayed", { broadcastId, effect });
      callback?.({ ok: true });
    } catch (err) {
      console.error("[radioSoundEffect] ❌", err);
      callback?.({ error: err.message });
    }
  });

  socket.on("radioCommercialBreak", async ({ broadcastId, seconds }, callback) => {
    try {
      await assertBroadcastHost(broadcastId, socket.currentUserId);
      const secs = Math.min(Math.max(Number(seconds) || 30, 10), 300);
      io.to(`radio:${broadcastId}`).emit("radioCommercialBreak", { broadcastId, seconds: secs });
      io.to(`radio:${broadcastId}`).emit("newRadioComment", {
        broadcastId, system: true, text: `📻 Commercial break — back in ${secs}s`, timestamp: Date.now()
      });
      callback?.({ ok: true });
    } catch (err) {
      console.error("[radioCommercialBreak] ❌", err);
      callback?.({ error: err.message });
    }
  });

  /* ══════════════════════════════════════════════════════
     GUEST BOOTH — CO-HOSTS / CALLERS (Phase 2)
     + HOST-INITIATED INVITES (Phase 4)
     + PER-GUEST MIC CONTROL (Phase 4)
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

      const room = radioRooms.get(broadcastId);
      if (room?.hostSocketId) {
        io.to(room.hostSocketId).emit("radioCohostRequested", { broadcastId, userId });
      }

      callback?.({ ok: true });
    } catch (err) {
      console.error("[radioRequestCohost] ❌", err);
      callback?.({ error: err.message });
    }
  });

  // Host invites a specific user (by username) into the guest booth.
  socket.on("radioInviteGuest", async ({ broadcastId, username }, callback) => {
    try {
      await assertBroadcastHost(broadcastId, socket.currentUserId);
      if (!username || !username.trim()) throw new Error("Enter a username to invite");

      const { rows: uRows } = await db.query(
        `SELECT id, username, display_name, avatar_url FROM users WHERE LOWER(username) = LOWER($1)`,
        [username.trim().replace(/^@/, "")]
      );
      if (!uRows.length) throw new Error("No user found with that username");
      const target = uRows[0];
      if (String(target.id) === String(socket.currentUserId)) throw new Error("You can't invite yourself");

      await db.query(
        `INSERT INTO radio_cohosts (broadcast_id, user_id, status, invited_by, mic_muted)
         VALUES ($1, $2, 'invited', $3, TRUE)
         ON CONFLICT (broadcast_id, user_id)
         DO UPDATE SET status = 'invited', invited_by = $3, requested_at = NOW(), approved_at = NULL`,
        [broadcastId, target.id, socket.currentUserId]
      );

      const hostBrief = await getUserBrief(socket.currentUserId);
      await notifyUser(io, target.id, {
        type: "radio_guest_invite",
        title: "🎙️ Radio Invitation",
        body: `${hostBrief?.display_name || hostBrief?.username || "A host"} invited you to join their live show as a guest speaker.`,
        data: { broadcastId }
      });

      io.to(`user:${target.id}`).emit("radioCohostInvite", {
        broadcastId,
        hostName: hostBrief?.display_name || hostBrief?.username || "The host",
        hostAvatar: hostBrief?.avatar_url || null
      });

      const roster = await fetchCohostRoster(broadcastId);
      io.to(`radio:${broadcastId}`).emit("radioCohostsUpdated", { broadcastId, roster });

      callback?.({ ok: true, invited: { id: target.id, username: target.username, displayName: target.display_name } });
    } catch (err) {
      console.error("[radioInviteGuest] ❌", err);
      callback?.({ error: err.message });
    }
  });

  // Invited user accepts/declines a host invite.
  socket.on("radioRespondInvite", async ({ broadcastId, action }, callback) => {
    try {
      const newStatus = action === "accept" ? "approved" : "declined_invite";
      const { rows } = await db.query(
        `UPDATE radio_cohosts SET status = $3,
           approved_at = CASE WHEN $3 = 'approved' THEN NOW() ELSE approved_at END
         WHERE broadcast_id = $1 AND user_id = $2 AND status = 'invited'
         RETURNING *`,
        [broadcastId, socket.currentUserId, newStatus]
      );
      if (!rows.length) throw new Error("No pending invite found");

      const roster = await fetchCohostRoster(broadcastId);
      io.to(`radio:${broadcastId}`).emit("radioCohostsUpdated", { broadcastId, roster });

      const room = radioRooms.get(broadcastId);
      if (room?.hostSocketId) {
        io.to(room.hostSocketId).emit("radioCohostResponse", { broadcastId, action, userId: socket.currentUserId, invite: true });
      }

      callback?.({ ok: true });
    } catch (err) {
      console.error("[radioRespondInvite] ❌", err);
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
      console.error("[radioRespondCohost] ❌", err);
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
      console.error("[radioLeaveCohost] ❌", err);
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
      console.error("[radioKickCohost] ❌", err);
      callback?.({ error: err.message });
    }
  });

  // Host toggles a live guest's mic on/off (goes "Live" on that boom mic).
  socket.on("radioSetGuestMic", async ({ broadcastId, targetUserId, muted }, callback) => {
    try {
      await assertBroadcastHost(broadcastId, socket.currentUserId);
      const { rows } = await db.query(
        `UPDATE radio_cohosts SET mic_muted = $3
         WHERE broadcast_id = $1 AND user_id = $2 AND status = 'approved'
         RETURNING *`,
        [broadcastId, targetUserId, !!muted]
      );
      if (!rows.length) throw new Error("Guest not found in booth");

      const roster = await fetchCohostRoster(broadcastId);
      io.to(`radio:${broadcastId}`).emit("radioCohostsUpdated", { broadcastId, roster });

      const room = radioRooms.get(broadcastId);
      const targetEntry = [...(room?.listeners.entries() || [])].find(([, v]) => String(v.userId) === String(targetUserId));
      if (targetEntry) io.to(targetEntry[0]).emit("radioGuestMicSet", { broadcastId, muted: !!muted });

      callback?.({ ok: true });
    } catch (err) {
      console.error("[radioSetGuestMic] ❌", err);
      callback?.({ error: err.message });
    }
  });

  // Host sets a live guest's mix volume (0-100) in the guest mixer.
  socket.on("radioSetGuestVolume", async ({ broadcastId, targetUserId, volume }, callback) => {
    try {
      await assertBroadcastHost(broadcastId, socket.currentUserId);
      const vol = Math.min(Math.max(Number(volume) || 0, 0), 100);
      await db.query(
        `UPDATE radio_cohosts SET mic_volume = $3
         WHERE broadcast_id = $1 AND user_id = $2 AND status = 'approved'`,
        [broadcastId, targetUserId, vol]
      );
      const roster = await fetchCohostRoster(broadcastId);
      io.to(`radio:${broadcastId}`).emit("radioCohostsUpdated", { broadcastId, roster });
      callback?.({ ok: true });
    } catch (err) {
      console.error("[radioSetGuestVolume] ❌", err);
      callback?.({ error: err.message });
    }
  });

  // Host locks/unlocks a guest's mic (prevents the guest self-unmuting).
  socket.on("radioSetGuestLock", async ({ broadcastId, targetUserId, locked }, callback) => {
    try {
      await assertBroadcastHost(broadcastId, socket.currentUserId);
      await db.query(
        `UPDATE radio_cohosts SET mic_locked = $3
         WHERE broadcast_id = $1 AND user_id = $2 AND status = 'approved'`,
        [broadcastId, targetUserId, !!locked]
      );
      const roster = await fetchCohostRoster(broadcastId);
      io.to(`radio:${broadcastId}`).emit("radioCohostsUpdated", { broadcastId, roster });
      callback?.({ ok: true });
    } catch (err) {
      console.error("[radioSetGuestLock] ❌", err);
      callback?.({ error: err.message });
    }
  });

  // Guest self-toggles their own mic (blocked if host-locked).
  socket.on("radioToggleOwnMic", async ({ broadcastId, muted }, callback) => {
    try {
      const { rows } = await db.query(
        `SELECT * FROM radio_cohosts WHERE broadcast_id = $1 AND user_id = $2 AND status = 'approved'`,
        [broadcastId, socket.currentUserId]
      );
      if (!rows.length) throw new Error("You're not in the guest booth");
      if (rows[0].mic_locked) throw new Error("Your mic is locked by the host");

      await db.query(
        `UPDATE radio_cohosts SET mic_muted = $3 WHERE broadcast_id = $1 AND user_id = $2`,
        [broadcastId, socket.currentUserId, !!muted]
      );
      const roster = await fetchCohostRoster(broadcastId);
      io.to(`radio:${broadcastId}`).emit("radioCohostsUpdated", { broadcastId, roster });
      callback?.({ ok: true });
    } catch (err) {
      console.error("[radioToggleOwnMic] ❌", err);
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
      console.error("[radioCreatePoll] ❌", err);
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
      console.error("[radioVotePoll] ❌", err);
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
      console.error("[radioClosePoll] ❌", err);
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