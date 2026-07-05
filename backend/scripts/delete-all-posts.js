require("dotenv").config();

console.log("🧨 DELETE ALL POSTS SCRIPT STARTED");

const db = require("../src/config/db");

async function run() {
  try {
    console.log("📡 Connecting to database...");

    const result = await db.query(`
      DELETE FROM posts
    `);

    console.log("✅ All posts deleted successfully");
    console.log("Rows affected:", result.rowCount);

    process.exit(0);

  } catch (err) {
    console.error("❌ FAILED TO DELETE POSTS");
    console.error(err);

    process.exit(1);
  }
}

run();