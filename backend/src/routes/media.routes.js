// backend/src/routes/media.routes.js
const express = require("express");
const router = express.Router();

const { requireAuth, requireRole } = require("../middlewares/auth");
const MediaController = require("../controllers/mediaController");

router.get("/assign/:roomType/:roomId", requireAuth, MediaController.assign);
router.post("/release/:roomId", requireAuth, MediaController.release);
router.get("/nodes", requireAuth, requireRole("admin"), MediaController.listNodes);

module.exports = router;