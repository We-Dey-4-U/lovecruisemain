/**
 * ==========================================
 * PostgreSQL Migration Runner
 * ==========================================
 *
 * Reads every .sql file inside /sql
 * and executes them in alphabetical order.
 *
 * Usage:
 *
 * node backend/migrate.js
 *
 * or
 *
 * npm run migrate
 *
 */

const fs = require("fs");
const path = require("path");
const db = require("./src/config/db");

async function migrate() {
  try {
    console.log("\n======================================");
    console.log("🚀 Starting Database Migration");
    console.log("======================================");

    const sqlDir = path.join(__dirname, "sql");

    if (!fs.existsSync(sqlDir)) {
      console.error(`❌ SQL directory not found:\n${sqlDir}`);
      process.exit(1);
    }

    const files = fs
      .readdirSync(sqlDir)
      .filter(file => file.endsWith(".sql"))
      .sort();

    if (files.length === 0) {
      console.log("⚠ No SQL migration files found.");
      process.exit(0);
    }

    console.log(`📂 SQL Folder: ${sqlDir}`);
    console.log(`📄 Found ${files.length} SQL file(s).\n`);

    for (const file of files) {
      const filePath = path.join(sqlDir, file);

      console.log("--------------------------------------");
      console.log(`📄 Applying ${file}`);

      const sql = fs.readFileSync(filePath, "utf8");

      try {
        await db.query(sql);
        console.log(`✅ ${file} completed`);
      } catch (err) {
        console.error(`❌ Failed: ${file}`);
        console.error(err.message);
        process.exit(1);
      }
    }

    console.log("\n======================================");
    console.log("🎉 All migrations completed successfully!");
    console.log("======================================");

    process.exit(0);

  } catch (err) {
    console.error("\n❌ Migration failed.");
    console.error(err);
    process.exit(1);
  }
}

migrate();