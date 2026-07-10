const db = require('../config/db');

async function requireApprovedSeller(req, res, next) {
  try {
    const { rows } = await db.query(`SELECT is_approved_seller FROM users WHERE id = $1`, [req.user.id]);
    if (!rows[0]?.is_approved_seller) {
      return res.status(403).json({
        success: false,
        message: 'You must be an approved seller to do this. Apply from your profile page.',
      });
    }
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = requireApprovedSeller;