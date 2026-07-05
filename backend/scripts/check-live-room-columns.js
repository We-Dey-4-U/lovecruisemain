require("dotenv").config();

const db = require("../src/config/db");

async function checkLiveRoomColumns() {
    try {

        const { rows } = await db.query(`
            SELECT
                column_name,
                data_type
            FROM information_schema.columns
            WHERE table_name = 'live_rooms'
            ORDER BY ordinal_position
        `);

        console.table(rows);

        process.exit(0);

    } catch (err) {

        console.error(err);
        process.exit(1);

    }
}

checkLiveRoomColumns();