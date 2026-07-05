/* ============================================================
   backend/src/services/antiFraudService.js   [NEW — Part 4]
   ------------------------------------------------------------
   Lightweight, synchronous checks that run inside the gift
   transaction (same `client`) so a rejected gift never partially
   commits. Anything suspicious is logged to fraud_flags for
   review but does NOT block the coin transfer itself unless the
   gift must be blocked outright (self-gift, banned users) — this
   matches "no manual approval required unless fraud is detected"
   from PART 4/PART 3, i.e. earnings still work, only Host Academy
   *qualification credit* is what gets withheld for softer signals.
   ============================================================ */

const db = require("../config/db");

const AntiFraudService = {
  /**
   * Hard block — these gifts must not be processed at all.
   * Throws with .status = 400/403 so the controller returns cleanly.
   */
  async assertGiftAllowed(client, { senderId, receiverId }) {
    if (senderId === receiverId) {
      const err = new Error("Self-gifting is not allowed");
      err.status = 400;
      throw err;
    }

    const { rows } = await client.query(
      `SELECT id, status FROM users WHERE id IN ($1, $2)`,
      [senderId, receiverId]
    );
    for (const u of rows) {
      if (u.status === "banned" || u.status === "suspended") {
        const err = new Error("This account cannot send or receive gifts");
        err.status = 403;
        throw err;
      }
    }
  },

  /**
   * Soft signal — device/IP duplication or gift-farming between the
   * same two accounts. Logged for review; does not block the coin
   * transfer, but callers (Host Academy service) should treat a
   * fresh flag as a reason to withhold *qualification* credit.
   * Returns true if a flag was raised.
   */
  async checkSoftSignals(client, { senderId, receiverId, deviceHash, ipAddress }) {
    let flagged = false;

    // gift farming: same sender->receiver pair sending Golden Love
    // gifts back and forth many times in a short window
    const { rows: farmRows } = await client.query(
      `SELECT COUNT(*)::int AS cnt FROM gift_transactions
       WHERE sender_id = $1 AND receiver_id = $2
         AND created_at > NOW() - INTERVAL '10 minutes'`,
      [senderId, receiverId]
    );
    if (farmRows[0].cnt >= 10) {
      flagged = true;
      await this.flag(client, senderId, "gift_farming", { receiverId, count: farmRows[0].cnt });
    }

    // device duplication: same device hash tied to >1 user account
    if (deviceHash) {
      await client.query(
        `INSERT INTO device_fingerprints (user_id, device_hash, ip_address) VALUES ($1, $2, $3)`,
        [senderId, deviceHash, ipAddress || null]
      );
      const { rows: devRows } = await client.query(
        `SELECT COUNT(DISTINCT user_id)::int AS cnt FROM device_fingerprints WHERE device_hash = $1`,
        [deviceHash]
      );
      if (devRows[0].cnt > 3) {
        flagged = true;
        await this.flag(client, senderId, "device_duplication", { deviceHash, accounts: devRows[0].cnt });
      }
    }

    return flagged;
  },

  async flag(client, userId, reason, details) {
    await client.query(
      `INSERT INTO fraud_flags (user_id, reason, details) VALUES ($1, $2, $3)`,
      [userId, reason, details ? JSON.stringify(details) : null]
    );
  },

  /**
   * Used by hostAcademyService before granting qualification credit
   * for a Golden Love gift: refunded gifts and gifts from a user
   * flagged in the last 24h don't count.
   */
  async isEligibleForQualification({ giftTransactionId, senderId }) {
    const { rows: txRows } = await db.query(
      `SELECT status FROM gift_transactions WHERE id = $1`,
      [giftTransactionId]
    );
    if (!txRows[0] || txRows[0].status === "refunded") return false;

    const { rows: flagRows } = await db.query(
      `SELECT 1 FROM fraud_flags WHERE user_id = $1 AND created_at > NOW() - INTERVAL '24 hours' LIMIT 1`,
      [senderId]
    );
    if (flagRows.length) return false;

    return true;
  },
};

module.exports = AntiFraudService;