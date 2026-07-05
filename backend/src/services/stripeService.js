/* ============================================================
   backend/src/services/stripeService.js   [NEW FILE]
   ------------------------------------------------------------
   Stripe Checkout Session flow — closest Stripe equivalent to
   OPay's hosted-checkout-URL pattern, so it slots into the same
   initiatePurchase/webhook/getStatus shape.

   Flow:
     1. stripe.checkout.sessions.create({...}) -> session.url
     2. user pays on Stripe's hosted page
     3. Stripe POSTs webhook 'checkout.session.completed' to
        /payments/stripe/webhook
     4. Signature verified via stripe.webhooks.constructEvent
        using the RAW request body (see routes file note).

   ENV VARS REQUIRED:
     STRIPE_SECRET_KEY
     STRIPE_WEBHOOK_SECRET   (whsec_... from the Stripe dashboard)
     STRIPE_SUCCESS_URL
     STRIPE_CANCEL_URL
   ============================================================ */

const Stripe = require('stripe');
const crypto = require('crypto');
const db = require('../config/db');
const WalletService = require('./walletService');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

function generateReference() {
  return `VC-STRIPE-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

const StripeService = {

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
    const amountInMinorUnits = Math.round(Number(pkg.price_amount) * 100);

    const { rows: txRows } = await db.query(
      `INSERT INTO payment_transactions 
        (user_id, coin_package_id, provider, provider_reference, amount, currency, status)
       VALUES ($1, $2, 'stripe', $3, $4, $5, 'pending')
       RETURNING *`,
      [userId, coinPackageId, reference, pkg.price_amount, pkg.currency]
    );

    try {
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        customer_email: userEmail,
        client_reference_id: reference,
        line_items: [
          {
            price_data: {
              currency: String(pkg.currency).toLowerCase(),
              product_data: {
                name: pkg.name,
                description: `${pkg.coins + pkg.bonus_coins} coins`,
              },
              unit_amount: amountInMinorUnits,
            },
            quantity: 1,
          },
        ],
        metadata: { reference, userId, coinPackageId },
        success_url: `${process.env.STRIPE_SUCCESS_URL}?ref=${reference}`,
        cancel_url: `${process.env.STRIPE_CANCEL_URL}?ref=${reference}`,
      });

      console.log('📥 STRIPE SESSION CREATED:', session.id);

      if (!session.url) {
        await db.query(
          `UPDATE payment_transactions SET status = 'failed', raw_response = $1 WHERE id = $2`,
          [JSON.stringify(session), txRows[0].id]
        );
        const noUrlErr = new Error('Stripe did not return a checkout URL');
        noUrlErr.status = 502;
        throw noUrlErr;
      }

      await db.query(
        `UPDATE payment_transactions SET raw_response = $1 WHERE id = $2`,
        [JSON.stringify({ sessionId: session.id }), txRows[0].id]
      );

      return { transaction: txRows[0], checkoutUrl: session.url };
    } catch (err) {
      console.error('❌ STRIPE INIT ERROR:', err.message);

      await db.query(
        `UPDATE payment_transactions SET status = 'failed', raw_response = $1 WHERE id = $2`,
        [JSON.stringify({ message: err.message }), txRows[0].id]
      );

      const wrapped = new Error(err.message || 'Failed to initiate Stripe payment');
      wrapped.status = 502;
      throw wrapped;
    }
  },

  /**
   * Stripe webhooks MUST be verified against the raw (unparsed) body —
   * see payments.routes.js for the express.raw() middleware needed on
   * this specific route only. `rawBody` is a Buffer, `signature` is
   * req.headers['stripe-signature'].
   * Returns the constructed event object, or null if invalid.
   */
  verifyAndConstructEvent(rawBody, signature) {
    try {
      return stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error('❌ STRIPE WEBHOOK SIGNATURE INVALID:', err.message);
      return null;
    }
  },

  /**
   * `event` is the verified Stripe event object from
   * verifyAndConstructEvent(). Only acts on checkout.session.completed.
   */
  async handleWebhookEvent(event) {
    if (event.type !== 'checkout.session.completed') {
      return { skipped: true, type: event.type };
    }

    const session = event.data.object;
    const reference = session.client_reference_id || session.metadata?.reference;
    if (!reference) {
      const err = new Error('Stripe event missing client_reference_id');
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

    const isSuccess = session.payment_status === 'paid';

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
        [isSuccess ? 'success' : 'failed', isSuccess ? coinsToCredit : 0, JSON.stringify(session), tx.id]
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

module.exports = StripeService;