const express = require("express");
const router = express.Router();

const GiftController = require("../controllers/giftController");
const { requireAuth } = require("../middlewares/auth");

router.get("/", requireAuth, GiftController.catalog);
router.post("/send", requireAuth, GiftController.send);
router.get("/received", requireAuth, GiftController.received);
router.get("/sent", requireAuth, GiftController.sent);

module.exports = router;