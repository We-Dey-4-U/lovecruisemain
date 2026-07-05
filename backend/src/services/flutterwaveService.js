/* ============================================================
   backend/src/services/flutterwaveService.js
   ------------------------------------------------------------
   Same shape as opayService.js: initiatePurchase, webhook
   verify + handle, getStatus. Reuses payment_transactions +
   coin_packages + WalletService exactly like OPay does.

   Flutterwave v3 Standard flow:
     1. POST /v3/payments  -> returns { link } hosted checkout
     2. user pays on Flutterwave's page
     3. Flutterwave POSTs a webhook to FLW_WEBHOOK_URL with
        header 'verif-hash' === FLUTTERWAVE_WEBHOOK_HASH
     4. We additionally re-verify via GET /v3/transactions/:id/verify
        before crediting coins (Flutterwave's own best-practice
        recommendation — webhook hash alone is not sufficient).

   ENV VARS REQUIRED:
     FLUTTERWAVE_SECRET_KEY      (Bearer token for API calls)
     FLUTTERWAVE_WEBHOOK_HASH    (arbitrary secret you set in the
                                  Flutterwave dashboard under
                                  Settings > Webhooks > Secret Hash)
     FLUTTERWAVE_RETURN_URL      (redirect_url after payment)

   ============================================================
   DIAGNOSTIC LOGGING (added)
   ------------------------------------------------------------
   Tag [FLW] on everything so it's easy to grep in Render logs.
   Boot-time env checks + a correlation id per initiate call +
   full webhook lifecycle logging (received -> verify call ->
   credit decision -> DB result).
   ============================================================ */

const axios = require('axios');
const crypto = require('crypto');
const db = require('../config/db');
const WalletService = require('./walletService');

const FLW_BASE_URL = 'https://api.flutterwave.com/v3';
const SECRET_KEY = process.env.FLUTTERWAVE_SECRET_KEY;
const WEBHOOK_HASH = process.env.FLUTTERWAVE_WEBHOOK_HASH;
const RETURN_URL = process.env.FLUTTERWAVE_RETURN_URL;

// ── Boot-time diagnostics ──────────────────────────────────
(function logFlwEnvStatus() {
  function describe(name, value, { isSecret = false } = {}) {
    if (!value) {
      console.error(`[FLW][BOOT] ❌ ${name} is NOT SET`);
      return;
    }
    if (isSecret) {
      console.log(`[FLW][BOOT] ✅ ${name} is set (length=${value.length}, starts with "${value.slice(0, 8)}...")`);
    } else {
      console.log(`[FLW][BOOT] ✅ ${name} = "${value}"`);
    }
  }

  console.log('[FLW][BOOT] ================= Flutterwave config check =================');
  describe('FLUTTERWAVE_SECRET_KEY', SECRET_KEY, { isSecret: true });
  describe('FLUTTERWAVE_WEBHOOK_HASH', WEBHOOK_HASH, { isSecret: true });
  describe('FLUTTERWAVE_RETURN_URL', RETURN_URL);

  if (SECRET_KEY && SECRET_KEY.includes('TEST')) {
    console.log('[FLW][BOOT] ℹ️  Using a TEST secret key — this is a sandbox/test-mode key, safe for testing the auto-credit flow without moving real money.');
  } else if (SECRET_KEY) {
    console.warn('[FLW][BOOT] ⚠️  Secret key does not contain "TEST" — this looks like a LIVE key. Real charges will occur.');
  }
  console.log('[FLW][BOOT] ================================================================');
})();

