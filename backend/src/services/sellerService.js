const db = require('../config/db');

const SellerService = {
  async getStatus(userId) {
    const { rows } = await db.query(`SELECT is_approved_seller FROM users WHERE id = $1`, [userId]);
    const isApprovedSeller = !!rows[0]?.is_approved_seller;

    const { rows: appRows } = await db.query(
      `SELECT * FROM seller_applications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    return { isApprovedSeller, application: appRows[0] || null };
  },

  async apply(userId, { businessName, reason, contactInfo } = {}) {
    const { rows: userRows } = await db.query(`SELECT is_approved_seller FROM users WHERE id = $1`, [userId]);
    if (userRows[0]?.is_approved_seller) {
      throw Object.assign(new Error('You are already an approved seller'), { status: 400 });
    }

    const { rows: pending } = await db.query(
      `SELECT id FROM seller_applications WHERE user_id = $1 AND status = 'pending'`,
      [userId]
    );
    if (pending.length) {
      throw Object.assign(new Error('You already have a pending application'), { status: 409 });
    }

    const { rows } = await db.query(
      `INSERT INTO seller_applications (user_id, business_name, reason, contact_info)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [userId, businessName || null, reason || null, contactInfo || null]
    );
    return rows[0];
  },

  // ── Admin ──────────────────────────────────────────────
  async listApplications({ status = 'pending', limit = 50, offset = 0 } = {}) {
    const { rows } = await db.query(
      `SELECT a.*, u.username, u.display_name, u.avatar_url, u.email
       FROM seller_applications a
       JOIN users u ON u.id = a.user_id
       WHERE a.status = $1
       ORDER BY a.created_at ASC
       LIMIT $2 OFFSET $3`,
      [status, limit, offset]
    );
    return rows;
  },

  async reviewApplication(adminId, applicationId, { approve, rejectionReason } = {}) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const { rows } = await client.query(
        `SELECT * FROM seller_applications WHERE id = $1 FOR UPDATE`,
        [applicationId]
      );
      const application = rows[0];
      if (!application) throw Object.assign(new Error('Application not found'), { status: 404 });
      if (application.status !== 'pending') {
        throw Object.assign(new Error('Application has already been reviewed'), { status: 400 });
      }

      const newStatus = approve ? 'approved' : 'rejected';
      const { rows: updated } = await client.query(
        `UPDATE seller_applications
         SET status = $1, reviewed_by = $2, reviewed_at = now(), rejection_reason = $3
         WHERE id = $4 RETURNING *`,
        [newStatus, adminId, approve ? null : (rejectionReason || null), applicationId]
      );

      if (approve) {
        await client.query(`UPDATE users SET is_approved_seller = TRUE WHERE id = $1`, [application.user_id]);
      }

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

module.exports = SellerService;