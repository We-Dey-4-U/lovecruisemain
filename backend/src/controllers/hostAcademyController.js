const HostAcademyService = require("../services/hostAcademyService");

const HostAcademyController = {
  // GET /api/host-academy/me
  async myDashboard(req, res, next) {
    try {
      const data = await HostAcademyService.getDashboard(req.user.id);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/host-academy/:userId  (public — view another host's badge/progress)
  async dashboardFor(req, res, next) {
    try {
      const data = await HostAcademyService.getDashboard(req.params.userId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/host-academy/checkin
  async checkin(req, res, next) {
    try {
      const io = req.app.get("io");
      await HostAcademyService.recordTask(io, {
        userId: req.user.id,
        taskKey: "daily_checkin",
      });
      const data = await HostAcademyService.getDashboard(req.user.id);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },
};

module.exports = HostAcademyController;