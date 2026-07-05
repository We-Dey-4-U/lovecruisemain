require("dotenv").config();

const db = require("../src/config/db");

async function installRevenueAndHostAcademy() {
  try {
    console.log("======================================");
    console.log("🚀 INSTALLING REVENUE SHARING SYSTEM");
    console.log("======================================");

    await db.query("BEGIN");

    //
    // Ensure uuid extension exists
    //
    await db.query(`
        CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    `);

    console.log("✅ UUID extension ready");

    //
    // Gifts table
    //
    console.log("Updating gifts table...");

    await db.query(`
        ALTER TABLE gifts
        ADD COLUMN IF NOT EXISTS is_golden_love BOOLEAN NOT NULL DEFAULT FALSE;
    `);

    //
    // Gift Transactions
    //
    console.log("Updating gift_transactions...");

    await db.query(`
        ALTER TABLE gift_transactions
            ADD COLUMN IF NOT EXISTS host_share_coins BIGINT NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS platform_share_coins BIGINT NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'completed',
            ADD COLUMN IF NOT EXISTS is_golden_love BOOLEAN NOT NULL DEFAULT FALSE;
    `);

    //
    // Platform Wallet
    //
    console.log("Creating platform_wallet...");

    await db.query(`
        CREATE TABLE IF NOT EXISTS platform_wallet (
            id INT PRIMARY KEY DEFAULT 1,
            balance BIGINT NOT NULL DEFAULT 0,
            CHECK (id = 1)
        );
    `);

    await db.query(`
        INSERT INTO platform_wallet (id, balance)
        VALUES (1,0)
        ON CONFLICT (id) DO NOTHING;
    `);

    //
    // Platform Wallet Ledger
    //
    console.log("Creating platform_wallet_ledger...");

    await db.query(`
        CREATE TABLE IF NOT EXISTS platform_wallet_ledger (
            id BIGSERIAL PRIMARY KEY,
            amount BIGINT NOT NULL,
            balance_after BIGINT NOT NULL,
            reference_type VARCHAR(50),
            reference_id BIGINT,
            description TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);

    //
    // Fraud Flags
    //
    console.log("Creating fraud_flags...");

    await db.query(`
        CREATE TABLE IF NOT EXISTS fraud_flags (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            reason VARCHAR(50) NOT NULL,
            details JSONB,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);

    await db.query(`
        CREATE INDEX IF NOT EXISTS idx_fraud_flags_user
        ON fraud_flags(user_id, created_at);
    `);

    //
    // Device Fingerprints
    //
    console.log("Creating device_fingerprints...");

    await db.query(`
        CREATE TABLE IF NOT EXISTS device_fingerprints (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            device_hash VARCHAR(255) NOT NULL,
            ip_address VARCHAR(100),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);

    await db.query(`
        CREATE INDEX IF NOT EXISTS idx_device_fp_hash
        ON device_fingerprints(device_hash);
    `);

    //
    // Host Academy Daily Log
    //
    console.log("Creating host_academy_daily_log...");

    await db.query(`
        CREATE TABLE IF NOT EXISTS host_academy_daily_log (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            log_date DATE NOT NULL,
            golden_love_count INT NOT NULL DEFAULT 0,
            golden_love_senders UUID[] NOT NULL DEFAULT '{}',
            tasks_completed TEXT[] NOT NULL DEFAULT '{}',
            day_completed BOOLEAN NOT NULL DEFAULT FALSE,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE(user_id, log_date)
        );
    `);

    //
    // Host Academy Progress
    //
    console.log("Creating host_academy_progress...");

    await db.query(`
        CREATE TABLE IF NOT EXISTS host_academy_progress (
            user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            current_day INT NOT NULL DEFAULT 1,
            consecutive_days_completed INT NOT NULL DEFAULT 0,
            last_qualifying_date DATE,
            unlocked BOOLEAN NOT NULL DEFAULT FALSE,
            unlocked_at TIMESTAMPTZ,
            badge_awarded BOOLEAN NOT NULL DEFAULT FALSE,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);

    await db.query("COMMIT");

    console.log("");
    console.log("======================================");
    console.log("✅ Revenue Sharing Installed");
    console.log("✅ Platform Wallet Installed");
    console.log("✅ Platform Wallet Ledger Installed");
    console.log("✅ Host Academy Installed");
    console.log("✅ Anti-Fraud Installed");
    console.log("======================================");

    process.exit(0);

  } catch (err) {

    await db.query("ROLLBACK");

    console.error("");
    console.error("❌ Installation Failed");
    console.error(err);

    process.exit(1);
  }
}

installRevenueAndHostAcademy();