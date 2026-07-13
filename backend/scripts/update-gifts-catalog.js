require("dotenv").config();
const db = require("../src/config/db");

async function migrate() {
  try {
    console.log("==================================");
    console.log("Updating vConnect Gift Catalog...");
    console.log("==================================");

    // Update existing gifts
    await db.query(`
      UPDATE gifts
      SET
        emoji = v.emoji,
        icon_url = v.icon_url,
        animation_url = v.animation_url,
        sound_url = v.sound_url,
        animation_duration = v.animation_duration,
        animation_type = v.animation_type,
        price_coins = v.price_coins,
        category = v.category,
        sort_order = v.sort_order,
        is_golden_love = v.is_golden_love,
        is_active = TRUE
      FROM (
        VALUES
       ('Rose','🌹','/assets/gifts/rose.png',NULL,NULL,0,'none',5,'standard',1,FALSE),
('Heart','❤️','/assets/gifts/heart.png',NULL,NULL,0,'none',10,'standard',2,FALSE),
('Golden Love','💛','/assets/gifts/golden-love.png','/assets/gifts/animations/golden-love.json','/assets/gifts/sounds/golden-love.mp3',3500,'lottie',25,'standard',3,TRUE),
('Like','👍','/assets/gifts/like.png',NULL,NULL,0,'none',15,'standard',4,FALSE),
('Kiss','💋','/assets/gifts/kiss.png','/assets/gifts/animations/kiss.json',NULL,2500,'lottie',20,'standard',5,FALSE),
('Teddy Bear','🧸','/assets/gifts/teddy.png','/assets/gifts/animations/teddy.json',NULL,3500,'lottie',50,'premium',6,FALSE),
('Bouquet','💐','/assets/gifts/bouquet.png','/assets/gifts/animations/bouquet.json',NULL,3500,'lottie',75,'premium',7,FALSE),
('Diamond Ring','💍','/assets/gifts/ring.png','/assets/gifts/animations/ring.json',NULL,4000,'lottie',150,'premium',8,FALSE),
('Diamond','💎','/assets/gifts/diamond.png','/assets/gifts/animations/diamond.json',NULL,4000,'lottie',200,'premium',9,FALSE),
('Crown','👑','/assets/gifts/crown.png','/assets/gifts/animations/crown.json',NULL,4500,'lottie',500,'luxury',10,FALSE),
('Sports Car','🏎️','/assets/gifts/car.png','/assets/gifts/animations/car.json',NULL,5000,'lottie',1000,'luxury',11,FALSE),
('Yacht','🛥️','/assets/gifts/yacht.png','/assets/gifts/animations/yacht.json',NULL,6000,'lottie',2500,'luxury',12,FALSE),
('Private Jet','✈️','/assets/gifts/private-jet.png','/assets/gifts/animations/private-jet.json',NULL,7000,'lottie',5000,'luxury',13,FALSE),
('Castle','🏰','/assets/gifts/castle.png','/assets/gifts/animations/castle.json',NULL,8000,'lottie',10000,'luxury',14,FALSE),
('Fireworks','🎆','/assets/gifts/fireworks.png','/assets/gifts/animations/fireworks.json',NULL,3500,'lottie',300,'event',15,FALSE),
('Birthday Cake','🎂','/assets/gifts/cake.png','/assets/gifts/animations/cake.json',NULL,3500,'lottie',80,'event',16,FALSE)
      ) AS v(
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
        is_golden_love
      )
      WHERE gifts.name = v.name;
    `);

    console.log("✅ Existing gifts updated.");

    // Insert any missing gifts
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
        is_golden_love
      )
      SELECT *
      FROM (
        VALUES
        ('Rose','🌹','/assets/gifts/rose.webp',NULL,NULL,0,'none',5,'standard',1,FALSE),
        ('Heart','❤️','/assets/gifts/heart.webp',NULL,NULL,0,'none',10,'standard',2,FALSE),
        ('Golden Love','💛','/assets/gifts/golden-love.webp','/assets/gifts/animations/golden-love.json','/assets/gifts/sounds/golden-love.mp3',3500,'lottie',25,'standard',3,TRUE),
        ('Like','👍','/assets/gifts/like.webp',NULL,NULL,0,'none',15,'standard',4,FALSE),
        ('Kiss','💋','/assets/gifts/kiss.webp','/assets/gifts/animations/kiss.json',NULL,2500,'lottie',20,'standard',5,FALSE),
        ('Teddy Bear','🧸','/assets/gifts/teddy.webp','/assets/gifts/animations/teddy.json',NULL,3500,'lottie',50,'premium',6,FALSE),
        ('Bouquet','💐','/assets/gifts/bouquet.webp','/assets/gifts/animations/bouquet.json',NULL,3500,'lottie',75,'premium',7,FALSE),
        ('Diamond Ring','💍','/assets/gifts/ring.webp','/assets/gifts/animations/ring.json',NULL,4000,'lottie',150,'premium',8,FALSE),
        ('Diamond','💎','/assets/gifts/diamond.webp','/assets/gifts/animations/diamond.json',NULL,4000,'lottie',200,'premium',9,FALSE),
        ('Crown','👑','/assets/gifts/crown.webp','/assets/gifts/animations/crown.json',NULL,4500,'lottie',500,'luxury',10,FALSE),
        ('Sports Car','🏎️','/assets/gifts/car.webp','/assets/gifts/animations/car.json',NULL,5000,'lottie',1000,'luxury',11,FALSE),
        ('Yacht','🛥️','/assets/gifts/yacht.webp','/assets/gifts/animations/yacht.json',NULL,6000,'lottie',2500,'luxury',12,FALSE),
        ('Private Jet','✈️','/assets/gifts/private-jet.webp','/assets/gifts/animations/private-jet.json',NULL,7000,'lottie',5000,'luxury',13,FALSE),
        ('Castle','🏰','/assets/gifts/castle.webp','/assets/gifts/animations/castle.json',NULL,8000,'lottie',10000,'luxury',14,FALSE),
        ('Fireworks','🎆','/assets/gifts/fireworks.webp','/assets/gifts/animations/fireworks.json',NULL,3500,'lottie',300,'event',15,FALSE),
        ('Birthday Cake','🎂','/assets/gifts/cake.webp','/assets/gifts/animations/cake.json',NULL,3500,'lottie',80,'event',16,FALSE)
      ) AS v(
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
        is_golden_love
      )
      WHERE NOT EXISTS (
        SELECT 1
        FROM gifts g
        WHERE g.name = v.name
      );
    `);

    console.log("✅ Missing gifts inserted.");
    console.log("🎉 Gift catalog synchronized successfully.");
    process.exit(0);

  } catch (err) {
    console.error("❌ Migration failed:");
    console.error(err);
    process.exit(1);
  }
}

migrate();