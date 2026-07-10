const SellerService = require('../services/sellerService');

const SellerController = {
  async myStatus(req, res, next) {
    try {
      const data = await SellerService.getStatus(req.user.id);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  },

  async apply(req, res, next) {
    try {
      const { businessName, reason, contactInfo } = req.body;
      const application = await SellerService.apply(req.user.id, { businessName, reason, contactInfo });
      res.status(201).json({ success: true, data: application });
    } catch (err) { next(err); }
  },

  // ── Admin ──
  async listApplications(req, res, next) {
    try {
      const data = await SellerService.listApplications({
        status: req.query.status || 'pending',
        limit: req.query.limit ? Number(req.query.limit) : 50,
        offset: req.query.offset ? Number(req.query.offset) : 0,
      });
      res.json({ success: true, data });
    } catch (err) { next(err); }
  },

  async reviewApplication(req, res, next) {
    try {
      const { approve, rejectionReason } = req.body;
      const data = await SellerService.reviewApplication(req.user.id, req.params.id, {
        approve: !!approve,
        rejectionReason,
      });
      res.json({ success: true, data });
    } catch (err) { next(err); }
  },
};

module.exports = SellerController;