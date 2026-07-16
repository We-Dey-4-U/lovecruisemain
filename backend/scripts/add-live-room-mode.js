require("dotenv").config();
const db = require("../src/config/db");

async function migrate() {
  try {
    console.log("======================================");
    console.log("Adding mode column to live_rooms...");
    console.log("======================================");

    // Add the column if it doesn't already exist
    await db.query(`
      ALTER TABLE live_rooms
      ADD COLUMN IF NOT EXISTS mode VARCHAR(20) NOT NULL DEFAULT 'social';
    `);

    console.log("✅ mode column verified.");

    // Add the CHECK constraint only if it doesn't already exist
    await db.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'live_rooms_mode_check'
        ) THEN
          ALTER TABLE live_rooms
          ADD CONSTRAINT live_rooms_mode_check
          CHECK (mode IN ('social', 'podcast'));
        END IF;
      END
      $$;
    `);

    console.log("✅ CHECK constraint verified.");
    console.log("🎉 Migration completed successfully.");

    process.exit(0);
  } catch (err) {
    console.error("❌ Migration failed:");
    console.error(err);
    process.exit(1);
  }
}

migrate();