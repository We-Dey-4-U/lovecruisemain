const db = require('../config/db');
const WalletService = require('./walletService');
const AntiFraudService = require('./antiFraudService');

const HOST_SHARE_PCT = 0.70;
const PLATFORM_SHARE_PCT = 0.30;

const GiftService = {
  async listCatalog() {
    const { rows } = await db.query(
      `SELECT id, name, emoji, icon_url, animation_url, price_coins, category, sort_order, is_golden_love
       FROM gifts WHERE is_active = TRUE ORDER BY sort_order ASC, price_coins ASC`
    );
    return rows;
  },

  /**
   * Send a gift from one user to another. Runs in a DB transaction:
   * 1. Anti-fraud gate (self-gift / banned accounts) — hard block
   * 2. Debit sender's spendable coin_balance
   * 3. Record the gift_transactions row (host/platform share + status)
   * 4. Split: credit 70% to receiver's earnings_balance, 30% to platform_wallet
   * 5. (optional) Insert a chat/live-room message representing the gift
   * Golden Love / Host Academy qualification tracking happens AFTER
   * commit (best-effort, never rolls back a successful coin transfer).
   */
  async sendGift({ senderId, receiverId, giftId, quantity = 1, contextType, contextId, deviceHash, ipAddress }) {
    const client = await db.getClient();
    let tx, gift, hostShare, platformShare;

    try {
      await client.query('BEGIN');

      await AntiFraudService.assertGiftAllowed(client, { senderId, receiverId });

      const { rows: giftRows } = await client.query(
        'SELECT * FROM gifts WHERE id = $1 AND is_active = TRUE',
        [giftId]
      );
      gift = giftRows[0];
      if (!gift) {
        const err = new Error('Gift not found');
        err.status = 404;
        throw err;
      }

      const totalCoins = gift.price_coins * quantity;
      hostShare = Math.round(totalCoins * HOST_SHARE_PCT);
      platformShare = totalCoins - hostShare; // remainder avoids rounding leaks

      await WalletService.debitCoins(client, {
        userId: senderId,
        amount: totalCoins,
        type: 'gift_sent',
        referenceType: 'gift_transactions',
        referenceId: null,
        description: `Sent ${quantity}x ${gift.name}`,
      });

      const { rows: txRows } = await client.query(
        `INSERT INTO gift_transactions
           (gift_id, sender_id, receiver_id, quantity, total_coins,
            host_share_coins, platform_share_coins, status, is_golden_love,
            context_type, context_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed', $8, $9, $10)
         RETURNING *`,
        [giftId, senderId, receiverId, quantity, totalCoins,
          hostShare, platformShare, !!gift.is_golden_love, contextType, contextId]
      );
      tx = txRows[0];

      // 70% to the host/receiver's earnings
      await WalletService.creditEarnings(client, {
        userId: receiverId,
        amount: hostShare,
        referenceType: 'gift_transactions',
        referenceId: tx.id,
        description: `Received ${quantity}x ${gift.name} (70% host share)`,
      });

      // 30% to the platform — atomic, same transaction
      await WalletService.creditPlatform(client, {
        amount: platformShare,
        referenceType: 'gift_transactions',
        referenceId: tx.id,
        description: `Platform share of ${quantity}x ${gift.name} from gift #${tx.id}`,
      });

      // soft anti-fraud signals (device dup / farming) — logged, non-blocking
      await AntiFraudService.checkSoftSignals(client, { senderId, receiverId, deviceHash, ipAddress });

      if (contextType === 'live_room') {
        await client.query(
          `INSERT INTO live_room_messages (room_id, user_id, body, message_type, gift_id)
           VALUES ($1, $2, $3, 'gift', $4)`,
          [contextId, senderId, `sent ${quantity}x ${gift.name} ${gift.emoji || ''}`, giftId]
        );
        await client.query(
          `UPDATE live_rooms SET total_coins_earned = total_coins_earned + $1 WHERE id = $2`,
          [totalCoins, contextId]
        );
      } else if (contextType === 'chat') {
        await client.query(
          `INSERT INTO messages (conversation_id, sender_id, body, message_type, gift_id)
           VALUES ($1, $2, $3, 'gift', $4)`,
          [contextId, senderId, `sent ${quantity}x ${gift.name} ${gift.emoji || ''}`, giftId]
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // NOTE: Host Academy qualification tracking is intentionally NOT
    // triggered here. It's fired by the controller (giftController.send)
    // right after this resolves, since the controller already has `io`
    // via req.app.get('io') and this keeps giftService decoupled from
    // Socket.IO. See giftController.js — it checks `gift.is_golden_love`
    // on the returned result and calls HostAcademyService.recordGoldenLoveGift.

    return {
      transaction: tx,
      gift,
      totalCoins: tx.total_coins,
      hostShare,
      platformShare,
    };
  },

  async receivedHistory(userId, { limit = 50, offset = 0 } = {}) {
    const { rows } = await db.query(
      `SELECT gt.*, g.name AS gift_name, g.emoji, u.username AS sender_username
       FROM gift_transactions gt
       JOIN gifts g ON g.id = gt.gift_id
       JOIN users u ON u.id = gt.sender_id
       WHERE gt.receiver_id = $1
       ORDER BY gt.created_at DESC LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    return rows;
  },

  async sentHistory(userId, { limit = 50, offset = 0 } = {}) {
    const { rows } = await db.query(
      `SELECT gt.*, g.name AS gift_name, g.emoji, u.username AS receiver_username
       FROM gift_transactions gt
       JOIN gifts g ON g.id = gt.gift_id
       JOIN users u ON u.id = gt.receiver_id
       WHERE gt.sender_id = $1
       ORDER BY gt.created_at DESC LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    return rows;
  },
};

module.exports = GiftService;