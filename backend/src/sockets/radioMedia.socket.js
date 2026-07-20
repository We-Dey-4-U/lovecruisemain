// backend/src/sockets/radioMedia.socket.js
//
// Real-time audio transport for Radio Studio rooms, built on the
// exact same mediasoup primitives that already power live.html
// (see stream.socket.js — createRoom/getRoom/closeRoom, createRouter,
// createSendTransport/createRecvTransport/removeSocketTransports).
// Radio media rooms are kept in their own namespace
// (`radio:${broadcastId}`) so they never collide with live-video
// room ids in the same in-memory room map.
//
// This is what was missing end-to-end: radioController.js was
// handing every listener a hardcoded public test HLS URL
// (test-streams.mux.dev) instead of actually capturing and routing
// the host's mic. This file is the real pipeline:
//
//   1. Client emits "radioJoinMedia" right after "joinRadio" — this
//      creates/reuses a router for the broadcast and returns its
//      rtpCapabilities + any producers already live, so someone who
//      joins mid-show immediately hears what's already playing.
//   2. The host (and any approved co-host/guest) creates a send
//      transport and calls "radioProduce" with their mic track.
//   3. Every participant (host, guests, listeners) creates a recv
//      transport and "radioConsume"s every producer that isn't
//      their own — this is how the host's voice, and any live
//      guest's voice, actually reaches every listener's speakers.
//   4. "radioStopProducing" / disconnect / leaveRadio / radioEnded
//      close a user's producer(s) and tell the room so consumers
//      clean up their tracks.
//
// Wire this into your socket bootstrap alongside radio.socket.js
// (see sockets/index.js below) — it relies on socket.currentUserId
// already being set by radio.socket.js's "joinRadio" handler, which
// fires first because the client emits joinRadio then radioJoinMedia
// in that order on the same socket (socket.io preserves per-socket
// event ordering).

const db = require("../config/db");
const { createRoom, getRoom, closeRoom } = require("../mediasoup/room");
const { createRouter } = require("../mediasoup/router");
const {
  createSendTransport,
  createRecvTransport,
  removeSocketTransports
} = require("../mediasoup/transport");

function mediaRoomId(broadcastId) {
  return `radio:${broadcastId}`;
}

async function getBroadcastHostId(broadcastId) {
  const { rows } = await db.query(
    `SELECT host_id FROM radio_broadcasts WHERE id = $1`,
    [broadcastId]
  );
  return rows[0]?.host_id || null;
}

async function isApprovedCohost(broadcastId, userId) {
  if (!userId) return false;
  const { rows } = await db.query(
    `SELECT 1 FROM radio_cohosts WHERE broadcast_id = $1 AND user_id = $2 AND status = 'approved'`,
    [broadcastId, userId]
  );
  return !!rows.length;
}

async function assertCanProduceAudio(broadcastId, userId) {
  if (!userId) throw new Error("You're not signed in to this session — refresh and try again");
  const hostId = await getBroadcastHostId(broadcastId);
  if (!hostId) throw new Error("Broadcast not found");
  if (String(hostId) === String(userId)) return { isHost: true };
  if (await isApprovedCohost(broadcastId, userId)) return { isHost: false };
  throw new Error("Only the host or an approved guest can go live on mic");
}

function listExistingProducers(room, excludeSocketId) {
  const list = [];
  for (const [producerId, producer] of room.producers) {
    if (producer.closed) continue;
    const socketId = producer.appData?.socketId;
    if (excludeSocketId && socketId === excludeSocketId) continue;
    list.push({
      producerId,
      socketId,
      userId: producer.appData?.userId || null,
      isHost: !!producer.appData?.isHost
    });
  }
  return list;
}

