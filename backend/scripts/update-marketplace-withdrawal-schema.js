require("dotenv").config();
const db = require("../src/config/db");

async function migrate() {
  try {
    console.log("Updating marketplace and withdrawal schema...");

    await db.query(`
      -- Add seller contact to marketplace listings
      ALTER TABLE marketplace_listings
      ADD COLUMN IF NOT EXISTS seller_contact VARCHAR(50);

      -- Add shipping address to marketplace orders
      ALTER TABLE marketplace_orders
      ADD COLUMN IF NOT EXISTS shipping_address TEXT;

      -- Make cash_amount optional
      ALTER TABLE withdrawal_requests
      ALTER COLUMN cash_amount DROP NOT NULL;
    `);

    console.log("✅ Schema updated successfully.");
    process.exit(0);
  } catch (err) {
    console.error("❌ Migration failed:", err);
    process.exit(1);
  }
}

migrate();