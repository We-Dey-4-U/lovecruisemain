require("dotenv").config();

const db = require("../src/config/db");

async function migrate() {
  try {

    console.log("📡 Adding media_type column to stories...");

    await db.query(`
      ALTER TABLE stories
      ADD COLUMN IF NOT EXISTS media_type VARCHAR(20) DEFAULT 'image';
    `);

    console.log("✅ media_type column added successfully.");

    process.exit(0);

  } catch (err) {

    console.error("❌ Migration failed:");
    console.error(err);

    process.exit(1);

  }
}

migrate();