require("dotenv").config();

console.log("🚀 Coin Package Check Started");

const db = require("../src/config/db");

async function check() {
    try {
        console.log("📡 Querying coin_packages table...");

        const { rows } = await db.query(`
            SELECT
                id,
                name,
                coins,
                bonus_coins,
                price_amount,
                currency,
                sort_order,
                is_active
            FROM coin_packages
            ORDER BY sort_order ASC
        `);

        console.log("✅ Query completed");
        console.log(`💰 Packages found: ${rows.length}`);

        console.table(rows);

        process.exit(0);

    } catch (err) {
        console.error("❌ Check failed");
        console.error(err);

        process.exit(1);
    }
}

check();