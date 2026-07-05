require("dotenv").config();
const db = require("../src/config/db");

async function migrate() {
  try {
    console.log("🚀 Fixing posts schema alignment...");

    // STEP 1: FORCE TEXT[] FORMAT (RECOMMENDED FIX)
    await db.query(`
      ALTER TABLE posts
      ALTER COLUMN media_urls TYPE text[]
      USING COALESCE(media_urls, '{}')::text[];
    `);

    await db.query(`
      ALTER TABLE posts
      ALTER COLUMN tags TYPE text[]
      USING COALESCE(tags, '{}')::text[];
    `);

    // STEP 2: SAFE DEFAULTS
    await db.query(`
      ALTER TABLE posts
      ALTER COLUMN media_urls SET DEFAULT '{}',
      ALTER COLUMN tags SET DEFAULT '{}';
    `);

    console.log("✅ Schema fixed to text[]");

    process.exit(0);
  } catch (err) {
    console.error("❌ MIGRATION ERROR:", err.message);
    process.exit(1);
  }
}

migrate();