require("dotenv").config();

console.log("🚀 Posts System Migration Started");

const db = require("../src/config/db");

async function migrate() {
  try {
    console.log("📡 Connecting to database...");

    // =====================================================
    // ADD is_deleted COLUMN (FIX YOUR CURRENT ERROR)
    // =====================================================
    await db.query(`
      ALTER TABLE posts
      ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;
    `);

    console.log("✅ is_deleted column ensured");

    // =====================================================
    // ENSURE OTHER CRITICAL COLUMNS EXIST
    // =====================================================
    await db.query(`
      ALTER TABLE posts
      ADD COLUMN IF NOT EXISTS media_url TEXT,
      ADD COLUMN IF NOT EXISTS media_type VARCHAR(20) DEFAULT 'text',
      ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS caption TEXT;
    `);

    console.log("✅ post columns ensured");

    // =====================================================
    // INDEXES (SAFE)
    // =====================================================
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_posts_user
      ON posts(user_id);
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_posts_created
      ON posts(created_at DESC);
    `);

    console.log("✅ indexes ensured");

    console.log("🎉 POSTS MIGRATION COMPLETED SUCCESSFULLY");

    process.exit(0);
  } catch (err) {
    console.error("❌ Migration failed");
    console.error(err);
    process.exit(1);
  }
}

migrate();