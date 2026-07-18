const express = require("express");
const router = express.Router();

const SongRequestController = require("../controllers/songRequestController");
const { requireAuth } = require("../middlewares/auth");

/* REQUESTS (listener-facing + host moderation) */
router.post("/:broadcastId/requests", requireAuth, SongRequestController.requestSong);
router.get("/:broadcastId/requests", requireAuth, SongRequestController.listRequests);
router.post("/requests/:requestId/vote", requireAuth, SongRequestController.voteRequest);
router.post("/requests/:requestId/approve", requireAuth, SongRequestController.approveRequest);
router.post("/requests/:requestId/reject", requireAuth, SongRequestController.rejectRequest);

/* QUEUE (host-controlled) */
router.get("/:broadcastId/queue", requireAuth, SongRequestController.getQueue);
router.post("/:broadcastId/queue", requireAuth, SongRequestController.addToQueue);
router.patch("/:broadcastId/queue/reorder", requireAuth, SongRequestController.reorderQueue);
router.delete("/:broadcastId/queue/:itemId", requireAuth, SongRequestController.removeFromQueue);

/* TRANSPORT CONTROLS */
router.post("/:broadcastId/next", requireAuth, SongRequestController.playNext);
router.post("/:broadcastId/pause", requireAuth, SongRequestController.pausePlayback);
router.post("/:broadcastId/resume", requireAuth, SongRequestController.resumePlayback);

module.exports = router;