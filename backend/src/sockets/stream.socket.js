// backend/src/sockets/stream.socket.js
//
// ═══════════════════════════════════════════════════════════════
//   THIS PASS — 12 SEATS + FULL-ROOM PARTICIPANTS/KICK
// ═══════════════════════════════════════════════════════════════
//   1) MIC_SEAT_COUNT raised 8 → 12 (4 left wing, 4 right wing,
//      4 bottom row — matches the new client layout).
//   2) NEW: room.participants — a socketId → identity map (kept
//      separately from mediasoup's room.peers) so the host can
//      pull a full roster of everyone currently in the room,
//      including pure audience members who never touched a seat.
//      Only ever sent to the host socket — regular viewers have
//      no way to fetch this.
//   3) NEW socket events:
//        "getParticipants" (host-only)      -> cb({participants}|{error})
//        "hostKickUser"    (host-only)       -> removes ANY user from
//           the room entirely (not just a seat/guest slot) — frees
//           any seat/guest slot they held, boots them from the
//           socket.io room, updates viewer counts, and tells their
//           client to tear down and leave.
//   4) Join announcements are now broadcast into the comment feed
//      ("X joined the live") so regular viewers learn who's around
//      only through chat / occupied seats — never a full roster.
//
//   Everything else (mediasoup transports/producers/consumers,
//   seat/guest mute-vs-leave split, host seat/guest mute-kick) is
//   UNCHANGED from the previous pass.
// ═══════════════════════════════════════════════════════════════

const db = require("../config/db");
const { createRoom, getRoom, closeRoom } = require("../mediasoup/room");
const { createRouter } = require("../mediasoup/router");

/* ══════════════════════════════════════════════════════
   USER LOOKUP
══════════════════════════════════════════════════════ */
async function getUserBrief(userId) {
  if (!userId) return null;
  try {
    const { rows } = await db.query(
      `SELECT id, username, display_name, avatar_url FROM users WHERE id = $1`,
      [userId]
    );
    return rows[0] || null;
  } catch (err) {
    console.error("[getUserBrief] ❌", err);
    return null;
  }
}

/* ══════════════════════════════════════════════════════
   ROOM PARTICIPANTS ROSTER — host-only visibility
   ------------------------------------------------------
   Separate from mediasoup's room.peers: this tracks display
   identity (username/avatar) for every socket in the room,
   whether or not they ever touch a seat/guest frame. Regular
   viewers never receive this list — only the current host
   socket does, via "getParticipants" or the "participantsUpdated"
   push whenever the roster changes.
══════════════════════════════════════════════════════ */
function getParticipantsMap(room) {
  if (!room.participants) room.participants = new Map();
  return room.participants;
}
function getParticipantsList(room) {
  return Array.from(getParticipantsMap(room).values()).map(p => ({
    ...p,
    isHost: p.socketId === room.hostSocketId
  }));
}
function broadcastParticipants(io, room) {
  if (room.hostSocketId) {
    io.to(room.hostSocketId).emit("participantsUpdated", getParticipantsList(room));
  }
}

