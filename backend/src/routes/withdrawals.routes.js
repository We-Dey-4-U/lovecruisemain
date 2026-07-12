const express = require('express');
const router = express.Router();

const WithdrawalController = require('../controllers/withdrawalController');
const { requireAuth } = require('../middlewares/auth');
const requireAdmin = require('../middlewares/requireAdmin');

// ── User-facing ──
router.post('/', requireAuth, WithdrawalController.create);
router.get('/mine', requireAuth, WithdrawalController.mine);

// ── Admin ──
router.get('/', requireAuth, requireAdmin, WithdrawalController.listAll);
router.patch('/:id', requireAuth, requireAdmin, WithdrawalController.review);

module.exports = router;