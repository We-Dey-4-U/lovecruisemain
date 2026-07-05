-- ============================================================
-- Migration 002 — Revenue Sharing, Host Academy, Anti-Fraud
-- Additive only. Safe to run on the existing schema.
-- ============================================================

BEGIN;

-- ── PART 2: Revenue sharing on gift_transactions ──────────────
ALTER TABLE gift_transactions
  ADD COLUMN IF NOT EXISTS host_share_coins     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS platform_share_coins INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status                TEXT NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS is_golden_love        BOOLEAN NOT NULL DEFAULT FALSE;

-- one row, running platform balance + full audit trail via wallet_ledger-style table
CREATE TABLE IF NOT EXISTS platform_wallet (
  id      SMALLINT PRIMARY KEY DEFAULT 1,
  balance BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT platform_wallet_single_row CHECK (id = 1)
);
INSERT INTO platform_wallet (id, balance) VALUES (1, 0)
  ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS platform_wallet_ledger (
  id             BIGSERIAL PRIMARY KEY,
  amount         INTEGER NOT NULL,
  balance_after  BIGINT NOT NULL,
  reference_type TEXT,
  reference_id   BIGINT,
  description    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- mark specific catalog gifts as "Golden Love" (qualifies for Host Academy)
ALTER TABLE gifts
  ADD COLUMN IF NOT EXISTS is_golden_love BOOLEAN NOT NULL DEFAULT FALSE;

-- ── PART 3: Host Academy ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS host_academy_progress (
  user_id                   UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  current_day               SMALLINT NOT NULL DEFAULT 1 CHECK (current_day BETWEEN 1 AND 7),
  consecutive_days_completed SMALLINT NOT NULL DEFAULT 0,
  last_qualifying_date      DATE,
  unlocked                  BOOLEAN NOT NULL DEFAULT FALSE,
  unlocked_at               TIMESTAMPTZ,
  badge_awarded             BOOLEAN NOT NULL DEFAULT FALSE,
  fraud_hold                BOOLEAN NOT NULL DEFAULT FALSE,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- one row per user per calendar day — source of truth for "did they qualify today"
CREATE TABLE IF NOT EXISTS host_academy_daily_log (
  id                     BIGSERIAL PRIMARY KEY,
  user_id                UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_date               DATE NOT NULL,
  golden_love_count      SMALLINT NOT NULL DEFAULT 0,
  golden_love_senders    UUID[] NOT NULL DEFAULT '{}',   -- distinct sender ids today
  tasks_completed        TEXT[] NOT NULL DEFAULT '{}',   -- e.g. {'active_30m','new_followers'}
  day_completed          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, log_date)
);

CREATE INDEX IF NOT EXISTS idx_host_academy_daily_log_user_date
  ON host_academy_daily_log (user_id, log_date);

-- ── PART 4: Anti-fraud ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS device_fingerprints (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_hash  TEXT NOT NULL,
  ip_address   INET,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_device_fingerprints_hash ON device_fingerprints (device_hash);
CREATE INDEX IF NOT EXISTS idx_device_fingerprints_ip    ON device_fingerprints (ip_address);

CREATE TABLE IF NOT EXISTS fraud_flags (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  reason      TEXT NOT NULL,     -- e.g. 'self_gift_attempt', 'device_duplication', 'gift_farming'
  details     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;