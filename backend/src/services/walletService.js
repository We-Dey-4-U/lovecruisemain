const db = require('../config/db');

/**
 * All coin balance changes MUST go through this service so that
 * users.coin_balance / users.earnings_balance and wallet_ledger
 * stay perfectly in sync (single source of truth + audit trail).
 */
const WalletService = {
  async creditCoins(client, { userId, amount, type, referenceType, referenceId, description }) {
    const { rows } = await client.query(
      `UPDATE users SET coin_balance = coin_balance + $1 WHERE id = $2 RETURNING coin_balance`,
      [amount, userId]
    );
    const balanceAfter = rows[0].coin_balance;
    await client.query(
      `INSERT INTO wallet_ledger (user_id, type, amount, balance_after, reference_type, reference_id, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, type, amount, balanceAfter, referenceType, referenceId, description]
    );
    return balanceAfter;
  },

  async debitCoins(client, { userId, amount, type, referenceType, referenceId, description }) {
    const { rows: balRows } = await client.query(
      'SELECT coin_balance FROM users WHERE id = $1 FOR UPDATE',
      [userId]
    );
    if (!balRows[0] || balRows[0].coin_balance < amount) {
      const err = new Error('Insufficient coin balance');
      err.status = 400;
      throw err;
    }
    const { rows } = await client.query(
      `UPDATE users SET coin_balance = coin_balance - $1 WHERE id = $2 RETURNING coin_balance`,
      [amount, userId]
    );
    const balanceAfter = rows[0].coin_balance;
    await client.query(
      `INSERT INTO wallet_ledger (user_id, type, amount, balance_after, reference_type, reference_id, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, type, -amount, balanceAfter, referenceType, referenceId, description]
    );
    return balanceAfter;
  },

  /**
   * Credit a user's earnings balance. `type` distinguishes the SOURCE
   * of the earning ('gift_received' vs 'marketplace_sale') so the two
   * are never summed/blended incorrectly downstream.
   */
  async creditEarnings(client, { userId, amount, type = 'gift_received', referenceType, referenceId, description }) {
    const { rows } = await client.query(
      `UPDATE users SET earnings_balance = earnings_balance + $1 WHERE id = $2 RETURNING earnings_balance`,
      [amount, userId]
    );
    await client.query(
      `INSERT INTO wallet_ledger (user_id, type, amount, balance_after, reference_type, reference_id, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, type, amount, rows[0].earnings_balance, referenceType, referenceId, description]
    );
    return rows[0].earnings_balance;
  },

  /**
   * Debit a user's earnings balance (used when a withdrawal is requested —
   * the requested amount is held/removed from earnings_balance immediately).
   */
  async debitEarnings(client, { userId, amount, type, referenceType, referenceId, description }) {
    const { rows: balRows } = await client.query(
      'SELECT earnings_balance FROM users WHERE id = $1 FOR UPDATE',
      [userId]
    );
    if (!balRows[0] || Number(balRows[0].earnings_balance) < Number(amount)) {
      const err = new Error('Insufficient earnings balance');
      err.status = 400;
      throw err;
    }
    const { rows } = await client.query(
      `UPDATE users SET earnings_balance = earnings_balance - $1 WHERE id = $2 RETURNING earnings_balance`,
      [amount, userId]
    );
    const balanceAfter = rows[0].earnings_balance;
    await client.query(
      `INSERT INTO wallet_ledger (user_id, type, amount, balance_after, reference_type, reference_id, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, type, -amount, balanceAfter, referenceType, referenceId, description]
    );
    return balanceAfter;
  },

  /**
   * Returns gift-earnings and marketplace-earnings as two SEPARATE
   * totals (never summed into one blended figure) plus a combined total
   * for withdrawal-limit purposes.
   */
  async getEarningsSummary(userId) {
    const { rows } = await db.query(
      `SELECT
         COALESCE(SUM(amount) FILTER (WHERE type = 'gift_received'), 0)     AS gift_earnings,
         COALESCE(SUM(amount) FILTER (WHERE type = 'marketplace_sale'), 0)  AS marketplace_earnings,
         COALESCE(SUM(amount) FILTER (WHERE type = 'withdrawal_request'), 0) AS withdrawn
       FROM wallet_ledger
       WHERE user_id = $1`,
      [userId]
    );
    const giftEarnings        = Number(rows[0]?.gift_earnings || 0);
    const marketplaceEarnings = Number(rows[0]?.marketplace_earnings || 0);
    const withdrawn           = Math.abs(Number(rows[0]?.withdrawn || 0));
    return {
      giftEarnings,
      marketplaceEarnings,
      totalEarnings: giftEarnings + marketplaceEarnings - withdrawn,
    };
  },

  async getLedger(userId, { limit = 50, offset = 0 } = {}) {
    const { rows } = await db.query(
      `SELECT * FROM wallet_ledger WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    return rows;
  },

  /**
   * Credit the platform's cut. Must be called inside the same DB
   * transaction (same `client`) as the rest of the split so it's atomic.
   */
  async creditPlatform(client, { amount, referenceType, referenceId, description }) {
    const { rows } = await client.query(
      `UPDATE platform_wallet SET balance = balance + $1 WHERE id = 1 RETURNING balance`,
      [amount]
    );
    await client.query(
      `INSERT INTO platform_wallet_ledger (amount, balance_after, reference_type, reference_id, description)
       VALUES ($1, $2, $3, $4, $5)`,
      [amount, rows[0].balance, referenceType, referenceId, description]
    );
    return rows[0].balance;
  },
};

module.exports = WalletService;