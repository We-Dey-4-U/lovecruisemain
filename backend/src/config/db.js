const { Pool } = require("pg");
const path = require("path");
const fs = require("fs");

// ======================================================
// Load Environment Variables
// ======================================================

const envPath = path.join(process.cwd(), ".env");

console.log("======================================");
console.log("🚀 PostgreSQL Configuration");
console.log("======================================");
console.log("📁 DB File:", __filename);
console.log("📁 Working Directory:", process.cwd());

if (fs.existsSync(envPath)) {
  console.log("📄 Local .env found. Loading...");
  require("dotenv").config({ path: envPath });
} else {
  console.log("🌍 No local .env found. Using environment variables.");
}

console.log("NODE_ENV:", process.env.NODE_ENV);
console.log(
  "DATABASE_URL:",
  process.env.DATABASE_URL ? "Loaded ✅" : "Missing ❌"
);
console.log("======================================");

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is missing.");
}

// ======================================================
// PostgreSQL Pool
// ======================================================

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,

  ssl: {
    rejectUnauthorized: false,
  },

  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,

  allowExitOnIdle: false,
});

// ======================================================
// Pool Events
// ======================================================

pool.on("connect", () => {
  console.log("✅ New PostgreSQL client connected");
});

pool.on("acquire", () => {
  console.log("📥 PostgreSQL client acquired");
});

pool.on("remove", () => {
  console.log("📤 PostgreSQL client removed from pool");
});

pool.on("error", (err) => {
  console.error("======================================");
  console.error("❌ POSTGRESQL POOL ERROR");
  console.error("======================================");
  console.error("Message :", err.message);
  console.error("Code    :", err.code);
  console.error("Severity:", err.severity);
  console.error("Detail  :", err.detail);
  console.error("Hint    :", err.hint);
  console.error("Stack:");
  console.error(err.stack);
  console.error("======================================");
});

// ======================================================
// Startup Database Test
// ======================================================

(async () => {
  console.log("======================================");
  console.log("🔍 Testing PostgreSQL Connection...");
  console.log("======================================");

  try {
    const result = await pool.query(`
      SELECT
        NOW() AS server_time,
        current_database() AS database_name,
        current_user AS database_user,
        version() AS postgres_version
    `);

    console.log("✅ Database connection successful!");
    console.table(result.rows);

    const tables = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema='public'
      ORDER BY table_name;
    `);

    console.log("======================================");
    console.log("📋 Tables Found:", tables.rowCount);
    console.table(tables.rows);

  } catch (err) {
    console.error("======================================");
    console.error("❌ DATABASE STARTUP TEST FAILED");
    console.error("======================================");
    console.error("Message :", err.message);
    console.error("Code    :", err.code);
    console.error("Severity:", err.severity);
    console.error("Detail  :", err.detail);
    console.error("Hint    :", err.hint);
    console.error("Stack:");
    console.error(err.stack);
    console.error("======================================");
  }
})();

// ======================================================
// Query Wrapper
// ======================================================

async function query(text, params) {
  try {
    return await pool.query(text, params);
  } catch (err) {
    console.error("======================================");
    console.error("❌ DATABASE QUERY FAILED");
    console.error("======================================");
    console.error("SQL:");
    console.error(text);

    if (params) {
      console.error("Parameters:");
      console.dir(params, { depth: null });
    }

    console.error("--------------------------------------");
    console.error("Message :", err.message);
    console.error("Code    :", err.code);
    console.error("Severity:", err.severity);
    console.error("Detail  :", err.detail);
    console.error("Hint    :", err.hint);
    console.error("Stack:");
    console.error(err.stack);
    console.error("======================================");

    throw err;
  }
}

// ======================================================
// Get Dedicated Client
// ======================================================

async function getClient() {
  try {
    const client = await pool.connect();
    console.log("✅ Dedicated PostgreSQL client acquired");
    return client;
  } catch (err) {
    console.error("❌ Failed to acquire PostgreSQL client");
    console.error(err);
    throw err;
  }
}

// ======================================================

module.exports = {
  query,
  getClient,
  pool,
};