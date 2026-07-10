const MarketplaceService = require('../services/marketplaceService');
const UploadService = require('../services/UploadService'); // ← add this

const MarketplaceController = {
  // GET /api/marketplace/categories
  async categories(req, res, next) {
    try {
      const data = await MarketplaceService.listCategories();
      res.json({ success: true, data });
    } catch (err) { next(err); }
  },

  // GET /api/marketplace/listings?category=&search=&limit=&offset=
  async list(req, res, next) {
    try {
      const { category, search, limit, offset } = req.query;
      const data = await MarketplaceService.listListings({
        category,
        search,
        limit: limit ? Number(limit) : 20,
        offset: offset ? Number(offset) : 0,
      });
      res.json({ success: true, data });
    } catch (err) { next(err); }
  },

  // GET /api/marketplace/listings/mine
  async mine(req, res, next) {
    try {
      const data = await MarketplaceService.listingsBySeller(req.user.id);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  },

  // GET /api/marketplace/listings/:id
  async getOne(req, res, next) {
    try {
      const listing = await MarketplaceService.getListing(req.params.id);
      if (!listing) return res.status(404).json({ success: false, message: 'Listing not found' });
      res.json({ success: true, data: listing });
    } catch (err) { next(err); }
  },

  // POST /api/marketplace/listings
 async create(req, res, next) {
  try {
    const { title, description, category, condition, price_coins, quantity } = req.body;
    if (!title || !category || !price_coins) {
      return res.status(400).json({ success: false, message: 'title, category and price_coins are required' });
    }

    const files = req.files || [];
    const images = [];
    for (const file of files) {
      const uploaded = await UploadService.uploadFile(file);
      images.push({ url: UploadService.getFileViewUrl(uploaded.$id), type: 'image' });
    }

    const listing = await MarketplaceService.createListing(req.user.id, {
      title, description, category, condition, price_coins, quantity, images,
    });
    res.status(201).json({ success: true, data: listing });
  } catch (err) { next(err); }
},

  // PATCH /api/marketplace/listings/:id
 async update(req, res, next) {
  try {
    const fields = { ...req.body };

    // Frontend sends the URLs of images it wants to KEEP as a JSON string,
    // since removed images just aren't resent as files.
    if (fields.existingImages !== undefined) {
      try { fields.existingImages = JSON.parse(fields.existingImages); }
      catch { fields.existingImages = []; }
    }

    const files = req.files || [];
    const newImages = [];
    for (const file of files) {
      const uploaded = await UploadService.uploadFile(file);
      newImages.push({ url: UploadService.getFileViewUrl(uploaded.$id), type: 'image' });
    }

    if (files.length || fields.existingImages !== undefined) {
      fields.images = [...(fields.existingImages || []), ...newImages].slice(0, 4);
    }
    delete fields.existingImages;

    const listing = await MarketplaceService.updateListing(req.user.id, req.params.id, fields);
    res.json({ success: true, data: listing });
  } catch (err) { next(err); }
},

  // DELETE /api/marketplace/listings/:id
  async remove(req, res, next) {
    try {
      await MarketplaceService.deleteListing(req.user.id, req.params.id);
      res.json({ success: true, message: 'Listing removed' });
    } catch (err) { next(err); }
  },

  // POST /api/marketplace/listings/:id/buy  { quantity }
  async buy(req, res, next) {
    try {
      const { quantity } = req.body;
      const result = await MarketplaceService.buyListing({
        buyerId: req.user.id,
        listingId: req.params.id,
        quantity: quantity || 1,
      });

      const io = req.app.get('io');
      if (io) {
        io.to(`user:${result.order.seller_id}`).emit('marketplaceOrderReceived', result.order);
        io.to(`user:${result.order.buyer_id}`).emit('marketplaceOrderConfirmed', result.order);
      }

      res.status(201).json({
        success: true,
        data: { order: result.order, buyerCoinBalance: result.buyerCoinBalance },
      });
    } catch (err) { next(err); }
  },

  // GET /api/marketplace/orders?role=buyer|seller
  async orders(req, res, next) {
    try {
      const role = req.query.role === 'seller' ? 'seller' : 'buyer';
      const data = role === 'seller'
        ? await MarketplaceService.ordersForSeller(req.user.id)
        : await MarketplaceService.ordersForBuyer(req.user.id);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  },

  // PATCH /api/marketplace/orders/:id/status  { status }
  async updateOrderStatus(req, res, next) {
    try {
      const { status } = req.body;
      const order = await MarketplaceService.updateOrderStatus(req.user.id, req.params.id, status);

      const io = req.app.get('io');
      if (io) {
        io.to(`user:${order.buyer_id}`).emit('marketplaceOrderStatusChanged', order);
        io.to(`user:${order.seller_id}`).emit('marketplaceOrderStatusChanged', order);
      }

      res.json({ success: true, data: order });
    } catch (err) { next(err); }
  },
};

module.exports = MarketplaceController;