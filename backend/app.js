const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const { notFound, errorHandler } = require("./src/middlewares/error");

const app = express();

console.log("🚀 APP.JS LOADED");

/* =========================================================
   SECURITY + LOGGING
========================================================= */
app.use(cors());
app.use(helmet());
app.use(morgan("dev"));

/* =========================================================
   BODY PARSING (SAFE FOR MULTER + STRIPE WEBHOOK)
========================================================= */
app.use((req, res, next) => {
  const contentType = req.headers["content-type"] || "";

  const rawBodyRoutes = [
    "/api/payments/stripe/webhook",
    "/api/payments/cashapp/webhook",
  ];

  if (
    contentType.includes("multipart/form-data") ||
    rawBodyRoutes.includes(req.originalUrl)
  ) {
    return next();
  }

  express.json({ limit: "50mb" })(req, res, next);
});

/* =========================================================
   HEALTH CHECK
========================================================= */
app.get("/", (req, res) => {
  res.json({ success: true, message: "VoiceChat API Running" });
});

app.get("/my-ip", async (req, res) => {
  try {
    const response = await fetch("https://api.ipify.org?format=json");
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch public IP" });
  }
});

/* =========================================================
   SAFE ROUTE LOADER
========================================================= */
function safeUse(path, route) {
  console.log("=================================");
  console.log(`Registering ${path}`);

  if (!route) {
    console.error(`❌ Route is undefined: ${path}`);
    return;
  }

  app.use(path, route);
  console.log(`✅ Mounted ${path}`);
  console.log("=================================");
}

/* =========================================================
   ROUTES
========================================================= */
const authRoutes = require("./src/routes/auth.routes");
const userRoutes = require("./src/routes/users.routes");
const chatRoutes = require("./src/routes/chats.routes");
const callRoutes = require("./src/routes/calls.routes");
const giftRoutes = require("./src/routes/gifts.routes");
const paymentRoutes = require("./src/routes/payments.routes");
const storyRoutes = require("./src/routes/stories.routes");
const notificationRoutes = require("./src/routes/notifications.routes");
const liveRoomRoutes = require("./src/routes/liveRooms.routes");
const adminRoutes = require("./src/routes/admin.routes");
const uploadRoutes = require("./src/routes/uploads.routes");
const postsRoutes = require("./src/routes/posts.routes");
const podcastRoutes = require("./src/routes/podcast.routes");
const hostAcademyRoutes = require("./src/routes/hostAcademy.routes");
const leaderboardRoutes = require("./src/routes/leaderboard.routes");
const marketplaceRoutes = require("./src/routes/marketplace.routes");
const sellersRoutes = require("./src/routes/sellers.routes");
const walletRoutes = require("./src/routes/wallet.routes");
const withdrawalsRoutes = require("./src/routes/withdrawals.routes");
const presenceRoutes = require("./src/routes/presence.routes");
const radioRoutes = require("./src/routes/radio.routes");
const adminRadioRoutes = require("./src/routes/admin.radio.routes");

// ── NEW: Internet Radio Music Request System ──
const musicLibraryRoutes = require("./src/routes/musicLibrary.routes");
const songRequestRoutes = require("./src/routes/songRequest.routes");

safeUse("/api/auth", authRoutes);
safeUse("/api/users", userRoutes);
safeUse("/api/chats", chatRoutes);
safeUse("/api/calls", callRoutes);
safeUse("/api/gifts", giftRoutes);
safeUse("/api/payments", paymentRoutes);
safeUse("/api/stories", storyRoutes);
safeUse("/api/notifications", notificationRoutes);
safeUse("/api/live", liveRoomRoutes);
safeUse("/api/admin", adminRoutes);
safeUse("/api/uploads", uploadRoutes);
safeUse("/api/posts", postsRoutes);
safeUse("/api/podcasts", podcastRoutes);
safeUse("/api/host-academy", hostAcademyRoutes);
safeUse("/api/leaderboard", leaderboardRoutes);
safeUse("/api/marketplace", marketplaceRoutes);
safeUse("/api/sellers", sellersRoutes);
safeUse("/api/wallet", walletRoutes);
safeUse("/api/withdrawals", withdrawalsRoutes);
safeUse("/api/presence", presenceRoutes);

safeUse("/api/radio", radioRoutes);
safeUse("/api/admin/radio", adminRadioRoutes);

// ── NEW: mounted under /api/radio/music-library and
// /api/radio/broadcasts so they read naturally alongside the
// existing radio.routes.js endpoints (e.g.
// /api/radio/music-library/songs/upload,
// /api/radio/broadcasts/:broadcastId/requests). ──
safeUse("/api/radio/music-library", musicLibraryRoutes);
safeUse("/api/radio/broadcasts", songRequestRoutes);

/* =========================================================
   RADIO SHOW-START NOTIFIER (Phase 2)
   ------------------------------------------------------------
   Starts a 60s interval that checks radio_shows for anything
   starting soon and notifies station followers. If your socket
   bootstrap file exposes `io` on the express app (e.g. via
   `app.set('io', io)` right after creating the Socket.IO server),
   this will also push notifications live; otherwise it still
   writes durable rows to the `notifications` table.
========================================================= */
const radioNotifier = require("./src/services/radioNotifier");
setImmediate(() => {
  // app.get('io') will be undefined until your server bootstrap
  // calls app.set('io', io) — radioNotifier.start() tolerates that.
  // NOTE: songRequestController.js and the new music-request flow
  // ALSO read req.app.get("io") to push realtime queue/request
  // events — so app.set('io', io) is now load-bearing for two
  // modules, not just the notifier. Make sure it runs before any
  // request comes in (i.e. right after `const io = new Server(...)`
  // in your server bootstrap, before `server.listen(...)`).
  radioNotifier.start(app.get("io"));
});

/* =========================================================
   ERROR HANDLERS
========================================================= */
app.use(notFound);
app.use(errorHandler);

module.exports = app;