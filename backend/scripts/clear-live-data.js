require("dotenv").config();

const db = require("../src/config/db");

async function run() {
  try {
    console.log("🧹 Deleting all livestream data...");

    // Delete viewer history
    const viewers = await db.query(`
      DELETE FROM live_room_viewers;
    `);
    console.log(`✅ Deleted ${viewers.rowCount} viewer records.`);

    // Delete room members
    const members = await db.query(`
      DELETE FROM room_members;
    `);
    console.log(`✅ Deleted ${members.rowCount} room member records.`);

    // Delete live rooms
    const rooms = await db.query(`
      DELETE FROM live_rooms;
    `);
    console.log(`✅ Deleted ${rooms.rowCount} live rooms.`);

    // Reset presence
    await db.query(`
      UPDATE user_presence
      SET current_room_id = NULL;
    `);

    console.log("✅ User presence reset.");
    console.log("🎉 Livestream data cleared successfully.");

    process.exit(0);

  } catch (err) {
    console.error("❌ Failed:");
    console.error(err);
    process.exit(1);
  }
}

run();