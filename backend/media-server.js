// backend/media-server.js
//
// Entry point for ONE media cluster node. Run this as its own
// process/container, completely separate from server.js (the API
// process). Deploy as many of these as you need — media1, media2,
// media3... — each with a distinct MEDIA_NODE_ID / MEDIA_PUBLIC_URL,
// and the API layer will spread rooms across all of them
// automatically via roomAssignmentService.
//
// Start with: node media-server.js
// (or via PM2/Docker — see ecosystem.config.js / Dockerfile.media)

require("dotenv").config();

const http = require("http");
const os = require("os");
const crypto = require("crypto");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const { Server } = require("socket.io");
const { createAdapter } = require("@socket.io/redis-adapter");

const {
  pubClient,
  subClient,
  shutdown: redisShutdown,
  healthCheck: redisHealthCheck,
} = require("./src/config/redis");
const db = require("./src/config/db");
const workerPool = require("./src/mediasoup/worker");
const routerRegistry = require("./src/mediasoup/router");
const mediaNodeRegistry = require("./src/services/mediaNodeRegistry");
const { verifyAccessToken } = require("./src/utils/token");

const registerStreamSocket = require("./src/sockets/stream.socket");
const registerRadioMediaSocket = require("./src/sockets/radioMedia.socket");

/* =========================================================
   NODE IDENTITY — set these per-deployment via env vars.
   MEDIA_PUBLIC_URL is what the API hands back to clients, so it
   MUST be the externally reachable HTTPS URL for this exact node
   (e.g. https://media1.lovecruz.fun), not an internal hostname.
========================================================= */
const NODE_ID = process.env.MEDIA_NODE_ID || `media-${os.hostname()}-${crypto.randomBytes(3).toString("hex")}`;
const REGION = process.env.MEDIA_REGION || "default";
const PUBLIC_URL = process.env.MEDIA_PUBLIC_URL || null;
const CAPACITY = parseInt(process.env.MEDIA_NODE_CAPACITY || "150", 10); // max concurrent rooms before this node reports itself "full"
const PORT = process.env.MEDIA_PORT || 4000;

if (!PUBLIC_URL) {
  console.warn(
    "⚠️  MEDIA_PUBLIC_URL is not set. The API layer will hand clients a broken address for this node until you set it (e.g. https://media1.lovecruz.fun)."
  );
}

/* =========================================================
   HTTP APP — health checks + stats only. All real traffic to
   this node is Socket.IO + WebRTC, not REST.
========================================================= */
const app = express();
app.set("trust proxy", 1);
app.use(helmet());
app.use(
  cors({
    origin: (process.env.CORS_ORIGINS || "https://lovecruz.fun").split(","),
  })
);
app.use(express.json());

app.get("/health/live", (req, res) => {
  res.json({ success: true, status: "alive", nodeId: NODE_ID });
});

app.get("/health/ready", async (req, res) => {
  const [dbHealth, redisHealth] = await Promise.all([db.healthCheck(), redisHealthCheck()]);
  const ready = dbHealth.ok && redisHealth.ok && workerPool.isWorkerReady();
  res.status(ready ? 200 : 503).json({
    success: ready,
    nodeId: NODE_ID,
    region: REGION,
    checks: {
      database: dbHealth,
      redis: redisHealth,
      workerPool: workerPool.isWorkerReady(),
    },
  });
});

app.get("/stats", (req, res) => {
  res.json({
    nodeId: NODE_ID,
    region: REGION,
    capacity: CAPACITY,
    roomCount: routerRegistry.getRoomCount(),
    ...workerPool.getPoolStats(),
  });
});

const server = http.createServer(app);

/* =========================================================
   SOCKET.IO — same auth pattern as the API process (JWT on
   handshake). Redis adapter is included for consistency/future
   multi-instance-per-node setups, though a single media node's
   rooms don't need cross-instance broadcast today.
========================================================= */
const io = new Server(server, {
  cors: {
    origin: (process.env.CORS_ORIGINS || "https://lovecruz.fun").split(","),
    methods: ["GET", "POST"],
    credentials: true,
  },
  pingInterval: 25000,
  pingTimeout: 20000,
  transports: ["websocket", "polling"],
});

io.adapter(createAdapter(pubClient, subClient));

io.use((socket, next) => {
  try {
    const token =
      socket.handshake.auth?.token ||
      (socket.handshake.headers?.authorization || "").replace("Bearer ", "");
    if (!token) {
      socket.userId = null;
      return next();
    }
    const decoded = verifyAccessToken(token);
    socket.userId = decoded.sub;
    socket.userRole = decoded.role;
    return next();
  } catch (err) {
    socket.userId = null;
    return next();
  }
});

io.on("connection", (socket) => {
  console.log(`[media:${NODE_ID}] socket connected ${socket.id} user=${socket.userId || "guest"}`);
  registerStreamSocket(io, socket);
  registerRadioMediaSocket(io, socket);
});

/* =========================================================
   HEARTBEAT — registers/refreshes this node's entry in Redis
   every HEARTBEAT_INTERVAL_MS so roomAssignmentService.js on the
   API side always has a fresh picture of capacity and load.
========================================================= */
let heartbeatTimer = null;

async function heartbeat() {
  try {
    await mediaNodeRegistry.heartbeat({
      nodeId: NODE_ID,
      region: REGION,
      publicUrl: PUBLIC_URL || `http://localhost:${PORT}`,
      capacity: CAPACITY,
      roomCount: routerRegistry.getRoomCount(),
      workerStats: workerPool.getPoolStats(),
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error(`[media:${NODE_ID}] heartbeat failed:`, err.message);
  }
}

/* =========================================================
   STARTUP
========================================================= */
async function start() {
  await workerPool.createWorkers();
  await heartbeat();
  heartbeatTimer = setInterval(heartbeat, mediaNodeRegistry.HEARTBEAT_INTERVAL_MS);

  server.listen(PORT, () => {
    console.log(`🎥 Media node "${NODE_ID}" (region=${REGION}) listening on port ${PORT}`);
    console.log(`   Public URL: ${PUBLIC_URL || "(NOT SET — clients will fail to connect)"}`);
    console.log(`   Capacity: ${CAPACITY} rooms`);
  });
}

/* =========================================================
   GRACEFUL SHUTDOWN — deregisters from the cluster FIRST so the
   API stops assigning new rooms here immediately, then drains.
========================================================= */
async function gracefulShutdown(signal) {
  console.log(`\n🛑 [media:${NODE_ID}] ${signal} received — shutting down...`);
  clearInterval(heartbeatTimer);

  try {
    await mediaNodeRegistry.deregisterNode(NODE_ID);
    io.close();
    await new Promise((resolve) => server.close(resolve));
    await workerPool.closeAll();
    await db.shutdown();
    await redisShutdown();
    console.log(`[media:${NODE_ID}] ✅ shutdown complete`);
    process.exit(0);
  } catch (err) {
    console.error(`[media:${NODE_ID}] ❌ shutdown error:`, err);
    process.exit(1);
  }
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("uncaughtException", (err) => {
  console.error(`[media:${NODE_ID}] ❌ Uncaught Exception:`, err);
  gracefulShutdown("uncaughtException").finally(() => process.exit(1));
});

start().catch((err) => {
  console.error("❌ Media node startup failed:", err);
  process.exit(1);
});