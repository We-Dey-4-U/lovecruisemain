/* ============================================================
   backend/src/services/ipayService.js   [NEW FILE]
   ------------------------------------------------------------
   iPay Africa hosted-checkout flow — same shape as Flutterwave/
   OPay: build a signed request, redirect to a hosted page,
   verify via a callback hash.

   Flow:
     1. POST to iPay's "Pay Now" hosted-checkout endpoint with a
        SHA1 hash of (vendor_id + amount + email + ... + secret),
        per iPay's documented field order — returns a redirect
        URL for the checkout page itself (no JSON order object
        like Flutterwave's /v3/payments; iPay's classic
        integration is a signed FORM POST, so "initiate" here
        builds the signed payload and the checkoutUrl is iPay's
        static checkout endpoint with that payload appended).
     2. user pays on iPay's hosted page
     3. iPay redirects + POSTs a callback to IPAY_CALLBACK_URL
        with the same field set plus a `status` and a `hash`
        we must re-verify against our secret.
     4. We treat the callback as the primary trigger (iPay does
        not have a strong separate webhook system distinct from
        this callback in the classic integration).

   ENV VARS REQUIRED:
     IPAY_VENDOR_ID
     IPAY_SECRET             (hashkey from iPay dashboard)
     IPAY_CHECKOUT_URL        (https://www.ipayafrica.com/v3/ke or
                               applicable country endpoint)
     IPAY_CALLBACK_URL
   ============================================================ */

const crypto = require('crypto');
const db = require('../config/db');
const WalletService = require('./walletService');

const VENDOR_ID = process.env.IPAY_VENDOR_ID;
const SECRET = process.env.IPAY_SECRET;
const CHECKOUT_URL = process.env.IPAY_CHECKOUT_URL;

function generateReference() {
  return `VC-IPAY-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * iPay's classic hash is SHA1 of a fixed concatenation of fields
 * (live_or_test + vendor_id + amount + currency + email + reference +
 * secret), per their documented field order. Double-check the exact
 * field order/casing against the current iPay integration docs for
 * your account type before going live — vendors have historically
 * had slightly different field sets depending on signup date.
 */
function buildHash({ amount, currency, email, reference }) {
  const liveOrTest = process.env.NODE_ENV === 'production' ? '1' : '0';
  const signContent = `${liveOrTest}${VENDOR_ID}${amount}${currency}${email}${reference}${SECRET}`;
  return crypto.createHash('sha1').update(signContent, 'utf8').digest('hex');
}

const IpayService = {

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
    const amount = Number(pkg.price_amount).toFixed(2);

    const { rows: txRows } = await db.query(
      `INSERT INTO payment_transactions 
        (user_id, coin_package_id, provider, provider_reference, amount, currency, status)
       VALUES ($1, $2, 'ipay', $3, $4, $5, 'pending')
       RETURNING *`,
      [userId, coinPackageId, reference, pkg.price_amount, pkg.currency]
    );

    try {
      const hash = buildHash({ amount, currency: pkg.currency, email: userEmail, reference });

      const params = new URLSearchParams({
        live: process.env.NODE_ENV === 'production' ? '1' : '0',
        oid: VENDOR_ID,
        inv: reference,
        amount,
        tel: '',
        eml: userEmail || '',
        vid: VENDOR_ID,
        curr: pkg.currency,
        p1: pkg.name,
        p2: `${pkg.coins + pkg.bonus_coins} coins`,
        p3: '',
        p4: '',
        cbk: process.env.IPAY_CALLBACK_URL,
        cst: '1',
        crl: '0',
        hash,
      });

      const checkoutUrl = `${CHECKOUT_URL}?${params.toString()}`;

      console.log('📤 IPAY CHECKOUT URL BUILT for reference:', reference);

      await db.query(
        `UPDATE payment_transactions SET raw_response = $1 WHERE id = $2`,
        [JSON.stringify({ checkoutUrl }), txRows[0].id]
      );

      return { transaction: txRows[0], checkoutUrl };
    } catch (err) {
      console.error('❌ IPAY INIT ERROR:', err.message);

      await db.query(
        `UPDATE payment_transactions SET status = 'failed', raw_response = $1 WHERE id = $2`,
        [JSON.stringify({ message: err.message }), txRows[0].id]
      );

      const wrapped = new Error(err.message || 'Failed to initiate iPay payment');
      wrapped.status = 502;
      throw wrapped;
    }
  },

  /**
   * `body` is iPay's parsed callback payload (form-encoded, parsed by
   * express.urlencoded — already covered by app.js's global parser).
   * Re-derive the hash from the fields iPay sends back and compare.
   */
  verifyCallbackSignature(body) {
    if (!body?.hash || !body?.inv) return false;

    const expectedHash = buildHash({
      amount: body.amount,
      currency: body.curr,
      email: body.eml,
      reference: body.inv,
    });

    return expectedHash.toLowerCase() === String(body.hash).toLowerCase();
  },

  /**
   * `body` is the full parsed callback payload. Caller should verify
   * via verifyCallbackSignature(req.body) BEFORE calling this.
   */
  async handleCallback(body) {
    const reference = body?.inv;
    if (!reference) {
      const err = new Error('Malformed iPay callback payload');
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

    // iPay's status codes: 'aei7p7yrx4ae34' = success in classic
    // integration's documented response codes — confirm the exact
    // success code for your account/version against current docs
    // before relying on this in production.
    const isSuccess = body.status === 'aei7p7yrx4ae34' || body.status === '0';

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

module.exports = IpayService;