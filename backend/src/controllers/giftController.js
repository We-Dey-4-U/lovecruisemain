const db = require('../config/db');
const GiftService = require('../services/giftService');
const HostAcademyService = require('../services/hostAcademyService');

// FIX: 'radio_broadcast' was missing here entirely. Every gift sent
// from radio-room.html (contextType: "radio_broadcast") was being
// rejected at this check with a 400 "Invalid contextType" — which is
// exactly the "invalid content type" 400 you were seeing on
// POST /api/gifts/send. Radio is a first-class gifting context now.
const VALID_CONTEXT_TYPES = ['chat', 'call', 'live_room', 'podcast', 'profile', 'radio_broadcast'];

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
  // "giftReceived", "radioGiftReceived", "topGiftersUpdated",
  // "topRadioGiftersUpdated", or "battleScoreUpdated".
  // Every field in the broadcast below is sourced from the DB / the
  // committed transaction, never from req.body beyond the ids needed
  // to look the real records up.
  //
  // PNG GIFT-ICON FIX: socketPayload now includes `giftIcon`
  // (= gifts.icon_url for the gift that was actually purchased),
  // sourced from `result.gift` (SELECT * FROM gifts ...) inside
  // GiftService.sendGift(). Previously only `giftEmoji` was sent,
  // so the frontend's PNG-based gift-animation engine had nothing
  // to render the sprite from and silently fell back to emoji.
  //
  // RADIO FIX (this pass): added a 'radio_broadcast' branch mirroring
  // the existing 'live_room' branch — emits 'radioGiftReceived' to
  // `radio:${contextId}` (the room radio.socket.js joins sockets to
  // in joinRadio/"radio:" + broadcastId), plus a
  // 'topRadioGiftersUpdated' refresh queried the same way
  // radioController.topGifters() already does (context_type =
  // 'radio_broadcast'). Without this branch the DB write would
  // succeed but nothing would ever reach the room in realtime — no
  // animation, no live top-gifters update, no gift chat bubble.
  async send(req, res, next) {
    try {
      const { receiverId, giftId, contextType, contextId } = req.body;

      if (!receiverId || !giftId || !contextType) {
        return res.status(400).json({ success: false, message: 'receiverId, giftId and contextType are required' });
      }

      if (!VALID_CONTEXT_TYPES.includes(contextType)) {
        return res.status(400).json({ success: false, message: 'Invalid contextType' });
      }

      let quantity = req.body.quantity;
      quantity = quantity === undefined || quantity === null ? 1 : Number(quantity);
      if (!Number.isInteger(quantity) || quantity < 1) {
        return res.status(400).json({ success: false, message: 'quantity must be a whole number of at least 1' });
      }

      if (String(receiverId) === String(req.user.id)) {
        return res.status(400).json({ success: false, message: 'You cannot send a gift to yourself' });
      }

      const result = await GiftService.sendGift({
        senderId: req.user.id,
        receiverId,
        giftId,
        quantity,
        contextType,
        contextId: contextId || null,
        deviceHash: req.headers['x-device-id'] || null,
        ipAddress: req.ip,
      });

      const io = req.app.get('io');

      // ── AUTHORITATIVE PAYLOAD ─────────────────────────────────────
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
        giftIcon:       result.gift.icon_url || null, // <-- PNG icon for the 2D gift-animation engine
        quantity:       quantity,
        amount:         result.totalCoins,
        totalCoins:     result.totalCoins,
        hostShare:      result.hostShare,
        platformShare:  result.platformShare,
      };

      if (io && contextType === 'live_room') {
        io.to(`room:${contextId}`).emit('giftReceived', socketPayload);

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
      } else if (io && contextType === 'radio_broadcast') {
        // Mirrors the live_room branch above, but for radio.socket.js's
        // room naming convention (`radio:${broadcastId}`) and event
        // names (radio-room.html listens for "radioGiftReceived" /
        // "topRadioGiftersUpdated", not the live_room ones).
        io.to(`radio:${contextId}`).emit('radioGiftReceived', socketPayload);

        try {
          const { rows: topGifters } = await db.query(
            `SELECT u.id, u.username, u.avatar_url,
                    COALESCE(SUM(gt.total_coins), 0) AS total
             FROM gift_transactions gt
             JOIN users u ON u.id = gt.sender_id
             WHERE gt.context_type = 'radio_broadcast' AND gt.context_id = $1
             GROUP BY u.id, u.username, u.avatar_url
             ORDER BY total DESC
             LIMIT 5`,
            [contextId]
          );
          io.to(`radio:${contextId}`).emit('topRadioGiftersUpdated', topGifters);
        } catch (e) {
          console.error('[giftController.send] radio topGifters query failed:', e);
        }
      }

      if (io) {
        io.to(`user:${receiverId}`).emit('giftNotification', socketPayload);
      }

      // Part 3: Golden Love gifts count toward Host Academy qualification.
      if (result.gift?.is_golden_love) {
        try {
          const maybePromise = HostAcademyService.recordGoldenLoveGift(io, {
            giftTransactionId: result.transaction.id,
            senderId: req.user.id,
            receiverId,
          });
          if (maybePromise && typeof maybePromise.catch === 'function') {
            maybePromise.catch((err) => console.error('[giftController] host academy tracking failed:', err));
          }
        } catch (err) {
          console.error('[giftController] host academy tracking threw synchronously:', err);
        }
      }

      res.status(201).json({ success: true, data: result });
    } catch (err) {
      console.error('[giftController.send] ERROR:', err);
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