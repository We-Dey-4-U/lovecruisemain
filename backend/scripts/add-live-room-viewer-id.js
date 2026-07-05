require("dotenv").config();

const db = require("../src/config/db");

async function migrate() {
    try {

        console.log("🚀 Adding viewer session id...");

        await db.query(`
            ALTER TABLE live_room_viewers
            ADD COLUMN IF NOT EXISTS id UUID
            DEFAULT uuid_generate_v4()
        `);

        console.log("✅ Migration completed");

        process.exit(0);

    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

migrate();