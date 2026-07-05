require("dotenv").config();

console.log("🚀 Migration started");

const db = require("../src/config/db");

async function migrate() {
    try {
        console.log("📡 Connecting to database...");

        const result = await db.query(`
            ALTER TABLE stories
            ADD COLUMN IF NOT EXISTS media_type VARCHAR(20) DEFAULT 'image'
        `);

        console.log("✅ Migration executed");
        console.log(result);

        process.exit(0);

    } catch (err) {
        console.error("❌ Migration failed");
        console.error(err);

        process.exit(1);
    }
}

migrate();