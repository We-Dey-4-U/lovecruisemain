require("dotenv").config();

const db = require("../src/config/db");

async function migrate() {
  try {
    console.log("======================================");
    console.log("💳 PAYMENT PROVIDER MIGRATION");
    console.log("======================================");

    await db.query("BEGIN");

    console.log("➜ Adding provider_order_id column...");

    await db.query(`
      ALTER TABLE payment_transactions
      ADD COLUMN IF NOT EXISTS provider_order_id VARCHAR(150);
    `);

    console.log("✅ Column ready.");

    console.log("➜ Creating index...");

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_payment_provider_order_id
      ON payment_transactions(provider_order_id);
    `);

    console.log("✅ Index ready.");

    console.log("➜ Backfilling existing PayPal transactions...");

    const result = await db.query(`
      UPDATE payment_transactions
      SET provider_order_id = raw_response->>'orderId'
      WHERE provider = 'paypal'
      AND raw_response ? 'orderId';
    `);

    console.log(`✅ Updated ${result.rowCount} existing PayPal records.`);

    console.log("➜ Adding provider constraint...");

    await db.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'chk_payment_provider'
        ) THEN
          ALTER TABLE payment_transactions
          ADD CONSTRAINT chk_payment_provider
          CHECK (
            provider IN (
              'opay',
              'stripe',
              'flutterwave',
              'paypal',
              'cashapp',
              'ipay'
            )
          );
        END IF;
      END
      $$;
    `);

    console.log("✅ Constraint ready.");

    await db.query("COMMIT");

    console.log("======================================");
    console.log("🎉 PAYMENT PROVIDER MIGRATION COMPLETE");
    console.log("======================================");

    process.exit(0);

  } catch (err) {
    await db.query("ROLLBACK");

    console.error("======================================");
    console.error("❌ MIGRATION FAILED");
    console.error("======================================");
    console.error(err);

    process.exit(1);
  }
}

migrate();