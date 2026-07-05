// backend/src/sockets/gift.socket.js
//
// ── REMOVED: "sendChatGift" handler ──
// This used to re-broadcast the raw client payload as "giftReceived"
// to a conversation room — the exact same spoofing/duplication bug
// as stream.socket.js's old "sendGift" handler. A client could emit
// a fake sendChatGift event with an arbitrary amount/giftName/emoji
// and have it broadcast as if it were a real, paid gift, with no
// server-side validation and no corresponding coin transfer.
//
// It was also redundant: giftController.send() already emits
// "giftReceived" to `conversation:${contextId}` for
// contextType === 'chat' once the gift transaction commits (see
// backend/src/controllers/giftController.js).
//
// This module is intentionally a no-op now. It is kept registered
// (rather than deleted from the socket setup index) so future,
// carefully-validated chat-context socket events have an obvious
// home — but nothing in this file ever emits "giftReceived", and no
// client-originated event can trigger a gift broadcast. The only
// path that can produce a gift broadcast is the authenticated
// POST /api/gifts/send REST endpoint.

module.exports = (io, socket) => {
  // Intentionally no listeners. All gift broadcasts (live_room, chat,
  // call, podcast) are emitted exclusively from giftController.send()
  // after the underlying DB transaction commits.
};