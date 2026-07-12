const WithdrawalService = require('../services/withdrawalService');

const WithdrawalController = {
 async create(req, res, next) {
    try {
      const { coinsRequested, currency, bankName, bankAccountName, bankAccountNumber } = req.body;
      const data = await WithdrawalService.create(req.user.id, {
        coinsRequested, currency, bankName, bankAccountName, bankAccountNumber,
      });
      res.status(201).json({ success: true, data });
    } catch (err) { next(err); }
  },

  async mine(req, res, next) {
    try {
      const data = await WithdrawalService.listMine(req.user.id);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  },

  // ── Admin ──
  async listAll(req, res, next) {
    try {
      const data = await WithdrawalService.listAll({
        status: req.query.status,
        limit: req.query.limit ? Number(req.query.limit) : 50,
        offset: req.query.offset ? Number(req.query.offset) : 0,
      });
      res.json({ success: true, data });
    } catch (err) { next(err); }
  },

  async review(req, res, next) {
    try {
      const { approve, adminNote } = req.body;
      const data = await WithdrawalService.review(req.params.id, { approve: !!approve, adminNote });
      res.json({ success: true, data });
    } catch (err) { next(err); }
  },
};

module.exports = WithdrawalController;