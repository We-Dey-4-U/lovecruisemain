require("dotenv").config();

const db = require("../src/config/db");

async function check() {
  try {
    console.log("📡 Checking database...");

    const tables = await db.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    console.log("\n📋 Tables found:\n");

    tables.rows.forEach(t => {
      console.log("-", t.table_name);
    });

    const postTable = await db.query(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema='public'
        AND table_name='posts'
      ) AS exists
    `);

    console.log("\n");

    if (postTable.rows[0].exists) {
      console.log("✅ posts table EXISTS");

      const count = await db.query(`
        SELECT COUNT(*)::int AS total
        FROM posts
      `);

      console.log(`📦 Total posts: ${count.rows[0].total}`);

    } else {
      console.log("❌ posts table DOES NOT EXIST");
    }

    process.exit(0);

  } catch (err) {

    console.error("❌ Check failed");
    console.error(err);

    process.exit(1);
  }
}

check();