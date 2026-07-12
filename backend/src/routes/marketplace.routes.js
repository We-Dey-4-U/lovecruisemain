const express = require('express');
const router = express.Router();

const MarketplaceController = require('../controllers/marketplaceController');
const uploadMarketplaceImages = require('../middlewares/uploadMarketplaceImages');
const requireApprovedSeller = require('../middlewares/requireApprovedSeller');
const { requireAuth } = require('../middlewares/auth');

// ================= CATEGORIES =================
router.get('/categories', MarketplaceController.categories);

// ================= LISTINGS =================
router.get('/listings', MarketplaceController.list);

// NOTE: "/listings/mine" must be registered BEFORE "/listings/:id"
router.get('/listings/mine', requireAuth, MarketplaceController.mine);
router.get('/listings/:id', MarketplaceController.getOne);

router.post('/listings', requireAuth, requireApprovedSeller, uploadMarketplaceImages, MarketplaceController.create);
router.patch('/listings/:id', requireAuth, requireApprovedSeller, uploadMarketplaceImages, MarketplaceController.update);
router.delete('/listings/:id', requireAuth, MarketplaceController.remove);

router.post('/listings/:id/buy', requireAuth, MarketplaceController.buy);

// ================= ORDERS =================
router.get('/orders', requireAuth, MarketplaceController.orders);
router.patch('/orders/:id/status', requireAuth, MarketplaceController.updateOrderStatus);

module.exports = router;