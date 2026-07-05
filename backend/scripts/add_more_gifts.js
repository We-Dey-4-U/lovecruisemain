require("dotenv").config();
const db = require("../src/config/db");

async function migrate() {
  try {
    console.log("Adding new gifts...");

    await db.query(`
      INSERT INTO gifts (name, emoji, price_coins, category, sort_order)
      VALUES
      ('Love Bomb', '💣', 120, 'premium', 17),
      ('Magic Wand', '🪄', 180, 'premium', 18),
      ('Rocket', '🚀', 250, 'premium', 19),
      ('Money Bag', '💰', 300, 'luxury', 20),
      ('Treasure Chest', '🧰', 400, 'luxury', 21),
      ('Dragon', '🐉', 800, 'luxury', 22),
      ('Angel Wings', '🪽', 1500, 'luxury', 23),
      ('Galaxy', '🌌', 2000, 'luxury', 24),
      ('Love Castle', '🏯', 3500, 'luxury', 25),
      ('Infinity Heart', '♾️❤️', 5000, 'luxury', 26)
      ON CONFLICT DO NOTHING;
    `);

    console.log("DONE");
    process.exit(0);

  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  }
}

migrate();