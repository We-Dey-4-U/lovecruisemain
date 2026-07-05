/* ============================================================
   backend/src/controllers/leaderboardController.js   [NEW]
   ============================================================ */

const LeaderboardService = require("../services/leaderboardService");

function parsePaging(req) {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const period = LeaderboardService.PERIODS.includes(req.query.period)
    ? req.query.period
    : "all";
  return { limit, offset, period };
}

const LeaderboardController = {
  // GET /api/leaderboard/gifters?period=&limit=&offset=
  async topGifters(req, res, next) {
    try {
      const { limit, offset, period } = parsePaging(req);
      const data = await LeaderboardService.getTopGifters({ period, limit, offset });
      res.json({ success: true, data, meta: { period, limit, offset } });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/leaderboard/receivers?period=&limit=&offset=
  async topReceivers(req, res, next) {
    try {
      const { limit, offset, period } = parsePaging(req);
      const data = await LeaderboardService.getTopReceivers({ period, limit, offset });
      res.json({ success: true, data, meta: { period, limit, offset } });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/leaderboard/biggest-gifts?direction=sent|received&period=&limit=
  async biggestGifts(req, res, next) {
    try {
      const { limit, period } = parsePaging(req);
      const direction = req.query.direction === "received" ? "received" : "sent";
      const data = await LeaderboardService.getBiggestGifts({ direction, period, limit });
      res.json({ success: true, data, meta: { period, direction, limit } });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/leaderboard/me?type=gifter|receiver&period=
  async myRank(req, res, next) {
    try {
      const period = LeaderboardService.PERIODS.includes(req.query.period)
        ? req.query.period
        : "all";
      const type = req.query.type === "receiver" ? "receiver" : "gifter";
      const data = await LeaderboardService.getUserRank(req.user.id, { type, period });
      res.json({ success: true, data, meta: { period, type } });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/leaderboard/user/:id?type=gifter|receiver&period=
  async userRank(req, res, next) {
    try {
      const period = LeaderboardService.PERIODS.includes(req.query.period)
        ? req.query.period
        : "all";
      const type = req.query.type === "receiver" ? "receiver" : "gifter";
      const data = await LeaderboardService.getUserRank(req.params.id, { type, period });
      res.json({ success: true, data, meta: { period, type } });
    } catch (err) {
      next(err);
    }
  },
};

module.exports = LeaderboardController;