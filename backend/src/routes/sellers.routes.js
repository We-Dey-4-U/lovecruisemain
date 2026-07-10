const express = require('express');
const router = express.Router();

const SellerController = require('../controllers/sellerController');
const { requireAuth } = require('../middlewares/auth');
const requireAdmin = require('../middlewares/requireAdmin');

router.get('/me', requireAuth, SellerController.myStatus);
router.post('/apply', requireAuth, SellerController.apply);

router.get('/applications', requireAuth, requireAdmin, SellerController.listApplications);
router.patch('/applications/:id', requireAuth, requireAdmin, SellerController.reviewApplication);

module.exports = router;