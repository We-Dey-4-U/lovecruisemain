// backend/src/routes/presence.routes.js

const express = require("express");
const router = express.Router();

const presenceController = require("../controllers/presenceController");
const { requireAuth } = require("../middlewares/auth");

// Specific paths MUST come before the generic "/:userId" route.
router.get("/followers/live-status", requireAuth, presenceController.followersLiveStatus);
router.get("/room/current/:userId", requireAuth, presenceController.getCurrentRoom);
router.patch("/settings", requireAuth, presenceController.updatePrivacySettings);

// Keep last — most generic param route.
router.get("/:userId", requireAuth, presenceController.getUserPresence);

module.exports = router;