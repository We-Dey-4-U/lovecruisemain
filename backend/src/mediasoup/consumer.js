// backend/src/mediasoup/consumer.js

// backend/src/mediasoup/consumer.js

const consumers = new Map();

/* =========================================================
   CREATE CONSUMER
   FIXED: pass direction="recv" to getTransport
========================================================= */
async function createConsumer({ socketId, producerId, rtpCapabilities, room }) {
  if (!room) throw new Error("Room context required for consumer");
  if (!room.router) throw new Error(`Router not initialized for room ${room.roomId}`);

  const router = room.router;

  // FIXED: recv transport for consuming
  const transport = room.getTransport(socketId, "recv");
  if (!transport) {
    throw new Error(`Recv transport not found for socket ${socketId} in room ${room.roomId}`);
  }

  if (!router.canConsume({ producerId, rtpCapabilities })) {
    throw new Error("Router cannot consume this producer — incompatible RTP capabilities");
  }

  const consumer = await transport.consume({
    producerId,
    rtpCapabilities,
    paused: true,   // client resumes after UI ready
    appData: { socketId, roomId: room.roomId }
  });

  consumers.set(consumer.id, { consumer, socketId, roomId: room.roomId });

  consumer.observer.once("close", () => {
    consumers.delete(consumer.id);
  });

  console.log(`👀 Consumer created: ${consumer.id} in room ${room.roomId}`);
  return consumer;
}

/* =========================================================
   CLOSE CONSUMER
========================================================= */
function closeConsumer(consumerId) {
  const entry = consumers.get(consumerId);
  if (!entry) return;
  try { entry.consumer.close(); } catch (e) {}
  consumers.delete(consumerId);
}

module.exports = { createConsumer, closeConsumer };