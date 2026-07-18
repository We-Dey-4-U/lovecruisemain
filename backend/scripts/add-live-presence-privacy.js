require("dotenv").config();
const db = require("../src/config/db");

async function migrate() {
  try {
    console.log("======================================");
    console.log("Adding Live Presence & Privacy System");
    console.log("======================================");

    //
    // USERS TABLE
    //
    console.log("Updating users table...");

    await db.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS allow_followers_see_live BOOLEAN NOT NULL DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS allow_followers_join_room BOOLEAN NOT NULL DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS hide_viewing_activity BOOLEAN NOT NULL DEFAULT FALSE;
    `);

    //
    // USER_PRESENCE TABLE
    //
    console.log("Updating user_presence table...");

    await db.query(`
      ALTER TABLE user_presence
        ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'OFFLINE',
        ADD COLUMN IF NOT EXISTS host_id UUID NULL,
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    `);

    //
    // STATUS CHECK CONSTRAINT
    //
    console.log("Adding status constraint...");

    await db.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'user_presence_status_check'
        ) THEN
          ALTER TABLE user_presence
          ADD CONSTRAINT user_presence_status_check
          CHECK (
            status IN (
              'OFFLINE',
              'ONLINE',
              'WATCHING_LIVE',
              'HOSTING_LIVE',
              'CO_HOST',
              'GUEST_SEAT'
            )
          );
        END IF;
      END
      $$;
    `);

    //
    // UNIQUE CONSTRAINT
    //
    console.log("Adding unique constraint...");

    await db.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'user_presence_user_id_unique'
        ) THEN
          ALTER TABLE user_presence
          ADD CONSTRAINT user_presence_user_id_unique
          UNIQUE (user_id);
        END IF;
      END
      $$;
    `);

    //
    // INDEXES
    //
    console.log("Creating indexes...");

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_user_presence_status
      ON user_presence(status);
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_user_presence_current_room
      ON user_presence(current_room_id);
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_user_presence_host_id
      ON user_presence(host_id);
    `);

    console.log("");
    console.log("======================================");
    console.log("Migration completed successfully.");
    console.log("======================================");

    process.exit(0);

  } catch (err) {
    console.error("");
    console.error("======================================");
    console.error("Migration failed.");
    console.error("======================================");
    console.error(err);

    process.exit(1);
  }
}

migrate();