const db = require('../config/db');
const GiftService = require('../services/giftService');
const HostAcademyService = require('../services/hostAcademyService');

const GiftController = {
  // GET /api/gifts
  async catalog(req, res, next) {
    try {
      const gifts = await GiftService.listCatalog();
      res.json({ success: true, data: gifts });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/gifts/send  { receiverId, giftId, quantity, contextType, contextId }
  //
  // This is the ONLY place in the entire codebase that emits
  // "giftReceived", "topGiftersUpdated", or "battleScoreUpdated".
  // stream.socket.js's old "sendGift" handler and gift.socket.js's
  // old "sendChatGift" handler have both been removed — clients can
  // no longer trigger a gift broadcast directly over the socket with
  // an arbitrary payload. Every field in the broadcast below is
  // sourced from the DB / the committed transaction, never from
  // req.body beyond the ids needed to look the real records up.
  async send(req, res, next) {
    try {
      const { receiverId, giftId, quantity, contextType, contextId } = req.body;
      if (!receiverId || !giftId || !contextType) {
        return res.status(400).json({ success: false, message: 'receiverId, giftId and contextType are required' });
      }
      // →
if (!['chat', 'call', 'live_room', 'podcast', 'profile'].includes(contextType)) {
  return res.status(400).json({ success: false, message: 'Invalid contextType' });
}

      const result = await GiftService.sendGift({
        senderId: req.user.id,
        receiverId,
        giftId,
        quantity: quantity || 1,
        contextType,
        contextId,
        deviceHash: req.headers['x-device-id'] || null,
        ipAddress: req.ip,
      });

      const io = req.app.get('io');

      // ── AUTHORITATIVE PAYLOAD ─────────────────────────────────────
      // sender display info pulled fresh from the DB — nothing here
      // is taken from client input, so nothing here is spoofable.
      let sender = {};
      try {
        const { rows: senderRows } = await db.query(
          `SELECT username, display_name, avatar_url FROM users WHERE id = $1`,
          [req.user.id]
        );
        sender = senderRows[0] || {};
      } catch (e) {
        console.error('[giftController.send] failed to load sender info:', e);
      }

      const socketPayload = {
        roomId:         contextId,
        senderId:       req.user.id,
        receiverId,
        avatar:         sender.avatar_url || null,
        name:           sender.display_name || sender.username || 'Someone',
        giftId:         result.gift.id,
        giftName:       result.gift.name,
        giftEmoji:      result.gift.emoji,
        quantity:       quantity || 1,
        amount:         result.totalCoins,
        totalCoins:     result.totalCoins,
        hostShare:      result.hostShare,
        platformShare:  result.platformShare,
      };

      if (io && contextType === 'live_room') {
        io.to(`room:${contextId}`).emit('giftReceived', socketPayload);

        // Top gifters — derived from the DB, never from client input.
        try {
          const { rows: topGifters } = await db.query(
            `SELECT u.id, u.username, u.avatar_url,
                    COALESCE(SUM(gt.total_coins), 0) AS total
             FROM gift_transactions gt
             JOIN users u ON u.id = gt.sender_id
             WHERE gt.context_type = 'live_room' AND gt.context_id = $1
             GROUP BY u.id, u.username, u.avatar_url
             ORDER BY total DESC
             LIMIT 5`,
            [contextId]
          );
          io.to(`room:${contextId}`).emit('topGiftersUpdated', topGifters);
        } catch (e) {
          console.error('[giftController.send] topGifters query failed:', e);
        }

        io.to(`room:${contextId}`).emit('battleScoreUpdated', {
          roomId: contextId,
          coinsAdded: result.totalCoins,
        });
      } else if (io && contextType === 'chat') {
        io.to(`conversation:${contextId}`).emit('giftReceived', socketPayload);
      }

      if (io) {
        io.to(`user:${receiverId}`).emit('giftNotification', socketPayload);
      }

      // Part 3: Golden Love gifts count toward Host Academy qualification.
      // Fire-and-forget — never blocks or fails the gift response.
      if (result.gift?.is_golden_love) {
        HostAcademyService.recordGoldenLoveGift(io, {
          giftTransactionId: result.transaction.id,
          senderId: req.user.id,
          receiverId,
        }).catch((err) => console.error('[giftController] host academy tracking failed:', err));
      }

      res.status(201).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/gifts/received
  async received(req, res, next) {
    try {
      const data = await GiftService.receivedHistory(req.user.id);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/gifts/sent
  async sent(req, res, next) {
    try {
      const data = await GiftService.sentHistory(req.user.id);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },
};

module.exports = GiftController;