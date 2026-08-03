// backend/src/sockets/stream.socket.js
//
// ═══════════════════════════════════════════════════════════════
//   THIS PASS — HLS EGRESS WIRING
// ═══════════════════════════════════════════════════════════════
//   liveEgressManager (mediasoup -> FFmpeg -> RTMP -> HLS) is now
//   actually invoked from this file, which previously imported
//   nothing from it. Three additive hooks, nothing else changed:
//
//     1. "produce" handler — once BOTH the host's video and audio
//        producers exist, liveEgressManager.startEgress() is fired
//        (fire-and-forget, .catch()'d) so GET /live/:id can start
//        returning a real hlsUrl to plain viewers.
//     2. "liveEnded" handler — liveEgressManager.stopEgress() is
//        awaited before closeRoom(roomId), so the ffmpeg child and
//        PlainTransports are cleaned up when the host explicitly
//        ends the stream.
//     3. _handlePeerLeave()'s `if (wasHost)` block — the same
//        stopEgress() call fires when the host disconnects/leaves
//        without clicking "End Live", so egress doesn't keep
//        running (and doesn't keep an ffmpeg process alive) against
//        a room nobody is hosting anymore.
//
//   Everything else in this file — presence system, mediasoup
//   transports/producers/consumers, host-only participants roster,
//   seat/guest mute-vs-leave split — is UNCHANGED from the previous
//   pass.
// ═══════════════════════════════════════════════════════════════

const db = require("../config/db");
const { createRoom, getRoom, closeRoom } = require("../mediasoup/room");
const { createRouter } = require("../mediasoup/router");
const presenceService = require("../services/presenceService");
const liveEgressManager = require("../mediasoup/liveEgressManager");

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

async function getUserPrivacy(userId) {
  try {
    const { rows } = await db.query(
      `SELECT allow_followers_see_live, allow_followers_join_room, hide_viewing_activity
       FROM users WHERE id = $1`,
      [userId]
    );
    return rows[0] || {};
  } catch (err) {
    console.error("[getUserPrivacy] ❌", err);
    return {};
  }
}

function getHostUserId(room) {
  if (!room?.hostSocketId) return null;
  const info = room.peers.get(room.hostSocketId);
  return info?.userId || null;
}

/* ══════════════════════════════════════════════════════
   PRESENCE BROADCAST — pushes a presence change to every
   follower of `userId`, respecting that user's own privacy
   settings. Followers receive it only if they're currently
   connected (joined their personal `user:{id}` room via
   "registerUser").
══════════════════════════════════════════════════════ */
async function broadcastPresenceToFollowers(io, userId, presencePayload) {
  try {
    const privacy = await getUserPrivacy(userId);
    const isHostingSelf = presencePayload.status === "HOSTING_LIVE";

    let outPayload = { ...presencePayload };

    if (!isHostingSelf && (privacy.allow_followers_see_live === false || privacy.hide_viewing_activity)) {
      outPayload = {
        userId,
        status: presencePayload.status === "OFFLINE" ? "OFFLINE" : "ONLINE",
        currentRoomId: null,
        hostId: null,
        hostName: null
      };
    } else if (!isHostingSelf && privacy.allow_followers_join_room === false) {
      outPayload = { ...outPayload, currentRoomId: null };
    }

    const { rows } = await db.query(
      `SELECT follower_id FROM follows WHERE following_id = $1`,
      [userId]
    );
    for (const row of rows) {
      io.to(`user:${row.follower_id}`).emit("presenceUpdated", outPayload);
    }
  } catch (err) {
    console.error("[broadcastPresenceToFollowers] ❌", err);
  }
}

async function resolveHostName(hostUserId) {
  if (!hostUserId) return null;
  const brief = await getUserBrief(hostUserId);
  return brief?.display_name || brief?.username || null;
}

/* ══════════════════════════════════════════════════════
   PENDING-OFFLINE GRACE TIMERS — module scope so they persist
   across all connections (this file is require()'d once).
══════════════════════════════════════════════════════ */
const pendingOfflineTimers = new Map(); // userId -> timeout handle
const OFFLINE_GRACE_MS = 8000;

function cancelPendingOffline(userId) {
  if (!userId) return;
  if (pendingOfflineTimers.has(userId)) {
    clearTimeout(pendingOfflineTimers.get(userId));
    pendingOfflineTimers.delete(userId);
  }
}

