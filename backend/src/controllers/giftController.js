const db = require('../config/db');
const GiftService = require('../services/giftService');
const HostAcademyService = require('../services/hostAcademyService');

const VALID_CONTEXT_TYPES = ['chat', 'call', 'live_room', 'podcast', 'profile'];

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
      const { receiverId, giftId, contextType, contextId } = req.body;

      // ── Basic input validation ──────────────────────────────
      // These checks run BEFORE anything touches the DB, so bad
      // input never has a chance to reach code paths that might
      // throw an unstatused error (which would otherwise surface
      // to the client as a generic 500).
      if (!receiverId || !giftId || !contextType) {
        return res.status(400).json({ success: false, message: 'receiverId, giftId and contextType are required' });
      }

      if (!VALID_CONTEXT_TYPES.includes(contextType)) {
        return res.status(400).json({ success: false, message: 'Invalid contextType' });
      }

      // Quantity must be a whole number >= 1. A bad value here
      // (NaN, 0, negative, decimal) used to sail through to the
      // DB layer, where a CHECK (quantity > 0) constraint violation
      // comes back as an unhandled, unstatused error -> 500.
      let quantity = req.body.quantity;
      quantity = quantity === undefined || quantity === null ? 1 : Number(quantity);
      if (!Number.isInteger(quantity) || quantity < 1) {
        return res.status(400).json({ success: false, message: 'quantity must be a whole number of at least 1' });
      }

      // Self-gifting is almost certainly meant to be blocked by
      // AntiFraudService.assertGiftAllowed() further down the chain,
      // but if that helper ever throws a plain Error() without a
      // `.status` attached, it will bubble up as a 500 instead of a
      // clean 400. Catching the obvious case here up front means the
      // user always gets a sensible response for it regardless of
      // how the anti-fraud service is implemented.
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
        quantity:       quantity,
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
      //
      // FIX: this is now wrapped in a try/catch. Previously, if
      // HostAcademyService.recordGoldenLoveGift() threw SYNCHRONOUSLY
      // (e.g. a bug before it ever returns a promise, or the function
      // not existing/being undefined), that throw happened inside this
      // try block but AFTER we'd already have wanted to send the
      // response — worse, if it threw before returning anything, the
      // ".catch(...)" call below would itself throw a TypeError
      // ("Cannot read properties of undefined (reading 'catch')"),
      // which WOULD propagate out of this handler and produce a 500
      // even though the gift itself was sent successfully.
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
      // Log the full error server-side (visible in your Render logs)
      // so the real cause of any 500 is easy to find, even though the
      // client just sees a generic failure message via next(err).
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