require("dotenv").config();
const db = require("../src/config/db");

async function listUsernames() {
  try {
    console.log("========================================");
    console.log("Lovecruise Usernames");
    console.log("========================================");

    const { rows } = await db.query(`
      SELECT
        id,
        username
      FROM users
      ORDER BY username ASC;
    `);

    if (!rows.length) {
      console.log("No users found.");
      process.exit(0);
    }

    console.log(`\nTotal Users: ${rows.length}\n`);

    console.table(rows);

    console.log("\nUsernames Only:");
    console.log("----------------------------------------");

    rows.forEach((user, index) => {
      console.log(`${index + 1}. ${user.username}`);
    });

    console.log("----------------------------------------");
    console.log("✅ Username retrieval completed.");

    process.exit(0);

  } catch (err) {
    console.error("\n❌ Failed to retrieve usernames");
    console.error(err);
    process.exit(1);
  }
}

listUsernames();