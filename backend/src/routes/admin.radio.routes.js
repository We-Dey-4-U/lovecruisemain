// backend/src/routes/admin.radio.routes.js
//
// Separate top-level mount (kept independent of the unseen
// admin.routes.js file) so radio moderation ships without
// touching routes you already have wired up. Uses an inline
// admin-role check rather than assuming a requireAdmin
// middleware exists elsewhere in the codebase.

const express = require("express");
const router = express.Router();

const AdminController = require("../controllers/adminController");
const { requireAuth } = require("../middlewares/auth");

function requireAdminRole(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ success: false, message: "Admin access required" });
  }
  next();
}

router.get("/stations", requireAuth, requireAdminRole, AdminController.radioStations);
router.patch("/stations/:id/status", requireAuth, requireAdminRole, AdminController.updateRadioStationStatus);
router.patch("/stations/:id/official", requireAuth, requireAdminRole, AdminController.updateRadioStationOfficial);
router.get("/analytics", requireAuth, requireAdminRole, AdminController.radioAnalytics);
router.post("/categories", requireAuth, requireAdminRole, AdminController.createRadioCategory);

module.exports = router;