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

        const idColumn = rows.find(
            col => col.column_name === "id"
        );

        if (idColumn) {
            console.log("✅ id column exists");
        } else {
            console.log("❌ id column NOT found");
        }

        process.exit(0);

    } catch (err) {

        console.error(err);
        process.exit(1);

    }
}

check();