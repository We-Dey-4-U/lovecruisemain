/* ============================================================
   backend/src/services/cashappService.js   [NEW FILE]
   ------------------------------------------------------------
   Cash App Pay is not a standalone API — it's a payment method
   surfaced through Square's Web Payments SDK + Orders/Payments
   API. Flow differs from every other provider here:

     1. Frontend renders Square's Web Payments SDK Cash App Pay
        button (client-side JS, not something this backend can
        generate a "checkoutUrl" for in the redirect sense).
        The SDK returns a payment `token` (a "cnon:..." nonce)
        once the user approves in the Cash App.
     2. Frontend POSTs that token to
        POST /payments/cashapp/initiate (this file's
        initiatePurchase, repurposed to take + charge a token in
        one step, NOT return a checkoutUrl like the others).
     3. We call Square's Payments API CreatePayment with that
        token server-side — this is synchronous, so unlike OPay/
        Flutterwave/Stripe/PayPal there's no separate "pending →
        webhook flips it to success" gap for the happy path.
     4. Square ALSO sends a webhook (payment.updated) which we
        verify as defense-in-depth, same role as the others.

   IMPORTANT — this breaks the "return checkoutUrl, redirect the
   user" contract every other initiatePurchase() in this file
   follows. The coin.html PAYMENT_METHODS/startCheckout JS will
   need a Cash App-specific branch (render the SDK button, get
   the token, THEN call initiate) rather than reading
   `res.data.checkoutUrl` and redirecting. Flag this to frontend
   before flipping `live: true` for cashapp.

   ENV VARS REQUIRED:
     SQUARE_ACCESS_TOKEN
     SQUARE_BASE_URL          (https://connect.squareupsandbox.com
                                or https://connect.squareup.com)
     SQUARE_LOCATION_ID
     SQUARE_WEBHOOK_SIGNATURE_KEY
   ============================================================ */

const axios = require('axios');
const crypto = require('crypto');
const db = require('../config/db');
const WalletService = require('./walletService');

const SQUARE_BASE_URL = process.env.SQUARE_BASE_URL;
const ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const LOCATION_ID = process.env.SQUARE_LOCATION_ID;
const WEBHOOK_SIGNATURE_KEY = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;

