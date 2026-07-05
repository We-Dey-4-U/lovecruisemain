/* ============================================================
   backend/src/services/paypalService.js   [NEW FILE]
   ------------------------------------------------------------
   PayPal Orders API v2. PayPal does NOT use a single hosted-
   checkout-link + webhook-only model like OPay/Flutterwave —
   it's a two-step "create order, then capture order" flow:

     1. POST /v2/checkout/orders  -> returns an "approve" link
     2. user approves on PayPal's page, PayPal redirects back to
        PAYPAL_RETURN_URL?token={orderId}
     3. your frontend/return-page calls
        POST /payments/paypal/capture/:orderId  (NEW endpoint,
        not part of the original OPay-only route set — see
        payments.routes.js) which calls capturePurchase() below
     4. We ALSO verify via PayPal's webhook
        (PAYMENT.CAPTURE.COMPLETED) as a defense-in-depth check,
        same role OPay's webhook plays, but capture is the
        primary trigger since PayPal's redirect flow doesn't
        guarantee a webhook arrives before the user is back on
        your site.

   ENV VARS REQUIRED:
     PAYPAL_CLIENT_ID
     PAYPAL_CLIENT_SECRET
     PAYPAL_BASE_URL          (https://api-m.sandbox.paypal.com
                                or https://api-m.paypal.com)
     PAYPAL_RETURN_URL
     PAYPAL_CANCEL_URL
     PAYPAL_WEBHOOK_ID        (from PayPal dashboard, used to
                                verify webhook signatures)
   ============================================================ */

const axios = require('axios');
const crypto = require('crypto');
const db = require('../config/db');
const WalletService = require('./walletService');

const PAYPAL_BASE_URL = process.env.PAYPAL_BASE_URL;
const CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;

function generateReference() {
  return `VC-PP-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

async function getAccessToken() {
  const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const res = await axios.post(
    `${PAYPAL_BASE_URL}/v1/oauth2/token`,
    'grant_type=client_credentials',
    { headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  return res.data.access_token;
}

const PaypalService = {

  async initiatePurchase({ userId, coinPackageId, userEmail }) {
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

    const { rows: txRows } = await db.query(
      `INSERT INTO payment_transactions 
        (user_id, coin_package_id, provider, provider_reference, amount, currency, status)
       VALUES ($1, $2, 'paypal', $3, $4, $5, 'pending')
       RETURNING *`,
      [userId, coinPackageId, reference, pkg.price_amount, pkg.currency]
    );

    try {
      const accessToken = await getAccessToken();

      const orderPayload = {
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: reference,
            description: `${pkg.name} — ${pkg.coins + pkg.bonus_coins} coins`,
            amount: {
              currency_code: pkg.currency,
              value: Number(pkg.price_amount).toFixed(2),
            },
          },
        ],
        payer: userEmail ? { email_address: userEmail } : undefined,
        application_context: {
          return_url: `${process.env.PAYPAL_RETURN_URL}?ref=${reference}`,
          cancel_url: `${process.env.PAYPAL_CANCEL_URL}?ref=${reference}`,
          user_action: 'PAY_NOW',
        },
      };

      console.log('📤 PAYPAL ORDER REQUEST:', JSON.stringify(orderPayload));

      const response = await axios.post(`${PAYPAL_BASE_URL}/v2/checkout/orders`, orderPayload, {
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      });

      console.log('📥 PAYPAL ORDER RESPONSE:', JSON.stringify(response.data, null, 2));

      const approveLink = response.data?.links?.find((l) => l.rel === 'approve')?.href;
      const orderId = response.data?.id;

      if (!approveLink) {
        await db.query(
          `UPDATE payment_transactions SET status = 'failed', raw_response = $1 WHERE id = $2`,
          [JSON.stringify(response.data), txRows[0].id]
        );
        const noUrlErr = new Error('PayPal did not return an approval link');
        noUrlErr.status = 502;
        throw noUrlErr;
      }

      await db.query(
        `UPDATE payment_transactions SET raw_response = $1 WHERE id = $2`,
        [JSON.stringify({ orderId }), txRows[0].id]
      );

      return { transaction: txRows[0], checkoutUrl: approveLink, paypalOrderId: orderId };
    } catch (err) {
      console.error('❌ PAYPAL INIT ERROR:', err.response?.data || err.message);

      await db.query(
        `UPDATE payment_transactions SET status = 'failed', raw_response = $1 WHERE id = $2`,
        [JSON.stringify(err.response?.data || { message: err.message }), txRows[0].id]
      );

      const wrapped = new Error(err.response?.data?.message || 'Failed to initiate PayPal payment');
      wrapped.status = 502;
      throw wrapped;
    }
  },

  /**
   * NEW endpoint vs. the OPay-only route set: PayPal's redirect flow
   * needs an explicit capture step after the user approves. Called as
   * POST /payments/paypal/capture/:orderId from the PAYPAL_RETURN_URL
   * page (or directly by the frontend once it has the token/orderId
   * query param PayPal appended to the return URL).
   */
  async capturePurchase({ userId, orderId }) {
    const { rows } = await db.query(
      `SELECT * FROM payment_transactions 
       WHERE provider = 'paypal' AND raw_response->>'orderId' = $1 AND user_id = $2`,
      [orderId, userId]
    );
    const tx = rows[0];
    if (!tx) {
      const err = new Error('Transaction not found for this PayPal order');
      err.status = 404;
      throw err;
    }
    if (tx.status === 'success') return tx;

    const accessToken = await getAccessToken();

    const captureRes = await axios.post(
      `${PAYPAL_BASE_URL}/v2/checkout/orders/${orderId}/capture`,
      {},
      { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
    );

    const isSuccess = captureRes.data?.status === 'COMPLETED';

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
        [isSuccess ? 'success' : 'failed', isSuccess ? coinsToCredit : 0, JSON.stringify(captureRes.data), tx.id]
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

  /**
   * Webhook is defense-in-depth here, not the primary trigger (capture
   * is). `body` is PayPal's raw event JSON; `headers` is req.headers.
   * Uses PayPal's /v1/notifications/verify-webhook-signature endpoint
   * rather than local HMAC, since PayPal signs with their own keys.
   */
  async verifyWebhookSignature(body, headers) {
    try {
      const accessToken = await getAccessToken();
      const verifyRes = await axios.post(
        `${PAYPAL_BASE_URL}/v1/notifications/verify-webhook-signature`,
        {
          auth_algo: headers['paypal-auth-algo'],
          cert_url: headers['paypal-cert-url'],
          transmission_id: headers['paypal-transmission-id'],
          transmission_sig: headers['paypal-transmission-sig'],
          transmission_time: headers['paypal-transmission-time'],
          webhook_id: process.env.PAYPAL_WEBHOOK_ID,
          webhook_event: body,
        },
        { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
      );
      return verifyRes.data?.verification_status === 'SUCCESS';
    } catch (err) {
      console.error('❌ PAYPAL WEBHOOK VERIFY ERROR:', err.response?.data || err.message);
      return false;
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

module.exports = PaypalService;