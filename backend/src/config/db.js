const { Pool } = require("pg");
const path = require("path");
const fs = require("fs");

// Only try to load a local .env if it exists
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

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on("connect", () => {
  console.log("✅ Connected to PostgreSQL");
});

pool.on("error", (err) => {
  console.error("❌ PostgreSQL Pool Error", err);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect(),
  pool,
};