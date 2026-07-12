const db = require('../config/db');
const WalletService = require('./walletService');

const WithdrawalService = {
  /**
   * Requesting a withdrawal immediately debits earnings_balance (holds
   * the funds) and creates a pending row for admin review/payout.
   */
    async create(userId, { coinsRequested, currency, bankName, bankAccountName, bankAccountNumber }) {
    const amount = Number(coinsRequested);
    if (!amount || amount <= 0) {
      throw Object.assign(new Error('Enter a valid amount'), { status: 400 });
    }
    if (!bankName || !bankAccountName || !bankAccountNumber) {
      throw Object.assign(new Error('Bank details are required'), { status: 400 });
    }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const { rows } = await client.query(
        `INSERT INTO withdrawal_requests
           (user_id, coins_requested, cash_amount, currency, bank_account_name, bank_account_number, bank_name, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'pending') RETURNING *`,
        [userId, amount, null, currency || 'NGN', bankAccountName, bankAccountNumber, bankName]
      );
      const withdrawal = rows[0];

      await WalletService.debitEarnings(client, {
        userId,
        amount,
        type: 'withdrawal_request',
        referenceType: 'withdrawal_requests',
        referenceId: withdrawal.id,
        description: `Withdrawal request #${withdrawal.id}`,
      });

      await client.query('COMMIT');
      return withdrawal;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async listMine(userId) {
    const { rows } = await db.query(
      `SELECT * FROM withdrawal_requests WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
    return rows;
  },

  // ── Admin ──────────────────────────────────────────────
  async listAll({ status, limit = 50, offset = 0 } = {}) {
    const params = [];
    let where = '';
    if (status) {
      params.push(status);
      where = `WHERE w.status = $${params.length}`;
    }
    params.push(limit);
    const limitIdx = params.length;
    params.push(offset);
    const offsetIdx = params.length;

    const { rows } = await db.query(
      `SELECT w.*, u.username, u.email
       FROM withdrawals w
       JOIN users u ON u.id = w.user_id
       ${where}
       ORDER BY w.created_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params
    );
    return rows;
  },

  /**
   * Admin approves/rejects. On rejection, refund earnings_balance
   * so the held amount goes back to the user.
   */
  async review(withdrawalId, { approve, adminNote }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const { rows } = await client.query(
        `SELECT * FROM withdrawals WHERE id = $1 FOR UPDATE`,
        [withdrawalId]
      );
      const withdrawal = rows[0];
      if (!withdrawal) throw Object.assign(new Error('Withdrawal not found'), { status: 404 });
      if (withdrawal.status !== 'pending') {
        throw Object.assign(new Error('Withdrawal has already been processed'), { status: 400 });
      }

      const newStatus = approve ? 'approved' : 'rejected';

      if (!approve) {
        await WalletService.creditEarnings(client, {
          userId: withdrawal.user_id,
          amount: withdrawal.coins_requested,
          type: 'withdrawal_rejected_refund',
          referenceType: 'withdrawal',
          referenceId: withdrawal.id,
          description: `Refund for rejected withdrawal #${withdrawal.id}`,
        });
      }

      const { rows: updated } = await client.query(
        `UPDATE withdrawals SET status = $1, admin_note = $2, processed_at = now() WHERE id = $3 RETURNING *`,
        [newStatus, adminNote || null, withdrawalId]
      );

      await client.query('COMMIT');
      return updated[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
};

module.exports = WithdrawalService;