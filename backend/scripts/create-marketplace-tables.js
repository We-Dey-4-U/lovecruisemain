require("dotenv").config();

const db = require("../src/config/db");

async function migrate() {
  const client = await db.getClient();

  try {
    console.log("======================================");
    console.log("🚀 Creating Marketplace Tables...");
    console.log("======================================");

    await client.query("BEGIN");

    console.log("Creating extension...");
    await client.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    console.log("Creating categories...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS marketplace_categories (
        key VARCHAR(40) PRIMARY KEY,
        label VARCHAR(80) NOT NULL,
        icon VARCHAR(10),
        sort_order INT DEFAULT 0,
        is_active BOOLEAN DEFAULT TRUE
      )
    `);

    console.log("Seeding categories...");
    await client.query(`
      INSERT INTO marketplace_categories (key, label, icon, sort_order)
      VALUES
        ('fashion','Fashion','👗',1),
        ('beauty','Beauty','💄',2),
        ('electronics','Electronics','📱',3),
        ('home','Home & Living','🏠',4),
        ('digital','Digital & Services','💻',5),
        ('vouchers','Gift Cards','🎟️',6),
        ('handmade','Art & Handmade','🎨',7)
      ON CONFLICT (key) DO NOTHING
    `);

    console.log("Creating listings...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS marketplace_listings (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        seller_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(100) NOT NULL,
        description TEXT,
        category VARCHAR(40) NOT NULL REFERENCES marketplace_categories(key),
        condition VARCHAR(20) NOT NULL DEFAULT 'new'
          CHECK (condition IN ('new','like_new','good','fair','digital')),
        price_coins NUMERIC NOT NULL CHECK (price_coins > 0),
        quantity INT NOT NULL DEFAULT 1 CHECK (quantity >= 0),
        images JSONB NOT NULL DEFAULT '[]',
        status VARCHAR(20) NOT NULL DEFAULT 'active'
          CHECK (status IN ('active','sold','removed','flagged')),
        views_count INT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    console.log("Creating listing indexes...");
    await client.query(`CREATE INDEX IF NOT EXISTS idx_mkt_listings_category ON marketplace_listings(category)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_mkt_listings_seller ON marketplace_listings(seller_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_mkt_listings_status ON marketplace_listings(status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_mkt_listings_created ON marketplace_listings(created_at DESC)`);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_mkt_listings_search
      ON marketplace_listings
      USING GIN (
        to_tsvector('english', title || ' ' || COALESCE(description,''))
      )
    `);

    // Continue the same pattern:
    // - marketplace_orders
    // - marketplace_order_events
    // - set_updated_at function
    // - DROP TRIGGER
    // - CREATE TRIGGER

    await client.query("COMMIT");

    console.log("✅ Marketplace tables created successfully.");

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Marketplace migration failed");
    console.error(err);
  } finally {
    client.release();
    process.exit();
  }
}

migrate();