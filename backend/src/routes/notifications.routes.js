const express = require("express");
const router = express.Router();

const NotificationController = require("../controllers/NotificationController");
const { requireAuth } = require("../middlewares/auth");

router.get("/", requireAuth, NotificationController.list);

router.patch("/:id/read", requireAuth, NotificationController.markRead);

router.patch("/read-all", requireAuth, NotificationController.markAllRead);

module.exports = router;