function generateReference() {
  return `VC-FLW-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

const FlutterwaveService = {

  async initiatePurchase({ userId, coinPackageId, userEmail }) {
    const reqId = crypto.randomBytes(3).toString('hex');
    console.log(`[FLW][${reqId}] ── initiatePurchase start ── userId=${userId} coinPackageId=${coinPackageId} userEmail=${userEmail}`);

    const { rows: pkgRows } = await db.query(
      'SELECT * FROM coin_packages WHERE id = $1 AND is_active = TRUE',
      [coinPackageId]
    );
    const pkg = pkgRows[0];
    if (!pkg) {
      console.error(`[FLW][${reqId}] ❌ Coin package not found or inactive: ${coinPackageId}`);
      const err = new Error('Coin package not found');
      err.status = 404;
      throw err;
    }

    const reference = generateReference();
    console.log(`[FLW][${reqId}] Generated reference: ${reference}, package: "${pkg.name}" price=${pkg.price_amount} ${pkg.currency}`);

    const { rows: txRows } = await db.query(
      `INSERT INTO payment_transactions 
        (user_id, coin_package_id, provider, provider_reference, amount, currency, status)
       VALUES ($1, $2, 'flutterwave', $3, $4, $5, 'pending')
       RETURNING *`,
      [userId, coinPackageId, reference, pkg.price_amount, pkg.currency]
    );
    console.log(`[FLW][${reqId}] Inserted pending payment_transactions row id=${txRows[0].id}`);

    const orderPayload = {
      tx_ref: reference,
      amount: Number(pkg.price_amount),
      currency: pkg.currency,
      redirect_url: RETURN_URL,
      customer: { email: userEmail },
      customizations: {
        title: pkg.name,
        description: `${pkg.coins + pkg.bonus_coins} coins`,
      },
    };

    try {
      console.log(`[FLW][${reqId}] 📤 POST ${FLW_BASE_URL}/payments`);
      console.log(`[FLW][${reqId}] 📤 Payload:`, JSON.stringify(orderPayload));

      const response = await axios.post(`${FLW_BASE_URL}/payments`, orderPayload, {
        headers: {
          Authorization: `Bearer ${SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 20000,
        validateStatus: () => true,
      });

      console.log(`[FLW][${reqId}] 📥 Response status: ${response.status}`);
      console.log(`[FLW][${reqId}] 📥 Response body:`, JSON.stringify(response.data, null, 2));

      const checkoutUrl = response.data?.data?.link;

      if (!checkoutUrl) {
        console.error(`[FLW][${reqId}] ❌ No checkout link in response`);
        await db.query(
          `UPDATE payment_transactions SET status = 'failed', raw_response = $1 WHERE id = $2`,
          [JSON.stringify(response.data), txRows[0].id]
        );
        const noUrlErr = new Error(response.data?.message || 'Flutterwave did not return a checkout link');
        noUrlErr.status = 502;
        throw noUrlErr;
      }

      console.log(`[FLW][${reqId}] ✅ Got checkout link: ${checkoutUrl}`);

      return { transaction: txRows[0], checkoutUrl };
    } catch (err) {
      console.error(`[FLW][${reqId}] ❌ INIT ERROR:`, err.response?.data || err.message);

      await db.query(
        `UPDATE payment_transactions SET status = 'failed', raw_response = $1 WHERE id = $2`,
        [JSON.stringify(err.response?.data || { message: err.message }), txRows[0].id]
      );

      const wrapped = new Error(err.response?.data?.message || 'Failed to initiate Flutterwave payment');
      wrapped.status = 502;
      throw wrapped;
    }
  },

  /**
   * Flutterwave sends the hash in a header, not inside the body
   * (unlike OPay). Pass req.headers['verif-hash'] as `signature`.
   */
  verifyWebhookSignature(signature) {
    if (!WEBHOOK_HASH || !signature) {
      console.error(`[FLW][webhook] ❌ verifyWebhookSignature failed early: hasSecretConfigured=${!!WEBHOOK_HASH} hasHeaderFromFlutterwave=${!!signature}`);
      return false;
    }
    const isValid = signature === WEBHOOK_HASH;
    if (!isValid) {
      console.error(`[FLW][webhook] ❌ verif-hash mismatch. Received header does not match FLUTTERWAVE_WEBHOOK_HASH configured in this environment. Double check the "Secret Hash" set in the Flutterwave dashboard matches FLUTTERWAVE_WEBHOOK_HASH exactly.`);
    }
    return isValid;
  },

  /**
   * `body` is the raw parsed webhook JSON: { event, data: {...} }.
   * Re-verifies the transaction server-side via Flutterwave's
   * /verify endpoint before crediting — webhook hash match alone
   * is necessary but not sufficient per Flutterwave's own docs.
   */
  async handleWebhook(body) {
    console.log('[FLW][webhook] ── handleWebhook start ──');
    console.log('[FLW][webhook] Raw body:', JSON.stringify(body));

    const data = body?.data;
    if (!data?.tx_ref || !data?.id) {
      console.error('[FLW][webhook] ❌ Malformed payload — missing data.tx_ref or data.id');
      const err = new Error('Malformed Flutterwave webhook payload');
      err.status = 400;
      throw err;
    }

    console.log(`[FLW][webhook] event=${body.event} tx_ref=${data.tx_ref} flw_id=${data.id} status(from webhook)=${data.status} amount=${data.amount} currency=${data.currency}`);

    const { rows } = await db.query(
      'SELECT * FROM payment_transactions WHERE provider_reference = $1',
      [data.tx_ref]
    );
    const tx = rows[0];
    if (!tx) {
      console.error(`[FLW][webhook] ❌ Unknown payment reference: ${data.tx_ref} — no matching payment_transactions row`);
      const err = new Error('Unknown payment reference');
      err.status = 404;
      throw err;
    }
    console.log(`[FLW][webhook] Found payment_transactions row id=${tx.id} current status=${tx.status} expected amount=${tx.amount} ${tx.currency}`);

    if (tx.status === 'success') {
      console.log(`[FLW][webhook] Reference ${data.tx_ref} already marked success — ignoring duplicate webhook.`);
      return tx;
    }

    // Re-verify with Flutterwave directly (defense in depth)
    let verified = null;
    try {
      const verifyUrl = `${FLW_BASE_URL}/transactions/${data.id}/verify`;
      console.log(`[FLW][webhook] 📤 Re-verifying via GET ${verifyUrl}`);
      const verifyRes = await axios.get(verifyUrl, {
        headers: { Authorization: `Bearer ${SECRET_KEY}` },
        validateStatus: () => true,
      });
      console.log(`[FLW][webhook] 📥 Verify response status: ${verifyRes.status}`);
      console.log(`[FLW][webhook] 📥 Verify response body:`, JSON.stringify(verifyRes.data, null, 2));
      verified = verifyRes.data?.data;
    } catch (e) {
      console.error('[FLW][webhook] ❌ VERIFY REQUEST THREW:', e.response?.data || e.message);
    }

    if (!verified) {
      console.error('[FLW][webhook] ❌ No verified transaction data returned — will NOT credit coins. This can happen if the /verify call failed or Flutterwave has not yet indexed the transaction (rare race condition); the webhook can safely be retried by Flutterwave if this handler throws or returns quickly.');
    }

    const isSuccess =
      !!verified &&
      verified.status === 'successful' &&
      Number(verified.amount) >= Number(tx.amount) &&
      verified.currency === tx.currency;

    console.log(`[FLW][webhook] Credit decision: isSuccess=${isSuccess} (verified.status=${verified?.status}, verified.amount=${verified?.amount} vs tx.amount=${tx.amount}, verified.currency=${verified?.currency} vs tx.currency=${tx.currency})`);

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
        [isSuccess ? 'success' : 'failed', isSuccess ? coinsToCredit : 0, JSON.stringify({ webhook: body, verify: verified }), tx.id]
      );

      if (isSuccess) {
        await WalletService.creditCoins(client, {
          userId: tx.user_id,
          amount: coinsToCredit,
          type: 'purchase',
          referenceType: 'payment_transactions',
          referenceId: tx.id,
          description: `Purchased ${pkg?.name || 'coin package'}`,
        });
        console.log(`[FLW][webhook] ✅ Credited ${coinsToCredit} coins to user ${tx.user_id} for reference ${data.tx_ref}`);
      } else {
        console.log(`[FLW][webhook] Payment ${data.tx_ref} marked FAILED — no coins credited.`);
      }

      await client.query('COMMIT');
      console.log(`[FLW][webhook] ── handleWebhook done ── final status=${isSuccess ? 'success' : 'failed'}`);
      return { ...tx, status: isSuccess ? 'success' : 'failed', coins_credited: coinsToCredit };
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[FLW][webhook] ❌ Error while crediting/updating DB for ${data.tx_ref}:`, err);
      throw err;
    } finally {
      client.release();
    }
  },

  async getStatus(userId, reference) {
    console.log(`[FLW][getStatus] userId=${userId} reference=${reference}`);
    const { rows } = await db.query(
      `SELECT * FROM payment_transactions WHERE provider_reference = $1 AND user_id = $2`,
      [reference, userId]
    );
    if (!rows[0]) {
      console.warn(`[FLW][getStatus] ❌ No row found for reference=${reference} userId=${userId}`);
    } else {
      console.log(`[FLW][getStatus] Found status=${rows[0].status} coins_credited=${rows[0].coins_credited}`);
    }
    return rows[0];
  },
};

module.exports = FlutterwaveService;