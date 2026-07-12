const MarketplaceService = require('../services/marketplaceService');
const UploadService = require('../services/UploadService');

const MarketplaceController = {
  async categories(req, res, next) {
    try {
      const data = await MarketplaceService.listCategories();
      res.json({ success: true, data });
    } catch (err) { next(err); }
  },

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

  async mine(req, res, next) {
    try {
      const data = await MarketplaceService.listingsBySeller(req.user.id);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  },

  async getOne(req, res, next) {
    try {
      const listing = await MarketplaceService.getListing(req.params.id);
      if (!listing) return res.status(404).json({ success: false, message: 'Listing not found' });
      res.json({ success: true, data: listing });
    } catch (err) { next(err); }
  },

  async create(req, res, next) {
    try {
      const { title, description, category, condition, price_coins, quantity, seller_contact } = req.body;
      if (!title || !category || !price_coins) {
        return res.status(400).json({ success: false, message: 'title, category and price_coins are required' });
      }
      if (!seller_contact) {
        return res.status(400).json({ success: false, message: 'A contact number is required' });
      }

      const files = req.files || [];
      const images = [];
      for (const file of files) {
        const uploaded = await UploadService.uploadFile(file);
        images.push({ url: UploadService.getFileViewUrl(uploaded.$id), type: 'image' });
      }

      const listing = await MarketplaceService.createListing(req.user.id, {
        title, description, category, condition, price_coins, quantity, images, seller_contact,
      });
      res.status(201).json({ success: true, data: listing });
    } catch (err) { next(err); }
  },

  async update(req, res, next) {
    try {
      const fields = { ...req.body };

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

  async remove(req, res, next) {
    try {
      await MarketplaceService.deleteListing(req.user.id, req.params.id);
      res.json({ success: true, message: 'Listing removed' });
    } catch (err) { next(err); }
  },

  // Single buy() — requires shippingAddress, drives the marketplaceOrder* socket events.
  async buy(req, res, next) {
    try {
      const { quantity, shippingAddress } = req.body;
      const result = await MarketplaceService.buyListing({
        buyerId: req.user.id,
        listingId: req.params.id,
        quantity: quantity || 1,
        shippingAddress,
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

  async orders(req, res, next) {
    try {
      const role = req.query.role === 'seller' ? 'seller' : 'buyer';
      const data = role === 'seller'
        ? await MarketplaceService.ordersForSeller(req.user.id)
        : await MarketplaceService.ordersForBuyer(req.user.id);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  },

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