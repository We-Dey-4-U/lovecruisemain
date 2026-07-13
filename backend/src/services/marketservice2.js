const db = require('../config/db');
const WalletService = require('./walletService'); // ← add this import

const PLATFORM_FEE_PCT = 10;

const MarketplaceService = {
  // ... listCategories, listListings, getListing, listingsBySeller unchanged ...

  async createListing(sellerId, { title, description, category, condition, price_coins, quantity, images, seller_contact }) {
    if (!seller_contact || !String(seller_contact).trim()) {
      throw Object.assign(new Error('A contact number is required so buyers can reach you'), { status: 400 });
    }
    const { rows } = await db.query(
      `INSERT INTO marketplace_listings (seller_id, title, description, category, condition, price_coins, quantity, images, seller_contact)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [sellerId, title, description || null, category, condition || 'new', price_coins, quantity || 1, JSON.stringify(images || []), seller_contact]
    );
    return rows[0];
  },

  async updateListing(sellerId, listingId, fields) {
    const existing = await this.getListing(listingId);
    if (!existing) throw Object.assign(new Error('Listing not found'), { status: 404 });
    if (String(existing.seller_id) !== String(sellerId)) {
      throw Object.assign(new Error('You do not own this listing'), { status: 403 });
    }

    const allowed = ['title', 'description', 'category', 'condition', 'price_coins', 'quantity', 'images', 'status', 'seller_contact'];
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
    await db.query(`UPDATE marketplace_listings SET status = 'removed' WHERE id = $1`, [listingId]);
    return true;
  },

  // ── Purchase flow — now requires shippingAddress, and every coin
  // movement goes through WalletService so wallet_ledger stays the
  // single source of truth (and marketplace earnings are tagged
  // 'marketplace_sale', never mixed with 'gift_received').
  async buyListing({ buyerId, listingId, quantity = 1, shippingAddress }) {
    if (quantity < 1) throw Object.assign(new Error('Quantity must be at least 1'), { status: 400 });
    if (!shippingAddress || !shippingAddress.trim()) {
      throw Object.assign(new Error('A shipping address is required'), { status: 400 });
    }

    const client = await db.getClient();
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

      // Create the order row first so we have an id to reference in the ledger.
      const { rows: orderRows } = await client.query(
        `INSERT INTO marketplace_orders
           (listing_id, buyer_id, seller_id, quantity, unit_price_coins, total_coins,
            platform_fee_pct, platform_fee_coins, seller_payout_coins, status, shipping_address)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10)
         RETURNING *`,
        [listingId, buyerId, listing.seller_id, quantity, listing.price_coins, totalCoins,
         PLATFORM_FEE_PCT, platformFeeCoins, sellerPayout, shippingAddress.trim()]
      );
      const order = orderRows[0];

      // Debit buyer's spendable coins (throws if insufficient — handled here, not manually).
      await WalletService.debitCoins(client, {
        userId: buyerId,
        amount: totalCoins,
        type: 'marketplace_purchase',
        referenceType: 'marketplace_order',
        referenceId: order.id,
        description: `Purchase: ${listing.title}`,
      });

      // Credit seller's earnings — tagged 'marketplace_sale' so it never
      // gets mixed with gift earnings in the ledger/summary.
      await WalletService.creditEarnings(client, {
        userId: listing.seller_id,
        amount: sellerPayout,
        type: 'marketplace_sale',
        referenceType: 'marketplace_order',
        referenceId: order.id,
        description: `Sale: ${listing.title}`,
      });

      // Credit platform's cut.
      await WalletService.creditPlatform(client, {
        amount: platformFeeCoins,
        referenceType: 'marketplace_order',
        referenceId: order.id,
        description: `Platform fee: ${listing.title}`,
      });

      const newQuantity = listing.quantity - quantity;
      await client.query(
        `UPDATE marketplace_listings SET quantity = $1, status = $2 WHERE id = $3`,
        [newQuantity, newQuantity <= 0 ? 'sold' : 'active', listingId]
      );

      await client.query('COMMIT');

      const { rows: freshBuyer } = await db.query(`SELECT coin_balance FROM users WHERE id = $1`, [buyerId]);
      return { order, buyerCoinBalance: Number(freshBuyer[0]?.coin_balance || 0) };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  // ordersForBuyer / ordersForSeller / updateOrderStatus unchanged —
  // shipping_address and seller_contact will just ride along on l.*/o.*
};

module.exports = MarketplaceService;