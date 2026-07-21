// backend/src/config/db.js
//
// Enterprise-hardened Postgres access layer.
// - Primary pool for writes + strong-consistency reads
// - Optional read-replica pool(s) for read-heavy queries (feed,
//   discover, leaderboards) — falls back to primary if no replica
//   URL is configured, so this is a safe drop-in with zero config
//   changes required on day one.
// - Automatic retry for transient errors (connection resets,
//   deadlocks) with exponential backoff.
// - Slow query logging for observability.
// - Graceful shutdown hook (server.js calls db.shutdown()).

const { Pool } = require("pg");

const TRANSIENT_ERROR_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "57P01", // admin shutdown
  "57P02", // crash shutdown
  "57P03", // cannot connect now
  "40001", // serialization failure
  "40P01", // deadlock detected
]);

const SLOW_QUERY_MS = parseInt(process.env.SLOW_QUERY_MS || "300", 10);

function buildPool(connectionString, label) {
  if (!connectionString) return null;

  const pool = new Pool({
    connectionString,
    ssl: process.env.PGSSL_DISABLE === "true" ? false : { rejectUnauthorized: false },
    max: parseInt(process.env.PG_POOL_MAX || "20", 10),
    min: parseInt(process.env.PG_POOL_MIN || "2", 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    allowExitOnIdle: false,
  });

  pool.on("error", (err) => {
    console.error(`[db:${label}] ❌ POOL ERROR`, {
      message: err.message,
      code: err.code,
    });
  });

  return pool;
}

const primaryPool = buildPool(process.env.DATABASE_URL, "primary");
if (!primaryPool) {
  throw new Error("DATABASE_URL is required");
}

// Comma-separated list supported for multiple read replicas —
// picks one at random per query for basic load distribution.
const replicaUrls = (process.env.DATABASE_REPLICA_URLS || process.env.DATABASE_REPLICA_URL || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const replicaPools = replicaUrls.map((url, i) => buildPool(url, `replica-${i}`)).filter(Boolean);

function pickReplicaPool() {
  if (replicaPools.length === 0) return primaryPool;
  return replicaPools[Math.floor(Math.random() * replicaPools.length)];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs a query against the primary (read-write) pool, with
 * automatic retry on transient errors.
 */
async function query(text, params, { retries = 2 } = {}) {
  return _runWithRetry(primaryPool, text, params, retries, "primary");
}

/**
 * Runs a query against a read replica if configured, otherwise
 * transparently falls back to the primary. Use for read-heavy,
 * eventually-consistent-tolerant queries: feeds, discover,
 * leaderboards, analytics, public listings.
 */
async function readQuery(text, params, { retries = 2 } = {}) {
  const pool = pickReplicaPool();
  return _runWithRetry(pool, text, params, retries, pool === primaryPool ? "primary" : "replica");
}

async function _runWithRetry(pool, text, params, retries, label) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const durationMs = Date.now() - start;
    if (durationMs > SLOW_QUERY_MS) {
      console.warn(`[db:${label}] 🐢 SLOW QUERY (${durationMs}ms):`, text.slice(0, 200));
    }
    return result;
  } catch (err) {
    const isTransient = TRANSIENT_ERROR_CODES.has(err.code);
    if (isTransient && retries > 0) {
      const backoffMs = (3 - retries) * 150 + Math.random() * 100;
      console.warn(`[db:${label}] ⚠️ transient error (${err.code}), retrying in ${backoffMs.toFixed(0)}ms. Retries left: ${retries - 1}`);
      await sleep(backoffMs);
      return _runWithRetry(pool, text, params, retries - 1, label);
    }

    console.error(`[db:${label}] ❌ QUERY FAILED`, {
      message: err.message,
      code: err.code,
      detail: err.detail,
      sql: text?.slice(0, 300),
    });
    throw err;
  }
}

async function getClient() {
  const client = await primaryPool.connect();
  const releaseOriginal = client.release.bind(client);
  // Guard against connections held open too long (leak detection)
  const timeout = setTimeout(() => {
    console.warn("[db] ⚠️ A client has been checked out for >30s — possible leak");
  }, 30000);
  client.release = (...args) => {
    clearTimeout(timeout);
    return releaseOriginal(...args);
  };
  return client;
}

/**
 * Runs a callback inside a transaction, handling BEGIN/COMMIT/ROLLBACK
 * and client release automatically.
 */
async function withTransaction(fn) {
  const client = await getClient();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      console.error("[db] ❌ ROLLBACK FAILED", rollbackErr.message);
    }
    throw err;
  } finally {
    client.release();
  }
}

async function healthCheck() {
  try {
    const { rows } = await primaryPool.query("SELECT 1 AS ok");
    return { ok: rows[0]?.ok === 1, pool: "primary" };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function shutdown() {
  console.log("[db] Closing connection pools...");
  await Promise.allSettled([
    primaryPool.end(),
    ...replicaPools.map((p) => p.end()),
  ]);
  console.log("[db] Pools closed");
}

module.exports = {
  query,
  readQuery,
  getClient,
  withTransaction,
  healthCheck,
  shutdown,
  pool: primaryPool, // legacy compat for any code doing db.pool.query(...)
};

