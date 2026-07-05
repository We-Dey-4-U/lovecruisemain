const express = require("express");
const router = express.Router();

const AdminController = require("../controllers/adminController");
const { requireAuth, requireRole } = require("../middlewares/auth");

// ================= SECURITY GUARD =================
router.use(requireAuth);
router.use(requireRole("admin"));

// ================= DASHBOARD =================
router.get("/dashboard", AdminController.dashboard);

// ================= USERS =================
router.get("/users", AdminController.users);
router.get("/users/:id", AdminController.userDetails);
router.patch("/users/:id/status", AdminController.updateUserStatus);
router.patch("/users/:id/role", AdminController.updateUserRole);
router.delete("/users/:id", AdminController.deleteUser);

// ================= VERIFICATIONS =================
router.get("/verifications", AdminController.verificationRequests);
router.patch("/verifications/:id", AdminController.reviewVerification);

// ================= WITHDRAWALS =================
router.get("/withdrawals", AdminController.withdrawals);
router.patch("/withdrawals/:id", AdminController.processWithdrawal);

// ================= REPORTS =================
router.get("/reports", AdminController.reports);

// ================= LIVE ROOMS =================
router.get("/live-rooms", AdminController.liveRooms);
router.get("/live-rooms/:id", AdminController.liveRoomDetails);

// ================= PAYMENTS =================
router.get("/payments", AdminController.payments);

// ================= GIFTS =================
router.get("/gifts", AdminController.gifts);
router.post("/gifts", AdminController.createGift);
router.patch("/gifts/:id", AdminController.updateGift);
router.delete("/gifts/:id", AdminController.deleteGift);

// ================= ANALYTICS =================
router.get("/analytics", AdminController.analytics);
router.get("/revenue", AdminController.revenue);

// ================= LOGS =================
router.get("/logs", AdminController.logs);

// ================= SETTINGS =================
router.get("/settings", AdminController.settings);
router.patch("/settings/:key", AdminController.updateSetting);

module.exports = router;