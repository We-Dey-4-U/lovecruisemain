require("dotenv").config();
const db = require("../src/config/db");

async function fixRadioSchema() {
  try {
    console.log("================================================");
    console.log("Lovecruise Radio Schema Drift Fix");
    console.log("================================================");

    //
    // ------------------------------------------------------------
    // 1. FOLLOWS TABLE
    // ------------------------------------------------------------
    //
    console.log("Creating follows table if needed...");

    await db.query(`
      CREATE TABLE IF NOT EXISTS follows (
        follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        following_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (follower_id, following_id)
      );
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_follows_following_id
      ON follows(following_id);
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_follows_follower_id
      ON follows(follower_id);
    `);

    console.log("✅ follows table verified");

    //
    // ------------------------------------------------------------
    // 2. radio_cohosts columns
    // ------------------------------------------------------------
    //
    console.log("Checking radio_cohosts columns...");

    await db.query(`
      ALTER TABLE radio_cohosts
      ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES users(id);
    `);

    await db.query(`
      ALTER TABLE radio_cohosts
      ADD COLUMN IF NOT EXISTS mic_muted BOOLEAN NOT NULL DEFAULT TRUE;
    `);

    await db.query(`
      ALTER TABLE radio_cohosts
      ADD COLUMN IF NOT EXISTS mic_locked BOOLEAN NOT NULL DEFAULT FALSE;
    `);

    await db.query(`
      ALTER TABLE radio_cohosts
      ADD COLUMN IF NOT EXISTS mic_volume SMALLINT NOT NULL DEFAULT 100;
    `);

    console.log("✅ radio_cohosts columns verified");

    //
    // ------------------------------------------------------------
    // 3. STATUS ENUM / CHECK FIX
    // ------------------------------------------------------------
    //
    console.log("Checking radio_cohosts.status...");

    await db.query(`
DO $$
DECLARE
    enum_type_name TEXT;
BEGIN

    SELECT t.typname
    INTO enum_type_name
    FROM pg_type t
    JOIN pg_attribute a
      ON a.atttypid=t.oid
    JOIN pg_class c
      ON c.oid=a.attrelid
    WHERE
        c.relname='radio_cohosts'
        AND a.attname='status'
        AND t.typtype='e';

    IF enum_type_name IS NOT NULL THEN

        EXECUTE format(
            'ALTER TYPE %I ADD VALUE IF NOT EXISTS %L',
            enum_type_name,
            'invited'
        );

        EXECUTE format(
            'ALTER TYPE %I ADD VALUE IF NOT EXISTS %L',
            enum_type_name,
            'declined_invite'
        );

        EXECUTE format(
            'ALTER TYPE %I ADD VALUE IF NOT EXISTS %L',
            enum_type_name,
            'left'
        );

        EXECUTE format(
            'ALTER TYPE %I ADD VALUE IF NOT EXISTS %L',
            enum_type_name,
            'rejected'
        );

        RAISE NOTICE 'Updated enum type %', enum_type_name;

    ELSE

        EXECUTE (
            SELECT COALESCE(
                string_agg(
                    format(
                        'ALTER TABLE radio_cohosts DROP CONSTRAINT %I;',
                        con.conname
                    ),
                    ' '
                ),
                ''
            )
            FROM pg_constraint con
            JOIN pg_class rel
              ON rel.oid=con.conrelid
            WHERE
                rel.relname='radio_cohosts'
                AND con.contype='c'
                AND pg_get_constraintdef(con.oid)
                    ILIKE '%status%'
        );

        ALTER TABLE radio_cohosts
        ADD CONSTRAINT radio_cohosts_status_check
        CHECK (
            status IN (
                'pending',
                'approved',
                'rejected',
                'invited',
                'declined_invite',
                'left'
            )
        );

    END IF;

END
$$;
`);

    console.log("✅ Status constraint verified");

    //
    // ------------------------------------------------------------
    // 4. VERIFY RESULT
    // ------------------------------------------------------------
    //
    console.log("");
    console.log("Current radio_cohosts schema:");

    const { rows } = await db.query(`
        SELECT
            column_name,
            data_type,
            is_nullable,
            column_default
        FROM information_schema.columns
        WHERE table_name='radio_cohosts'
        ORDER BY ordinal_position;
    `);

    console.table(rows);

    console.log("");
    console.log("================================================");
    console.log("✅ Radio schema migration completed successfully.");
    console.log("================================================");

    process.exit(0);

  } catch (err) {
    console.error("");
    console.error("❌ Migration failed");
    console.error(err);
    process.exit(1);
  }
}

fixRadioSchema();