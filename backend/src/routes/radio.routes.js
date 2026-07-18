const express = require("express");
const router = express.Router();

const RadioController = require("../controllers/radioController");
const { requireAuth } = require("../middlewares/auth");

/* CATEGORIES */
router.get("/categories", requireAuth, RadioController.listCategories);

/* DISCOVER */
router.get("/live", requireAuth, RadioController.listLiveBroadcasts);

/* SCHEDULE */
router.get("/shows/upcoming", requireAuth, RadioController.listUpcomingShows);
router.post("/shows", requireAuth, RadioController.createShow);

/* STATIONS */
router.post("/stations", requireAuth, RadioController.createStation);
router.get("/stations", requireAuth, RadioController.listStations);
router.get("/stations/:id", requireAuth, RadioController.getStation);
router.patch("/stations/:id", requireAuth, RadioController.updateStation);
router.post("/stations/:id/follow", requireAuth, RadioController.followStation);
router.delete("/stations/:id/follow", requireAuth, RadioController.unfollowStation);
router.post("/stations/:id/subscribe", requireAuth, RadioController.subscribeStation); // members-only MVP

/* BROADCASTS */
router.post("/broadcasts", requireAuth, RadioController.startBroadcast);
router.get("/broadcasts/:id", requireAuth, RadioController.getBroadcast);
router.post("/broadcasts/:id/join", requireAuth, RadioController.joinBroadcast);
router.post("/broadcasts/:id/leave", requireAuth, RadioController.leaveBroadcast);
router.post("/broadcasts/:id/end", requireAuth, RadioController.endBroadcast);
router.get("/broadcasts/:id/top-gifters", requireAuth, RadioController.topGifters);
router.post("/broadcasts/:id/song-request", requireAuth, RadioController.requestSong);

/* CO-HOSTS / CALLERS (Phase 2) */
router.post("/broadcasts/:id/cohost/request", requireAuth, RadioController.requestCohost);
router.get("/broadcasts/:id/cohosts", requireAuth, RadioController.listCohosts);
router.post("/broadcasts/:id/cohost/:userId/respond", requireAuth, RadioController.respondCohost);
router.delete("/broadcasts/:id/cohost", requireAuth, RadioController.leaveCohost);
router.delete("/broadcasts/:id/cohost/:userId", requireAuth, RadioController.kickCohost);

/* LIVE POLLS (Phase 2) */
router.post("/broadcasts/:id/polls", requireAuth, RadioController.createPoll);
router.get("/broadcasts/:id/polls/active", requireAuth, RadioController.getActivePoll);
router.post("/polls/:pollId/vote", requireAuth, RadioController.votePoll);
router.post("/polls/:pollId/close", requireAuth, RadioController.closePoll);

console.log("Radio router type:", typeof router);

module.exports = router;