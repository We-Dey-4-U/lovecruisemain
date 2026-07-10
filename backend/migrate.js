/**
 * ==========================================
 * PostgreSQL Migration Runner
 * ==========================================
 *
 * Usage:
 *
 * Run all migrations:
 *   node migrate.js
 *
 * Run a specific migration:
 *   node migrate.js market-schema.sql
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

    // Optional migration file passed from command line
    const targetMigration = process.argv[2];

    let files;

    if (targetMigration) {
      const filePath = path.join(sqlDir, targetMigration);

      if (!fs.existsSync(filePath)) {
        console.error(`❌ Migration file not found: ${targetMigration}`);
        process.exit(1);
      }

      files = [targetMigration];

      console.log(`📄 Running single migration: ${targetMigration}\n`);
    } else {
      files = fs
        .readdirSync(sqlDir)
        .filter(file => file.endsWith(".sql"))
        .sort();

      if (files.length === 0) {
        console.log("⚠ No SQL migration files found.");
        process.exit(0);
      }

      console.log(`📂 SQL Folder: ${sqlDir}`);
      console.log(`📄 Found ${files.length} SQL file(s).\n`);
    }

    for (const file of files) {
      const filePath = path.join(sqlDir, file);

      console.log("--------------------------------------");
      console.log(`📄 Applying ${file}`);

      const sql = fs.readFileSync(filePath, "utf8");

      try {
        await db.query(sql);
        console.log(`✅ ${file} completed\n`);
      } catch (err) {
        console.error(`❌ Failed: ${file}`);
        console.error(err);
        process.exit(1);
      }
    }

    console.log("======================================");
    console.log("🎉 Migration completed successfully!");
    console.log("======================================");

    process.exit(0);

  } catch (err) {
    console.error("\n❌ Migration failed.");
    console.error(err);
    process.exit(1);
  }
}

migrate();