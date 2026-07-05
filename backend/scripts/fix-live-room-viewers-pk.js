require("dotenv").config();

const db = require("../src/config/db");

async function fix() {
    try {

        console.log("🚀 Fixing live_room_viewers primary key...");

        await db.query(`
            ALTER TABLE live_room_viewers
            DROP CONSTRAINT IF EXISTS live_room_viewers_pkey
        `);

        await db.query(`
            ALTER TABLE live_room_viewers
            ADD CONSTRAINT live_room_viewers_pkey
            PRIMARY KEY (id)
        `);

        console.log("✅ Primary key updated to id");

        process.exit(0);

    } catch (err) {

        console.error("❌ Migration failed");
        console.error(err);

        process.exit(1);
    }
}

fix();