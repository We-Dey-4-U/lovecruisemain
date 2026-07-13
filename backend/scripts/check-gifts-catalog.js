require("dotenv").config();
const db = require("../src/config/db");

async function checkGifts() {
  try {
    console.log("======================================");
    console.log("Checking vConnect Gift Catalog...");
    console.log("======================================");

    const expectedGifts = [
      "Rose",
      "Heart",
      "Golden Love",
      "Like",
      "Kiss",
      "Teddy Bear",
      "Bouquet",
      "Diamond Ring",
      "Diamond",
      "Crown",
      "Sports Car",
      "Yacht",
      "Private Jet",
      "Castle",
      "Fireworks",
      "Birthday Cake",
    ];

    const { rows } = await db.query(`
      SELECT
        name,
        emoji,
        icon_url,
        price_coins,
        category,
        sort_order,
        is_golden_love,
        is_active
      FROM gifts
      ORDER BY sort_order;
    `);

    console.log("");
    console.log(`Total Gifts Found: ${rows.length}`);
    console.log("");

    console.table(rows);

    const existing = rows.map((g) => g.name);

    const missing = expectedGifts.filter(
      (gift) => !existing.includes(gift)
    );

    if (missing.length === 0) {
      console.log("");
      console.log("✅ All 16 gifts are present.");
    } else {
      console.log("");
      console.log("❌ Missing gifts:");
      missing.forEach((gift) => console.log(`   • ${gift}`));
    }

    console.log("");

    const pngRows = rows.filter(
      (g) => g.icon_url && g.icon_url.endsWith(".png")
    );

    console.log(
      `PNG icons: ${pngRows.length}/${expectedGifts.length}`
    );

    if (pngRows.length !== expectedGifts.length) {
      console.log("");
      console.log("⚠ Some gifts still don't use PNG icons.");
      rows.forEach((g) => {
        if (!g.icon_url.endsWith(".png")) {
          console.log(`${g.name} -> ${g.icon_url}`);
        }
      });
    } else {
      console.log("✅ All gift icons use PNG.");
    }

    process.exit(0);

  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkGifts();