const express = require("express");
const router = express.Router();

const MarketplaceController = require("../controllers/marketplaceController");
const uploadMarketplaceImages = require('../middlewares/uploadMarketplaceImages');
const requireApprovedSeller = require('../middlewares/requireApprovedSeller');
const { requireAuth } = require("../middlewares/auth");

// ================= CATEGORIES =================
router.get("/categories", MarketplaceController.categories);

// ================= LISTINGS =================
// Public browse — no auth required, mirrors home.html's guest-friendly feed.
router.get("/listings", MarketplaceController.list);

// NOTE: "/listings/mine" must be registered BEFORE "/listings/:id"
// or Express will try to treat "mine" as an :id param.
router.get("/listings/mine", requireAuth, MarketplaceController.mine);

router.get("/listings/:id", MarketplaceController.getOne);

router.post('/listings', requireAuth, requireApprovedSeller, uploadMarketplaceImages, MarketplaceController.create);
router.patch('/listings/:id', requireAuth, requireApprovedSeller, uploadMarketplaceImages, MarketplaceController.update);
router.delete("/listings/:id", requireAuth, MarketplaceController.remove);

// Buying — deducts coins server-side inside a DB transaction.
router.post("/listings/:id/buy", requireAuth, MarketplaceController.buy);

// ================= ORDERS =================
router.get("/orders", requireAuth, MarketplaceController.orders);
router.patch("/orders/:id/status", requireAuth, MarketplaceController.updateOrderStatus);

module.exports = router;