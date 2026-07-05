const express = require("express");
const router = express.Router();

const {
  listPackages,
  initiateOpay,
  opayWebhook,
  checkStatus,
  initiateStripe,
  stripeWebhook,
  checkStripeStatus,
  initiateFlutterwave,
  flutterwaveWebhook,
  checkFlutterwaveStatus,
  initiatePaypal,
  capturePaypal,
  paypalWebhook,
  checkPaypalStatus,
  initiateCashapp,
  cashappWebhook,
  checkCashappStatus,
  initiateIpay,
  ipayCallback,
  checkIpayStatus,
  initiateCrypto,
  cryptoWebhook,
  checkCryptoStatus,
  getCryptoCurrencies,   // ← was missing
  ledger,
  requestWithdrawal
} = require("../controllers/paymentController");

const { requireAuth } = require("../middlewares/auth");

// ================= PACKAGES =================
router.get("/packages", requireAuth, listPackages);

// ================= OPay =================
router.post("/opay/initiate", requireAuth, initiateOpay);
router.post("/opay/webhook", opayWebhook);
router.get("/opay/status/:reference", requireAuth, checkStatus);

// ================= Stripe =================
router.post("/stripe/initiate", requireAuth, initiateStripe);
// IMPORTANT: needs the RAW body for signature verification.
// Mounted with express.raw() here so it bypasses the global
// express.json() parser in app.js (see the rawBodyRoutes
// exception list in app.js).
router.post(
  "/stripe/webhook",
  express.raw({ type: "application/json" }),
  stripeWebhook
);
router.get("/stripe/status/:reference", requireAuth, checkStripeStatus);

// ================= Flutterwave =================
router.post("/flutterwave/initiate", requireAuth, initiateFlutterwave);
router.post("/flutterwave/webhook", flutterwaveWebhook);
router.get("/flutterwave/status/:reference", requireAuth, checkFlutterwaveStatus);

// ================= PayPal =================
router.post("/paypal/initiate", requireAuth, initiatePaypal);
router.post("/paypal/capture/:orderId", requireAuth, capturePaypal);
router.post("/paypal/webhook", paypalWebhook);
router.get("/paypal/status/:reference", requireAuth, checkPaypalStatus);

// ================= Cash App Pay (Square) =================
router.post("/cashapp/initiate", requireAuth, initiateCashapp);
// IMPORTANT: needs RAW body for Square's HMAC signature check,
// same pattern as Stripe's webhook.
router.post(
  "/cashapp/webhook",
  express.raw({ type: "application/json" }),
  cashappWebhook
);
router.get("/cashapp/status/:reference", requireAuth, checkCashappStatus);

// ================= iPay =================
router.post("/ipay/initiate", requireAuth, initiateIpay);
// form-encoded callback — covered by app.js's global urlencoded parser
router.post("/ipay/callback", ipayCallback);
router.get("/ipay/status/:reference", requireAuth, checkIpayStatus);

// ================= Crypto (NOWPayments: BTC/ETH/BNB/MATIC/USDT/USDC) =================
// ================= Crypto (NOWPayments: BTC/ETH/BNB/MATIC/USDT/USDC) =================
router.get("/crypto/currencies", requireAuth, getCryptoCurrencies);
router.post("/crypto/initiate", requireAuth, initiateCrypto);
// NOWPayments signs over the parsed+resorted JSON body, not raw
// bytes — global express.json() parser is fine here, no raw-body
// exception needed unlike Stripe/Cash App.
router.post("/crypto/webhook", cryptoWebhook);
router.get("/crypto/status/:reference", requireAuth, checkCryptoStatus);
// ================= WALLET =================
router.get("/wallet/ledger", requireAuth, ledger);

// ================= WITHDRAWALS =================
router.post("/withdrawals", requireAuth, requestWithdrawal);



console.log("=================================");
console.log("PAYMENT ROUTES");
console.log("=================================");

router.stack.forEach((layer) => {
  if (layer.route) {
    const method = Object.keys(layer.route.methods)[0].toUpperCase();
    console.log(`${method} ${layer.route.path}`);
  }
});

console.log("=================================");

module.exports = router;