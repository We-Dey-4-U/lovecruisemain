const db = require('../config/db');

const PLATFORM_FEE_PCT = 10; // % kept by the platform on every sale

const MarketplaceService = {
  // ── Categories ──────────────────────────────────────────
  async listCategories() {
    const { rows } = await db.query(
      `SELECT key, label, icon FROM marketplace_categories WHERE is_active = TRUE ORDER BY sort_order ASC`
    );
    return rows;
  },

  // ── Browse listings (public) ───────────────────────────
  async listListings({ category, search, limit = 20, offset = 0 } = {}) {
    const conditions = [`l.status != 'removed'`];
    const params = [];

    if (category && category !== 'all') {
      params.push(category);
      conditions.push(`l.category = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(l.title ILIKE $${params.length} OR l.description ILIKE $${params.length})`);
    }

    params.push(limit);
    const limitIdx = params.length;
    params.push(offset);
    const offsetIdx = params.length;

    const { rows } = await db.query(
      `SELECT l.id, l.title, l.description, l.category, l.condition, l.price_coins,
              l.quantity, l.images, l.status, l.created_at,
              u.id AS seller_id, u.username AS seller_username,
              u.display_name AS seller_name, u.avatar_url AS seller_avatar
       FROM marketplace_listings l
       JOIN users u ON u.id = l.seller_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY l.created_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params
    );
    return rows;
  },

  async getListing(id) {
    const { rows } = await db.query(
      `SELECT l.*, u.username AS seller_username, u.display_name AS seller_name, u.avatar_url AS seller_avatar
       FROM marketplace_listings l
       JOIN users u ON u.id = l.seller_id
       WHERE l.id = $1`,
      [id]
    );
    return rows[0] || null;
  },

  async listingsBySeller(sellerId) {
    const { rows } = await db.query(
      `SELECT * FROM marketplace_listings WHERE seller_id = $1 ORDER BY created_at DESC`,
      [sellerId]
    );
    return rows;
  },

  // ── Create / update / delete (seller-owned) ────────────
  async createListing(sellerId, { title, description, category, condition, price_coins, quantity, images }) {
    const { rows } = await db.query(
      `INSERT INTO marketplace_listings (seller_id, title, description, category, condition, price_coins, quantity, images)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [sellerId, title, description || null, category, condition || 'new', price_coins, quantity || 1, JSON.stringify(images || [])]
    );
    return rows[0];
  },

  async updateListing(sellerId, listingId, fields) {
    const existing = await this.getListing(listingId);
    if (!existing) throw Object.assign(new Error('Listing not found'), { status: 404 });
    if (String(existing.seller_id) !== String(sellerId)) {
      throw Object.assign(new Error('You do not own this listing'), { status: 403 });
    }

    const allowed = ['title', 'description', 'category', 'condition', 'price_coins', 'quantity', 'images', 'status'];
    const sets = [];
    const params = [];
    for (const key of allowed) {
      if (fields[key] !== undefined) {
        params.push(key === 'images' ? JSON.stringify(fields[key]) : fields[key]);
        sets.push(`${key} = $${params.length}`);
      }
    }
    if (!sets.length) return existing;

    params.push(listingId);
    const { rows } = await db.query(
      `UPDATE marketplace_listings SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    return rows[0];
  },

  async deleteListing(sellerId, listingId) {
    const existing = await this.getListing(listingId);
    if (!existing) throw Object.assign(new Error('Listing not found'), { status: 404 });
    if (String(existing.seller_id) !== String(sellerId)) {
      throw Object.assign(new Error('You do not own this listing'), { status: 403 });
    }
    // Soft delete — keeps order history intact for past buyers.
    await db.query(`UPDATE marketplace_listings SET status = 'removed' WHERE id = $1`, [listingId]);
    return true;
  },

  // ── Purchase flow ───────────────────────────────────────
  // Wraps the coin transfer + stock decrement + order creation in a
  // single DB transaction, the same defensive pattern used for gifts:
  // every amount is derived server-side from the committed listing
  // row, never trusted from the client.
  async buyListing({ buyerId, listingId, quantity = 1 }) {
    if (quantity < 1) throw Object.assign(new Error('Quantity must be at least 1'), { status: 400 });

    const client = await db.getClient(); // expects a pg Pool wrapper exposing getClient()
    try {
      await client.query('BEGIN');

      const { rows: listingRows } = await client.query(
        `SELECT * FROM marketplace_listings WHERE id = $1 FOR UPDATE`,
        [listingId]
      );
      const listing = listingRows[0];
      if (!listing || listing.status !== 'active') {
        throw Object.assign(new Error('This listing is no longer available'), { status: 400 });
      }
      if (String(listing.seller_id) === String(buyerId)) {
        throw Object.assign(new Error('You cannot buy your own listing'), { status: 400 });
      }
      if (listing.quantity < quantity) {
        throw Object.assign(new Error('Not enough stock available'), { status: 400 });
      }

      const totalCoins       = Number(listing.price_coins) * quantity;
      const platformFeeCoins = Math.round(totalCoins * (PLATFORM_FEE_PCT / 100));
      const sellerPayout     = totalCoins - platformFeeCoins;

      const { rows: buyerRows } = await client.query(
        `SELECT coin_balance FROM users WHERE id = $1 FOR UPDATE`,
        [buyerId]
      );
      const buyerBalance = Number(buyerRows[0]?.coin_balance || 0);
      if (buyerBalance < totalCoins) {
        throw Object.assign(new Error('Insufficient coin balance'), { status: 400 });
      }

      await client.query(`UPDATE users SET coin_balance = coin_balance - $1 WHERE id = $2`, [totalCoins, buyerId]);
      await client.query(
        `UPDATE users SET earnings_balance = COALESCE(earnings_balance,0) + $1 WHERE id = $2`,
        [sellerPayout, listing.seller_id]
      );

      const newQuantity = listing.quantity - quantity;
      await client.query(
        `UPDATE marketplace_listings SET quantity = $1, status = $2 WHERE id = $3`,
        [newQuantity, newQuantity <= 0 ? 'sold' : 'active', listingId]
      );

      const { rows: orderRows } = await client.query(
        `INSERT INTO marketplace_orders
           (listing_id, buyer_id, seller_id, quantity, unit_price_coins, total_coins,
            platform_fee_pct, platform_fee_coins, seller_payout_coins, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending')
         RETURNING *`,
        [listingId, buyerId, listing.seller_id, quantity, listing.price_coins, totalCoins,
         PLATFORM_FEE_PCT, platformFeeCoins, sellerPayout]
      );

      await client.query('COMMIT');

      const { rows: freshBuyer } = await db.query(`SELECT coin_balance FROM users WHERE id = $1`, [buyerId]);
      return { order: orderRows[0], buyerCoinBalance: Number(freshBuyer[0]?.coin_balance || 0) };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  // ── Orders ──────────────────────────────────────────────
  async ordersForBuyer(buyerId) {
    const { rows } = await db.query(
      `SELECT o.*, l.title AS listing_title, l.images AS listing_images,
              u.display_name AS seller_name, u.username AS seller_username
       FROM marketplace_orders o
       JOIN marketplace_listings l ON l.id = o.listing_id
       JOIN users u ON u.id = o.seller_id
       WHERE o.buyer_id = $1
       ORDER BY o.created_at DESC`,
      [buyerId]
    );
    return rows;
  },

  async ordersForSeller(sellerId) {
    const { rows } = await db.query(
      `SELECT o.*, l.title AS listing_title, l.images AS listing_images,
              u.display_name AS buyer_name, u.username AS buyer_username
       FROM marketplace_orders o
       JOIN marketplace_listings l ON l.id = o.listing_id
       JOIN users u ON u.id = o.buyer_id
       WHERE o.seller_id = $1
       ORDER BY o.created_at DESC`,
      [sellerId]
    );
    return rows;
  },

  async updateOrderStatus(actorId, orderId, newStatus) {
    const allowed = ['shipped', 'delivered', 'cancelled'];
    if (!allowed.includes(newStatus)) {
      throw Object.assign(new Error('Invalid status'), { status: 400 });
    }
    const { rows } = await db.query(`SELECT * FROM marketplace_orders WHERE id = $1`, [orderId]);
    const order = rows[0];
    if (!order) throw Object.assign(new Error('Order not found'), { status: 404 });

    const isSeller = String(order.seller_id) === String(actorId);
    const isBuyer  = String(order.buyer_id) === String(actorId);
    if (!isSeller && !isBuyer) throw Object.assign(new Error('Not authorized'), { status: 403 });
    if (newStatus === 'cancelled' && !isBuyer && order.status !== 'pending') {
      throw Object.assign(new Error('Only the buyer can cancel, and only while pending'), { status: 403 });
    }
    if ((newStatus === 'shipped' || newStatus === 'delivered') && !isSeller) {
      throw Object.assign(new Error('Only the seller can update shipping status'), { status: 403 });
    }

    const { rows: updated } = await db.query(
      `UPDATE marketplace_orders SET status = $1 WHERE id = $2 RETURNING *`,
      [newStatus, orderId]
    );
    await db.query(
      `INSERT INTO marketplace_order_events (order_id, from_status, to_status, actor_id) VALUES ($1,$2,$3,$4)`,
      [orderId, order.status, newStatus, actorId]
    );
    return updated[0];
  },
};

module.exports = MarketplaceService;