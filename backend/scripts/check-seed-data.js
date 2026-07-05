require("dotenv").config();

console.log("🚀 Seed Data Verification Started");

const db = require("../src/config/db");

async function check() {
    try {
        console.log("📡 Checking seed data...");

        const gifts = await db.query(`
            SELECT COUNT(*)::int AS count
            FROM gifts
        `);

        const packages = await db.query(`
            SELECT COUNT(*)::int AS count
            FROM coin_packages
        `);

        console.log("\n========== RESULTS ==========");
        console.log(`🎁 Gifts: ${gifts.rows[0].count}`);
        console.log(`💰 Coin Packages: ${packages.rows[0].count}`);
        console.log("=============================\n");

        if (
            gifts.rows[0].count === 16 &&
            packages.rows[0].count === 6
        ) {
            console.log("✅ Monetization seed data installed successfully");
        } else {
            console.log("⚠️ Seed data appears incomplete");
        }

        process.exit(0);

    } catch (err) {
        console.error("❌ Verification failed");
        console.error(err);

        process.exit(1);
    }
}

check();
