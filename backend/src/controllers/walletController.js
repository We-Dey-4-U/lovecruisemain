const WalletService = require('../services/walletService');

const WalletController = {
  async earningsSummary(req, res, next) {
    try {
      const data = await WalletService.getEarningsSummary(req.user.id);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  },

  async ledger(req, res, next) {
    try {
      const { limit, offset } = req.query;
      const data = await WalletService.getLedger(req.user.id, {
        limit: limit ? Number(limit) : 50,
        offset: offset ? Number(offset) : 0,
      });
      res.json({ success: true, data });
    } catch (err) { next(err); }
  },
};

module.exports = WalletController;