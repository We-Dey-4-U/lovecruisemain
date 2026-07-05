require("dotenv").config();
const db = require("../src/config/db");

async function migrate() {
  try {
    console.log("Adding new coin packages...");

    await db.query(`
      INSERT INTO coin_packages (name, coins, bonus_coins, price_amount, currency, sort_order)
      VALUES
      ('Mega Starter', 200, 20, 1000, 'NGN', 1),
      ('Super Value', 800, 120, 4000, 'NGN', 2),
      ('Ultra Pack', 3000, 600, 15000, 'NGN', 3),
      ('Whale Pack', 10000, 3000, 40000, 'NGN', 4),
      ('Legend Pack', 25000, 8000, 90000, 'NGN', 5)
      ON CONFLICT DO NOTHING;
    `);

    console.log("DONE");
    process.exit(0);
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  }
}

migrate();