module.exports = (io, socket) => {

  /* ══════════════════════════════════════════════════════
     JOIN MEDIA — creates/reuses the room's mediasoup router and
     hands back its RTP capabilities + whatever's already live.
  ══════════════════════════════════════════════════════ */
  socket.on("radioJoinMedia", async ({ broadcastId }, callback) => {
    try {
      if (!broadcastId) throw new Error("broadcastId is required");
      const roomId = mediaRoomId(broadcastId);
      socket.currentRadioMediaRoomId = roomId;
      socket.currentBroadcastId = broadcastId;

      let room = getRoom(roomId);
      if (!room) room = createRoom(roomId);
      if (!room.router) {
        room.router = await createRouter(roomId);
        console.log(`[radioJoinMedia] Router created for ${roomId}`);
      }

      room.addPeer(socket.id, socket.currentUserId);

      const existingProducers = listExistingProducers(room, socket.id);

      callback?.({
        ok: true,
        rtpCapabilities: room.router.rtpCapabilities,
        existingProducers
      });
    } catch (err) {
      console.error("[radioJoinMedia] ❌", err);
      callback?.({ error: err.message });
    }
  });

  /* ══════════════════════════════════════════════════════
     TRANSPORTS
  ══════════════════════════════════════════════════════ */
  socket.on("radioCreateSendTransport", async ({ broadcastId }, callback) => {
    try {
      const roomId = mediaRoomId(broadcastId);
      const room = getRoom(roomId);
      if (!room?.router) throw new Error("Media room not ready");

      const transport = await createSendTransport(socket.id, roomId);
      room.transports.set(`${socket.id}:radiosend`, transport);

      callback?.({
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters
      });
    } catch (err) {
      console.error("[radioCreateSendTransport] ❌", err);
      callback?.({ error: err.message });
    }
  });

  socket.on("radioCreateRecvTransport", async ({ broadcastId }, callback) => {
    try {
      const roomId = mediaRoomId(broadcastId);
      const room = getRoom(roomId);
      if (!room?.router) throw new Error("Media room not ready");

      const transport = await createRecvTransport(socket.id, roomId);
      room.transports.set(`${socket.id}:radiorecv`, transport);

      callback?.({
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters
      });
    } catch (err) {
      console.error("[radioCreateRecvTransport] ❌", err);
      callback?.({ error: err.message });
    }
  });

  socket.on("radioConnectTransport", async ({ broadcastId, transportId, dtlsParameters }, callback) => {
    try {
      const roomId = mediaRoomId(broadcastId);
      const room = getRoom(roomId);
      if (!room) throw new Error("Media room not found");

      let transport = null;
      for (const [, t] of room.transports) {
        if (t?.id === transportId) { transport = t; break; }
      }
      if (!transport) throw new Error(`Transport ${transportId} not found`);

      await transport.connect({ dtlsParameters });
      callback?.({ connected: true });
    } catch (err) {
      console.error("[radioConnectTransport] ❌", err);
      callback?.({ error: err.message });
    }
  });

  /* ══════════════════════════════════════════════════════
     PRODUCE — host or an approved guest goes live on mic.
  ══════════════════════════════════════════════════════ */
  socket.on("radioProduce", async ({ broadcastId, transportId, kind, rtpParameters }, callback) => {
    try {
      if (kind !== "audio") throw new Error("Radio only supports audio");
      const { isHost } = await assertCanProduceAudio(broadcastId, socket.currentUserId);

      const roomId = mediaRoomId(broadcastId);
      const room = getRoom(roomId);
      if (!room) throw new Error("Media room not found");

      let transport = null;
      for (const [, t] of room.transports) {
        if (t?.id === transportId) { transport = t; break; }
      }
      if (!transport) throw new Error(`Transport ${transportId} not found`);

      // A user only ever has one live mic producer at a time — close
      // any previous one (e.g. rejoining/reconnecting) first.
      for (const [pid, p] of room.producers) {
        if (p.appData?.socketId === socket.id && !p.closed) {
          p.close();
          room.producers.delete(pid);
        }
      }

      const producer = await transport.produce({
        kind,
        rtpParameters,
        appData: { socketId: socket.id, userId: socket.currentUserId, broadcastId, isHost }
      });

      room.producers.set(producer.id, producer);

      producer.observer.once("close", () => {
        room.producers.delete(producer.id);
        io.to(`radio:${broadcastId}`).emit("radioProducerClosed", {
          broadcastId, producerId: producer.id, socketId: socket.id
        });
      });

      socket.to(`radio:${broadcastId}`).emit("radioNewProducer", {
        broadcastId,
        producerId: producer.id,
        socketId: socket.id,
        userId: socket.currentUserId,
        isHost
      });

      console.log(`[radioProduce] ✅ broadcast=${broadcastId} producer=${producer.id} isHost=${isHost}`);
      callback?.({ producerId: producer.id });
    } catch (err) {
      console.error("[radioProduce] ❌", err);
      callback?.({ error: err.message });
    }
  });

  socket.on("radioStopProducing", async ({ broadcastId }, callback) => {
    try {
      const roomId = mediaRoomId(broadcastId);
      const room = getRoom(roomId);
      if (!room) return callback?.({ ok: true });

      for (const [pid, p] of room.producers) {
        if (p.appData?.socketId === socket.id && !p.closed) {
          p.close();
          room.producers.delete(pid);
          io.to(`radio:${broadcastId}`).emit("radioProducerClosed", {
            broadcastId, producerId: pid, socketId: socket.id
          });
        }
      }
      callback?.({ ok: true });
    } catch (err) {
      callback?.({ error: err.message });
    }
  });

  // Host mutes/unmutes a guest's mic at the transport level —
  // pausing the actual mediasoup producer stops audio leaving the
  // server, not just a UI flag in the DB.
  socket.on("radioSetProducerPaused", async ({ broadcastId, targetUserId, paused, userId }, callback) => {
    try {
      const hostId = await getBroadcastHostId(broadcastId);
      const callerId = socket.currentUserId || userId;
      if (String(hostId) !== String(callerId)) throw new Error("Only the host can do that");

      const roomId = mediaRoomId(broadcastId);
      const room = getRoom(roomId);
      if (!room) return callback?.({ ok: true });

      for (const [, p] of room.producers) {
        if (String(p.appData?.userId) === String(targetUserId) && !p.closed) {
          if (paused) await p.pause(); else await p.resume();
        }
      }
      callback?.({ ok: true });
    } catch (err) {
      callback?.({ error: err.message });
    }
  });

  /* ══════════════════════════════════════════════════════
     CONSUME
  ══════════════════════════════════════════════════════ */
  socket.on("radioConsume", async ({ broadcastId, transportId, producerId, rtpCapabilities }, callback) => {
    try {
      const roomId = mediaRoomId(broadcastId);
      const room = getRoom(roomId);
      if (!room?.router) throw new Error("Media room not found");

      const producer = room.producers.get(producerId);
      if (!producer || producer.closed) throw new Error("Producer not found or closed");

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
        appData: { socketId: socket.id, broadcastId }
      });

      room.consumers.set(consumer.id, consumer);
      consumer.observer.once("close", () => room.consumers.delete(consumer.id));

      callback?.({
        id: consumer.id,
        producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
        producerSocketId: producer.appData?.socketId,
        producerUserId: producer.appData?.userId || null,
        isHost: !!producer.appData?.isHost
      });
    } catch (err) {
      console.error("[radioConsume] ❌", err);
      callback?.({ error: err.message });
    }
  });

  socket.on("radioResumeConsumer", async ({ broadcastId, consumerId }, callback) => {
    try {
      const roomId = mediaRoomId(broadcastId);
      const room = getRoom(roomId);
      const consumer = room?.consumers.get(consumerId);
      if (!consumer) throw new Error("Consumer not found");
      await consumer.resume();
      callback?.({ resumed: true });
    } catch (err) {
      callback?.({ error: err.message });
    }
  });

  /* ══════════════════════════════════════════════════════
     CLEANUP — producer(s) closed + transports removed whenever
     this socket leaves the broadcast, the broadcast ends, or the
     socket disconnects outright.
  ══════════════════════════════════════════════════════ */
  function cleanupRadioMedia() {
    const roomId = socket.currentRadioMediaRoomId;
    const broadcastId = socket.currentBroadcastId;
    if (!roomId) return;

    const room = getRoom(roomId);
    if (room) {
      for (const [pid, p] of room.producers) {
        if (p.appData?.socketId === socket.id && !p.closed) {
          p.close();
          room.producers.delete(pid);
          if (broadcastId) {
            io.to(`radio:${broadcastId}`).emit("radioProducerClosed", {
              broadcastId, producerId: pid, socketId: socket.id
            });
          }
        }
      }
      room.removePeer?.(socket.id);

      if (room.producers.size === 0 && (!room.peers || room.peers.size === 0)) {
        closeRoom(roomId);
      }
    }

    removeSocketTransports(socket.id);
    socket.currentRadioMediaRoomId = null;
  }

  socket.on("leaveRadio", cleanupRadioMedia);
  socket.on("radioEnded", cleanupRadioMedia);
  socket.on("disconnect", cleanupRadioMedia);
};