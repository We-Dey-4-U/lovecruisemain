const db = require("../src/config/db");

(async () => {
  try {
    console.log("📡 Creating posts table...");

    await db.query(`
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

      CREATE TABLE IF NOT EXISTS posts (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

        user_id UUID NOT NULL
          REFERENCES users(id)
          ON DELETE CASCADE,

        caption TEXT,

        media_url TEXT NOT NULL,

        type VARCHAR(20) NOT NULL DEFAULT 'image',

        thumbnail_url TEXT,

        likes_count INTEGER NOT NULL DEFAULT 0,

        comments_count INTEGER NOT NULL DEFAULT 0,

        views_count INTEGER NOT NULL DEFAULT 0,

        is_active BOOLEAN NOT NULL DEFAULT TRUE,

        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

        CHECK(type IN ('image','video'))
      );

      CREATE INDEX IF NOT EXISTS idx_posts_user
      ON posts(user_id, created_at DESC);
    `);

    console.log("✅ posts table created");

    process.exit(0);

  } catch (err) {

    console.error("❌ Error:", err.message);

    process.exit(1);

  }
})();