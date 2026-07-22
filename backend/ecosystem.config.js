// PM2 process manager config — cluster mode runs one Node.js
// process per CPU core, load-balanced internally by PM2, with
// zero-downtime reloads (`pm2 reload ecosystem.config.js`).
// This is your simplest path to horizontal scaling on a single
// VPS before/alongside moving to containers.

module.exports = {
  apps: [
    {
      name: "lovecruz-api",
      script: "./server.js",
      instances: process.env.PM2_INSTANCES || "max", // one per CPU core
      exec_mode: "cluster",
      env: { NODE_ENV: "production" },
      max_memory_restart: "1G",
      // Zero-downtime: PM2 starts new workers before killing old
      // ones, and waits for this signal before considering a
      // worker "ready" (pairs with the health check in server.js).
      wait_ready: false,
      listen_timeout: 10000,
      kill_timeout: 16000, // > SHUTDOWN_TIMEOUT_MS in server.js
      autorestart: true,
      watch: false,
    },
    {
      name: "lovecruz-worker",
      script: "./src/queues/worker.js",
      instances: process.env.WORKER_INSTANCES || 2,
      exec_mode: "cluster",
      env: { NODE_ENV: "production" },
      max_memory_restart: "512M",
      autorestart: true,
    },
  ],
};