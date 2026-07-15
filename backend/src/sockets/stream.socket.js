// backend/src/sockets/stream.socket.js
// ROOT CAUSE FIXES applied:
//   FIX-1: existingProducers is sent 150ms after routerRtpCapabilities
//           so the client has time to load the device + publish before consuming.
//   FIX-2: getById is used instead of scanning the full list in loadRoom (client-side).
//   FIX-3: consume callback returns isHost derived from server state (not client guess).
//   FIX-4: peerMicToggled relay cleaned up (was duplicated in original file).
//   FIX-5 (ANTI-FRAUD/DEDUP): the "sendGift" socket handler has been
//         REMOVED. It used to re-broadcast the raw client payload as
//         "giftReceived" — untrusted amount/giftName/giftEmoji, and a
//         second, duplicate emission on top of the one already sent
//         by giftController.send() after the REST transaction commits.
//         "giftReceived" / "topGiftersUpdated" / "battleScoreUpdated"
//         are now emitted exclusively from giftController.send(),
//         built from the committed DB transaction. See that file.
//   FIX-6 (GUEST SEATS): added the matchmaker "male"/"female" guest-seat
//         slots. State lives on the in-memory `room` object (not in
//         room.js) so mediasoup internals stay untouched. Fully synced
//         across all clients via "guestSeatsUpdated", and cleaned up
//         automatically on leave/disconnect.
//   FIX-7 (MIC SEATS — NEW): added the 8 circular mic-seat slots from
//         the room-layout spec ("Seat 2..10" in the diagram). Same
//         pattern as guest seats: in-memory state on `room`, synced via
//         "micSeatsUpdated", cleaned up on leave/disconnect. This is
//         what lets a viewer tap a vacant seat and have their mic go
//         live / their presence show up for everyone else — the seat
//         itself is just a reserved slot; the actual audio/video still
//         flows over the existing mediasoup produce/consume pipeline
//         above, unchanged.

const db = require("../config/db");
const { createRoom, getRoom, closeRoom } = require("../mediasoup/room");
const { createRouter } = require("../mediasoup/router");

/* ══════════════════════════════════════════════════════
   GUEST SEATS (matchmaker male/female slots)
   Not part of mediasoup Room state — tracked here so no
   changes to room.js are needed.
   Shape: { male: {socketId,userId}|null, female: {...}|null }
══════════════════════════════════════════════════════ */
function getGuestSeats(room) {
  if (!room.guestSeats) room.guestSeats = { male: null, female: null };
  return room.guestSeats;
}
function broadcastGuestSeats(io, roomId, room) {
  io.to(`room:${roomId}`).emit("guestSeatsUpdated", getGuestSeats(room));
}
function clearGuestSeatsForSocket(room, socketId) {
  const seats = getGuestSeats(room);
  let changed = false;
  for (const key of ["male", "female"]) {
    if (seats[key]?.socketId === socketId) { seats[key] = null; changed = true; }
  }
  return changed;
}

/* ══════════════════════════════════════════════════════
   MIC SEATS (circular seats around the room — "Seat 2..10")
   8 numbered slots. Shape: array of 8, each either null or
   { socketId, userId }. Same "tracked on the room object,
   never touches mediasoup" approach as guest seats above.
══════════════════════════════════════════════════════ */
const MIC_SEAT_COUNT = 8;

function getMicSeats(room) {
  if (!room.micSeats) room.micSeats = Array(MIC_SEAT_COUNT).fill(null);
  return room.micSeats;
}
function broadcastMicSeats(io, roomId, room) {
  io.to(`room:${roomId}`).emit("micSeatsUpdated", getMicSeats(room));
}
function clearMicSeatForSocket(room, socketId) {
  const seats = getMicSeats(room);
  let changed = false;
  seats.forEach((s, i) => {
    if (s?.socketId === socketId) { seats[i] = null; changed = true; }
  });
  return changed;
}

