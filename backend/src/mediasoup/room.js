// backend/src/mediasoup/room.js
// Premium LiveRoom — SFU with simulcast, VP9/H264, send+recv transports

const { createSendTransport, createRecvTransport } = require("./transport");
const { createRouter } = require("./router");

const rooms = new Map();

class LiveRoom {
  constructor(roomId) {
    this.roomId = roomId;
    this.router = null;
    this.hostSocketId = null;

    // socketId → { send: transport, recv: transport }
    this.transports = new Map();

    // producerId → producer
    this.producers = new Map();

    // consumerId → consumer
    this.consumers = new Map();

    // socketId → { userId, joinedAt }
    this.peers = new Map();

    this.createdAt = Date.now();
  }

  /* ─── PEERS ─── */
  addPeer(socketId, userId = null) {
    this.peers.set(socketId, { userId, joinedAt: Date.now() });
  }

  removePeer(socketId) {
    this.peers.delete(socketId);
    this._cleanupPeerResources(socketId);
  }

  setHost(socketId) {
    this.hostSocketId = socketId;
    console.log(`👑 Host set: ${socketId} in room ${this.roomId}`);
  }

  getPeerCount() {
    return this.peers.size;
  }

  /* ─── ROUTER ─── */
  async initRouter(workerOrGetter) {
    if (this.router) return this.router;

    // Accept either a worker instance or a getter function
    const worker = typeof workerOrGetter === "function"
      ? workerOrGetter()
      : workerOrGetter;

    if (!worker) throw new Error("Mediasoup worker not available");

    // Use centralized router creation with premium codecs
    this.router = await createRouter(this.roomId);
    return this.router;
  }

  /* ─── TRANSPORTS ─── */
  async createSendTransport(socketId) {
    const transport = await createSendTransport(socketId, this.roomId);

    if (!this.transports.has(socketId)) {
      this.transports.set(socketId, new Map());
    }
    this.transports.get(socketId).set("send", transport);

    // Also store by composite key for lookup by transportId
    this.transports.set(`${socketId}:send`, transport);

    return transport;
  }

  async createRecvTransport(socketId) {
    const transport = await createRecvTransport(socketId, this.roomId);

    if (!this.transports.has(socketId)) {
      this.transports.set(socketId, new Map());
    }
    this.transports.get(socketId).set("recv", transport);

    this.transports.set(`${socketId}:recv`, transport);

    return transport;
  }

  // Legacy: used by old stream.socket.js
  async createTransport(socketId) {
    return this.createSendTransport(socketId);
  }

  getTransport(socketId, direction = "send") {
    const key = `${socketId}:${direction}`;
    return this.transports.get(key) || null;
  }

  getTransportById(transportId) {
    for (const [key, transport] of this.transports) {
      if (transport?.id === transportId) return transport;
    }
    return null;
  }

  /* ─── PRODUCERS ─── */
  async produce(socketId, kind, rtpParameters, appData = {}) {
    if (!this.router) throw new Error("Router not initialized");

    const transport = this.getTransport(socketId, "send");
    if (!transport) throw new Error(`Send transport not found for socket ${socketId}`);

    const producer = await transport.produce({
      kind,
      rtpParameters,
      appData: { socketId, roomId: this.roomId, ...appData }
    });

    this.producers.set(producer.id, producer);

    producer.observer.once("close", () => {
      this.producers.delete(producer.id);
    });

    console.log(`🎥 Producer created: ${producer.id} kind=${kind}`);
    return producer;
  }

  getActiveProducers() {
    const list = [];
    for (const [producerId, producer] of this.producers) {
      if (!producer.closed) {
        list.push({
          producerId,
          kind: producer.kind,
          socketId: producer.appData?.socketId
        });
      }
    }
    return list;
  }

  /* ─── CONSUMERS ─── */
  async consume(socketId, producerId, rtpCapabilities) {
    if (!this.router) throw new Error("Router not initialized");

    if (!this.router.canConsume({ producerId, rtpCapabilities })) {
      throw new Error("Cannot consume — incompatible RTP capabilities");
    }

    const transport = this.getTransport(socketId, "recv");
    if (!transport) throw new Error(`Recv transport not found for socket ${socketId}`);

    const consumer = await transport.consume({
      producerId,
      rtpCapabilities,
      paused: true
    });

    this.consumers.set(consumer.id, consumer);

    consumer.observer.once("close", () => {
      this.consumers.delete(consumer.id);
    });

    console.log(`👀 Consumer created: ${consumer.id} kind=${consumer.kind}`);
    return consumer;
  }

  /* ─── CLEANUP ─── */
  _cleanupPeerResources(socketId) {
    // Close all transports for this peer
    for (const direction of ["send", "recv"]) {
      const transport = this.getTransport(socketId, direction);
      if (transport) {
        try { transport.close(); } catch (e) {}
        this.transports.delete(`${socketId}:${direction}`);
      }
    }
    if (this.transports.has(socketId)) this.transports.delete(socketId);

    // Close producers from this peer
    for (const [producerId, producer] of this.producers) {
      if (producer.appData?.socketId === socketId) {
        try { producer.close(); } catch (e) {}
        this.producers.delete(producerId);
      }
    }

    // Close consumers from this peer
    for (const [consumerId, consumer] of this.consumers) {
      if (consumer.appData?.socketId === socketId) {
        try { consumer.close(); } catch (e) {}
        this.consumers.delete(consumerId);
      }
    }
  }

  close() {
    for (const [, transport] of this.transports) {
      if (transport?.id) {
        try { transport.close(); } catch (e) {}
      }
    }
    if (this.router) {
      try { this.router.close(); } catch (e) {}
    }
    this.peers.clear();
    this.transports.clear();
    this.producers.clear();
    this.consumers.clear();
    console.log(`🗑️  Room closed: ${this.roomId}`);
  }
}

/* ─── FACTORY ─── */
function createRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, new LiveRoom(roomId));
    console.log(`🏠 Room created: ${roomId}`);
  }
  return rooms.get(roomId);
}

function getRoom(roomId) {
  return rooms.get(roomId) || null;
}

function closeRoom(roomId) {
  const room = rooms.get(roomId);
  if (room) {
    room.close();
    rooms.delete(roomId);
  }
}

function getAllRooms() {
  return [...rooms.entries()].map(([id, room]) => ({
    roomId: id,
    peerCount: room.getPeerCount(),
    producerCount: room.producers.size,
    createdAt: room.createdAt
  }));
}

module.exports = { createRoom, getRoom, closeRoom, getAllRooms, LiveRoom };