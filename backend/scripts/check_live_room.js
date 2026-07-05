require("dotenv").config();

console.log("🚀 Live Room Check Started");

const db = require("../src/config/db");

async function check() {
  try {
    const userId = process.argv[2];

    if (!userId) {
      console.log("❌ Please provide userId");
      console.log("Example:");
      console.log("node scripts/check_live_room.js <user_id>");
      process.exit(1);
    }

    console.log("📡 Checking user_presence for user:");
    console.log(userId);

    const { rows: presence } = await db.query(
      `
      SELECT *
      FROM user_presence
      WHERE user_id = $1
      `,
      [userId]
    );

    console.log("\n👤 USER PRESENCE:");
    console.table(presence);

    if (presence.length && presence[0].current_room_id) {
      console.log("\n🏠 Checking live room details...");

      const { rows: room } = await db.query(
        `
        SELECT *
        FROM live_rooms
        WHERE id = $1
        `,
        [presence[0].current_room_id]
      );

      console.log("\n🎥 LIVE ROOM:");
      console.table(room);
    } else {
      console.log("\n⚠️ User is NOT in a live room");
    }

    process.exit(0);

  } catch (err) {
    console.error("❌ Check failed");
    console.error(err);
    process.exit(1);
  }
}

check();