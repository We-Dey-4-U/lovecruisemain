/* ============================================================
   backend/src/services/cryptoService.js
   ------------------------------------------------------------
   Wraps NOWPayments' NON-HOSTED payment endpoint (/v1/payment),
   NOT the hosted invoice endpoint. The difference matters:

     /v1/invoice  -> returns invoice_url, redirects user to
                      NOWPayments' own checkout page (we don't
                      control that UI)
     /v1/payment  -> returns the deposit address + exact amount
                      to send DIRECTLY in the JSON response, no
                      redirect at all. We display that address
                      ourselves, in our own dropdown/modal.

   ============================================================
   DIAGNOSTIC LOGGING (added)
   ------------------------------------------------------------
   This version logs, at module load:
     - whether each required env var is present (never the raw
       secret value itself, just presence/length/prefix)
     - the exact BASE_URL that will be used for every request

   And on every initiatePurchase call:
     - the exact URL being hit
     - the outgoing payload (safe to log, no secrets in it)
     - the response status code + full response body on success
     - on failure: HTTP status, response headers, response body,
       and whether the failure even reached NOWPayments at all
       (vs. DNS/connection errors, which axios reports differently)

   Search your Render logs for the tag [CRYPTO] to find all of
   this in one place.
   ============================================================ */

const axios = require('axios');
const crypto = require('crypto');
const db = require('../config/db');
const WalletService = require('./walletService');

const BASE_URL = process.env.NOWPAYMENTS_BASE_URL;
const API_KEY = process.env.NOWPAYMENTS_API_KEY;
const IPN_SECRET = process.env.NOWPAYMENTS_IPN_SECRET;
const IPN_CALLBACK_URL = process.env.CRYPTO_IPN_CALLBACK_URL;

// ── Boot-time diagnostics ──────────────────────────────────
// Logs whether each env var is actually set and roughly what it
// looks like, WITHOUT ever printing the secret itself. This is
// the #1 place misconfiguration shows up (e.g. .env edited
// locally but never updated in the Render dashboard).
(function logCryptoEnvStatus() {
  function describe(name, value, { isSecret = false } = {}) {
    if (!value) {
      console.error(`[CRYPTO][BOOT] ❌ ${name} is NOT SET`);
      return;
    }
    if (isSecret) {
      console.log(`[CRYPTO][BOOT] ✅ ${name} is set (length=${value.length}, starts with "${value.slice(0, 4)}...")`);
    } else {
      console.log(`[CRYPTO][BOOT] ✅ ${name} = "${value}"`);
    }
  }

  console.log('[CRYPTO][BOOT] ================= NOWPayments config check =================');
  describe('NOWPAYMENTS_BASE_URL', BASE_URL);
  describe('NOWPAYMENTS_API_KEY', API_KEY, { isSecret: true });
  describe('NOWPAYMENTS_IPN_SECRET', IPN_SECRET, { isSecret: true });
  describe('CRYPTO_IPN_CALLBACK_URL', IPN_CALLBACK_URL);

  if (BASE_URL && !/^https:\/\/api\.nowpayments\.io\/?$/.test(BASE_URL.trim())) {
    console.error(
      `[CRYPTO][BOOT] ⚠️  NOWPAYMENTS_BASE_URL does not look like NOWPayments' real API host. ` +
      `Expected "https://api.nowpayments.io" but got "${BASE_URL}". ` +
      `Every /v1/payment call will be sent to the WRONG SERVER until this is corrected ` +
      `in the Render dashboard's Environment tab (not just the local .env file).`
    );
  }
  if (BASE_URL && BASE_URL.trim() !== BASE_URL) {
    console.error(`[CRYPTO][BOOT] ⚠️  NOWPAYMENTS_BASE_URL has leading/trailing whitespace or stray characters: ${JSON.stringify(BASE_URL)}`);
  }
  console.log('[CRYPTO][BOOT] ================================================================');
})();

// Coin codes as NOWPayments expects them. usdt/usdc default to a
// network — pin explicitly (usdttrc20, usdterc20, usdtbsc, etc.)
// once you decide which chain(s) you want to support for stablecoins;
// left generic here so it's easy to expand later.
const SUPPORTED_CURRENCIES = {
  btc:   { code: 'btc',   label: 'Bitcoin' },
  eth:   { code: 'eth',   label: 'Ethereum' },
  bnb:   { code: 'bnb',   label: 'BNB (BSC)' },
  matic: { code: 'matic', label: 'Polygon' },
  usdt:  { code: 'usdttrc20', label: 'USDT (TRC20)' },
  usdc:  { code: 'usdc',  label: 'USD Coin' },
};

