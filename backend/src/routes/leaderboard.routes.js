const express = require("express");
const router = express.Router();

router.get("/test", (req, res) => {
  res.json({ ok: true });
});

const LeaderboardController = require("../controllers/leaderboardController");
console.log("=================================");
console.log("LEADERBOARD CONTROLLER DEBUG");
console.log("=================================");
console.log("Type:", typeof LeaderboardController);
console.log("Keys:", Object.keys(LeaderboardController || {}));
console.log("Value:", LeaderboardController);
console.log("=================================");
const { requireAuth } = require("../middlewares/auth");

/* =========================================================
   DEFENSIVE CHECK
   ---------------------------------------------------------
   Helps catch startup errors like:
     "Route.get() requires a callback function but got
      [object Undefined]"

   If the auth middleware or any controller handler isn't
   exported correctly, we'll throw a descriptive error before
   Express attempts to register the routes.
========================================================= */
function assertFn(fn, name) {
  if (typeof fn !== "function") {
    throw new TypeError(
      `[leaderboard.routes.js] Expected "${name}" to be a function but got ${typeof fn} (${fn}). ` +
      `Check that backend/src/controllers/leaderboardController.js exports it and that ` +
      `backend/src/middlewares/auth.js exports "requireAuth" as a named export.`
    );
  }
}

assertFn(requireAuth, "requireAuth (from ../middlewares/auth)");
assertFn(LeaderboardController.topGifters, "LeaderboardController.topGifters");
assertFn(LeaderboardController.topReceivers, "LeaderboardController.topReceivers");
assertFn(LeaderboardController.biggestGifts, "LeaderboardController.biggestGifts");
assertFn(LeaderboardController.myRank, "LeaderboardController.myRank");
assertFn(LeaderboardController.userRank, "LeaderboardController.userRank");

/* =========================================================
   LEADERBOARDS
========================================================= */

// GET /api/leaderboard/gifters
router.get(
  "/gifters",
  LeaderboardController.topGifters
);

// GET /api/leaderboard/receivers
router.get(
  "/receivers",
  LeaderboardController.topReceivers
);

// GET /api/leaderboard/biggest-gifts
router.get(
  "/biggest-gifts",
  LeaderboardController.biggestGifts
);

// GET /api/leaderboard/me
// Registered before "/user/:id" for consistency.
router.get(
  "/me",
  requireAuth,
  LeaderboardController.myRank
);

// GET /api/leaderboard/user/:id
router.get(
  "/user/:id",
  requireAuth,
  LeaderboardController.userRank
);

module.exports = router;