/* ══════════════════════════════════════════════════════
   ROOM PARTICIPANTS ROSTER — host-only visibility
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
   MIC SEATS — 12 numbered slots: 4 left wing, 4 right
   wing, 4 bottom row.
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
     JOIN ROOM  (aliased as "joinLiveRoom" per spec)
  ══════════════════════════════════════════════════════ */
  async function handleJoinRoom({ roomId, userId }) {
    try {
      console.log(`[joinRoom] socket=${socket.id} room=${roomId} user=${userId}`);

      socket.join(`room:${roomId}`);
      socket.currentRoomId = roomId;
      socket.currentUserId = userId;
      cancelPendingOffline(userId);

      let room = getRoom(roomId);
      if (!room) room = createRoom(roomId);

      if (!room.router) {
        const router = await createRouter(roomId);
        room.router = router;
        console.log(`[joinRoom] Router created for room=${roomId}`);
      }

      room.addPeer(socket.id, userId);

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

      // ── Follow-to-live-room presence state ──
      const presenceStatus = isActualHost ? "HOSTING_LIVE" : "WATCHING_LIVE";
      const hostName = isActualHost ? null : await resolveHostName(dbHostId);
      const presencePayload = await presenceService.setPresence(userId, {
        status: presenceStatus,
        currentRoomId: roomId,
        hostId: dbHostId || userId,
        hostName,
        socketId: socket.id
      });
      broadcastPresenceToFollowers(io, userId, presencePayload).catch(() => {});

      // Viewer count
      const roomSockets = io.sockets.adapter.rooms.get(`room:${roomId}`);
      const viewerCount = roomSockets ? roomSockets.size : 0;
      await db.query(`UPDATE live_rooms SET viewer_count = $2 WHERE id = $1`, [roomId, viewerCount]);
      io.to(`room:${roomId}`).emit("viewerCountUpdated", { roomId, viewerCount });

      // ── Roster tracking — identity info for the host-only
      // participants modal.
      const brief = await getUserBrief(userId);
      getParticipantsMap(room).set(socket.id, {
        socketId: socket.id,
        userId,
        username:  brief?.username || brief?.display_name || null,
        avatarUrl: brief?.avatar_url || null,
        joinedAt:  Date.now()
      });
      broadcastParticipants(io, room);

      // ── Join announcement
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
  isHost:   peerSocketId === room.hostSocketId,
  appData:  producer.appData || null
});
        }
      }

      console.log(`[joinRoom] Sending routerRtpCapabilities to socket=${socket.id}`);
      socket.emit("routerRtpCapabilities", {
        rtpCapabilities: room.router.rtpCapabilities
      });

      socket.emit("guestSeatsUpdated", getGuestSeats(room));
      socket.emit("micSeatsUpdated", getMicSeats(room));

      if (becameHostJustNow) broadcastParticipants(io, room);

      if (existingProducers.length > 0) {
        console.log(`[joinRoom] Scheduling existingProducers (${existingProducers.length}) with 150ms delay`);
        setTimeout(() => {
          if (socket.connected) {
            console.log(`[joinRoom] Emitting existingProducers to socket=${socket.id}`);
            socket.emit("existingProducers", existingProducers);
          }
        }, 150);
      }

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
  }

  socket.on("joinRoom", handleJoinRoom);
  socket.on("joinLiveRoom", handleJoinRoom); // spec alias

  /* ══════════════════════════════════════════════════════
     START LIVE — explicit presence flip to HOSTING_LIVE,
     callable the moment a room is created (before the host's
     live.html even finishes loading mediasoup), so followers
     get notified as early as possible.
  ══════════════════════════════════════════════════════ */
  socket.on("startLive", async ({ roomId, userId }, callback) => {
    try {
      cancelPendingOffline(userId);
      const presencePayload = await presenceService.setPresence(userId, {
        status: "HOSTING_LIVE",
        currentRoomId: roomId,
        hostId: userId,
        hostName: null,
        socketId: socket.id
      });
      await broadcastPresenceToFollowers(io, userId, presencePayload);
      callback?.({ ok: true });
    } catch (err) {
      console.error("[startLive] ❌", err);
      callback?.({ error: err.message });
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
      const targetInfo = room.peers.get(targetSocketId);
      const targetUserId = targetInfo?.userId || null;

      if (clearMicSeatForSocket(room, targetSocketId)) broadcastMicSeats(io, roomId, room);
      if (clearGuestSeatsForSocket(room, targetSocketId)) broadcastGuestSeats(io, roomId, room);

      io.to(targetSocketId).emit("youWereKicked", { roomId });

      if (targetSocket) {
        targetSocket.leave(`room:${roomId}`);
      }

      getParticipantsMap(room).delete(targetSocketId);
      broadcastParticipants(io, room);

      if (targetUserId) {
        const presencePayload = await presenceService.setPresence(targetUserId, {
          status: "ONLINE", currentRoomId: null, hostId: null, socketId: targetSocketId
        });
        broadcastPresenceToFollowers(io, targetUserId, presencePayload).catch(() => {});
      }

      const roomSockets = io.sockets.adapter.rooms.get(`room:${roomId}`);
      const viewerCount = roomSockets ? roomSockets.size : 0;
      await db.query(`UPDATE live_rooms SET viewer_count = $2 WHERE id = $1`, [roomId, viewerCount]);
      io.to(`room:${roomId}`).emit("viewerCountUpdated", { roomId, viewerCount });
      io.to(`room:${roomId}`).emit("peerLeft", { socketId: targetSocketId, userId: null });

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
  socket.on("hostKickSeat", async ({ roomId, seatIndex }, callback) => {
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

      if (occupant.userId) {
        const hostUserId = getHostUserId(room);
        const hostName = await resolveHostName(hostUserId);
        const presencePayload = await presenceService.setPresence(occupant.userId, {
          status: "WATCHING_LIVE", currentRoomId: roomId, hostId: hostUserId, hostName, socketId: occupant.socketId
        });
        broadcastPresenceToFollowers(io, occupant.userId, presencePayload).catch(() => {});
      }

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

  socket.on("hostKickGuest", async ({ roomId, slot }, callback) => {
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

      if (occupant.userId) {
        const hostUserId = getHostUserId(room);
        const hostName = await resolveHostName(hostUserId);
        const presencePayload = await presenceService.setPresence(occupant.userId, {
          status: "WATCHING_LIVE", currentRoomId: roomId, hostId: hostUserId, hostName, socketId: occupant.socketId
        });
        broadcastPresenceToFollowers(io, occupant.userId, presencePayload).catch(() => {});
      }

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

      // ── HLS EGRESS: once the host has BOTH a video and audio
      // producer live, start (or reuse) the mediasoup -> FFmpeg ->
      // RTMP -> HLS pipeline for this room. Fire-and-forget: this
      // must never block or fail the produce() callback for the
      // host's own publish, so failures are only logged.
      if (isHost) {
        const hostVideoProducer = [...room.producers.values()]
          .find(p => p.appData?.socketId === room.hostSocketId && p.kind === "video" && !p.closed);
        const hostAudioProducer = [...room.producers.values()]
          .find(p => p.appData?.socketId === room.hostSocketId && p.kind === "audio" && !p.closed);

        if (hostVideoProducer && hostAudioProducer) {
          liveEgressManager.startEgress({
            roomId: socket.currentRoomId,
            router: room.router,
            videoProducer: hostVideoProducer,
            audioProducer: hostAudioProducer,
            streamKey: socket.currentRoomId
          }).then(info => {
            if (info) console.log(`[produce] Egress started/confirmed for room=${socket.currentRoomId} -> ${info.hlsUrl}`);
          }).catch(err => console.error("[produce] egress start failed:", err.message));
        }
      }

      producer.on("score", (scores) => {
        socket.emit("producerScore", { producerId: producer.id, scores });
      });

      producer.observer.once("close", () => {
        room.producers.delete(producer.id);
        console.log(`[produce] Producer closed: ${producer.id}`);
      });

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
     GUEST SEATS (matchmaker male/female slots) -> GUEST_SEAT
  ══════════════════════════════════════════════════════ */
  socket.on("requestGuestSeat", async ({ roomId, slot }, callback) => {
    try {
      if (roomId !== socket.currentRoomId) throw new Error("Not a member of this room");
      if (slot !== "male" && slot !== "female") throw new Error("Invalid slot");
      const room = getRoom(roomId);
      if (!room) throw new Error("Room not found");

      const seats = getGuestSeats(room);
      clearGuestSeatsForSocket(room, socket.id);
      clearMicSeatForSocket(room, socket.id);

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

      const hostUserId = getHostUserId(room);
      const hostName = await resolveHostName(hostUserId);
      const presencePayload = await presenceService.setPresence(socket.currentUserId, {
        status: "GUEST_SEAT", currentRoomId: roomId, hostId: hostUserId, hostName, socketId: socket.id
      });
      broadcastPresenceToFollowers(io, socket.currentUserId, presencePayload).catch(() => {});

      callback?.({ ok: true, slot });
    } catch (err) {
      callback?.({ error: err.message });
    }
  });

  socket.on("leaveGuestSeat", async ({ roomId }, callback) => {
    try {
      if (roomId !== socket.currentRoomId) throw new Error("Not a member of this room");
      const room = getRoom(roomId);
      if (!room) throw new Error("Room not found");

      if (clearGuestSeatsForSocket(room, socket.id)) {
        broadcastGuestSeats(io, roomId, room);

        const hostUserId = getHostUserId(room);
        const hostName = await resolveHostName(hostUserId);
        const presencePayload = await presenceService.setPresence(socket.currentUserId, {
          status: "WATCHING_LIVE", currentRoomId: roomId, hostId: hostUserId, hostName, socketId: socket.id
        });
        broadcastPresenceToFollowers(io, socket.currentUserId, presencePayload).catch(() => {});
      }
      callback?.({ ok: true });
    } catch (err) {
      callback?.({ error: err.message });
    }
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
     MIC SEATS (12 slots) -> CO_HOST
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
      clearMicSeatForSocket(room, socket.id);
      clearGuestSeatsForSocket(room, socket.id);

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

      const hostUserId = getHostUserId(room);
      const hostName = await resolveHostName(hostUserId);
      const presencePayload = await presenceService.setPresence(socket.currentUserId, {
        status: "CO_HOST", currentRoomId: roomId, hostId: hostUserId, hostName, socketId: socket.id
      });
      broadcastPresenceToFollowers(io, socket.currentUserId, presencePayload).catch(() => {});

      callback?.({ ok: true, seatIndex });
    } catch (err) {
      callback?.({ error: err.message });
    }
  });

  socket.on("leaveMicSeat", async ({ roomId }, callback) => {
    try {
      if (roomId !== socket.currentRoomId) throw new Error("Not a member of this room");
      const room = getRoom(roomId);
      if (!room) throw new Error("Room not found");

      if (clearMicSeatForSocket(room, socket.id)) {
        broadcastMicSeats(io, roomId, room);

        const hostUserId = getHostUserId(room);
        const hostName = await resolveHostName(hostUserId);
        const presencePayload = await presenceService.setPresence(socket.currentUserId, {
          status: "WATCHING_LIVE", currentRoomId: roomId, hostId: hostUserId, hostName, socketId: socket.id
        });
        broadcastPresenceToFollowers(io, socket.currentUserId, presencePayload).catch(() => {});
      }
      callback?.({ ok: true });
    } catch (err) {
      callback?.({ error: err.message });
    }
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
     LIVE ENDED — every connected participant's presence
     resets to ONLINE and their followers are notified. Also
     stops the HLS egress pipeline (ffmpeg + PlainTransports)
     for this room, since the host explicitly ended the live.
  ══════════════════════════════════════════════════════ */
  socket.on("liveEnded", async ({ roomId }) => {
    try {
      const room = getRoom(roomId);

      io.to(`room:${roomId}`).emit("liveEnded", { roomId });

      if (room) {
        const affectedUserIds = [];
        for (const [, peerInfo] of room.peers) {
          if (peerInfo.userId) affectedUserIds.push(peerInfo.userId);
        }
        for (const uid of affectedUserIds) {
          const presencePayload = await presenceService.setPresence(uid, {
            status: "ONLINE", currentRoomId: null, hostId: null
          });
          broadcastPresenceToFollowers(io, uid, presencePayload).catch(() => {});
        }
      }

      await liveEgressManager.stopEgress(roomId).catch(() => {});

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
     LEAVE ROOM  (aliased as "leaveLive" per spec)
  ══════════════════════════════════════════════════════ */
  async function handleLeaveRoom({ roomId }) {
    try {
      socket.leave(`room:${roomId}`);
      await _handlePeerLeave(io, socket, roomId, { isFullDisconnect: false });
    } catch (err) {
      console.error("[leaveRoom] ❌", err);
    }
  }

  socket.on("leaveRoom", handleLeaveRoom);
  socket.on("leaveLive", handleLeaveRoom); // spec alias

  /* ══════════════════════════════════════════════════════
     REGISTER USER — joins the personal notification room used
     for presenceUpdated broadcasts, and defaults presence to
     ONLINE if nothing richer is already tracked. Also cancels
     any pending OFFLINE grace timer from a recent disconnect.
  ══════════════════════════════════════════════════════ */
  socket.on("registerUser", async (userId) => {
    if (!userId) return;
    socket.join(`user:${userId}`);
    socket.currentUserId = socket.currentUserId || userId;
    console.log(`[registerUser] userId=${userId} socket=${socket.id}`);

    cancelPendingOffline(userId);

    try {
      const existing = await presenceService.getPresence(userId);
      if (!existing.currentRoomId) {
        const payload = await presenceService.setPresence(userId, { status: "ONLINE", socketId: socket.id });
        broadcastPresenceToFollowers(io, userId, payload).catch(() => {});
      }
    } catch (err) {
      console.error("[registerUser] presence init failed:", err.message);
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
        await _handlePeerLeave(io, socket, currentRoomId, { isFullDisconnect: true });
      } else if (currentUserId) {
        // Not in a room, just dropped the socket entirely.
        const timer = setTimeout(async () => {
          pendingOfflineTimers.delete(currentUserId);
          const payload = await presenceService.setOffline(currentUserId);
          broadcastPresenceToFollowers(io, currentUserId, payload).catch(() => {});
        }, OFFLINE_GRACE_MS);
        pendingOfflineTimers.set(currentUserId, timer);
      }

      const { removeSocketTransports } = require("../mediasoup/transport");
      removeSocketTransports(socket.id);
    } catch (err) {
      console.error("[disconnect] ❌", err);
    }
  });

  /* ══════════════════════════════════════════════════════
     INTERNAL: PEER LEAVE CLEANUP
     - isFullDisconnect=false (explicit "leaveRoom"/"leaveLive"):
       user is still connected, just left the room -> ONLINE now.
     - isFullDisconnect=true (socket dropped): grace-period timer
       before flipping to OFFLINE, so quick reconnects don't flicker.
     - If the LEAVING peer was the host, the HLS egress pipeline is
       stopped too (mirrors the explicit "liveEnded" stopEgress
       call) — a host disconnecting/refreshing without clicking
       "End Live" should not leave ffmpeg running against a room
       nobody is hosting.
  ══════════════════════════════════════════════════════ */
  async function _handlePeerLeave(io, socket, roomId, { isFullDisconnect = false } = {}) {
    const room = getRoom(roomId);
    if (room) {
      const wasHost = room.hostSocketId === socket.id;
      room.removePeer(socket.id);

      if (clearGuestSeatsForSocket(room, socket.id)) {
        io.to(`room:${roomId}`).emit("guestSeatsUpdated", getGuestSeats(room));
      }

      if (clearMicSeatForSocket(room, socket.id)) {
        io.to(`room:${roomId}`).emit("micSeatsUpdated", getMicSeats(room));
      }

      getParticipantsMap(room).delete(socket.id);
      broadcastParticipants(io, room);

      if (wasHost) {
        room.hostSocketId = null;
        io.to(`room:${roomId}`).emit("hostLeft", { roomId });

        liveEgressManager.stopEgress(roomId).catch(() => {});
      }
    }

    const userId = socket.currentUserId;
    if (userId) {
      if (isFullDisconnect) {
        const timer = setTimeout(async () => {
          pendingOfflineTimers.delete(userId);
          const payload = await presenceService.setOffline(userId);
          broadcastPresenceToFollowers(io, userId, payload).catch(() => {});
        }, OFFLINE_GRACE_MS);
        pendingOfflineTimers.set(userId, timer);
      } else {
        const payload = await presenceService.setPresence(userId, {
          status: "ONLINE", currentRoomId: null, hostId: null, socketId: socket.id
        });
        broadcastPresenceToFollowers(io, userId, payload).catch(() => {});
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