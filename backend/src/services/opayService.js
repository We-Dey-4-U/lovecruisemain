const axios = require('axios');
const crypto = require('crypto');
const db = require('../config/db');
const WalletService = require('./walletService');

const OPAY_BASE_URL = process.env.OPAY_BASE_URL;
const MERCHANT_ID = process.env.OPAY_MERCHANT_ID;
const PUBLIC_KEY = process.env.OPAY_PUBLIC_KEY;
const SECRET_KEY = process.env.OPAY_SECRET_KEY; // only used for webhook verification, NOT for Cashier Create

function generateReference() {
  return `VC-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

const OpayService = {

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

    const amountInKobo = Math.round(Number(pkg.price_amount) * 100);

    const { rows: txRows } = await db.query(
      `INSERT INTO payment_transactions 
        (user_id, coin_package_id, provider, provider_reference, amount, currency, status)
       VALUES ($1, $2, 'opay', $3, $4, $5, 'pending')
       RETURNING *`,
      [userId, coinPackageId, reference, pkg.price_amount, pkg.currency]
    );

    const orderPayload = {
      country: "NG",
      reference,
      amount: {
        total: amountInKobo,
        currency: pkg.currency
      },
      returnUrl: process.env.OPAY_RETURN_URL,
      callbackUrl: process.env.OPAY_CALLBACK_URL,
      cancelUrl: process.env.OPAY_RETURN_URL,
      userInfo: {
        userEmail
      },
      // Cashier Create's documented schema uses a single `product` object,
      // not a `productList` array (that's a different OPay endpoint).
      product: {
        name: pkg.name,
        description: `${pkg.coins + pkg.bonus_coins} coins`
      },
      payMethod: "BankCard"
    };

    const bodyString = JSON.stringify(orderPayload);

    try {
      console.log("📤 OPAY REQUEST:", bodyString);

      const response = await axios.post(
        `${OPAY_BASE_URL}/api/v1/international/cashier/create`,
        orderPayload,
        {
          headers: {
            MerchantId: MERCHANT_ID,
            // Cashier Create does NOT use HMAC signing. Per OPay's docs:
            // "Signature is calculated using the concatenation of the
            // PublicKey and Bearer prefix: Bearer {PublicKey}" — i.e. you
            // just send your raw public key here, full stop.
            Authorization: `Bearer ${PUBLIC_KEY}`,
            "Content-Type": "application/json"
          }
        }
      );

      console.log("📥 OPAY RESPONSE:", JSON.stringify(response.data, null, 2));

      const data = response.data?.data || response.data;

      const checkoutUrl =
        data?.cashierUrl ||
        data?.checkoutUrl ||
        data?.payUrl ||
        data?.url;

      const opayOrderNo = data?.orderNo || data?.orderId;

      if (!checkoutUrl) {
        await db.query(
          `UPDATE payment_transactions 
           SET status = 'failed', raw_response = $1 
           WHERE id = $2`,
          [JSON.stringify(response.data), txRows[0].id]
        );

        const noUrlErr = new Error(
          response.data?.message || "OPay did not return checkout URL"
        );
        noUrlErr.status = 502;
        throw noUrlErr;
      }

      return {
        transaction: txRows[0],
        checkoutUrl,
        opayOrderNo
      };

    } catch (err) {
      console.error("❌ OPAY INIT ERROR:", err.response?.data || err.message);

      await db.query(
        `UPDATE payment_transactions 
         SET status = 'failed', raw_response = $1 
         WHERE id = $2`,
        [
          JSON.stringify(err.response?.data || { message: err.message }),
          txRows[0].id
        ]
      );

      const wrapped = new Error(
        err.response?.data?.message || "Failed to initiate OPay payment"
      );
      wrapped.status = 502;
      throw wrapped;
    }
  },

  /**
   * ✅ REAL OPay callback verification.
   *
   * Per OPay's "Callback Notification Signature" doc, this is NOT a plain
   * HMAC-SHA512 of the raw body. It's:
   *   - algorithm: HMAC-SHA3-512 (not SHA512)
   *   - signed string: a FIXED template built from specific payload fields,
   *     in this exact order, with Refunded as the literal letter "t"/"f":
   *       {Amount:"...",Currency:"...",Reference:"...",Refunded:t,Status:"...",Timestamp:"...",Token:"...",TransactionID:"..."}
   *   - the signature itself arrives INSIDE the JSON body as `sha512`,
   *     not as a request header.
   *
   * `body` here should be the parsed webhook JSON (the object with
   * `payload`, `sha512`, `type` fields), not a raw string.
   */
  verifyWebhookSignature(body) {
    const p = body?.payload;
    const receivedSig = body?.sha512;

    if (!p || !receivedSig) return false;

    const signContent =
      `{Amount:"${p.amount}",Currency:"${p.currency}",Reference:"${p.reference}",` +
      `Refunded:${p.refunded ? "t" : "f"},Status:"${p.status}",Timestamp:"${p.timestamp}",` +
      `Token:"${p.token ?? ""}",TransactionID:"${p.transactionId}"}`;

    const expectedSig = crypto
      .createHmac("sha3-512", SECRET_KEY)
      .update(signContent, "utf8")
      .digest("hex");

    return expectedSig.toLowerCase() === String(receivedSig).toLowerCase();
  },

  /**
   * `body` is the full parsed webhook JSON: { payload: {...}, sha512, type }.
   * Caller (controller) should pass req.body as-is (already parsed) — verify
   * the signature BEFORE calling this, using verifyWebhookSignature(req.body).
   */
  async handleWebhook(body) {
    const p = body?.payload;
    if (!p) {
      const err = new Error("Malformed webhook payload");
      err.status = 400;
      throw err;
    }

    const { reference, status } = p;

    const { rows } = await db.query(
      'SELECT * FROM payment_transactions WHERE provider_reference = $1',
      [reference]
    );

    const tx = rows[0];

    if (!tx) {
      const err = new Error("Unknown payment reference");
      err.status = 404;
      throw err;
    }

    if (tx.status === "success") return tx;

    const isSuccess = ["SUCCESS", "success", "PAID"].includes(status);

    const client = await db.getClient();

    try {
      await client.query("BEGIN");

      const { rows: pkgRows } = await client.query(
        'SELECT * FROM coin_packages WHERE id = $1',
        [tx.coin_package_id]
      );

      const pkg = pkgRows[0];
      const coinsToCredit = pkg ? pkg.coins + pkg.bonus_coins : 0;

      await client.query(
        `UPDATE payment_transactions
         SET status = $1,
             coins_credited = $2,
             raw_response = $3
         WHERE id = $4`,
        [
          isSuccess ? "success" : "failed",
          isSuccess ? coinsToCredit : 0,
          JSON.stringify(body),
          tx.id
        ]
      );

      if (isSuccess) {
        await WalletService.creditCoins(client, {
          userId: tx.user_id,
          amount: coinsToCredit,
          type: "purchase",
          referenceType: "payment_transactions",
          referenceId: tx.id,
          description: `Purchased ${pkg?.name || "coin package"}`
        });
      }

      await client.query("COMMIT");

      return {
        ...tx,
        status: isSuccess ? "success" : "failed",
        coins_credited: coinsToCredit
      };

    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },

  async getStatus(userId, reference) {
    const { rows } = await db.query(
      `SELECT * FROM payment_transactions 
       WHERE provider_reference = $1 AND user_id = $2`,
      [reference, userId]
    );

    return rows[0];
  }
};

module.exports = OpayService;