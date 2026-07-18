require("dotenv").config();
const fs = require("fs");
const path = require("path");
const db = require("../src/config/db");

async function migrate() {
  try {
    console.log("📻 Running Radio schema migration...");

    // Path to your SQL file
    const sqlPath = path.join(__dirname, "../sql/radio-schema.sql");

    // Read SQL file
    const sql = fs.readFileSync(sqlPath, "utf8");

    // Execute migration
    await db.query(sql);

    console.log("✅ Radio tables created successfully.");
    process.exit(0);
  } catch (err) {
    console.error("❌ Migration failed:");
    console.error(err);
    process.exit(1);
  }
}

migrate();