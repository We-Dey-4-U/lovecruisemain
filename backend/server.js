require("dotenv").config();
// Safety net: a transient Redis blip (or any other unhandled async
// error) must never take down mediasoup workers / live streams.
// Logs the error and keeps the process running instead of crashing.
process.on("unhandledRejection", (reason) => {
  console.error("❌ Unhandled Rejection (server stayed up):", reason);
});
process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception (server stayed up):", err);
});
console.log("MEDIASOUP_ANNOUNCED_IP =", process.env.MEDIASOUP_ANNOUNCED_IP);

const http = require("http");
const app = require("./app");

const server = http.createServer(app);

const socketSetup = require("./src/sockets");
const mediasoupWorker = require("./src/mediasoup/worker.js");
const nodeRegistry = require("./src/mediasoup/nodeRegistry");
const { getAllRooms } = require("./src/mediasoup/room");

/* =========================================================
   DEBUG MEDIASOUP IMPORT
========================================================= */
console.log("=================================");
console.log("MEDIASOUP WORKER DEBUG");
console.log("=================================");

console.log("Worker module =", mediasoupWorker);

try {
  console.log("Keys =", Object.keys(mediasoupWorker));
} catch (err) {
  console.error("Failed reading keys:", err);
}

try {
  console.log(
    "Resolved =",
    require.resolve("./src/mediasoup/worker.js")
  );
} catch (err) {
  console.error("Failed resolving path:", err);
}

console.log("=================================");

const PORT = process.env.PORT || 3000;

async function start() {
  try {
    /* =========================================================
       VALIDATE EXPORTS BEFORE STARTING
    ========================================================= */
    if (!mediasoupWorker) {
      throw new Error("mediasoupWorker import returned undefined/null");
    }

    if (typeof mediasoupWorker.createWorker !== "function") {
      console.error(
        "createWorker type =",
        typeof mediasoupWorker.createWorker
      );

      console.error(
        "Module contents =",
        mediasoupWorker
      );

      throw new Error(
        "createWorker is not a function. Check worker.js exports."
      );
    }

    /* =========================================================
       START MEDIASOUP
    ========================================================= */
    console.log("🚀 Starting mediasoup worker...");

    await mediasoupWorker.createWorker();

    console.log("✅ Mediasoup ready");

    /* =========================================================
       START MEDIA-NODE HEARTBEAT (Redis)
       ------------------------------------------------------------
       THIS PASS: registers this process as a media node with a live
       load snapshot (room/producer counts pulled straight from
       room.js's existing getAllRooms()). On a single VPS this is
       purely observational — nothing currently routes based on it —
       but it means the moment you add a second media-server box,
       both are already visible to each other with zero extra setup.
    ========================================================= */
    nodeRegistry.startHeartbeat(() => {
      const allRooms = getAllRooms();
      return {
        roomCount: allRooms.length,
        producerCount: allRooms.reduce((sum, r) => sum + r.producerCount, 0)
      };
    });

    /* =========================================================
       START SOCKET.IO
    ========================================================= */
    const io = socketSetup(server);

    app.set("io", io);

    /* =========================================================
       START HTTP SERVER
    ========================================================= */
    server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });

  } catch (err) {
    console.error("❌ Server startup failed:");
    console.error(err);

    process.exit(1);
  }
}

start();