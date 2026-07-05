require("dotenv").config();

const db = require("../src/config/db");

async function migrate() {
  try {

    console.log("🚀 Adding gallery support");

    await db.query(`
      ALTER TABLE posts
      ADD COLUMN IF NOT EXISTS media_urls JSONB DEFAULT '[]';
    `);

    console.log("✅ media_urls added");

    process.exit(0);

  } catch (err) {

    console.error(err);
    process.exit(1);

  }
}

migrate();