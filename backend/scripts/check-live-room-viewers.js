require("dotenv").config();

const db = require("../src/config/db");

async function check() {
    try {

        console.log("🚀 Checking live_room_viewers...");

        const { rows } = await db.query(`
            SELECT
                column_name,
                data_type
            FROM information_schema.columns
            WHERE table_name = 'live_room_viewers'
            ORDER BY ordinal_position
        `);

        console.table(rows);

        process.exit(0);

    } catch (err) {

        console.error(err);
        process.exit(1);
    }
}

check();