/* ══════════════════════════════════════════════════════
   GUEST SEATS (matchmaker male/female slots)
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
   MIC SEATS — now 12 numbered slots: 4 left wing, 4 right
   wing, 4 bottom row (client-side layout in live-mic-ring.js
   mirrors this exact distribution).
══════════════════════════════════════════════════════ */
const MIC_SEAT_COUNT = 12;

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

      // Host must be resolved from the DB's live_rooms.host_id, never
      // from "first socket to connect".
      const { rows: roomRows } = await db.query(
        `SELECT host_id FROM live_rooms WHERE id = $1`,
        [roomId]
      );
      const dbHostId = roomRows[0]?.host_id;
      const isActualHost = dbHostId != null && String(dbHostId) === String(userId);

      let becameHostJustNow = false;
      if (isActualHost && room.hostSocketId !== socket.id) {
        room.setHost(socket.id);
        becameHostJustNow = true;
        console.log(`[joinRoom] Host (re)assigned from DB truth: socket=${socket.id} user=${userId}`);
      } else if (!room.hostSocketId && !dbHostId) {
        room.setHost(socket.id);
        becameHostJustNow = true;
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

      // ── Roster tracking — identity info for the host-only
      // participants modal. Regular viewers never receive this;
      // they only learn who's around via the join comment below
      // and via occupied seats/guest frames.
      const brief = await getUserBrief(userId);
      getParticipantsMap(room).set(socket.id, {
        socketId: socket.id,
        userId,
        username:  brief?.username || brief?.display_name || null,
        avatarUrl: brief?.avatar_url || null,
        joinedAt:  Date.now()
      });
      broadcastParticipants(io, room);

      // ── Join announcement — the ONLY way a regular viewer learns
      // someone new is here (besides seeing them take a seat/guest
      // frame). Sent to everyone else already in the room.
      socket.to(`room:${roomId}`).emit("newComment", {
        roomId,
        system: true,
        text: `${brief?.username || brief?.display_name || "Someone"} joined the live`,
        timestamp: Date.now()
      });

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

      // Mic-seat snapshot (the 12 slots) — same idea.
      socket.emit("micSeatsUpdated", getMicSeats(room));

      // If this socket just became host, give them the roster right away.
      if (becameHostJustNow) broadcastParticipants(io, room);

      // Wait 150ms before sending existingProducers so the client has
      // time to load the mediasoup device first.
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
     PARTICIPANTS ROSTER (host-only)
     ------------------------------------------------------
     Returns everyone currently in the room — audience, seated,
     and guest-frame occupants alike. Only the verified host
     socket (room.hostSocketId === socket.id) may call this.
  ══════════════════════════════════════════════════════ */
  socket.on("getParticipants", ({ roomId }, callback) => {
    try {
      if (roomId !== socket.currentRoomId) throw new Error("Not a member of this room");
      const room = getRoom(roomId);
      if (!room) throw new Error("Room not found");
      if (room.hostSocketId !== socket.id) throw new Error("Only the host can view the participant list");

      callback?.({ ok: true, participants: getParticipantsList(room) });
    } catch (err) {
      callback?.({ error: err.message });
    }
  });

  /* ══════════════════════════════════════════════════════
     HOST: REMOVE ANY USER FROM THE ENTIRE ROOM
     ------------------------------------------------------
     Unlike hostKickSeat/hostKickGuest (which only free a seat or
     guest slot), this removes the target from the live room
     completely — audience member, seated speaker, or guest, it
     doesn't matter. Authority check is server-side only.
  ══════════════════════════════════════════════════════ */
  socket.on("hostKickUser", async ({ roomId, targetSocketId }, callback) => {
    try {
      if (roomId !== socket.currentRoomId) throw new Error("Not a member of this room");
      const room = getRoom(roomId);
      if (!room) throw new Error("Room not found");
      if (room.hostSocketId !== socket.id) throw new Error("Only the host can do that");
      if (!targetSocketId) throw new Error("Missing target");
      if (targetSocketId === socket.id) throw new Error("You can't remove yourself");

      const targetSocket = io.sockets.sockets.get(targetSocketId);

      // Free any seat/guest slot they held first, so everyone's
      // seat view updates immediately.
      if (clearMicSeatForSocket(room, targetSocketId)) broadcastMicSeats(io, roomId, room);
      if (clearGuestSeatsForSocket(room, targetSocketId)) broadcastGuestSeats(io, roomId, room);

      // Tell the target first so their client can tear down local
      // media/UI gracefully before we force-remove them.
      io.to(targetSocketId).emit("youWereKicked", { roomId });

      if (targetSocket) {
        targetSocket.leave(`room:${roomId}`);
      }

      getParticipantsMap(room).delete(targetSocketId);
      broadcastParticipants(io, room);

      const roomSockets = io.sockets.adapter.rooms.get(`room:${roomId}`);
      const viewerCount = roomSockets ? roomSockets.size : 0;
      await db.query(`UPDATE live_rooms SET viewer_count = $2 WHERE id = $1`, [roomId, viewerCount]);
      io.to(`room:${roomId}`).emit("viewerCountUpdated", { roomId, viewerCount });
      io.to(`room:${roomId}`).emit("peerLeft", { socketId: targetSocketId, userId: null });

      // Give the client a moment to receive "youWereKicked" and react
      // before we sever the connection outright.
      if (targetSocket) {
        setTimeout(() => {
          try { targetSocket.disconnect(true); } catch (e) {}
        }, 400);
      }

      callback?.({ ok: true });
    } catch (err) {
      callback?.({ error: err.message });
    }
  });

  /* ══════════════════════════════════════════════════════
     HOST CONTROLS — kick/mute a mic seat or guest seat.
  ══════════════════════════════════════════════════════ */
  socket.on("hostKickSeat", ({ roomId, seatIndex }, callback) => {
    try {
      if (roomId !== socket.currentRoomId) throw new Error("Not a member of this room");
      const room = getRoom(roomId);
      if (!room) throw new Error("Room not found");
      if (room.hostSocketId !== socket.id) throw new Error("Only the host can do that");
      if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= MIC_SEAT_COUNT) {
        throw new Error("Invalid seat");
      }

      const seats = getMicSeats(room);
      const occupant = seats[seatIndex];
      if (!occupant) throw new Error("Seat is already empty");

      seats[seatIndex] = null;
      broadcastMicSeats(io, roomId, room);
      io.to(occupant.socketId).emit("removedFromSeat", { roomId, seatIndex });

      callback?.({ ok: true });
    } catch (err) {
      callback?.({ error: err.message });
    }
  });

  socket.on("hostMuteSeat", ({ roomId, seatIndex }, callback) => {
    try {
      if (roomId !== socket.currentRoomId) throw new Error("Not a member of this room");
      const room = getRoom(roomId);
      if (!room) throw new Error("Room not found");
      if (room.hostSocketId !== socket.id) throw new Error("Only the host can do that");

      const seats = getMicSeats(room);
      const occupant = seats[seatIndex];
      if (!occupant) throw new Error("Seat is empty");

      occupant.mutedByHost = !occupant.mutedByHost;
      occupant.muted = occupant.mutedByHost ? true : false;

      broadcastMicSeats(io, roomId, room);
      io.to(occupant.socketId).emit("hostMutedYou", {
        roomId, seatIndex, muted: occupant.muted
      });

      callback?.({ ok: true, muted: occupant.muted });
    } catch (err) {
      callback?.({ error: err.message });
    }
  });

  socket.on("hostKickGuest", ({ roomId, slot }, callback) => {
    try {
      if (roomId !== socket.currentRoomId) throw new Error("Not a member of this room");
      if (slot !== "male" && slot !== "female") throw new Error("Invalid slot");
      const room = getRoom(roomId);
      if (!room) throw new Error("Room not found");
      if (room.hostSocketId !== socket.id) throw new Error("Only the host can do that");

      const seats = getGuestSeats(room);
      const occupant = seats[slot];
      if (!occupant) throw new Error("Seat is already empty");

      seats[slot] = null;
      broadcastGuestSeats(io, roomId, room);
      io.to(occupant.socketId).emit("removedFromSeat", { roomId, slot });

      callback?.({ ok: true });
    } catch (err) {
      callback?.({ error: err.message });
    }
  });

  socket.on("hostMuteGuest", ({ roomId, slot }, callback) => {
    try {
      if (roomId !== socket.currentRoomId) throw new Error("Not a member of this room");
      if (slot !== "male" && slot !== "female") throw new Error("Invalid slot");
      const room = getRoom(roomId);
      if (!room) throw new Error("Room not found");
      if (room.hostSocketId !== socket.id) throw new Error("Only the host can do that");

      const seats = getGuestSeats(room);
      const occupant = seats[slot];
      if (!occupant) throw new Error("Seat is empty");

      occupant.mutedByHost = !occupant.mutedByHost;
      occupant.muted = occupant.mutedByHost ? true : false;

      broadcastGuestSeats(io, roomId, room);
      io.to(occupant.socketId).emit("hostMutedYou", {
        roomId, slot, muted: occupant.muted
      });

      callback?.({ ok: true, muted: occupant.muted });
    } catch (err) {
      callback?.({ error: err.message });
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
     "sendGift" handler intentionally does not exist here — the
     gift broadcast is emitted exclusively from giftController.send()
     immediately after the gift transaction commits in the database.
  ══════════════════════════════════════════════════════ */

  /* ══════════════════════════════════════════════════════
     GUEST SEATS (matchmaker male/female slots)
  ══════════════════════════════════════════════════════ */
  socket.on("requestGuestSeat", async ({ roomId, slot }, callback) => {
    try {
      if (roomId !== socket.currentRoomId) throw new Error("Not a member of this room");
      if (slot !== "male" && slot !== "female") throw new Error("Invalid slot");
      const room = getRoom(roomId);
      if (!room) throw new Error("Room not found");

      const seats = getGuestSeats(room);
      clearGuestSeatsForSocket(room, socket.id); // hop between slots cleanly
      clearMicSeatForSocket(room, socket.id);    // can't hold a mic seat + guest slot at once

      if (seats[slot]) throw new Error("Seat already taken");

      const brief = await getUserBrief(socket.currentUserId);
      seats[slot] = {
        socketId:   socket.id,
        userId:     socket.currentUserId,
        username:   brief?.username || brief?.display_name || null,
        avatarUrl:  brief?.avatar_url || null,
        muted:      false,
        mutedByHost: false
      };
      broadcastGuestSeats(io, roomId, room);
      broadcastMicSeats(io, roomId, room);
      callback?.({ ok: true, slot });
    } catch (err) {
      callback?.({ error: err.message });
    }
  });

  socket.on("leaveGuestSeat", ({ roomId }, callback) => {
    if (roomId !== socket.currentRoomId) return callback?.({ error: "Not a member of this room" });
    const room = getRoom(roomId);
    if (!room) return callback?.({ error: "Room not found" });
    if (clearGuestSeatsForSocket(room, socket.id)) {
      broadcastGuestSeats(io, roomId, room);
    }
    callback?.({ ok: true });
  });

  socket.on("toggleGuestMic", ({ roomId, slot }, callback) => {
    try {
      if (roomId !== socket.currentRoomId) throw new Error("Not a member of this room");
      if (slot !== "male" && slot !== "female") throw new Error("Invalid slot");
      const room = getRoom(roomId);
      if (!room) throw new Error("Room not found");

      const seats = getGuestSeats(room);
      const occupant = seats[slot];
      if (!occupant || occupant.socketId !== socket.id) throw new Error("You are not in that seat");
      if (occupant.mutedByHost) throw new Error("You were muted by the host");

      occupant.muted = !occupant.muted;
      broadcastGuestSeats(io, roomId, room);
      callback?.({ ok: true, muted: occupant.muted });
    } catch (err) {
      callback?.({ error: err.message });
    }
  });

  /* ══════════════════════════════════════════════════════
     MIC SEATS (12 slots — 4 left wing, 4 right wing, 4 bottom row)
  ══════════════════════════════════════════════════════ */
  socket.on("requestMicSeat", async ({ roomId, seatIndex }, callback) => {
    try {
      if (roomId !== socket.currentRoomId) throw new Error("Not a member of this room");
      if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= MIC_SEAT_COUNT) {
        throw new Error("Invalid seat");
      }
      const room = getRoom(roomId);
      if (!room) throw new Error("Room not found");

      const seats = getMicSeats(room);
      clearMicSeatForSocket(room, socket.id); // hop between seats cleanly
      clearGuestSeatsForSocket(room, socket.id); // can't hold both at once

      if (seats[seatIndex]) throw new Error("Seat already taken");

      const brief = await getUserBrief(socket.currentUserId);
      seats[seatIndex] = {
        socketId:   socket.id,
        userId:     socket.currentUserId,
        username:   brief?.username || brief?.display_name || null,
        avatarUrl:  brief?.avatar_url || null,
        muted:      false,
        mutedByHost: false
      };
      broadcastMicSeats(io, roomId, room);
      broadcastGuestSeats(io, roomId, room);
      callback?.({ ok: true, seatIndex });
    } catch (err) {
      callback?.({ error: err.message });
    }
  });

  socket.on("leaveMicSeat", ({ roomId }, callback) => {
    if (roomId !== socket.currentRoomId) return callback?.({ error: "Not a member of this room" });
    const room = getRoom(roomId);
    if (!room) return callback?.({ error: "Room not found" });
    if (clearMicSeatForSocket(room, socket.id)) {
      broadcastMicSeats(io, roomId, room);
    }
    callback?.({ ok: true });
  });

  socket.on("toggleSeatMic", ({ roomId, seatIndex }, callback) => {
    try {
      if (roomId !== socket.currentRoomId) throw new Error("Not a member of this room");
      const room = getRoom(roomId);
      if (!room) throw new Error("Room not found");

      const seats = getMicSeats(room);
      const occupant = seats[seatIndex];
      if (!occupant || occupant.socketId !== socket.id) throw new Error("You are not in that seat");
      if (occupant.mutedByHost) throw new Error("You were muted by the host");

      occupant.muted = !occupant.muted;
      broadcastMicSeats(io, roomId, room);
      callback?.({ ok: true, muted: occupant.muted });
    } catch (err) {
      callback?.({ error: err.message });
    }
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

      // Free any guest seat this socket held, and tell everyone.
      if (clearGuestSeatsForSocket(room, socket.id)) {
        io.to(`room:${roomId}`).emit("guestSeatsUpdated", getGuestSeats(room));
      }

      // Same cleanup for mic seats.
      if (clearMicSeatForSocket(room, socket.id)) {
        io.to(`room:${roomId}`).emit("micSeatsUpdated", getMicSeats(room));
      }

      // Remove from the roster and let the host's modal (if open) update.
      getParticipantsMap(room).delete(socket.id);
      broadcastParticipants(io, room);

      if (wasHost) {
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