require("dotenv").config();
const db = require("../src/config/db");

async function migrateRadioPhase4() {
  try {
    console.log("====================================");
    console.log("Radio Phase 4 Migration");
    console.log("Guest Invite Support");
    console.log("====================================");

    await db.query("BEGIN");

    // --------------------------------------------------
    // Extend radio_cohosts
    // --------------------------------------------------
    await db.query(`
      ALTER TABLE radio_cohosts
      ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'approved',
      ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS mic_muted BOOLEAN NOT NULL DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS mic_volume INT NOT NULL DEFAULT 100
          CHECK (mic_volume BETWEEN 0 AND 100),
      ADD COLUMN IF NOT EXISTS mic_locked BOOLEAN NOT NULL DEFAULT FALSE;
    `);

    console.log("✓ radio_cohosts updated");

    // --------------------------------------------------
    // Helpful index
    // --------------------------------------------------
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_radio_cohosts_status
      ON radio_cohosts(broadcast_id, status);
    `);

    console.log("✓ Index created");

    // --------------------------------------------------
    // Normalize existing rows
    // --------------------------------------------------
    await db.query(`
      UPDATE radio_cohosts
      SET
        requested_at = COALESCE(requested_at, NOW()),
        mic_muted = COALESCE(mic_muted, TRUE),
        mic_volume = COALESCE(mic_volume, 100),
        mic_locked = COALESCE(mic_locked, FALSE),
        status = COALESCE(status, 'approved');
    `);

    console.log("✓ Existing records updated");

    await db.query("COMMIT");

    console.log("");
    console.log("====================================");
    console.log("✅ Radio Phase 4 migration complete");
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

migrateRadioPhase4();