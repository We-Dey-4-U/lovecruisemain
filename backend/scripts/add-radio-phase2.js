require("dotenv").config();
const db = require("../src/config/db");

async function migrateRadioPhase2() {
  try {
    console.log("====================================");
    console.log("Radio Phase 2 Migration");
    console.log("====================================");

    await db.query("BEGIN");

    // --------------------------------------------------
    // Party FM category
    // --------------------------------------------------
    await db.query(`
      INSERT INTO radio_categories
      (key, label, icon, sort_order, is_active)
      VALUES
      ('party','Party FM','🎉',13,true)
      ON CONFLICT (key) DO NOTHING;
    `);

    console.log("✓ Party FM category");

    // --------------------------------------------------
    // radio_stations
    // --------------------------------------------------
    await db.query(`
      ALTER TABLE radio_stations
      ADD COLUMN IF NOT EXISTS is_members_only BOOLEAN NOT NULL DEFAULT FALSE;
    `);

    console.log("✓ radio_stations altered");

    // --------------------------------------------------
    // radio_station_subscriptions
    // --------------------------------------------------
    await db.query(`
      CREATE TABLE IF NOT EXISTS radio_station_subscriptions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          station_id UUID NOT NULL REFERENCES radio_stations(id) ON DELETE CASCADE,
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          status TEXT NOT NULL DEFAULT 'active',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(station_id,user_id)
      );
    `);

    console.log("✓ radio_station_subscriptions");

    // --------------------------------------------------
    // Extend radio_cohosts
    // --------------------------------------------------
    await db.query(`
      ALTER TABLE radio_cohosts
      ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid(),
      ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending',
      ADD COLUMN IF NOT EXISTS requested_at TIMESTAMPTZ DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
    `);

    console.log("✓ radio_cohosts altered");

    // --------------------------------------------------
    // radio_polls
    // --------------------------------------------------
    await db.query(`
      CREATE TABLE IF NOT EXISTS radio_polls (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          broadcast_id UUID NOT NULL REFERENCES radio_broadcasts(id) ON DELETE CASCADE,
          question TEXT NOT NULL,
          options JSONB NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          closed_at TIMESTAMPTZ
      );
    `);

    console.log("✓ radio_polls");

    // --------------------------------------------------
    // radio_poll_votes
    // --------------------------------------------------
    await db.query(`
      CREATE TABLE IF NOT EXISTS radio_poll_votes (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          poll_id UUID NOT NULL REFERENCES radio_polls(id) ON DELETE CASCADE,
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          option_index INT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(poll_id,user_id)
      );
    `);

    console.log("✓ radio_poll_votes");

    // --------------------------------------------------
    // radio_shows
    // --------------------------------------------------
    await db.query(`
      ALTER TABLE radio_shows
      ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;
    `);

    console.log("✓ radio_shows altered");

    // --------------------------------------------------
    // Helpful indexes
    // --------------------------------------------------
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_radio_station_subscriptions_station
      ON radio_station_subscriptions(station_id);
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_radio_station_subscriptions_user
      ON radio_station_subscriptions(user_id);
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_radio_polls_broadcast
      ON radio_polls(broadcast_id);
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_radio_poll_votes_poll
      ON radio_poll_votes(poll_id);
    `);

    console.log("✓ Indexes");

    await db.query("COMMIT");

    console.log("");
    console.log("====================================");
    console.log("✅ Radio Phase 2 migration complete");
    console.log("====================================");

    process.exit(0);

  } catch (err) {

    await db.query("ROLLBACK");

    console.error("");
    console.error("❌ Migration failed");
    console.error(err);

    process.exit(1);
  }
}

migrateRadioPhase2();