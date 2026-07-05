require("dotenv").config();

const db = require("../src/config/db");

async function check() {
    try {
        console.log("🚀 Checking primary key...");

        const { rows } = await db.query(`
            SELECT
                tc.constraint_name,
                kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
                ON tc.constraint_name = kcu.constraint_name
            WHERE tc.table_name = 'live_room_viewers'
            AND tc.constraint_type = 'PRIMARY KEY'
            ORDER BY kcu.ordinal_position
        `);

        console.table(rows);

        process.exit(0);

    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

check();