module.exports = (io, socket) => {

  /* ══════════════════════════════════════════════════════
     JOIN ROOM
  ══════════════════════════════════════════════════════ */
  socket.on("joinRoom", async ({ roomId, userId }) => {
    try {
      console.log(`[joinRoom] socket=${socket.id} room=${roomId} user=${userId}`);

      socket.join(`room:${roomId}`);
      socket.currentRoomId = roomId;
      socket.currentUserId = userId;

      let room = getRoom(roomId);
      if (!room) room = createRoom(roomId);

      if (!room.router) {
        const router = await createRouter(roomId);
        room.router = router;
        console.log(`[joinRoom] Router created for room=${roomId}`);
      }

      room.addPeer(socket.id, userId);

      // ── FIX-8 (ROOT CAUSE): host must be resolved from the DB's
      // live_rooms.host_id, never from "first socket to connect".
      const { rows: roomRows } = await db.query(
        `SELECT host_id FROM live_rooms WHERE id = $1`,
        [roomId]
      );
      const dbHostId = roomRows[0]?.host_id;
      const isActualHost = dbHostId != null && String(dbHostId) === String(userId);

      if (isActualHost && room.hostSocketId !== socket.id) {
        room.setHost(socket.id);
        console.log(`[joinRoom] Host (re)assigned from DB truth: socket=${socket.id} user=${userId}`);
      } else if (!room.hostSocketId && !dbHostId) {
        room.setHost(socket.id);
        console.log(`[joinRoom] No DB host_id found — falling back to first joiner: socket=${socket.id}`);
      }

      // Presence
      await db.query(
        `INSERT INTO user_presence (user_id, socket_id, is_online, current_room_id, last_seen_at)
         VALUES ($1, $2, TRUE, $3, NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           socket_id       = EXCLUDED.socket_id,
           is_online       = TRUE,
           current_room_id = EXCLUDED.current_room_id,
           last_seen_at    = NOW()`,
        [userId, socket.id, roomId]
      );

      // Viewer count
      const roomSockets = io.sockets.adapter.rooms.get(`room:${roomId}`);
      const viewerCount = roomSockets ? roomSockets.size : 0;
      await db.query(`UPDATE live_rooms SET viewer_count = $2 WHERE id = $1`, [roomId, viewerCount]);
      io.to(`room:${roomId}`).emit("viewerCountUpdated", { roomId, viewerCount });

      // Collect existing producers BEFORE emitting anything
      const existingProducers = [];
      for (const [producerId, producer] of room.producers) {
        if (!producer.closed) {
          const peerSocketId = producer.appData?.socketId;
          const peerInfo     = room.peers.get(peerSocketId) || {};
          existingProducers.push({
            producerId,
            socketId: peerSocketId,
            userId:   peerInfo.userId || producer.appData?.userId || null,
            kind:     producer.kind,
            isHost:   peerSocketId === room.hostSocketId
          });
        }
      }

      console.log(`[joinRoom] Sending routerRtpCapabilities to socket=${socket.id}`);
      socket.emit("routerRtpCapabilities", {
        rtpCapabilities: room.router.rtpCapabilities
      });

      // Guest-seat snapshot (matchmaker slots) — sent immediately so a
      // fresh joiner sees who's already up without waiting on anything else.
      socket.emit("guestSeatsUpdated", getGuestSeats(room));

      // Mic-seat snapshot (the 8 circular seats) — same idea: a fresh
      // joiner sees which seats are already taken right away, so the
      // vacant/occupied state of the ring is correct from frame one.
      socket.emit("micSeatsUpdated", getMicSeats(room));

      // ── FIX-1 ── Wait 150ms before sending existingProducers.
      if (existingProducers.length > 0) {
        console.log(`[joinRoom] Scheduling existingProducers (${existingProducers.length}) with 150ms delay`);
        setTimeout(() => {
          if (socket.connected) {
            console.log(`[joinRoom] Emitting existingProducers to socket=${socket.id}`);
            socket.emit("existingProducers", existingProducers);
          }
        }, 150);
      }

      // Announce to existing peers
      socket.to(`room:${roomId}`).emit("peerJoined", {
        socketId: socket.id,
        userId,
        isHost: socket.id === room.hostSocketId
      });

      console.log(`[joinRoom] ✅ Done: room=${roomId} socket=${socket.id} isHost=${socket.id === room.hostSocketId} existingProducers=${existingProducers.length}`);
    } catch (err) {
      console.error("[joinRoom] ❌ Error:", err);
      socket.emit("streamError", { message: "Failed to join room", code: "JOIN_FAILED" });
    }
  });

  /* ══════════════════════════════════════════════════════
     CREATE SEND TRANSPORT
  ══════════════════════════════════════════════════════ */
  socket.on("createSendTransport", async ({ roomId }, callback) => {
    try {
      console.log(`[createSendTransport] socket=${socket.id} room=${roomId}`);
      const room = getRoom(roomId);
      if (!room?.router) throw new Error("Room/router not ready");

      const { createSendTransport } = require("../mediasoup/transport");
      const transport = await createSendTransport(socket.id, roomId);

      room.transports.set(`${socket.id}:send`, transport);

      console.log(`[createSendTransport] ✅ transport=${transport.id}`);
      callback({
        id:             transport.id,
        iceParameters:  transport.iceParameters,
        iceCandidates:  transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters
      });
    } catch (err) {
      console.error("[createSendTransport] ❌", err);
      callback({ error: err.message });
    }
  });

  /* ══════════════════════════════════════════════════════
     CREATE RECV TRANSPORT
  ══════════════════════════════════════════════════════ */
  socket.on("createRecvTransport", async ({ roomId }, callback) => {
    try {
      console.log(`[createRecvTransport] socket=${socket.id} room=${roomId}`);
      const room = getRoom(roomId);
      if (!room?.router) throw new Error("Room/router not ready");

      const { createRecvTransport } = require("../mediasoup/transport");
      const transport = await createRecvTransport(socket.id, roomId);

      room.transports.set(`${socket.id}:recv`, transport);

      console.log(`[createRecvTransport] ✅ transport=${transport.id}`);
      callback({
        id:             transport.id,
        iceParameters:  transport.iceParameters,
        iceCandidates:  transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters
      });
    } catch (err) {
      console.error("[createRecvTransport] ❌", err);
      callback({ error: err.message });
    }
  });

  /* ══════════════════════════════════════════════════════
     CONNECT TRANSPORT
  ══════════════════════════════════════════════════════ */
  socket.on("connectTransport", async ({ transportId, dtlsParameters }, callback) => {
    try {
      console.log(`[connectTransport] transportId=${transportId}`);
      const room = getRoom(socket.currentRoomId);
      if (!room) throw new Error("Room not found");

      let transport = null;
      for (const [, t] of room.transports) {
        if (t?.id === transportId) { transport = t; break; }
      }
      if (!transport) throw new Error(`Transport ${transportId} not found`);

      await transport.connect({ dtlsParameters });
      console.log(`[connectTransport] ✅ transportId=${transportId}`);
      if (callback) callback({ connected: true });
    } catch (err) {
      console.error("[connectTransport] ❌", err);
      if (callback) callback({ error: err.message });
    }
  });

  /* ══════════════════════════════════════════════════════
     PRODUCE
  ══════════════════════════════════════════════════════ */
  socket.on("produce", async ({ transportId, kind, rtpParameters, appData }, callback) => {
    try {
      console.log(`[produce] socket=${socket.id} kind=${kind} transportId=${transportId}`);
      const room = getRoom(socket.currentRoomId);
      if (!room) throw new Error("Room not found");

      let transport = null;
      for (const [, t] of room.transports) {
        if (t?.id === transportId) { transport = t; break; }
      }
      if (!transport) throw new Error(`Transport ${transportId} not found`);

      const isHost = socket.id === room.hostSocketId;

      const producer = await transport.produce({
        kind,
        rtpParameters,
        appData: {
          ...appData,
          socketId: socket.id,
          userId:   socket.currentUserId,
          roomId:   socket.currentRoomId,
          isHost
        }
      });

      room.producers.set(producer.id, producer);

      producer.on("score", (scores) => {
        socket.emit("producerScore", { producerId: producer.id, scores });
      });

      producer.observer.once("close", () => {
        room.producers.delete(producer.id);
        console.log(`[produce] Producer closed: ${producer.id}`);
      });

      // Notify all OTHER peers
      socket.to(`room:${socket.currentRoomId}`).emit("newProducer", {
        producerId: producer.id,
        socketId:   socket.id,
        userId:     socket.currentUserId,
        kind,
        isHost,
        appData
      });

      console.log(`[produce] ✅ producerId=${producer.id} kind=${kind} isHost=${isHost}`);
      callback({ producerId: producer.id });
    } catch (err) {
      console.error("[produce] ❌", err);
      callback({ error: err.message });
    }
  });

  /* ══════════════════════════════════════════════════════
     CONSUME
     FIX-3: isHost is resolved from server-side room state,
     not from whatever the client guessed.
  ══════════════════════════════════════════════════════ */
  socket.on("consume", async ({ transportId, producerId, rtpCapabilities }, callback) => {
    try {
      console.log(`[consume] socket=${socket.id} producerId=${producerId}`);
      const room = getRoom(socket.currentRoomId);
      if (!room?.router) throw new Error("Room/router not found");

      const producer = room.producers.get(producerId);
      if (!producer || producer.closed) {
        throw new Error(`Producer ${producerId} not found or closed`);
      }

      if (!room.router.canConsume({ producerId, rtpCapabilities })) {
        throw new Error("Cannot consume — incompatible RTP capabilities");
      }

      let transport = null;
      for (const [, t] of room.transports) {
        if (t?.id === transportId) { transport = t; break; }
      }
      if (!transport) throw new Error(`Transport ${transportId} not found`);

      const consumer = await transport.consume({
        producerId,
        rtpCapabilities,
        paused: true,
        appData: { socketId: socket.id, roomId: socket.currentRoomId }
      });

      room.consumers.set(consumer.id, consumer);

      consumer.on("score", (score) => {
        socket.emit("consumerScore", { consumerId: consumer.id, score });
      });

      consumer.on("layerschange", (layers) => {
        socket.emit("consumerLayersChanged", { consumerId: consumer.id, layers });
      });

      consumer.observer.once("close", () => {
        room.consumers.delete(consumer.id);
        console.log(`[consume] Consumer closed: ${consumer.id}`);
      });

      const producerSocketId = producer.appData?.socketId;
      const producerIsHost   = producerSocketId === room.hostSocketId;

      console.log(`[consume] ✅ consumerId=${consumer.id} kind=${consumer.kind} fromHost=${producerIsHost} producerSocket=${producerSocketId}`);

      callback({
        id:              consumer.id,
        producerId,
        kind:            consumer.kind,
        rtpParameters:   consumer.rtpParameters,
        type:            consumer.type,
        producerPaused:  consumer.producerPaused,
        producerSocketId,
        producerUserId:  producer.appData?.userId || null,
        isHost:          producerIsHost
      });
    } catch (err) {
      console.error("[consume] ❌", err);
      callback({ error: err.message });
    }
  });

  /* ══════════════════════════════════════════════════════
     RESUME CONSUMER
  ══════════════════════════════════════════════════════ */
  socket.on("resumeConsumer", async ({ consumerId }, callback) => {
    try {
      console.log(`[resumeConsumer] consumerId=${consumerId}`);
      const room     = getRoom(socket.currentRoomId);
      const consumer = room?.consumers.get(consumerId);
      if (!consumer) throw new Error("Consumer not found");

      await consumer.resume();
      console.log(`[resumeConsumer] ✅ consumerId=${consumerId}`);
      if (callback) callback({ resumed: true });
    } catch (err) {
      console.error("[resumeConsumer] ❌", err);
      if (callback) callback({ error: err.message });
    }
  });

  /* ══════════════════════════════════════════════════════
     GET PRODUCERS
  ══════════════════════════════════════════════════════ */
  socket.on("getProducers", ({ roomId }, callback) => {
    try {
      const room = getRoom(roomId);
      if (!room) return callback([]);

      const producers = [];
      for (const [producerId, producer] of room.producers) {
        if (!producer.closed) {
          const peerSocketId = producer.appData?.socketId;
          const peerInfo     = room.peers.get(peerSocketId) || {};
          producers.push({
            producerId,
            socketId: peerSocketId,
            userId:   peerInfo.userId || producer.appData?.userId || null,
            kind:     producer.kind,
            isHost:   peerSocketId === room.hostSocketId
          });
        }
      }

      callback(producers);
    } catch (err) {
      console.error("[getProducers] ❌", err);
      callback([]);
    }
  });

  /* ══════════════════════════════════════════════════════
     STREAM QUALITY REPORTING
  ══════════════════════════════════════════════════════ */
  socket.on("streamQualityReport", ({ roomId, stats }) => {
    const room = getRoom(roomId);
    if (room?.hostSocketId) {
      io.to(room.hostSocketId).emit("viewerQualityReport", {
        viewerSocketId: socket.id,
        stats
      });
    }
  });

  /* ══════════════════════════════════════════════════════
     COMMENTS
  ══════════════════════════════════════════════════════ */
  socket.on("streamComment", async (payload) => {
    try {
      const { roomId, userId, avatar, name, text } = payload;
      if (!text?.trim() || text.length > 200) return;

      await db.query(
        `INSERT INTO live_room_messages (room_id, user_id, body, message_type)
         VALUES ($1, $2, $3, 'comment')`,
        [roomId, userId, text.trim()]
      );

      io.to(`room:${roomId}`).emit("newComment", {
        roomId, userId, avatar, name,
        text: text.trim(),
        timestamp: Date.now()
      });
    } catch (err) {
      console.error("[streamComment] ❌", err);
    }
  });

  /* ══════════════════════════════════════════════════════
     REACTIONS
  ══════════════════════════════════════════════════════ */
  socket.on("streamReaction", ({ roomId, emoji, userId }) => {
    io.to(`room:${roomId}`).emit("newReaction", { emoji, userId, roomId });
  });

  /* ══════════════════════════════════════════════════════
     GIFTS
     ── REMOVED: "sendGift" handler ──
     The gift broadcast is now emitted exclusively from
     giftController.send() (see backend/src/controllers/
     giftController.js), immediately after the gift transaction
     commits in the database.
  ══════════════════════════════════════════════════════ */

  /* ══════════════════════════════════════════════════════
     GUEST SEATS (matchmaker male/female slots)
  ══════════════════════════════════════════════════════ */
  socket.on("requestGuestSeat", ({ roomId, slot }, callback) => {
    try {
      if (slot !== "male" && slot !== "female") throw new Error("Invalid slot");
      const room = getRoom(roomId);
      if (!room) throw new Error("Room not found");

      const seats = getGuestSeats(room);
      clearGuestSeatsForSocket(room, socket.id); // hop between slots cleanly

      if (seats[slot]) throw new Error("Seat already taken");

      seats[slot] = { socketId: socket.id, userId: socket.currentUserId };
      broadcastGuestSeats(io, roomId, room);
      callback?.({ ok: true, slot });
    } catch (err) {
      callback?.({ error: err.message });
    }
  });

  socket.on("leaveGuestSeat", ({ roomId }, callback) => {
    const room = getRoom(roomId);
    if (!room) return callback?.({ error: "Room not found" });
    if (clearGuestSeatsForSocket(room, socket.id)) {
      broadcastGuestSeats(io, roomId, room);
    }
    callback?.({ ok: true });
  });

  /* ══════════════════════════════════════════════════════
     MIC SEATS (the 8 circular seats — "empty seat, tap to
     activate mic" flow from the room-layout spec)
  ══════════════════════════════════════════════════════ */
  socket.on("requestMicSeat", ({ roomId, seatIndex }, callback) => {
    try {
      if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= MIC_SEAT_COUNT) {
        throw new Error("Invalid seat");
      }
      const room = getRoom(roomId);
      if (!room) throw new Error("Room not found");

      const seats = getMicSeats(room);
      clearMicSeatForSocket(room, socket.id); // hop between seats cleanly

      if (seats[seatIndex]) throw new Error("Seat already taken");

      seats[seatIndex] = { socketId: socket.id, userId: socket.currentUserId };
      broadcastMicSeats(io, roomId, room);
      callback?.({ ok: true, seatIndex });
    } catch (err) {
      callback?.({ error: err.message });
    }
  });

  socket.on("leaveMicSeat", ({ roomId }, callback) => {
    const room = getRoom(roomId);
    if (!room) return callback?.({ error: "Room not found" });
    if (clearMicSeatForSocket(room, socket.id)) {
      broadcastMicSeats(io, roomId, room);
    }
    callback?.({ ok: true });
  });

  /* ══════════════════════════════════════════════════════
     LIVE ENDED
  ══════════════════════════════════════════════════════ */
  socket.on("liveEnded", async ({ roomId }) => {
    try {
      io.to(`room:${roomId}`).emit("liveEnded", { roomId });
      closeRoom(roomId);

      await db.query(
        `UPDATE live_rooms SET status = 'ended', ended_at = NOW() WHERE id = $1`,
        [roomId]
      );
    } catch (err) {
      console.error("[liveEnded] ❌", err);
    }
  });

  /* ══════════════════════════════════════════════════════
     LEAVE ROOM
  ══════════════════════════════════════════════════════ */
  socket.on("leaveRoom", async ({ roomId }) => {
    try {
      socket.leave(`room:${roomId}`);
      await _handlePeerLeave(io, socket, roomId);
    } catch (err) {
      console.error("[leaveRoom] ❌", err);
    }
  });

  /* ══════════════════════════════════════════════════════
     REGISTER USER
  ══════════════════════════════════════════════════════ */
  socket.on("registerUser", (userId) => {
    if (userId) {
      socket.join(`user:${userId}`);
      console.log(`[registerUser] userId=${userId} socket=${socket.id}`);
    }
  });

  /* ══════════════════════════════════════════════════════
     PEER MIC TOGGLED
  ══════════════════════════════════════════════════════ */
  socket.on("peerMicToggled", ({ roomId, socketId, muted }) => {
    socket.to(`room:${roomId}`).emit("peerMicToggled", { socketId, muted });
  });

  /* ══════════════════════════════════════════════════════
     DISCONNECT
  ══════════════════════════════════════════════════════ */
  socket.on("disconnect", async () => {
    try {
      const { currentUserId, currentRoomId } = socket;
      console.log(`[disconnect] socket=${socket.id} user=${currentUserId} room=${currentRoomId}`);

      if (currentUserId) {
        await db.query(
          `UPDATE user_presence
           SET is_online = FALSE, socket_id = NULL, current_room_id = NULL, last_seen_at = NOW()
           WHERE user_id = $1`,
          [currentUserId]
        );
      }

      if (currentRoomId) {
        await _handlePeerLeave(io, socket, currentRoomId);
      }

      const { removeSocketTransports } = require("../mediasoup/transport");
      removeSocketTransports(socket.id);
    } catch (err) {
      console.error("[disconnect] ❌", err);
    }
  });

  /* ══════════════════════════════════════════════════════
     INTERNAL: PEER LEAVE CLEANUP
  ══════════════════════════════════════════════════════ */
  async function _handlePeerLeave(io, socket, roomId) {
    const room = getRoom(roomId);
    if (room) {
      const wasHost = room.hostSocketId === socket.id;
      room.removePeer(socket.id);

      // FIX-6: free any guest seat this socket held, and tell everyone.
      if (clearGuestSeatsForSocket(room, socket.id)) {
        io.to(`room:${roomId}`).emit("guestSeatsUpdated", getGuestSeats(room));
      }

      // FIX-7: same cleanup for mic seats — an empty seat should
      // reopen the instant its occupant disconnects or leaves.
      if (clearMicSeatForSocket(room, socket.id)) {
        io.to(`room:${roomId}`).emit("micSeatsUpdated", getMicSeats(room));
      }

      if (wasHost) {
        // FIX-9: without this, hostSocketId stays pointed at the now-
        // dead socket forever, and `joinRoom`'s `room.hostSocketId !== socket.id`
        // check is the only thing that lets a reconnecting host reclaim
        // it — which does work with FIX-8 above, but clearing it here
        // too means viewers immediately see "waiting for host" instead
        // of a stale isHost=true producer reference lingering around.
        room.hostSocketId = null;
        io.to(`room:${roomId}`).emit("hostLeft", { roomId });
      }
    }

    const roomSockets = io.sockets.adapter.rooms.get(`room:${roomId}`);
    const viewerCount = roomSockets ? roomSockets.size : 0;

    try {
      await db.query(
        `UPDATE live_rooms SET viewer_count = $2 WHERE id = $1`,
        [roomId, viewerCount]
      );

      io.to(`room:${roomId}`).emit("viewerCountUpdated", { roomId, viewerCount });
      socket.to(`room:${roomId}`).emit("peerLeft", {
        socketId: socket.id,
        userId:   socket.currentUserId
      });

      console.log(`[peerLeave] socket=${socket.id} left room=${roomId}`);
    } catch (err) {
      console.error("[_handlePeerLeave] ❌", err);
    }
  }
};