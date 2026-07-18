// backend/src/controllers/presenceController.js

const db = require("../config/db");
const presenceService = require("../services/presenceService");

const LIVE_STATUSES = ["WATCHING_LIVE", "HOSTING_LIVE", "CO_HOST", "GUEST_SEAT"];

/**
 * Applies a target user's own privacy settings to a presence payload
 * that's about to be shown to a follower. Hosting your own live is
 * never hidden (that's the whole point of going live); watching /
 * guesting / co-hosting someone else's room can be hidden.
 */
function applyPrivacy(payload, targetUser) {
  const isHostingSelf = payload.status === "HOSTING_LIVE";
  if (isHostingSelf) return payload;

  if (targetUser.allow_followers_see_live === false || targetUser.hide_viewing_activity === true) {
    return {
      ...payload,
      status: payload.status === "OFFLINE" ? "OFFLINE" : "ONLINE",
      currentRoomId: null,
      hostId: null,
      hostName: null
    };
  }

  if (targetUser.allow_followers_join_room === false) {
    // Status/label can still be shown, but the room can't be joined directly.
    return { ...payload, currentRoomId: null };
  }

  return payload;
}

/* ============================================================
   GET /api/presence/followers/live-status
   People the CURRENT user follows, with live status.
   ============================================================ */
async function followersLiveStatus(req, res, next) {
  try {
    const userId = req.user.id;

    const { rows: followingRows } = await db.query(
      `SELECT following_id FROM follows WHERE follower_id = $1`,
      [userId]
    );
    const followingIds = followingRows.map((r) => r.following_id);
    if (!followingIds.length) return res.json({ success: true, data: [] });

    const presences = await presenceService.getManyPresence(followingIds);

    const { rows: userRows } = await db.query(
      `SELECT id, username, display_name, avatar_url,
              allow_followers_see_live, allow_followers_join_room, hide_viewing_activity
       FROM users WHERE id = ANY($1::uuid[])`,
      [followingIds]
    );
    const userMap = new Map(userRows.map((u) => [String(u.id), u]));

    const hostIds = [...new Set(presences.filter((p) => p.hostId).map((p) => p.hostId))];
    let hostMap = new Map();
    if (hostIds.length) {
      const { rows: hostRows } = await db.query(
        `SELECT id, username, display_name FROM users WHERE id = ANY($1::uuid[])`,
        [hostIds]
      );
      hostMap = new Map(hostRows.map((h) => [String(h.id), h]));
    }

    const data = presences
      .map((p) => {
        const u = userMap.get(String(p.userId));
        if (!u) return null;

        let payload = { ...p };
        if (payload.hostId) {
          const h = hostMap.get(String(payload.hostId));
          payload.hostName = h?.display_name || h?.username || null;
        }
        payload = applyPrivacy(payload, u);

        return {
          userId: u.id,
          username: u.username,
          displayName: u.display_name,
          avatarUrl: u.avatar_url,
          status: payload.status,
          roomId: payload.currentRoomId,
          hostId: payload.hostId,
          hostName: payload.hostName
        };
      })
      .filter(Boolean);

    return res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

/* ============================================================
   GET /api/presence/:userId
   ============================================================ */
async function getUserPresence(req, res, next) {
  try {
    const targetId = req.params.userId;

    const { rows } = await db.query(
      `SELECT id, username, display_name,
              allow_followers_see_live, allow_followers_join_room, hide_viewing_activity
       FROM users WHERE id = $1`,
      [targetId]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: "User not found" });
    const u = rows[0];

    let payload = await presenceService.getPresence(targetId);

    if (payload.hostId) {
      const { rows: hr } = await db.query(
        `SELECT username, display_name FROM users WHERE id = $1`,
        [payload.hostId]
      );
      payload.hostName = hr[0]?.display_name || hr[0]?.username || null;
    }

    payload = applyPrivacy(payload, u);

    return res.json({
      success: true,
      data: {
        userId: targetId,
        status: payload.status,
        roomId: payload.currentRoomId,
        hostId: payload.hostId,
        hostName: payload.hostName
      }
    });
  } catch (err) {
    next(err);
  }
}

/* ============================================================
   GET /api/presence/room/current/:userId
   Thin endpoint the client hits right before navigating, so a
   tap always lands the follower in the exact room the followed
   user is in (or nowhere, if privacy hides it / they're offline).
   ============================================================ */
async function getCurrentRoom(req, res, next) {
  try {
    const targetId = req.params.userId;

    const { rows } = await db.query(
      `SELECT allow_followers_join_room, hide_viewing_activity FROM users WHERE id = $1`,
      [targetId]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: "User not found" });
    const u = rows[0];

    const p = await presenceService.getPresence(targetId);
    if (!p.currentRoomId) return res.json({ success: true, data: { roomId: null } });

    const isHostingSelf = p.status === "HOSTING_LIVE";
    if (!isHostingSelf && (u.allow_followers_join_room === false || u.hide_viewing_activity === true)) {
      return res.json({ success: true, data: { roomId: null } });
    }

    return res.json({
      success: true,
      data: { roomId: p.currentRoomId, hostId: p.hostId, status: p.status }
    });
  } catch (err) {
    next(err);
  }
}

/* ============================================================
   PATCH /api/presence/settings
   Privacy toggles.
   ============================================================ */
async function updatePrivacySettings(req, res, next) {
  try {
    const userId = req.user.id;
    const { allowFollowersSeeLive, allowFollowersJoinRoom, hideViewingActivity } = req.body;

    const { rows } = await db.query(
      `UPDATE users SET
         allow_followers_see_live  = COALESCE($2, allow_followers_see_live),
         allow_followers_join_room = COALESCE($3, allow_followers_join_room),
         hide_viewing_activity     = COALESCE($4, hide_viewing_activity)
       WHERE id = $1
       RETURNING id, allow_followers_see_live, allow_followers_join_room, hide_viewing_activity`,
      [
        userId,
        allowFollowersSeeLive === undefined ? null : !!allowFollowersSeeLive,
        allowFollowersJoinRoom === undefined ? null : !!allowFollowersJoinRoom,
        hideViewingActivity === undefined ? null : !!hideViewingActivity
      ]
    );

    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  LIVE_STATUSES,
  followersLiveStatus,
  getUserPresence,
  getCurrentRoom,
  updatePrivacySettings
};