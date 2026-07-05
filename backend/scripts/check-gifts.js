require("dotenv").config();

console.log("🚀 Gift Check Started");

const db = require("../src/config/db");

async function check() {
    try {
        console.log("📡 Querying gifts table...");

        const { rows } = await db.query(`
            SELECT
                id,
                name,
                emoji,
                price_coins,
                category,
                sort_order,
                is_active
            FROM gifts
            ORDER BY sort_order ASC
        `);

        console.log("✅ Query completed");
        console.log(`🎁 Gifts found: ${rows.length}`);

        console.table(rows);

        process.exit(0);

    } catch (err) {
        console.error("❌ Check failed");
        console.error(err);

        process.exit(1);
    }
}

check();