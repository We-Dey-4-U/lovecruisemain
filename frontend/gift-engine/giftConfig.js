/* ============================================================
   gift-engine/giftConfig.js   [NEW FILE]
   ------------------------------------------------------------
   Single source of truth for how a gift NAME (as sent by your
   existing backend gift_transactions / gifts table) maps to a
   3D/visual treatment.

   TO ADD A NEW GIFT: add one entry here. Nothing else in the
   engine needs to change (per requirement #14, Future Expansion).

   tier: "basic" | "premium" | "legendary"
     - basic     -> lightweight, can run many at once, no camera fx
     - premium   -> full cinematic sequence, queued, non-overlapping
     - legendary -> premium + screen-wide effects, highest priority

   shape: a procedural placeholder geometry until real .glb models
   are dropped into /assets/models/ (see modelUrl, optional).
   ============================================================ */

export const GIFT_TIERS = {
  basic: { priority: 1, durationMs: 1600, allowOverlap: true },
  premium: { priority: 5, durationMs: 4200, allowOverlap: false },
  legendary: { priority: 10, durationMs: 6000, allowOverlap: false },
};

// name matching is case-insensitive against gift.name / gift_name from
// the existing gift_transactions payload. Unknown gifts fall back to
// DEFAULT_GIFT_CONFIG below (never crashes, never blocks the stream).
export const GIFT_REGISTRY = {
  // ---- Basic ----
  "rose": { tier: "basic", shape: "heart", color: 0xff3d7f, sound: null, label: "Rose" },
  "heart": { tier: "basic", shape: "heart", color: 0xff3d7f, sound: null, label: "Heart" },
  "clap": { tier: "basic", shape: "star", color: 0xffc857, sound: null, label: "Clap" },
  "kiss": { tier: "basic", shape: "heart", color: 0xff6fa3, sound: null, label: "Kiss" },
  "bouquet": { tier: "basic", shape: "flower", color: 0xff8fb3, sound: null, label: "Bouquet" },
  "birthday cake": { tier: "basic", shape: "star", color: 0xffd479, sound: null, label: "Birthday Cake" },

  // ---- Premium ----
  "golden love": { tier: "premium", shape: "heart", color: 0xffc857, sound: "assets/sounds/premium_chime.mp3", label: "Golden Love" },
  "teddy bear": { tier: "premium", shape: "box", color: 0xc98a4b, sound: "assets/sounds/premium_chime.mp3", label: "Teddy Bear" },
  "ring": { tier: "premium", shape: "ring", color: 0xffe9a8, sound: "assets/sounds/premium_chime.mp3", label: "Diamond Ring" },
  "diamond": { tier: "premium", shape: "diamond", color: 0x9ff0ff, sound: "assets/sounds/premium_chime.mp3", label: "Diamond" },
  "sports car": { tier: "premium", shape: "box", color: 0xff3d3d, sound: "assets/sounds/engine_rev.mp3", label: "Sports Car" },
  "yacht": { tier: "premium", shape: "box", color: 0x9fd8ff, sound: "assets/sounds/premium_chime.mp3", label: "Luxury Yacht" },
  "rocket": { tier: "premium", shape: "cone", color: 0xff8a3d, sound: "assets/sounds/rocket_launch.mp3", label: "Rocket" },
  "love bomb": { tier: "premium", shape: "diamond", color: 0xff3d7f, sound: "assets/sounds/premium_chime.mp3", label: "Love Bomb" },
  "magic wand": { tier: "premium", shape: "cone", color: 0xb38aff, sound: "assets/sounds/premium_chime.mp3", label: "Magic Wand" },
  "fireworks": { tier: "premium", shape: "star", color: 0xffe9a8, sound: "assets/sounds/fireworks.mp3", label: "Fireworks" },
  "private jet": { tier: "premium", shape: "cone", color: 0xdfe8ff, sound: "assets/sounds/engine_rev.mp3", label: "Private Jet" },

  // ---- Legendary ----
  "crown": { tier: "legendary", shape: "ring", color: 0xffd479, sound: "assets/sounds/legendary_fanfare.mp3", label: "King's Throne" },
  "money bag": { tier: "legendary", shape: "box", color: 0x6dff8a, sound: "assets/sounds/legendary_fanfare.mp3", label: "Money Bag" },
  "treasure chest": { tier: "legendary", shape: "box", color: 0xd4a23a, sound: "assets/sounds/legendary_fanfare.mp3", label: "Treasure Chest" },
  "dragon": { tier: "legendary", shape: "cone", color: 0x6dff8a, sound: "assets/sounds/legendary_fanfare.mp3", label: "Golden Dragon" },
  "angel wings": { tier: "legendary", shape: "ring", color: 0xffffff, sound: "assets/sounds/legendary_fanfare.mp3", label: "Phoenix" },
  "galaxy": { tier: "legendary", shape: "diamond", color: 0xb38aff, sound: "assets/sounds/legendary_fanfare.mp3", label: "Galaxy" },
  "love castle": { tier: "legendary", shape: "box", color: 0xff3d7f, sound: "assets/sounds/legendary_fanfare.mp3", label: "Love Kingdom" },
  "infinity heart": { tier: "legendary", shape: "heart", color: 0xff3d7f, sound: "assets/sounds/legendary_fanfare.mp3", label: "Universe" },
  "castle": { tier: "legendary", shape: "box", color: 0xffd479, sound: "assets/sounds/legendary_fanfare.mp3", label: "Love Kingdom" },
};

export const DEFAULT_GIFT_CONFIG = {
  tier: "basic",
  shape: "heart",
  color: 0xff3d7f,
  sound: null,
  label: "Gift",
};

export function resolveGiftConfig(giftNameRaw) {
  const key = String(giftNameRaw || "").trim().toLowerCase();
  const cfg = GIFT_REGISTRY[key] || DEFAULT_GIFT_CONFIG;
  return { ...cfg, tierInfo: GIFT_TIERS[cfg.tier] || GIFT_TIERS.basic };
}