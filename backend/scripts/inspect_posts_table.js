require("dotenv").config();
const db = require("../src/config/db");

async function inspect() {
  try {
    console.log("🔍 Inspecting posts table structure...\n");

    // 1. Get column info
    const columns = await db.query(`
      SELECT column_name, data_type, udt_name
      FROM information_schema.columns
      WHERE table_name = 'posts'
      ORDER BY ordinal_position;
    `);

    console.log("📌 COLUMNS:");
    console.table(columns.rows);

    // 2. Check sample row (VERY IMPORTANT)
    const sample = await db.query(`
      SELECT *
      FROM posts
      LIMIT 1;
    `);

    console.log("\n📌 SAMPLE ROW:");
    console.log(sample.rows[0] || "No data yet");

    // 3. Check constraints
    const constraints = await db.query(`
      SELECT conname, contype, pg_get_constraintdef(c.oid)
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      WHERE t.relname = 'posts';
    `);

    console.log("\n📌 CONSTRAINTS:");
    console.table(constraints.rows);

    process.exit(0);

  } catch (err) {
    console.error("❌ INSPECT FAILED:", err.message);
    process.exit(1);
  }
}

inspect();