require("dotenv").config();

const db = require("../src/config/db");

async function migrate() {
  try {

    console.log("📡 Fixing posts media schema...");

    // Remove the old media_url column (if it exists)
    await db.query(`
      ALTER TABLE posts
      DROP COLUMN IF EXISTS media_url;
    `);

    console.log("✅ Removed media_url column.");

    // Add the new media_urls column (if it doesn't exist)
    await db.query(`
      ALTER TABLE posts
      ADD COLUMN IF NOT EXISTS media_urls JSONB;
    `);

    console.log("✅ Added media_urls column.");

    // Ensure the column defaults to an empty JSON array
    await db.query(`
      ALTER TABLE posts
      ALTER COLUMN media_urls
      SET DEFAULT '[]'::jsonb;
    `);

    console.log("✅ Set default value for media_urls.");

    // Leave tags unchanged
    console.log("ℹ️ Skipping tags (already text[]).");

    console.log("🎉 Posts media schema migration completed successfully.");

    process.exit(0);

  } catch (err) {

    console.error("❌ Migration failed:");
    console.error(err);

    process.exit(1);

  }
}

migrate();