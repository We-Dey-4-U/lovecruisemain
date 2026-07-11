require("dotenv").config();
const db = require("../src/config/db");

async function migrate() {
  try {
    console.log("Fixing platform_wallet_ledger.reference_id column...");

    await db.query(`
      ALTER TABLE platform_wallet_ledger
      ALTER COLUMN reference_id TYPE UUID
      USING reference_id::text::uuid;
    `);

    console.log("✅ platform_wallet_ledger updated successfully.");
    process.exit(0);
  } catch (err) {
    console.error("❌ Migration failed:", err);
    process.exit(1);
  }
}

migrate();