require("dotenv").config();
const db = require("../src/config/db");

async function migrate() {
  try {
    console.log("Adding 100,000 coins to test users...");

    const result = await db.query(`
      UPDATE users
      SET coin_balance = coin_balance + 100000
      WHERE email IN (
        'muna@vconnect.com',
        'kamsi@vconnect.com'
      );
    `);

    console.log(`✅ ${result.rowCount} user(s) updated.`);
    console.log("DONE");

    process.exit(0);
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  }
}

migrate();