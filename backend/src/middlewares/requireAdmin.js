/* ============================================================
   backend/src/middlewares/requireAdmin.js
   ------------------------------------------------------------
   Simple role gate. Must run AFTER requireAuth (needs req.user
   already populated with at least { id, role }).

   Usage:
     const { requireAuth } = require('../middlewares/auth');
     const requireAdmin = require('../middlewares/requireAdmin');
     router.get('/applications', requireAuth, requireAdmin, ctrl.listApplications);
   ============================================================ */

module.exports = function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access required' });
  }
  return next();
};
