const { Pool } = require("pg");
const path = require("path");
const fs = require("fs");

// Always load backend/.env
const envPath = path.join(process.cwd(), ".env");

console.log("======================================");
console.log("🚀 PostgreSQL Configuration");
console.log("======================================");
console.log("📁 DB File:", __filename);
console.log("📁 Working Directory:", process.cwd());
console.log("📄 Looking for .env:", envPath);
console.log("📄 .env Exists:", fs.existsSync(envPath));
console.log("======================================");

// Load environment variables
const result = require("dotenv").config({
  path: envPath,
});

if (result.error) {
  console.error("❌ Failed to load .env");
  console.error(result.error);
  process.exit(1);
}

console.log("🌍 NODE_ENV:", process.env.NODE_ENV);
console.log(
  "📦 DATABASE_URL:",
  process.env.DATABASE_URL ? "Loaded ✅" : "Missing ❌"
);
console.log("======================================");

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL is missing from .env");
  process.exit(1);
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
  console.log("✅ Connected to Render PostgreSQL");
});

pool.on("error", (err) => {
  console.error("❌ PostgreSQL Pool Error");
  console.error(err);
  process.exit(1);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect(),
  pool,
};