function generateReference() {
  return `VC-CRYPTO-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

const CryptoService = {

  getSupportedCurrencies() {
    return Object.entries(SUPPORTED_CURRENCIES).map(([key, val]) => ({
      key,
      label: val.label,
    }));
  },

  /**
   * Returns a deposit address + exact amount to send — NOT a
   * checkoutUrl. Frontend should render this directly (address,
   * QR code, amount) rather than redirecting anywhere.
   */
  async initiatePurchase({ userId, coinPackageId, payCurrency }) {
    const reqId = crypto.randomBytes(3).toString('hex'); // correlate log lines for this call
    console.log(`[CRYPTO][${reqId}] ── initiatePurchase start ── userId=${userId} coinPackageId=${coinPackageId} payCurrency=${payCurrency}`);

    const normalizedKey = String(payCurrency || '').toLowerCase();
    const currencyConfig = SUPPORTED_CURRENCIES[normalizedKey];
    if (!currencyConfig) {
      console.error(`[CRYPTO][${reqId}] ❌ Unsupported currency requested: "${payCurrency}" (normalized: "${normalizedKey}")`);
      const err = new Error(`Unsupported crypto currency: ${payCurrency}`);
      err.status = 400;
      throw err;
    }

    if (!BASE_URL) {
      console.error(`[CRYPTO][${reqId}] ❌ NOWPAYMENTS_BASE_URL is not set in this environment. Aborting before making any HTTP call.`);
      const err = new Error('Crypto payments are misconfigured (missing base URL)');
      err.status = 500;
      throw err;
    }
    if (!API_KEY) {
      console.error(`[CRYPTO][${reqId}] ❌ NOWPAYMENTS_API_KEY is not set in this environment. Aborting before making any HTTP call.`);
      const err = new Error('Crypto payments are misconfigured (missing API key)');
      err.status = 500;
      throw err;
    }

    const { rows: pkgRows } = await db.query(
      'SELECT * FROM coin_packages WHERE id = $1 AND is_active = TRUE',
      [coinPackageId]
    );
    const pkg = pkgRows[0];
    if (!pkg) {
      console.error(`[CRYPTO][${reqId}] ❌ Coin package not found or inactive: ${coinPackageId}`);
      const err = new Error('Coin package not found');
      err.status = 404;
      throw err;
    }

    const reference = generateReference();
    console.log(`[CRYPTO][${reqId}] Generated reference: ${reference}, package: "${pkg.name}" price=${pkg.price_amount} ${pkg.currency}`);

    const { rows: txRows } = await db.query(
      `INSERT INTO payment_transactions 
        (user_id, coin_package_id, provider, provider_reference, amount, currency, status)
       VALUES ($1, $2, 'crypto', $3, $4, $5, 'pending')
       RETURNING *`,
      [userId, coinPackageId, reference, pkg.price_amount, pkg.currency]
    );
    console.log(`[CRYPTO][${reqId}] Inserted pending payment_transactions row id=${txRows[0].id}`);

    const targetUrl = `${BASE_URL.replace(/\/+$/, '')}/v1/payment`;

    try {
      const paymentPayload = {
        price_amount: Number(pkg.price_amount),
        price_currency: pkg.currency.toLowerCase(),
        pay_currency: currencyConfig.code,
        order_id: reference,
        order_description: `${pkg.name} — ${pkg.coins + pkg.bonus_coins} coins`,
        ipn_callback_url: IPN_CALLBACK_URL,
      };

      console.log(`[CRYPTO][${reqId}] 📤 POST ${targetUrl}`);
      console.log(`[CRYPTO][${reqId}] 📤 Payload:`, JSON.stringify(paymentPayload));
      console.log(`[CRYPTO][${reqId}] 📤 Using API key ending in "...${(API_KEY || '').slice(-4)}"`);

      const response = await axios.post(targetUrl, paymentPayload, {
        headers: { 'x-api-key': API_KEY, 'Content-Type': 'application/json' },
        timeout: 20000,
        // Let us inspect non-2xx responses ourselves instead of only
        // going through the catch block with less context.
        validateStatus: () => true,
      });

      console.log(`[CRYPTO][${reqId}] 📥 Response status: ${response.status} ${response.statusText || ''}`);
      console.log(`[CRYPTO][${reqId}] 📥 Response headers:`, JSON.stringify(response.headers));
      console.log(`[CRYPTO][${reqId}] 📥 Response body:`, JSON.stringify(response.data, null, 2));

      if (response.status >= 400) {
        // Surface NOWPayments' (or an intermediary's, e.g. a
        // suspended-service page) exact error body instead of a
        // generic message.
        const bodyPreview = typeof response.data === 'string'
          ? response.data.slice(0, 500)
          : JSON.stringify(response.data);
        console.error(`[CRYPTO][${reqId}] ❌ Non-2xx from ${targetUrl}: HTTP ${response.status} — body: ${bodyPreview}`);

        await db.query(
          `UPDATE payment_transactions SET status = 'failed', raw_response = $1 WHERE id = $2`,
          [JSON.stringify({ httpStatus: response.status, body: response.data }), txRows[0].id]
        );

        const upstreamErr = new Error(
          (response.data && response.data.message) ||
          `Upstream returned HTTP ${response.status}`
        );
        upstreamErr.status = 502;
        upstreamErr.upstreamStatus = response.status;
        upstreamErr.upstreamBody = response.data;
        throw upstreamErr;
      }

      const payAddress = response.data?.pay_address;
      const payAmount = response.data?.pay_amount;
      const paymentId = response.data?.payment_id;
      const paymentStatus = response.data?.payment_status;
      const expiresAt = response.data?.expiration_estimate_date || null;
      const network = response.data?.network || null;

      if (!payAddress) {
        console.error(`[CRYPTO][${reqId}] ❌ 2xx response but no pay_address present. Full body logged above. This usually means: (1) the payout wallet for "${currencyConfig.code}" is not configured in the NOWPayments dashboard, (2) the NOWPayments account/store is not fully verified or activated, or (3) pay_currency "${currencyConfig.code}" is not enabled for this account.`);
        await db.query(
          `UPDATE payment_transactions SET status = 'failed', raw_response = $1 WHERE id = $2`,
          [JSON.stringify(response.data), txRows[0].id]
        );
        const noAddrErr = new Error('NOWPayments did not return a deposit address');
        noAddrErr.status = 502;
        throw noAddrErr;
      }

      console.log(`[CRYPTO][${reqId}] ✅ Got deposit address for ${currencyConfig.code}: ${payAddress} amount=${payAmount} paymentId=${paymentId} status=${paymentStatus}`);

      await db.query(
        `UPDATE payment_transactions SET raw_response = $1 WHERE id = $2`,
        [JSON.stringify({ paymentId, payAddress, payAmount, payCurrency: currencyConfig.code, network }), txRows[0].id]
      );

      return {
        transaction: txRows[0],
        // No checkoutUrl — frontend renders this directly.
        checkoutUrl: null,
        payAddress,
        payAmount,
        payCurrency: currencyConfig.code,
        network,
        paymentId,
        paymentStatus,
        expiresAt,
      };
    } catch (err) {
      // Distinguish "we got a response and it was bad" (handled above,
      // rethrown) from "the request itself never completed" (DNS
      // failure, connection refused, timeout, TLS error, etc.) — these
      // look identical from the frontend but have very different fixes.
      if (err.upstreamStatus) {
        // Already logged in detail above; just log+update+rethrow the
        // already-informative wrapped error.
        throw err;
      }

      console.error(`[CRYPTO][${reqId}] ❌ Request to ${targetUrl} never completed normally.`);
      console.error(`[CRYPTO][${reqId}] ❌ err.code: ${err.code}`);
      console.error(`[CRYPTO][${reqId}] ❌ err.message: ${err.message}`);
      if (err.response) {
        console.error(`[CRYPTO][${reqId}] ❌ err.response.status: ${err.response.status}`);
        console.error(`[CRYPTO][${reqId}] ❌ err.response.data:`, JSON.stringify(err.response.data));
      } else if (err.request) {
        console.error(`[CRYPTO][${reqId}] ❌ No response received at all (network/DNS/timeout level failure). This usually means NOWPAYMENTS_BASE_URL points somewhere unreachable, or the outbound request was blocked/timed out.`);
      }

      await db.query(
        `UPDATE payment_transactions SET status = 'failed', raw_response = $1 WHERE id = $2`,
        [JSON.stringify(err.response?.data || { message: err.message, code: err.code }), txRows[0].id]
      );

      const wrapped = new Error(err.response?.data?.message || 'Failed to create crypto payment address');
      wrapped.status = 502;
      throw wrapped;
    }
  },

  /**
   * NOWPayments signs IPN webhooks as HMAC-SHA512 over the JSON body
   * with keys sorted alphabetically (documented quirk). `signature`
   * is req.headers['x-nowpayments-sig']. `body` must be the parsed
   * webhook JSON object.
   */
  verifyWebhookSignature(body, signature) {
    if (!IPN_SECRET || !signature || !body) {
      console.error(`[CRYPTO][webhook] ❌ verifyWebhookSignature failed early: hasSecret=${!!IPN_SECRET} hasSignatureHeader=${!!signature} hasBody=${!!body}`);
      return false;
    }

    const sortedBody = sortObjectKeys(body);
    const payload = JSON.stringify(sortedBody);

    const expectedSig = crypto
      .createHmac('sha512', IPN_SECRET)
      .update(payload, 'utf8')
      .digest('hex');

    const isValid = expectedSig === signature;
    if (!isValid) {
      console.error(`[CRYPTO][webhook] ❌ Signature mismatch. This means either NOWPAYMENTS_IPN_SECRET is wrong/stale, or the raw body was mutated (e.g. re-serialized) before this check.`);
    }
    return isValid;
  },

  /**
   * `body` is NOWPayments' parsed IPN payload: { order_id,
   * payment_status, pay_amount, actually_paid, pay_currency, ... }.
   * Only credits coins when payment_status === 'finished' (fully
   * confirmed on-chain). This IS the auto-credit trigger for crypto
   * — no manual capture step, exactly like every other provider's
   * webhook.
   */
  async handleWebhook(body) {
    console.log('[CRYPTO][webhook] Received IPN:', JSON.stringify(body));

    const reference = body?.order_id;
    if (!reference) {
      console.error('[CRYPTO][webhook] ❌ Malformed payload — missing order_id');
      const err = new Error('Malformed crypto webhook payload (missing order_id)');
      err.status = 400;
      throw err;
    }

    const { rows } = await db.query(
      'SELECT * FROM payment_transactions WHERE provider_reference = $1',
      [reference]
    );
    const tx = rows[0];
    if (!tx) {
      console.error(`[CRYPTO][webhook] ❌ Unknown payment reference: ${reference}`);
      const err = new Error('Unknown payment reference');
      err.status = 404;
      throw err;
    }
    if (tx.status === 'success') {
      console.log(`[CRYPTO][webhook] Reference ${reference} already marked success — ignoring duplicate webhook.`);
      return tx;
    }

    const status = body.payment_status;
    console.log(`[CRYPTO][webhook] reference=${reference} payment_status=${status}`);

    // Intermediate states: just log progress, wait for the next
    // webhook — more confirmations are still coming in.
    if (['waiting', 'confirming', 'sending', 'partially_paid'].includes(status)) {
      await db.query(
        `UPDATE payment_transactions SET raw_response = $1 WHERE id = $2`,
        [JSON.stringify(body), tx.id]
      );
      return { ...tx, status: 'pending' };
    }

    const isSuccess = status === 'finished';
    const isFailed = ['failed', 'expired', 'refunded'].includes(status);

    if (!isSuccess && !isFailed) {
      console.warn(`[CRYPTO][webhook] ⚠️ Unrecognized payment_status "${status}" — treating as pending.`);
      await db.query(
        `UPDATE payment_transactions SET raw_response = $1 WHERE id = $2`,
        [JSON.stringify(body), tx.id]
      );
      return { ...tx, status: 'pending' };
    }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const { rows: pkgRows } = await client.query(
        'SELECT * FROM coin_packages WHERE id = $1',
        [tx.coin_package_id]
      );
      const pkg = pkgRows[0];
      const coinsToCredit = pkg ? pkg.coins + pkg.bonus_coins : 0;

      await client.query(
        `UPDATE payment_transactions SET status = $1, coins_credited = $2, raw_response = $3 WHERE id = $4`,
        [isSuccess ? 'success' : 'failed', isSuccess ? coinsToCredit : 0, JSON.stringify(body), tx.id]
      );

      if (isSuccess) {
        await WalletService.creditCoins(client, {
          userId: tx.user_id,
          amount: coinsToCredit,
          type: 'purchase',
          referenceType: 'payment_transactions',
          referenceId: tx.id,
          description: `Purchased ${pkg?.name || 'coin package'} (crypto: ${body.pay_currency || 'unknown'})`,
        });
        console.log(`[CRYPTO][webhook] ✅ Credited ${coinsToCredit} coins to user ${tx.user_id} for reference ${reference}`);
      } else {
        console.log(`[CRYPTO][webhook] Payment ${reference} marked failed (status="${status}")`);
      }

      await client.query('COMMIT');
      return { ...tx, status: isSuccess ? 'success' : 'failed', coins_credited: coinsToCredit };
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[CRYPTO][webhook] ❌ Error while processing webhook for ${reference}:`, err);
      throw err;
    } finally {
      client.release();
    }
  },

  async getStatus(userId, reference) {
    const { rows } = await db.query(
      `SELECT * FROM payment_transactions WHERE provider_reference = $1 AND user_id = $2`,
      [reference, userId]
    );
    return rows[0];
  },
};

function sortObjectKeys(obj) {
  if (Array.isArray(obj)) return obj.map(sortObjectKeys);
  if (obj !== null && typeof obj === 'object') {
    return Object.keys(obj).sort().reduce((acc, key) => {
      acc[key] = sortObjectKeys(obj[key]);
      return acc;
    }, {});
  }
  return obj;
}

module.exports = CryptoService;