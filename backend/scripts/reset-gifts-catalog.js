require("dotenv").config();
const db = require("../src/config/db");

async function migrate() {
  try {
    console.log("======================================");
    console.log("Resetting vConnect Gift Catalog...");
    console.log("======================================");

    // Start transaction
    await db.query("BEGIN");

    console.log("🗑 Removing all existing gifts...");

    // Remove everything and reset IDs
    await db.query(`
      TRUNCATE TABLE gifts RESTART IDENTITY CASCADE;
    `);

    console.log("✅ Gifts table cleared.");

    console.log("📥 Inserting fresh gift catalog...");

    await db.query(`
      INSERT INTO gifts (
        name,
        emoji,
        icon_url,
        animation_url,
        sound_url,
        animation_duration,
        animation_type,
        price_coins,
        category,
        sort_order,
        is_golden_love,
        is_active
      )
      VALUES
      ('Rose','🌹','/assets/gifts/rose.png',NULL,NULL,0,'none',5,'standard',1,FALSE,TRUE),

      ('Heart','❤️','/assets/gifts/heart.png',NULL,NULL,0,'none',10,'standard',2,FALSE,TRUE),

      ('Golden Love','💛','/assets/gifts/golden-love.png','/assets/gifts/animations/golden-love.json','/assets/gifts/sounds/golden-love.mp3',3500,'lottie',25,'standard',3,TRUE,TRUE),

      ('Like','👍','/assets/gifts/like.png',NULL,NULL,0,'none',15,'standard',4,FALSE,TRUE),

      ('Kiss','💋','/assets/gifts/kiss.png','/assets/gifts/animations/kiss.json',NULL,2500,'lottie',20,'standard',5,FALSE,TRUE),

      ('Teddy Bear','🧸','/assets/gifts/teddy.png','/assets/gifts/animations/teddy.json',NULL,3500,'lottie',50,'premium',6,FALSE,TRUE),

      ('Bouquet','💐','/assets/gifts/bouquet.png','/assets/gifts/animations/bouquet.json',NULL,3500,'lottie',75,'premium',7,FALSE,TRUE),

      ('Diamond Ring','💍','/assets/gifts/ring.png','/assets/gifts/animations/ring.json',NULL,4000,'lottie',150,'premium',8,FALSE,TRUE),

      ('Diamond','💎','/assets/gifts/diamond.png','/assets/gifts/animations/diamond.json',NULL,4000,'lottie',200,'premium',9,FALSE,TRUE),

      ('Crown','👑','/assets/gifts/crown.png','/assets/gifts/animations/crown.json',NULL,4500,'lottie',500,'luxury',10,FALSE,TRUE),

      ('Sports Car','🏎️','/assets/gifts/car.png','/assets/gifts/animations/car.json',NULL,5000,'lottie',1000,'luxury',11,FALSE,TRUE),

      ('Yacht','🛥️','/assets/gifts/yacht.png','/assets/gifts/animations/yacht.json',NULL,6000,'lottie',2500,'luxury',12,FALSE,TRUE),

      ('Private Jet','✈️','/assets/gifts/private-jet.png','/assets/gifts/animations/private-jet.json',NULL,7000,'lottie',5000,'luxury',13,FALSE,TRUE),

      ('Castle','🏰','/assets/gifts/castle.png','/assets/gifts/animations/castle.json',NULL,8000,'lottie',10000,'luxury',14,FALSE,TRUE),

      ('Fireworks','🎆','/assets/gifts/fireworks.png','/assets/gifts/animations/fireworks.json',NULL,3500,'lottie',300,'event',15,FALSE,TRUE),

      ('Birthday Cake','🎂','/assets/gifts/cake.png','/assets/gifts/animations/cake.json',NULL,3500,'lottie',80,'event',16,FALSE,TRUE);
    `);

    await db.query("COMMIT");

    console.log("======================================");
    console.log("🎉 Gift catalog reset successfully!");
    console.log("======================================");

    const { rows } = await db.query(`
      SELECT
        id,
        name,
        price_coins,
        category,
        sort_order
      FROM gifts
      ORDER BY sort_order;
    `);

    console.table(rows);

    console.log(`✅ Total Gifts: ${rows.length}`);

    process.exit(0);

  } catch (err) {
    await db.query("ROLLBACK");

    console.error("❌ Failed to reset gift catalog.");
    console.error(err);

    process.exit(1);
  }
}

migrate();