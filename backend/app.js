const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const { notFound, errorHandler } = require("./src/middlewares/error");

const app = express();

console.log("🚀 APP.JS LOADED - Podcast test route is present");

/* =========================================================
   SECURITY + LOGGING git logs ths n  s i love this code hkowoiwkw
========================================================= */
app.use(cors());
app.use(helmet());
app.use(morgan("dev"));

/* =========================================================
   BODY PARSING (SAFE FOR MULTER)
========================================================= */
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
  res.json({
    success: true,
    message: "VoiceChat API Running"
  });
});



app.get("/my-ip", async (req, res) => {
  try {
    const response = await fetch("https://api.ipify.org?format=json");
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Failed to fetch public IP"
    });
  }
});
/* =========================================================
   SAFE ROUTE LOADER
========================================================= */
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

  console.log("Type:", typeof route);

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

console.log("=================================");
console.log("PODCAST ROUTER DEBUG");
console.log("=================================");
console.log("Type:", typeof podcastRoutes);
console.log("Constructor:", podcastRoutes?.constructor?.name);
console.log("Keys:", Object.keys(podcastRoutes || {}));
console.log("=================================");
/* =========================================================
   ROUTE REGISTRATION ORDER (IMPORTANT) how is my branch up to data
========================================================= */
safeUse("/api/auth", authRoutes);
safeUse("/api/users", userRoutes);

safeUse("/api/chats", chatRoutes);
safeUse("/api/calls", callRoutes);

safeUse("/api/gifts", giftRoutes);

console.log("=================================");
console.log("PAYMENT ROUTER STACK");
console.log("=================================");

paymentRoutes.stack.forEach((layer) => {
  if (layer.route) {
    console.log(
      `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`
    );
  }
});

console.log("=================================");

safeUse("/api/payments", paymentRoutes);

safeUse("/api/stories", storyRoutes);
safeUse("/api/notifications", notificationRoutes);

safeUse("/api/live", liveRoomRoutes);

safeUse("/api/admin", adminRoutes);
safeUse("/api/uploads", uploadRoutes);

app.use("/api/posts", postsRoutes);

// Temporarily add this BEFORE safeUse("/api/podcasts", podcastRoutes)
app.get("/api/podcasts-test", (req, res) => {
  console.log("✅ /api/podcasts-test was called");

  try {
    const r = require("./src/routes/podcast.routes");
    res.json({
      success: true,
      type: typeof r,
      keys: Object.keys(r || {})
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      error: err.message,
      stack: err.stack
    });
  }
});
safeUse("/api/podcasts", podcastRoutes);

safeUse("/api/host-academy", hostAcademyRoutes);
safeUse("/api/leaderboard", leaderboardRoutes);
safeUse("/api/marketplace", marketplaceRoutes);
safeUse("/api/sellers", sellersRoutes);
/* =========================================================
   ERROR HANDLERS
========================================================= */
app.use(notFound);
app.use(errorHandler);

module.exports = app;