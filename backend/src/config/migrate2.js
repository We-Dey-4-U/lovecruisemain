/**
 * Marketplace Migration Runner
 *
 * Runs only:
 *   sql/002_marketplace.sql
 *
 * Usage:
 *   node src/config/migrate2.js
 *   or
 *   npm run migrate:marketplace
 */

const fs = require("fs");
const path = require("path");
const db = require("./db");

console.log("🚀 MARKETPLACE MIGRATION STARTED");

async function migrate() {
  try {
    const migrationFile = path.join(
      __dirname,
      "..",
      "..",
      "sql",
      "002_marketplace.sql"
    );

    if (!fs.existsSync(migrationFile)) {
      console.error("❌ Migration file not found:");
      console.error(migrationFile);
      process.exit(1);
    }

    console.log(`📄 Applying ${path.basename(migrationFile)}...`);

    const sql = fs.readFileSync(migrationFile, "utf8");

    await db.query(sql);

    console.log("✅ Marketplace migration completed successfully.");
    process.exit(0);

  } catch (err) {
    console.error("❌ Marketplace migration failed.");
    console.error(err);
    process.exit(1);
  }
}

migrate();