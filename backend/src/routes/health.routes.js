// backend/src/routes/health.routes.js
//
// Two distinct endpoints, matching standard k8s/load-balancer
// conventions:
//   /health/live  — "is this process alive at all" (liveness probe).
//                   Always returns 200 unless the process is truly
//                   wedged. A failing liveness probe causes the
//                   orchestrator to KILL and restart the container.
//   /health/ready — "can this instance actually serve traffic right
//                   now" (readiness probe). Checks DB + Redis. A
//                   failing readiness probe causes the load balancer
//                   to stop sending it traffic WITHOUT killing it —
//                   important during slow startup or a brief DB
//                   blip, so instances aren't churned unnecessarily.

const express = require("express");
const router = express.Router();
const db = require("../config/db");
const redisConfig = require("../config/redis");

router.get("/live", (req, res) => {
  res.status(200).json({ success: true, status: "alive" });
});

router.get("/ready", async (req, res) => {
  const [dbHealth, redisHealth] = await Promise.all([
    db.healthCheck(),
    redisConfig.healthCheck(),
  ]);

  const ready = dbHealth.ok && redisHealth.ok;

  res.status(ready ? 200 : 503).json({
    success: ready,
    status: ready ? "ready" : "not_ready",
    checks: { database: dbHealth, redis: redisHealth },
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;