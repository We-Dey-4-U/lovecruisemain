const express = require("express");
const router = express.Router();

const CallController = require("../controllers/callController");

// ✅ FIXED PATH (middlewares NOT middleware)
const { requireAuth } = require("../middlewares/auth");

// ================= CALLS =================

// POST /api/calls
router.post("/", requireAuth, CallController.initiate);

// PATCH /api/calls/:id
router.patch("/:id", requireAuth, CallController.updateStatus);

// GET /api/calls/history
router.get("/history", requireAuth, CallController.history);

module.exports = router;