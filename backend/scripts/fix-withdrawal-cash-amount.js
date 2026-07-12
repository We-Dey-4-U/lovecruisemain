require("dotenv").config();
const db = require("../src/config/db");

async function migrate() {
  try {
    console.log("Updating withdrawal_requests table...");

    await db.query(`
      ALTER TABLE withdrawal_requests
      ALTER COLUMN cash_amount DROP NOT NULL;
    `);

    console.log("✅ withdrawal_requests.cash_amount is now nullable.");
    process.exit(0);
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  }
}

migrate();