-- ============================================================
-- Marketplace schema
-- Run this against the same Postgres database used by the rest
-- of the app (the one `src/config/db.js` connects to).
-- Assumes an existing `users` table with at least:
--   id UUID PRIMARY KEY, coin_balance NUMERIC, earnings_balance NUMERIC
-- (same columns already used by coins.html / giftController.js)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Categories ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketplace_categories (
  key         VARCHAR(40) PRIMARY KEY,
  label       VARCHAR(80) NOT NULL,
  icon        VARCHAR(10),
  sort_order  INT DEFAULT 0,
  is_active   BOOLEAN DEFAULT TRUE
);

INSERT INTO marketplace_categories (key, label, icon, sort_order) VALUES
  ('fashion',     'Fashion',             '👗', 1),
  ('beauty',      'Beauty',              '💄', 2),
  ('electronics', 'Electronics',         '📱', 3),
  ('home',        'Home & Living',       '🏠', 4),
  ('digital',     'Digital & Services',  '💻', 5),
  ('vouchers',    'Gift Cards',          '🎟️', 6),
  ('handmade',    'Art & Handmade',      '🎨', 7)
ON CONFLICT (key) DO NOTHING;

-- ── Listings ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketplace_listings (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  seller_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           VARCHAR(100) NOT NULL,
  description     TEXT,
  category        VARCHAR(40) NOT NULL REFERENCES marketplace_categories(key),
  condition       VARCHAR(20) NOT NULL DEFAULT 'new'
                  CHECK (condition IN ('new','like_new','good','fair','digital')),
  price_coins     NUMERIC NOT NULL CHECK (price_coins > 0),
  quantity        INT NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  images          JSONB NOT NULL DEFAULT '[]',     -- [{ "url": "...", "type": "image" }, ...]
  status          VARCHAR(20) NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','sold','removed','flagged')),
  views_count     INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mkt_listings_category ON marketplace_listings(category);
CREATE INDEX IF NOT EXISTS idx_mkt_listings_seller   ON marketplace_listings(seller_id);
CREATE INDEX IF NOT EXISTS idx_mkt_listings_status   ON marketplace_listings(status);
CREATE INDEX IF NOT EXISTS idx_mkt_listings_created  ON marketplace_listings(created_at DESC);
-- simple text search across title/description
CREATE INDEX IF NOT EXISTS idx_mkt_listings_search
  ON marketplace_listings USING GIN (to_tsvector('english', title || ' ' || coalesce(description,'')));

-- ── Orders (one row per purchase; quantity captured per order) ──
CREATE TABLE IF NOT EXISTS marketplace_orders (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  listing_id        UUID NOT NULL REFERENCES marketplace_listings(id) ON DELETE RESTRICT,
  buyer_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seller_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quantity          INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_coins  NUMERIC NOT NULL,
  total_coins       NUMERIC NOT NULL,           -- unit_price_coins * quantity
  platform_fee_pct  NUMERIC NOT NULL DEFAULT 10, -- % kept by the platform
  platform_fee_coins NUMERIC NOT NULL,
  seller_payout_coins NUMERIC NOT NULL,          -- total_coins - platform_fee_coins
  status            VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','shipped','delivered','cancelled','refunded')),
  buyer_note        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mkt_orders_buyer   ON marketplace_orders(buyer_id);
CREATE INDEX IF NOT EXISTS idx_mkt_orders_seller  ON marketplace_orders(seller_id);
CREATE INDEX IF NOT EXISTS idx_mkt_orders_listing ON marketplace_orders(listing_id);
CREATE INDEX IF NOT EXISTS idx_mkt_orders_status  ON marketplace_orders(status);

-- ── Order status history (audit trail, mirrors gift_transactions style) ──
CREATE TABLE IF NOT EXISTS marketplace_order_events (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id    UUID NOT NULL REFERENCES marketplace_orders(id) ON DELETE CASCADE,
  from_status VARCHAR(20),
  to_status   VARCHAR(20) NOT NULL,
  actor_id    UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── updated_at triggers ───────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mkt_listings_updated ON marketplace_listings;
CREATE TRIGGER trg_mkt_listings_updated BEFORE UPDATE ON marketplace_listings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_mkt_orders_updated ON marketplace_orders;
CREATE TRIGGER trg_mkt_orders_updated BEFORE UPDATE ON marketplace_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();










  -- ── Seller applications ────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_approved_seller BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS seller_applications (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status            VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected')),
  business_name     VARCHAR(120),
  reason            TEXT,
  contact_info      TEXT,
  reviewed_by       UUID REFERENCES users(id),
  reviewed_at       TIMESTAMPTZ,
  rejection_reason  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_seller_apps_user   ON seller_applications(user_id);
CREATE INDEX IF NOT EXISTS idx_seller_apps_status ON seller_applications(status);

-- Only one pending application per user at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_seller_apps_one_pending
  ON seller_applications(user_id) WHERE status = 'pending';

DROP TRIGGER IF EXISTS trg_seller_apps_updated ON seller_applications;
CREATE TRIGGER trg_seller_apps_updated BEFORE UPDATE ON seller_applications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at(); -- reuses the function from marketplace schema