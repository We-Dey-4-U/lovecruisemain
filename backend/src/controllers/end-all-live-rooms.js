require("dotenv").config();

const db = require("../src/config/db");

async function endAllLiveRooms() {
  try {

    console.log("📡 Ending all active live rooms...");

    // Mark all live rooms as ended
    const result = await db.query(`
      UPDATE live_rooms
      SET
        status = 'ended',
        ended_at = NOW(),
        viewer_count = 0
      WHERE status = 'live'
      RETURNING id, title;
    `);

    console.log(`✅ Ended ${result.rowCount} live room(s).`);

    // Remove everyone from rooms
    await db.query(`
      DELETE FROM room_members;
    `);

    console.log("✅ Cleared room_members.");

    // Close all active viewer sessions
    await db.query(`
      UPDATE live_room_viewers
      SET left_at = NOW()
      WHERE left_at IS NULL;
    `);

    console.log("✅ Closed active viewer sessions.");

    // Clear presence
    await db.query(`
      UPDATE user_presence
      SET
        current_room_id = NULL,
        last_seen_at = NOW();
    `);

    console.log("✅ Cleared user presence.");

    console.log("🎉 All live rooms have been ended successfully.");

    process.exit(0);

  } catch (err) {

    console.error("❌ Migration failed:");
    console.error(err);

    process.exit(1);

  }
}

endAllLiveRooms();