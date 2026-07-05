require("dotenv").config();

const db = require("../src/config/db");

async function updatePaymentProviderConstraint() {
  try {
    console.log("======================================");
    console.log("💳 UPDATING PAYMENT PROVIDER CONSTRAINT");
    console.log("======================================");

    await db.query("BEGIN");

    console.log("➜ Dropping existing constraint...");

    await db.query(`
      ALTER TABLE payment_transactions
      DROP CONSTRAINT IF EXISTS chk_payment_provider;
    `);

    console.log("✅ Old constraint removed.");

    console.log("➜ Creating updated constraint...");

    await db.query(`
      ALTER TABLE payment_transactions
      ADD CONSTRAINT chk_payment_provider
      CHECK (
        provider IN (
          'opay',
          'stripe',
          'flutterwave',
          'paypal',
          'cashapp',
          'ipay',
          'crypto'
        )
      );
    `);

    console.log("✅ Updated constraint created.");

    await db.query("COMMIT");

    console.log("======================================");
    console.log("🎉 PAYMENT PROVIDER CONSTRAINT UPDATED");
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

updatePaymentProviderConstraint();