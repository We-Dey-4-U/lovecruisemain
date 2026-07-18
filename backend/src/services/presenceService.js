// backend/src/services/presenceService.js
//
// Single source of truth for reading/writing user presence.
// Writes go to Redis (fast) AND Postgres (durable) together, so a
// server restart or Redis flush can rebuild presence from Postgres.
// Reads try Redis first and fall back to Postgres on a cache miss.

const redis = require("../config/redis");
const db = require("../config/db");

const PRESENCE_PREFIX = "presence:";
const PRESENCE_TTL_SECONDS = 90; // safety-net expiry; every real update refreshes it

const VALID_STATUSES = [
  "OFFLINE",
  "ONLINE",
  "WATCHING_LIVE",
  "HOSTING_LIVE",
  "CO_HOST",
  "LISTENING_RADIO",   // ← add this
  "HOSTING_RADIO" ,     // ← add this
  "GUEST_SEAT"
];

function keyFor(userId) {
  return `${PRESENCE_PREFIX}${userId}`;
}

function normalize(userId, raw) {
  return {
    userId,
    status: VALID_STATUSES.includes(raw?.status) ? raw.status : "OFFLINE",
    currentRoomId: raw?.currentRoomId ?? raw?.current_room_id ?? null,
    hostId: raw?.hostId ?? raw?.host_id ?? null,
    hostName: raw?.hostName ?? null,
    socketId: raw?.socketId ?? raw?.socket_id ?? null,
    updatedAt: raw?.updatedAt ?? Date.now()
  };
}

/* ============================================================
   WRITE
   ============================================================ */
async function setPresence(userId, data) {
  const payload = normalize(userId, { ...data, updatedAt: Date.now() });

  try {
    await redis.set(keyFor(userId), JSON.stringify(payload), "EX", PRESENCE_TTL_SECONDS);
  } catch (err) {
    console.error("[presenceService.setPresence] Redis write failed:", err.message);
  }

  try {
    await db.query(
      `INSERT INTO user_presence
         (user_id, socket_id, is_online, status, current_room_id, host_id, last_seen_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         socket_id       = EXCLUDED.socket_id,
         is_online       = EXCLUDED.is_online,
         status          = EXCLUDED.status,
         current_room_id = EXCLUDED.current_room_id,
         host_id         = EXCLUDED.host_id,
         last_seen_at    = NOW(),
         updated_at      = NOW()`,
      [
        userId,
        payload.socketId,
        payload.status !== "OFFLINE",
        payload.status,
        payload.currentRoomId,
        payload.hostId
      ]
    );
  } catch (err) {
    console.error("[presenceService.setPresence] Postgres write failed:", err.message);
  }

  return payload;
}

async function setOffline(userId) {
  try {
    await redis.del(keyFor(userId));
  } catch (err) {
    console.error("[presenceService.setOffline] Redis delete failed:", err.message);
  }

  try {
    await db.query(
      `UPDATE user_presence
       SET is_online = FALSE, status = 'OFFLINE', current_room_id = NULL,
           host_id = NULL, socket_id = NULL, updated_at = NOW()
       WHERE user_id = $1`,
      [userId]
    );
  } catch (err) {
    console.error("[presenceService.setOffline] Postgres write failed:", err.message);
  }

  return normalize(userId, { status: "OFFLINE" });
}

/* ============================================================
   READ (single)
   ============================================================ */
async function getPresence(userId) {
  try {
    const cached = await redis.get(keyFor(userId));
    if (cached) return normalize(userId, JSON.parse(cached));
  } catch (err) {
    console.error("[presenceService.getPresence] Redis read failed:", err.message);
  }

  try {
    const { rows } = await db.query(`SELECT * FROM user_presence WHERE user_id = $1`, [userId]);
    if (!rows.length) return normalize(userId, { status: "OFFLINE" });
    return normalize(userId, rows[0]);
  } catch (err) {
    console.error("[presenceService.getPresence] Postgres read failed:", err.message);
    return normalize(userId, { status: "OFFLINE" });
  }
}

/* ============================================================
   READ (batch) — used by the followers/live-status endpoint so we
   don't hit Postgres once per follow
   ============================================================ */
async function getManyPresence(userIds) {
  if (!userIds || !userIds.length) return [];

  let cachedList = [];
  try {
    cachedList = await redis.mget(userIds.map(keyFor));
  } catch (err) {
    console.error("[presenceService.getManyPresence] Redis mget failed:", err.message);
    cachedList = userIds.map(() => null);
  }

  const results = new Array(userIds.length).fill(null);
  const missingIdx = [];

  cachedList.forEach((v, i) => {
    if (v) {
      try {
        results[i] = normalize(userIds[i], JSON.parse(v));
        return;
      } catch (e) { /* fall through to DB lookup */ }
    }
    missingIdx.push(i);
  });

  if (missingIdx.length) {
    const missingIds = missingIdx.map((i) => userIds[i]);
    try {
      const { rows } = await db.query(
        `SELECT * FROM user_presence WHERE user_id = ANY($1::uuid[])`,
        [missingIds]
      );
      const byId = new Map(rows.map((r) => [String(r.user_id), r]));
      missingIdx.forEach((i) => {
        const row = byId.get(String(userIds[i]));
        results[i] = row ? normalize(userIds[i], row) : normalize(userIds[i], { status: "OFFLINE" });
      });
    } catch (err) {
      console.error("[presenceService.getManyPresence] Postgres read failed:", err.message);
      missingIdx.forEach((i) => { results[i] = normalize(userIds[i], { status: "OFFLINE" }); });
    }
  }

  return results;
}

module.exports = {
  VALID_STATUSES,
  setPresence,
  setOffline,
  getPresence,
  getManyPresence
};