function generateReference() {
  return `VC-CASHAPP-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

const CashappService = {

  /**
   * Unlike the other providers, this does NOT return a checkoutUrl.
   * `sourceToken` is the Cash App Pay token the frontend got back
   * from Square's Web Payments SDK after the user approved in-app.
   * Charges happen synchronously here.
   */
  async initiatePurchase({ userId, coinPackageId, sourceToken }) {
    if (!sourceToken) {
      const err = new Error('sourceToken is required (from Square Web Payments SDK)');
      err.status = 400;
      throw err;
    }

    const { rows: pkgRows } = await db.query(
      'SELECT * FROM coin_packages WHERE id = $1 AND is_active = TRUE',
      [coinPackageId]
    );
    const pkg = pkgRows[0];
    if (!pkg) {
      const err = new Error('Coin package not found');
      err.status = 404;
      throw err;
    }

    const reference = generateReference();
    const amountInMinorUnits = Math.round(Number(pkg.price_amount) * 100);

    const { rows: txRows } = await db.query(
      `INSERT INTO payment_transactions 
        (user_id, coin_package_id, provider, provider_reference, amount, currency, status)
       VALUES ($1, $2, 'cashapp', $3, $4, $5, 'pending')
       RETURNING *`,
      [userId, coinPackageId, reference, pkg.price_amount, pkg.currency]
    );

    try {
      const paymentPayload = {
        idempotency_key: reference,
        source_id: sourceToken,
        amount_money: {
          amount: amountInMinorUnits,
          currency: pkg.currency,
        },
        location_id: LOCATION_ID,
        note: `${pkg.name} — ${pkg.coins + pkg.bonus_coins} coins`,
        reference_id: reference,
      };

      console.log('📤 SQUARE PAYMENT REQUEST:', JSON.stringify({ ...paymentPayload, source_id: '[redacted]' }));

      const response = await axios.post(`${SQUARE_BASE_URL}/v2/payments`, paymentPayload, {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
          'Square-Version': '2024-01-18',
        },
      });

      console.log('📥 SQUARE PAYMENT RESPONSE:', JSON.stringify(response.data, null, 2));

      const payment = response.data?.payment;
      const isSuccess = payment?.status === 'COMPLETED';

      const client = await db.getClient();
      try {
        await client.query('BEGIN');

        const coinsToCredit = pkg.coins + pkg.bonus_coins;

        await client.query(
          `UPDATE payment_transactions SET status = $1, coins_credited = $2, raw_response = $3 WHERE id = $4`,
          [isSuccess ? 'success' : 'failed', isSuccess ? coinsToCredit : 0, JSON.stringify(response.data), txRows[0].id]
        );

        if (isSuccess) {
          await WalletService.creditCoins(client, {
            userId,
            amount: coinsToCredit,
            type: 'purchase',
            referenceType: 'payment_transactions',
            referenceId: txRows[0].id,
            description: `Purchased ${pkg.name}`,
          });
        }

        await client.query('COMMIT');

        return {
          transaction: { ...txRows[0], status: isSuccess ? 'success' : 'failed', coins_credited: isSuccess ? coinsToCredit : 0 },
          // No checkoutUrl — this provider charges synchronously.
          // Frontend should check `transaction.status` directly instead
          // of redirecting.
          checkoutUrl: null,
        };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('❌ SQUARE/CASHAPP INIT ERROR:', err.response?.data || err.message);

      await db.query(
        `UPDATE payment_transactions SET status = 'failed', raw_response = $1 WHERE id = $2`,
        [JSON.stringify(err.response?.data || { message: err.message }), txRows[0].id]
      );

      const wrapped = new Error(
        err.response?.data?.errors?.[0]?.detail || 'Failed to process Cash App payment'
      );
      wrapped.status = 502;
      throw wrapped;
    }
  },

  /**
   * Square signs webhooks as HMAC-SHA256 over (notification URL + raw
   * body), base64-encoded — NOT just the raw body alone like most
   * providers. `signature` is req.headers['x-square-hmacsha256-signature'].
   * `rawBody` must be the raw string/Buffer body, `notificationUrl` is
   * the full webhook URL Square was configured to call (must match
   * exactly, protocol included).
   */
  verifyWebhookSignature(rawBody, signature, notificationUrl) {
    if (!WEBHOOK_SIGNATURE_KEY || !signature) return false;

    const combined = notificationUrl + rawBody;
    const expectedSig = crypto
      .createHmac('sha256', WEBHOOK_SIGNATURE_KEY)
      .update(combined)
      .digest('base64');

    return expectedSig === signature;
  },

  /**
   * Defense-in-depth only — the happy path already credited coins
   * synchronously in initiatePurchase(). This exists to catch the
   * case where Square reports a delayed COMPLETED/FAILED status
   * change after the initial synchronous response (e.g. async risk
   * review). `body` is the parsed webhook JSON.
   */
  async handleWebhook(body) {
    const payment = body?.data?.object?.payment;
    const reference = payment?.reference_id;
    if (!reference) {
      const err = new Error('Malformed Square webhook payload');
      err.status = 400;
      throw err;
    }

    const { rows } = await db.query(
      'SELECT * FROM payment_transactions WHERE provider_reference = $1',
      [reference]
    );
    const tx = rows[0];
    if (!tx) {
      const err = new Error('Unknown payment reference');
      err.status = 404;
      throw err;
    }
    if (tx.status === 'success') return tx;

    const isSuccess = payment.status === 'COMPLETED';

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
          description: `Purchased ${pkg?.name || 'coin package'}`,
        });
      }

      await client.query('COMMIT');
      return { ...tx, status: isSuccess ? 'success' : 'failed', coins_credited: coinsToCredit };
    } catch (err) {
      await client.query('ROLLBACK');
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

module.exports = CashappService;