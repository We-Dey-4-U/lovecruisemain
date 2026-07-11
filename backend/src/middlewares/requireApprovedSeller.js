/* ============================================================
   backend/src/middlewares/requireApprovedSeller.js
   ------------------------------------------------------------
   Gates listing creation/editing to users whose seller
   application has been approved by an admin (users.is_approved_seller).
   Must run AFTER requireAuth.

   This is the server-side enforcement that backs the UI rule:
   "product upload form only shows on the user's profile /
   marketplace once admin approves their seller application."
   Without this middleware, a user could still hit the API
   directly even if the frontend hides the "Sell" button.
   ============================================================ */



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