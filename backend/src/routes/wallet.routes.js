const express = require('express');
const router = express.Router();

const WalletController = require('../controllers/walletController');
const { requireAuth } = require('../middlewares/auth');

router.get('/earnings-summary', requireAuth, WalletController.earningsSummary);
router.get('/ledger', requireAuth, WalletController.ledger);

module.exports = router;