require("dotenv").config();

const db = require("../src/config/db");

async function check() {
    try {

        const { rows } = await db.query(`
            SELECT
                column_name,
                column_default
            FROM information_schema.columns
            WHERE table_name = 'live_room_viewers'
            AND column_name = 'id'
        `);

        console.table(rows);

        process.exit(0);

    } catch (err) {

        console.error(err);
        process.exit(1);
    }
}

check();