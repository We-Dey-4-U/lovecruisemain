// backend/src/mediasoup/producer.js

// backend/src/mediasoup/producer.js

const producers = new Map();
const { getRoom } = require("./room");

/* =========================================================
   CREATE PRODUCER
   FIXED: pass direction="send" to getTransport
========================================================= */
async function createProducer(socketId, kind, rtpParameters, roomId) {
  const room = getRoom(roomId);
  if (!room) throw new Error("Room not found");
  if (!room.router) throw new Error(`Router not initialized for room ${roomId}`);

  // FIXED: send transport for producing
  const transport = room.getTransport(socketId, "send");
  if (!transport) {
    throw new Error(`Send transport not found for socket ${socketId} in room ${roomId}`);
  }

  const producer = await transport.produce({
    kind,
    rtpParameters,
    appData: {
      socketId,
      roomId,
      isHost: room.hostSocketId === socketId
    }
  });

  producers.set(producer.id, { producer, roomId, socketId });

  producer.observer.once("close", () => {
    producers.delete(producer.id);
  });

  console.log(`🎥 Producer created: ${producer.id} in room ${roomId}`);
  return producer;
}

/* =========================================================
   GET PRODUCER
========================================================= */
function getProducer(producerId) {
  const entry = producers.get(producerId);
  return entry ? entry.producer : null;
}

/* =========================================================
   CLOSE PRODUCER
========================================================= */
function closeProducer(producerId) {
  const entry = producers.get(producerId);
  if (!entry) return;
  try { entry.producer.close(); } catch (e) {}
  producers.delete(producerId);
}

module.exports = { createProducer, getProducer, closeProducer };