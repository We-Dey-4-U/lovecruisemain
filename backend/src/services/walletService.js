const db = require('../config/db');

/**
 * All coin balance changes MUST go through this service so that
 * users.coin_balance / users.earnings_balance and wallet_ledger
 * stay perfectly in sync (single source of truth + audit trail).
 */
const WalletService = {
  /**
   * Credit a user's spendable coin balance (e.g. after a successful coin purchase).
   */
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

  /**
   * Debit a user's spendable coin balance (e.g. sending a gift). Throws if insufficient funds.
   */
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
   * Credit a user's earnings balance (coins received from gifts — separately
   * trackable for withdrawal purposes).
   */
  async creditEarnings(client, { userId, amount, referenceType, referenceId, description }) {
    const { rows } = await client.query(
      `UPDATE users SET earnings_balance = earnings_balance + $1 WHERE id = $2 RETURNING earnings_balance`,
      [amount, userId]
    );
    await client.query(
      `INSERT INTO wallet_ledger (user_id, type, amount, balance_after, reference_type, reference_id, description)
       VALUES ($1, 'gift_received', $2, $3, $4, $5, $6)`,
      [userId, amount, rows[0].earnings_balance, referenceType, referenceId, description]
    );
    return rows[0].earnings_balance;
  },

  async getLedger(userId, { limit = 50, offset = 0 } = {}) {
    const { rows } = await db.query(
      `SELECT * FROM wallet_ledger WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    return rows;
  },



  /* ============================================================
   ADD THIS METHOD to your existing walletService.js — inside the
   WalletService object literal, alongside creditCoins/debitCoins/
   creditEarnings. Nothing else in that file needs to change.
   ============================================================ */
 
  /**
   * Credit the platform's cut of a gift. Mirrors creditEarnings but
   * writes to platform_wallet / platform_wallet_ledger instead of a
   * per-user row. Must be called inside the same DB transaction
   * (same `client`) as the rest of the gift split so it's atomic.
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