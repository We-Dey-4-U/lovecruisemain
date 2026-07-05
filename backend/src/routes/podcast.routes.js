const express = require("express");
const router = express.Router();

const { requireAuth } = require("../middlewares/auth");
const C = require("../controllers/podcastController");

/* ============================================================
   FEED
============================================================ */
router.get("/feed", requireAuth, C.getFeed);
router.get("/feed/following", requireAuth, C.getFollowingFeed);

/* ============================================================
   SHOWS
============================================================ */
router.get("/shows", requireAuth, C.listShows);
router.get("/shows/trending", requireAuth, C.getTrendingShows);
router.get("/shows/mine", requireAuth, C.getMyShows);
router.post("/shows", requireAuth, C.createShow);

router.get("/shows/:id", requireAuth, C.getShow);
router.put("/shows/:id", requireAuth, C.updateShow);
router.delete("/shows/:id", requireAuth, C.deleteShow);
router.get("/shows/:id/episodes", requireAuth, C.getShowEpisodes);
router.post("/shows/:id/follow", requireAuth, C.followShow);
router.delete("/shows/:id/follow", requireAuth, C.unfollowShow);

/* ============================================================
   EPISODES
============================================================ */
router.get("/episodes/trending", requireAuth, C.getTrendingEpisodes);
router.get("/episodes/mine", requireAuth, C.getMyEpisodes);
router.post("/episodes", requireAuth, C.createEpisode);

router.get("/episodes/:id", requireAuth, C.getEpisode);
router.put("/episodes/:id", requireAuth, C.updateEpisode);
router.delete("/episodes/:id", requireAuth, C.deleteEpisode);

/* ============================================================
   EPISODE INTERACTIONS
============================================================ */
router.post("/episodes/:id/listen", requireAuth, C.recordListen);
router.post("/episodes/:id/like", requireAuth, C.toggleLike);

/* ============================================================
   COMMENTS
============================================================ */
router.get("/episodes/:id/comments", requireAuth, C.getComments);
router.post("/episodes/:id/comments", requireAuth, C.addComment);
router.delete("/episodes/:id/comments/:commentId", requireAuth, C.deleteComment);

/* ============================================================
   CHAPTERS
============================================================ */
router.post("/episodes/:id/chapters", requireAuth, C.upsertChapter);
router.delete("/episodes/:id/chapters/:chapterId", requireAuth, C.deleteChapter);

/* ============================================================
   ANALYTICS
============================================================ */
router.get("/analytics/me", requireAuth, C.getAnalytics);


console.log("✅ podcast.routes.js loaded");

router.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Podcast API working"
  });
});

module.exports = router;