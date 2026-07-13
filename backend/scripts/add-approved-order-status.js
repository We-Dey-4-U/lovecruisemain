require("dotenv").config();
const db = require("../src/config/db");

async function migrate() {
  try {
    console.log("Updating marketplace_orders status constraint...");

    await db.query("BEGIN");

    // Remove the old constraint
    await db.query(`
      ALTER TABLE marketplace_orders
      DROP CONSTRAINT IF EXISTS marketplace_orders_status_check;
    `);

    // Add the new constraint with 'approved'
    await db.query(`
      ALTER TABLE marketplace_orders
      ADD CONSTRAINT marketplace_orders_status_check
      CHECK (
        status IN (
          'pending',
          'approved',
          'shipped',
          'delivered',
          'cancelled'
        )
      );
    `);

    await db.query("COMMIT");

    console.log("✅ marketplace_orders status constraint updated successfully.");
    process.exit(0);
  } catch (err) {
    await db.query("ROLLBACK").catch(() => {});
    console.error("❌ Migration failed:", err);
    process.exit(1);
  }
}

migrate();