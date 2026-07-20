require("dotenv").config();
const db = require("../src/config/db");

async function fixRadioSchemaDrift() {
  try {
    console.log("================================================");
    console.log("Lovecruise Radio Schema Drift Fix");
    console.log("================================================");

    //
    // ============================================================
    // 1. radio_cohosts
    // ============================================================
    //
    console.log("Checking radio_cohosts...");

    await db.query(`
        ALTER TABLE radio_cohosts
        ADD COLUMN IF NOT EXISTS invited_by UUID
        REFERENCES users(id) ON DELETE SET NULL;
    `);

    await db.query(`
        ALTER TABLE radio_cohosts
        ADD COLUMN IF NOT EXISTS mic_muted BOOLEAN NOT NULL DEFAULT TRUE;
    `);

    await db.query(`
        ALTER TABLE radio_cohosts
        ADD COLUMN IF NOT EXISTS mic_volume INTEGER NOT NULL DEFAULT 100;
    `);

    await db.query(`
        ALTER TABLE radio_cohosts
        ADD COLUMN IF NOT EXISTS mic_locked BOOLEAN NOT NULL DEFAULT FALSE;
    `);

    await db.query(`
        ALTER TABLE radio_cohosts
        ADD COLUMN IF NOT EXISTS requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    `);

    await db.query(`
        ALTER TABLE radio_cohosts
        ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
    `);

    console.log("✅ radio_cohosts columns verified");

    //
    // ============================================================
    // 2. UNIQUE CONSTRAINT
    // ============================================================
    //
    console.log("Checking unique constraint...");

    await db.query(`
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname='radio_cohosts_broadcast_user_uniq'
    ) THEN

        ALTER TABLE radio_cohosts
        ADD CONSTRAINT radio_cohosts_broadcast_user_uniq
        UNIQUE (broadcast_id,user_id);

    END IF;

EXCEPTION
WHEN duplicate_table THEN
    NULL;
END
$$;
`);

    console.log("✅ Unique constraint verified");

    //
    // ============================================================
    // 3. STATUS ENUM / CHECK
    // ============================================================
    //
    console.log("Checking radio_cohosts.status...");

    await db.query(`
DO $$
DECLARE
    col_type TEXT;
BEGIN

    SELECT data_type
    INTO col_type
    FROM information_schema.columns
    WHERE
        table_name='radio_cohosts'
        AND column_name='status';

    IF col_type='USER-DEFINED' THEN

        BEGIN
            ALTER TYPE radio_cohost_status ADD VALUE IF NOT EXISTS 'pending';
            ALTER TYPE radio_cohost_status ADD VALUE IF NOT EXISTS 'approved';
            ALTER TYPE radio_cohost_status ADD VALUE IF NOT EXISTS 'rejected';
            ALTER TYPE radio_cohost_status ADD VALUE IF NOT EXISTS 'left';
            ALTER TYPE radio_cohost_status ADD VALUE IF NOT EXISTS 'invited';
            ALTER TYPE radio_cohost_status ADD VALUE IF NOT EXISTS 'declined_invite';
        EXCEPTION
            WHEN undefined_object THEN
                NULL;
        END;

    ELSE

        EXECUTE (
            SELECT COALESCE(
                string_agg(
                    'ALTER TABLE radio_cohosts DROP CONSTRAINT '
                    || quote_ident(conname)
                    || ';',
                    ' '
                ),
                ''
            )
            FROM pg_constraint
            WHERE
                conrelid='radio_cohosts'::regclass
                AND contype='c'
                AND pg_get_constraintdef(oid) ILIKE '%status%'
        );

        ALTER TABLE radio_cohosts
        ADD CONSTRAINT radio_cohosts_status_check
        CHECK (
            status IN (
                'pending',
                'approved',
                'rejected',
                'left',
                'invited',
                'declined_invite'
            )
        );

    END IF;

END
$$;
`);

    console.log("✅ radio_cohosts status verified");

    //
    // ============================================================
    // 4. radio_songs
    // ============================================================
    //
    console.log("Checking radio_songs...");

    await db.query(`
        ALTER TABLE radio_songs
        ADD COLUMN IF NOT EXISTS file_id TEXT;
    `);

    await db.query(`
        ALTER TABLE radio_songs
        ADD COLUMN IF NOT EXISTS cover_file_id TEXT;
    `);

    await db.query(`
        ALTER TABLE radio_songs
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    `);

    await db.query(`
        ALTER TABLE radio_songs
        ADD COLUMN IF NOT EXISTS like_count INTEGER NOT NULL DEFAULT 0;
    `);

    await db.query(`
        ALTER TABLE radio_songs
        ADD COLUMN IF NOT EXISTS play_count INTEGER NOT NULL DEFAULT 0;
    `);

    console.log("✅ radio_songs columns verified");

    //
    // ============================================================
    // 5. radio_songs STATUS
    // ============================================================
    //
    console.log("Checking radio_songs.status...");

    await db.query(`
DO $$
DECLARE
    col_type TEXT;
BEGIN

    SELECT data_type
    INTO col_type
    FROM information_schema.columns
    WHERE
        table_name='radio_songs'
        AND column_name='status';

    IF col_type='USER-DEFINED' THEN

        BEGIN
            ALTER TYPE radio_song_status ADD VALUE IF NOT EXISTS 'processing';
            ALTER TYPE radio_song_status ADD VALUE IF NOT EXISTS 'ready';
            ALTER TYPE radio_song_status ADD VALUE IF NOT EXISTS 'failed';
        EXCEPTION
            WHEN undefined_object THEN
                NULL;
        END;

    ELSIF col_type IS NOT NULL THEN

        EXECUTE (
            SELECT COALESCE(
                string_agg(
                    'ALTER TABLE radio_songs DROP CONSTRAINT '
                    || quote_ident(conname)
                    || ';',
                    ' '
                ),
                ''
            )
            FROM pg_constraint
            WHERE
                conrelid='radio_songs'::regclass
                AND contype='c'
                AND pg_get_constraintdef(oid) ILIKE '%status%'
        );

        ALTER TABLE radio_songs
        ADD CONSTRAINT radio_songs_status_check
        CHECK (
            status IN (
                'processing',
                'ready',
                'failed'
            )
        );

    END IF;

END
$$;
`);

    console.log("✅ radio_songs status verified");

    //
    // ============================================================
    // 6. radio_song_likes
    // ============================================================
    //
    console.log("Checking radio_song_likes...");

    await db.query(`
CREATE TABLE IF NOT EXISTS radio_song_likes (

    song_id UUID NOT NULL
        REFERENCES radio_songs(id)
        ON DELETE CASCADE,

    user_id UUID NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY(song_id,user_id)
);
`);

    console.log("✅ radio_song_likes verified");

    //
    // ============================================================
    // 7. VERIFY SCHEMA
    // ============================================================
    //
    console.log("\nVerifying schemas...\n");

    const cohosts = await db.query(`
        SELECT column_name,data_type
        FROM information_schema.columns
        WHERE table_name='radio_cohosts'
        ORDER BY ordinal_position;
    `);

    console.log("radio_cohosts");
    console.table(cohosts.rows);

    const songs = await db.query(`
        SELECT column_name,data_type
        FROM information_schema.columns
        WHERE table_name='radio_songs'
        ORDER BY ordinal_position;
    `);

    console.log("radio_songs");
    console.table(songs.rows);

    console.log("\n================================================");
    console.log("✅ Radio schema successfully updated.");
    console.log("================================================");

    process.exit(0);

  } catch (err) {
    console.error("\n❌ Migration failed");
    console.error(err);
    process.exit(1);
  }
}

fixRadioSchemaDrift();