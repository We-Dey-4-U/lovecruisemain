const db = require('../config/db');
const OpayService = require('../services/opayService');
const StripeService = require('../services/stripeService');
const FlutterwaveService = require('../services/flutterwaveService');
const PaypalService = require('../services/paypalService');
const WalletService = require('../services/walletService');
const CashappService = require('../services/cashappService');
const IpayService = require('../services/ipayService');
const CryptoService = require('../services/cryptoService');

console.log("=================================");
console.log("CRYPTO SERVICE DEBUG");
console.log("Resolved:", require.resolve("../services/cryptoService"));
console.log("Keys:", Object.keys(CryptoService));
console.log("=================================");

exports.listPackages = async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM coin_packages WHERE is_active = TRUE ORDER BY sort_order ASC'
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
};

/* ================= OPAY ================= */

exports.initiateOpay = async (req, res, next) => {
  try {
    const { coinPackageId } = req.body;
    if (!coinPackageId) {
      return res.status(400).json({ success: false, message: 'coinPackageId is required' });
    }

    const result = await OpayService.initiatePurchase({
      userId: req.user.id,
      coinPackageId,
      userEmail: req.user.email,
    });

    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
};

exports.opayWebhook = async (req, res, next) => {
  try {
    const isValid = OpayService.verifyWebhookSignature(req.body);

    if (!isValid) {
      return res.status(401).json({ success: false, message: 'Invalid webhook signature' });
    }

    const result = await OpayService.handleWebhook(req.body);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
};

exports.checkStatus = async (req, res, next) => {
  try {
    const tx = await OpayService.getStatus(req.user.id, req.params.reference);

    if (!tx) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    res.json({ success: true, data: tx });
  } catch (err) {
    next(err);
  }
};

/* ================= STRIPE ================= */

exports.initiateStripe = async (req, res, next) => {
  try {
    const { coinPackageId } = req.body;
    if (!coinPackageId) {
      return res.status(400).json({ success: false, message: 'coinPackageId is required' });
    }

    const result = await StripeService.initiatePurchase({
      userId: req.user.id,
      coinPackageId,
      userEmail: req.user.email,
    });

    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
};

// NOTE: this route MUST receive the raw (unparsed) request body —
// see the express.raw() middleware in payments.routes.js and the
// app.js body-parser exception.
exports.stripeWebhook = async (req, res, next) => {
  try {
    const signature = req.headers['stripe-signature'];
    const event = StripeService.verifyAndConstructEvent(req.body, signature);

    if (!event) {
      return res.status(401).json({ success: false, message: 'Invalid webhook signature' });
    }

    const result = await StripeService.handleWebhookEvent(event);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
};

exports.checkStripeStatus = async (req, res, next) => {
  try {
    const tx = await StripeService.getStatus(req.user.id, req.params.reference);

    if (!tx) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    res.json({ success: true, data: tx });
  } catch (err) {
    next(err);
  }
};

/* ================= FLUTTERWAVE =================
   Logged with tag [FLW][ctrl] — pairs with the [FLW][<reqId>]
   and [FLW][webhook] logs inside flutterwaveService.js so the
   full request lifecycle is traceable in Render logs.
   ============================================================ */

exports.initiateFlutterwave = async (req, res, next) => {
  const startedAt = Date.now();
  console.log('[FLW][ctrl] ── POST /flutterwave/initiate ──');
  console.log('[FLW][ctrl] userId:', req.user?.id, 'email:', req.user?.email);
  console.log('[FLW][ctrl] body:', JSON.stringify(req.body));

  try {
    const { coinPackageId } = req.body;
    if (!coinPackageId) {
      console.warn('[FLW][ctrl] ❌ Missing coinPackageId in request body');
      return res.status(400).json({ success: false, message: 'coinPackageId is required' });
    }

    const result = await FlutterwaveService.initiatePurchase({
      userId: req.user.id,
      coinPackageId,
      userEmail: req.user.email,
    });

    console.log(`[FLW][ctrl] ✅ initiatePurchase succeeded in ${Date.now() - startedAt}ms — checkoutUrl: ${result.checkoutUrl}`);

    res.status(201).json({ success: true, data: result });
  } catch (err) {
    console.error(`[FLW][ctrl] ❌ initiateFlutterwave failed after ${Date.now() - startedAt}ms`);
    console.error('[FLW][ctrl] ❌ err.message:', err.message);
    console.error('[FLW][ctrl] ❌ err.status:', err.status);
    console.error('[FLW][ctrl] ❌ stack:', err.stack);
    next(err);
  }
};

exports.flutterwaveWebhook = async (req, res, next) => {
  console.log('[FLW][ctrl] ── POST /flutterwave/webhook ──');
  console.log('[FLW][ctrl] headers[verif-hash] present:', !!req.headers['verif-hash']);
  console.log('[FLW][ctrl] body:', JSON.stringify(req.body));

  try {
    const signature = req.headers['verif-hash'];
    const isValid = FlutterwaveService.verifyWebhookSignature(signature);

    if (!isValid) {
      console.error('[FLW][ctrl] ❌ Webhook signature verification FAILED — rejecting with 401. If this keeps happening, confirm FLUTTERWAVE_WEBHOOK_HASH in Render matches the "Secret Hash" set in the Flutterwave dashboard under Settings > Webhooks.');
      return res.status(401).json({ success: false, message: 'Invalid webhook signature' });
    }

    console.log('[FLW][ctrl] ✅ Webhook signature verified, processing...');
    const result = await FlutterwaveService.handleWebhook(req.body);
    console.log('[FLW][ctrl] ✅ Webhook processed, resulting status:', result.status, 'coins_credited:', result.coins_credited);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[FLW][ctrl] ❌ flutterwaveWebhook failed:', err.message);
    console.error('[FLW][ctrl] ❌ stack:', err.stack);
    next(err);
  }
};

exports.checkFlutterwaveStatus = async (req, res, next) => {
  console.log(`[FLW][ctrl] GET /flutterwave/status/${req.params.reference} — userId: ${req.user?.id}`);
  try {
    const tx = await FlutterwaveService.getStatus(req.user.id, req.params.reference);

    if (!tx) {
      console.warn(`[FLW][ctrl] ❌ No transaction found for reference ${req.params.reference} / user ${req.user.id}`);
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    console.log(`[FLW][ctrl] ✅ Status for ${req.params.reference}: ${tx.status}`);
    res.json({ success: true, data: tx });
  } catch (err) {
    console.error('[FLW][ctrl] ❌ checkFlutterwaveStatus failed:', err.message);
    next(err);
  }
};

/* ================= CASH APP PAY ================= */

// NOTE: unlike every other initiate*, this expects a `sourceToken`
// from Square's Web Payments SDK, not just a coinPackageId — the
// charge happens synchronously, no checkoutUrl redirect.
exports.initiateCashapp = async (req, res, next) => {
  try {
    const { coinPackageId, sourceToken } = req.body;
    if (!coinPackageId) {
      return res.status(400).json({ success: false, message: 'coinPackageId is required' });
    }
    if (!sourceToken) {
      return res.status(400).json({ success: false, message: 'sourceToken is required' });
    }

    const result = await CashappService.initiatePurchase({
      userId: req.user.id,
      coinPackageId,
      sourceToken,
    });

    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
};

// IMPORTANT: needs the raw body — see routes file note, same pattern
// as Stripe's webhook.
exports.cashappWebhook = async (req, res, next) => {
  try {
    const signature = req.headers['x-square-hmacsha256-signature'];
    const notificationUrl = `${process.env.SQUARE_WEBHOOK_NOTIFICATION_URL}`;
    const rawBody = req.body; // Buffer, when mounted with express.raw()

    const isValid = CashappService.verifyWebhookSignature(rawBody.toString('utf8'), signature, notificationUrl);

    if (!isValid) {
      return res.status(401).json({ success: false, message: 'Invalid webhook signature' });
    }

    const parsedBody = JSON.parse(rawBody.toString('utf8'));
    const result = await CashappService.handleWebhook(parsedBody);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
};

exports.checkCashappStatus = async (req, res, next) => {
  try {
    const tx = await CashappService.getStatus(req.user.id, req.params.reference);

    if (!tx) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    res.json({ success: true, data: tx });
  } catch (err) {
    next(err);
  }
};

/* ================= IPAY ================= */

exports.initiateIpay = async (req, res, next) => {
  try {
    const { coinPackageId } = req.body;
    if (!coinPackageId) {
      return res.status(400).json({ success: false, message: 'coinPackageId is required' });
    }

    const result = await IpayService.initiatePurchase({
      userId: req.user.id,
      coinPackageId,
      userEmail: req.user.email,
    });

    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
};

// iPay calls this as a form-encoded POST callback — already covered
// by app.js's global express.urlencoded() parser, no raw-body needed.
exports.ipayCallback = async (req, res, next) => {
  try {
    const isValid = IpayService.verifyCallbackSignature(req.body);

    if (!isValid) {
      return res.status(401).json({ success: false, message: 'Invalid callback signature' });
    }

    const result = await IpayService.handleCallback(req.body);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
};

exports.checkIpayStatus = async (req, res, next) => {
  try {
    const tx = await IpayService.getStatus(req.user.id, req.params.reference);

    if (!tx) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    res.json({ success: true, data: tx });
  } catch (err) {
    next(err);
  }
};

/* ================= CRYPTO (NOWPayments) =================
   Every handler below is heavily logged, tagged [CRYPTO][ctrl],
   so the full request lifecycle (incoming request -> service call
   -> outcome) is visible in the Render logs even before you get
   to cryptoService.js's own internal [CRYPTO][<reqId>] logs.
   ============================================================ */

exports.getCryptoCurrencies = async (req, res, next) => {
  console.log('[CRYPTO][ctrl] GET /crypto/currencies — userId:', req.user?.id);
  try {
    const data = CryptoService.getSupportedCurrencies();
    console.log('[CRYPTO][ctrl] Returning supported currencies:', JSON.stringify(data));
    res.json({ success: true, data });
  } catch (err) {
    console.error('[CRYPTO][ctrl] ❌ getCryptoCurrencies failed:', err.message);
    next(err);
  }
};

exports.initiateCrypto = async (req, res, next) => {
  const startedAt = Date.now();
  console.log('[CRYPTO][ctrl] ── POST /crypto/initiate ──');
  console.log('[CRYPTO][ctrl] userId:', req.user?.id, 'email:', req.user?.email);
  console.log('[CRYPTO][ctrl] body:', JSON.stringify(req.body));

  try {
    const { coinPackageId, payCurrency } = req.body;

    if (!coinPackageId) {
      console.warn('[CRYPTO][ctrl] ❌ Missing coinPackageId in request body');
      return res.status(400).json({ success: false, message: 'coinPackageId is required' });
    }
    if (!payCurrency) {
      console.warn('[CRYPTO][ctrl] ❌ Missing payCurrency in request body');
      return res.status(400).json({ success: false, message: 'payCurrency is required (btc, eth, bnb, matic, usdt, usdc)' });
    }

    const result = await CryptoService.initiatePurchase({
      userId: req.user.id,
      coinPackageId,
      payCurrency,
    });

    console.log(`[CRYPTO][ctrl] ✅ initiatePurchase succeeded in ${Date.now() - startedAt}ms — payAddress: ${result.payAddress}, payAmount: ${result.payAmount}, payCurrency: ${result.payCurrency}`);

    res.status(201).json({ success: true, data: result });
  } catch (err) {
    console.error(`[CRYPTO][ctrl] ❌ initiateCrypto failed after ${Date.now() - startedAt}ms`);
    console.error('[CRYPTO][ctrl] ❌ err.message:', err.message);
    console.error('[CRYPTO][ctrl] ❌ err.status:', err.status);
    if (err.upstreamStatus) {
      console.error('[CRYPTO][ctrl] ❌ err.upstreamStatus (from NOWPayments/host):', err.upstreamStatus);
      console.error('[CRYPTO][ctrl] ❌ err.upstreamBody:', JSON.stringify(err.upstreamBody));
    }
    console.error('[CRYPTO][ctrl] ❌ stack:', err.stack);
    next(err);
  }
};

// This IS the auto-credit trigger for crypto — same role webhooks
// play for every other provider. NOWPayments only fires this once
// the on-chain transaction is confirmed (payment_status === 'finished'),
// so coins are credited automatically, no manual capture step.
exports.cryptoWebhook = async (req, res, next) => {
  console.log('[CRYPTO][ctrl] ── POST /crypto/webhook (IPN) ──');
  console.log('[CRYPTO][ctrl] headers[x-nowpayments-sig] present:', !!req.headers['x-nowpayments-sig']);
  console.log('[CRYPTO][ctrl] body:', JSON.stringify(req.body));

  try {
    const signature = req.headers['x-nowpayments-sig'];
    const isValid = CryptoService.verifyWebhookSignature(req.body, signature);

    if (!isValid) {
      console.error('[CRYPTO][ctrl] ❌ Webhook signature verification FAILED — rejecting with 401');
      return res.status(401).json({ success: false, message: 'Invalid webhook signature' });
    }

    console.log('[CRYPTO][ctrl] ✅ Webhook signature verified, processing...');
    const result = await CryptoService.handleWebhook(req.body);
    console.log('[CRYPTO][ctrl] ✅ Webhook processed, resulting status:', result.status);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[CRYPTO][ctrl] ❌ cryptoWebhook failed:', err.message);
    console.error('[CRYPTO][ctrl] ❌ stack:', err.stack);
    next(err);
  }
};

exports.checkCryptoStatus = async (req, res, next) => {
  console.log(`[CRYPTO][ctrl] GET /crypto/status/${req.params.reference} — userId: ${req.user?.id}`);
  try {
    const tx = await CryptoService.getStatus(req.user.id, req.params.reference);

    if (!tx) {
      console.warn(`[CRYPTO][ctrl] ❌ No transaction found for reference ${req.params.reference} / user ${req.user.id}`);
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    console.log(`[CRYPTO][ctrl] ✅ Status for ${req.params.reference}: ${tx.status}`);
    res.json({ success: true, data: tx });
  } catch (err) {
    console.error('[CRYPTO][ctrl] ❌ checkCryptoStatus failed:', err.message);
    next(err);
  }
};

/* ================= PAYPAL ================= */

exports.initiatePaypal = async (req, res, next) => {
  try {
    const { coinPackageId } = req.body;
    if (!coinPackageId) {
      return res.status(400).json({ success: false, message: 'coinPackageId is required' });
    }

    const result = await PaypalService.initiatePurchase({
      userId: req.user.id,
      coinPackageId,
      userEmail: req.user.email,
    });

    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
};

// Called from the PAYPAL_RETURN_URL page once the user approves —
// this is the PRIMARY trigger for crediting coins, not the webhook.
exports.capturePaypal = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    if (!orderId) {
      return res.status(400).json({ success: false, message: 'orderId is required' });
    }

    const result = await PaypalService.capturePurchase({
      userId: req.user.id,
      orderId,
    });

    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
};

// Defense-in-depth only — does not credit coins itself beyond what
// capturePurchase already does; safe to call again if PayPal retries.
exports.paypalWebhook = async (req, res, next) => {
  try {
    const isValid = await PaypalService.verifyWebhookSignature(req.body, req.headers);

    if (!isValid) {
      return res.status(401).json({ success: false, message: 'Invalid webhook signature' });
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

exports.checkPaypalStatus = async (req, res, next) => {
  try {
    const tx = await PaypalService.getStatus(req.user.id, req.params.reference);

    if (!tx) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    res.json({ success: true, data: tx });
  } catch (err) {
    next(err);
  }
};

/* ================= WALLET / WITHDRAWALS (unchanged) ================= */

exports.ledger = async (req, res, next) => {
  try {
    const data = await WalletService.getLedger(req.user.id);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

exports.requestWithdrawal = async (req, res, next) => {
  try {
    const { coins, bankAccountName, bankAccountNumber, bankName } = req.body;

    if (!coins || coins <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid coins' });
    }

    const { rows: userRows } = await db.query(
      'SELECT earnings_balance FROM users WHERE id = $1',
      [req.user.id]
    );

    if (!userRows[0] || userRows[0].earnings_balance < coins) {
      return res.status(400).json({ success: false, message: 'Insufficient balance' });
    }

    const COIN_TO_NAIRA_RATE = 4;
    const cashAmount = coins * COIN_TO_NAIRA_RATE;

    const client = await db.getClient();

    try {
      await client.query('BEGIN');

      await client.query(
        'UPDATE users SET earnings_balance = earnings_balance - $1 WHERE id = $2',
        [coins, req.user.id]
      );

      const { rows } = await client.query(
        `INSERT INTO withdrawal_requests
        (user_id, coins_requested, cash_amount, bank_account_name, bank_account_number, bank_name)
        VALUES ($1,$2,$3,$4,$5,$6)
        RETURNING *`,
        [req.user.id, coins, cashAmount, bankAccountName, bankAccountNumber, bankName]
      );

      await client.query(
        `INSERT INTO wallet_ledger
        (user_id, type, amount, balance_after, reference_type, reference_id, description)
        VALUES ($1,'withdrawal',$2,
        (SELECT earnings_balance FROM users WHERE id = $1),
        'withdrawal_requests',$3,'Withdrawal requested')`,
        [req.user.id, -coins, rows[0].id]
      );

      await client.query('COMMIT');

      res.status(201).json({ success: true, data: rows[0] });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
};