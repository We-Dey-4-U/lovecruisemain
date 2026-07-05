/* ============================================================
   backend/src/services/leaderboardService.js   [NEW]
   ============================================================
   Real leaderboard, built directly off gift_transactions — the
   only table in the schema that's actually populated on every
   gift send (see giftService.sendGift). No dependency on
   livestream-hours / engagement tracking that doesn't exist yet.

   status = 'completed' filters out anything future work might
   mark as refunded/reversed (see migration 002 — gift_transactions
   already has a status column, default 'completed').
   ============================================================ */

console.log("1. leaderboardService starting");

const db = require("../config/db");

console.log("2. db loaded");

const PERIODS = ["today", "yesterday", "week", "month", "year", "all"];

console.log("3. about to build service");

/**
 * Returns { from, to } bounds (JS Dates, passed as bound params —
 * never string-concatenated) for the given period. `to` is null
 * unless the period needs an explicit upper bound (yesterday).
 */
function resolvePeriod(period) {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  switch (period) {
    case "today":
      return { from: startOfToday, to: null };
    case "yesterday": {
      const from = new Date(startOfToday);
      from.setDate(from.getDate() - 1);
      return { from, to: startOfToday };
    }
    case "week": {
      const from = new Date(startOfToday);
      const day = (from.getDay() + 6) % 7; // Monday-start week
      from.setDate(from.getDate() - day);
      return { from, to: null };
    }
    case "month": {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from, to: null };
    }
    case "year": {
      const from = new Date(now.getFullYear(), 0, 1);
      return { from, to: null };
    }
    case "all":
    default:
      return { from: new Date("2000-01-01T00:00:00Z"), to: null };
  }
}

function normalizePeriod(period) {
  return PERIODS.includes(period) ? period : "all";
}

const LeaderboardService = {
  PERIODS,

  /**
   * Top gifters (by coins SENT) for a given period.
   */
  async getTopGifters({ period = "all", limit = 20, offset = 0 } = {}) {
    const p = normalizePeriod(period);
    const { from, to } = resolvePeriod(p);

    const params = [from];
    let dateClause = "gt.created_at >= $1";
    if (to) {
      params.push(to);
      dateClause += ` AND gt.created_at < $${params.length}`;
    }

    params.push(limit, offset);
    const limitIdx = params.length - 1;
    const offsetIdx = params.length;

    const { rows } = await db.query(
      `
      SELECT
        u.id, u.username, u.display_name, u.avatar_url, u.is_verified,
        COALESCE(SUM(gt.total_coins), 0)::bigint AS total_coins,
        COUNT(DISTINCT gt.receiver_id)::int      AS hosts_supported,
        COUNT(gt.id)::int                        AS gift_count,
        RANK() OVER (ORDER BY COALESCE(SUM(gt.total_coins), 0) DESC) AS rank
      FROM gift_transactions gt
      JOIN users u ON u.id = gt.sender_id
      WHERE gt.status = 'completed' AND ${dateClause}
      GROUP BY u.id
      ORDER BY total_coins DESC, u.id
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
      `,
      params
    );
    return rows;
  },

  /**
   * Top receivers / "top hosts" (by coins RECEIVED) for a given period.
   */
  async getTopReceivers({ period = "all", limit = 20, offset = 0 } = {}) {
    const p = normalizePeriod(period);
    const { from, to } = resolvePeriod(p);

    const params = [from];
    let dateClause = "gt.created_at >= $1";
    if (to) {
      params.push(to);
      dateClause += ` AND gt.created_at < $${params.length}`;
    }

    params.push(limit, offset);
    const limitIdx = params.length - 1;
    const offsetIdx = params.length;

    const { rows } = await db.query(
      `
      SELECT
        u.id, u.username, u.display_name, u.avatar_url, u.is_verified,
        COALESCE(SUM(gt.host_share_coins), 0)::bigint AS total_coins,
        COUNT(DISTINCT gt.sender_id)::int             AS unique_gifters,
        COUNT(gt.id)::int                             AS gift_count,
        RANK() OVER (ORDER BY COALESCE(SUM(gt.host_share_coins), 0) DESC) AS rank
      FROM gift_transactions gt
      JOIN users u ON u.id = gt.receiver_id
      WHERE gt.status = 'completed' AND ${dateClause}
      GROUP BY u.id
      ORDER BY total_coins DESC, u.id
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
      `,
      params
    );
    return rows;
  },

  /**
   * A single user's rank + totals for a period, for either
   * direction ('gifter' = coins sent, 'receiver' = coins received).
   * Computed against the FULL ranked set (no limit), so this is
   * accurate even if the user isn't in the top page of results.
   */
  async getUserRank(userId, { type = "gifter", period = "all" } = {}) {
    const p = normalizePeriod(period);
    const { from, to } = resolvePeriod(p);
    const isGifter = type === "gifter";

    const groupCol = isGifter ? "gt.sender_id" : "gt.receiver_id";
    const coinExpr = isGifter ? "gt.total_coins" : "gt.host_share_coins";

    const params = [from];
    let dateClause = "gt.created_at >= $1";
    if (to) {
      params.push(to);
      dateClause += ` AND gt.created_at < $${params.length}`;
    }
    params.push(userId);
    const userIdx = params.length;

    const { rows } = await db.query(
      `
      WITH ranked AS (
        SELECT
          ${groupCol} AS user_id,
          COALESCE(SUM(${coinExpr}), 0)::bigint AS total_coins,
          RANK() OVER (ORDER BY COALESCE(SUM(${coinExpr}), 0) DESC) AS rank
        FROM gift_transactions gt
        WHERE gt.status = 'completed' AND ${dateClause}
        GROUP BY ${groupCol}
      )
      SELECT * FROM ranked WHERE user_id = $${userIdx}
      `,
      params
    );

    return rows[0] || { user_id: userId, total_coins: 0, rank: null };
  },

  /**
   * Biggest single gift sent / received for a period — cheap,
   * useful "record" leaderboard that needs no aggregation.
   */
  async getBiggestGifts({ direction = "sent", period = "all", limit = 20 } = {}) {
    const p = normalizePeriod(period);
    const { from, to } = resolvePeriod(p);
    const params = [from];
    let dateClause = "gt.created_at >= $1";
    if (to) {
      params.push(to);
      dateClause += ` AND gt.created_at < $${params.length}`;
    }
    params.push(limit);

    const userJoinCol = direction === "sent" ? "gt.sender_id" : "gt.receiver_id";

    const { rows } = await db.query(
      `
      SELECT
        gt.id, gt.total_coins, gt.quantity, gt.created_at,
        g.name AS gift_name, g.emoji,
        u.id AS user_id, u.username, u.display_name, u.avatar_url
      FROM gift_transactions gt
      JOIN gifts g ON g.id = gt.gift_id
      JOIN users u ON u.id = ${userJoinCol}
      WHERE gt.status = 'completed' AND ${dateClause}
      ORDER BY gt.total_coins DESC, gt.created_at DESC
      LIMIT $${params.length}
      `,
      params
    );
    return rows;
  },
};

module.exports = LeaderboardService;