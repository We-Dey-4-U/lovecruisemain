require("dotenv").config();

console.log("🚀 Check started");

const db = require("../src/config/db");

async function check() {
    try {
        console.log("📡 Querying stories columns...");

        const { rows } = await db.query(`
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'stories'
            ORDER BY ordinal_position
        `);

        console.log("✅ Query completed");
        console.log("Rows found:", rows.length);

        console.table(rows);

        process.exit(0);

    } catch (err) {
        console.error("❌ Check failed");
        console.error(err);

        process.exit(1);
    }
}

check();