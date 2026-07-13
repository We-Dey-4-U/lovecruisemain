/* ============================================================
   gift-engine/giftConfig.js
   PHASE 1 - PART 1
   Upgraded Gift Configuration

   Backward Compatible
   Ready for:
   ✓ GLB Models
   ✓ PNG Fallbacks
   ✓ Custom Animations
   ✓ Particle Presets
   ✓ Bloom
   ✓ Lighting
   ✓ Shadows
   ✓ Cinematic Effects
   ============================================================ */

export const GIFT_TIERS = {
  basic: {
    priority: 1,
    durationMs: 1600,
    allowOverlap: true,
    bloom: 0.2,
    cameraFx: false,
    particles: true,
  },

  premium: {
    priority: 5,
    durationMs: 4500,
    allowOverlap: false,
    bloom: 0.8,
    cameraFx: true,
    particles: true,
  },

  legendary: {
    priority: 10,
    durationMs: 6500,
    allowOverlap: false,
    bloom: 1.5,
    cameraFx: true,
    particles: true,
  },
};

/* ============================================================
   Default Configuration
   ============================================================ */

export const DEFAULT_GIFT_CONFIG = {

  tier: "basic",

  label: "Gift",

  color: 0xffffff,

  shape: "sphere",

  modelUrl: null,

  textureUrl: null,

  sound: null,

  animation: "basic",

  particlePreset: "sparkles",

  rarity: "common",

  scale: 1,

  bloomIntensity: 0.25,

  emissiveIntensity: 0.15,

  metallic: 0.35,

  roughness: 0.45,

  castShadow: true,

  receiveShadow: true,

  useModel: false,

  useHDR: false,

  useGlow: false,

  useParticles: true,

  useScreenFX: false,

  useCameraFX: false,

  useLightingFX: false,
};

/* ============================================================
   Helper
   ============================================================ */

function createGift(config) {

  const tierInfo = GIFT_TIERS[config.tier] || GIFT_TIERS.basic;

  return {

    ...DEFAULT_GIFT_CONFIG,

    ...config,

    tierInfo,

  };
}

/* ============================================================
   Gift Registry
   ============================================================ */

export const GIFT_REGISTRY = {

  /* ============================================================
     BASIC GIFTS
     ============================================================ */

  "rose": createGift({

    tier: "basic",

    label: "Rose",

    color: 0xff3d7f,

    shape: "heart",

    modelUrl: "assets/gifts/models/rose.glb",

    textureUrl: "assets/gifts/textures/rose.png",

    sound: "assets/gifts/sounds/rose.mp3",

    animation: "rose",

    particlePreset: "rosePetals",

    rarity: "common",

    useModel: true,

    useGlow: true,

    bloomIntensity: 0.35,

  }),

  "heart": createGift({

    tier: "basic",

    label: "Heart",

    color: 0xff4d8d,

    shape: "heart",

    modelUrl: "assets/gifts/models/heart.glb",

    textureUrl: "assets/gifts/textures/heart.png",

    animation: "heart",

    particlePreset: "hearts",

    sound: "assets/gifts/sounds/heart.mp3",

    useModel: true,

    useGlow: true,

  }),

  "kiss": createGift({

    tier: "basic",

    label: "Kiss",

    color: 0xff75a8,

    shape: "heart",

    modelUrl: "assets/gifts/models/kiss.glb",

    textureUrl: "assets/gifts/textures/kiss.png",

    animation: "kiss",

    particlePreset: "heartBurst",

    sound: "assets/gifts/sounds/kiss.mp3",

    useModel: true,

    useGlow: true,

  }),

  "clap": createGift({

    tier: "basic",

    label: "Clap",

    color: 0xffc857,

    shape: "star",

    modelUrl: "assets/gifts/models/clap.glb",

    textureUrl: "assets/gifts/textures/clap.png",

    animation: "clap",

    particlePreset: "goldSparkles",

    sound: "assets/gifts/sounds/clap.mp3",

    useModel: true,

  }),

  "bouquet": createGift({

    tier: "basic",

    label: "Bouquet",

    color: 0xff82b9,

    shape: "flower",

    modelUrl: "assets/gifts/models/bouquet.glb",

    textureUrl: "assets/gifts/textures/bouquet.png",

    animation: "bouquet",

    particlePreset: "petals",

    sound: "assets/gifts/sounds/bouquet.mp3",

    useModel: true,

    bloomIntensity: 0.45,

  }),

  "birthday cake": createGift({

    tier: "basic",

    label: "Birthday Cake",

    color: 0xffd479,

    shape: "cake",

    modelUrl: "assets/gifts/models/cake.glb",

    textureUrl: "assets/gifts/textures/cake.png",

    animation: "cake",

    particlePreset: "confetti",

    sound: "assets/gifts/sounds/birthday.mp3",

    useModel: true,

    bloomIntensity: 0.55,

  }),


    /* ============================================================
     PREMIUM GIFTS
     ============================================================ */

  "golden love": createGift({

    tier: "premium",

    label: "Golden Love",

    color: 0xffc857,

    shape: "heart",

    modelUrl: "assets/gifts/models/goldenLove.glb",

    textureUrl: "assets/gifts/textures/goldenLove.png",

    sound: "assets/gifts/sounds/premium_chime.mp3",

    animation: "goldenLove",

    particlePreset: "goldHearts",

    rarity: "rare",

    scale: 1.15,

    bloomIntensity: 0.9,

    emissiveIntensity: 0.6,

    metallic: 0.85,

    roughness: 0.18,

    castShadow: true,

    receiveShadow: true,

    useModel: true,

    useGlow: true,

    useHDR: true,

    useCameraFX: true,

    useLightingFX: true,

  }),

  "teddy bear": createGift({

    tier: "premium",

    label: "Teddy Bear",

    color: 0xc98a4b,

    shape: "box",

    modelUrl: "assets/gifts/models/teddyBear.glb",

    textureUrl: "assets/gifts/textures/teddyBear.png",

    sound: "assets/gifts/sounds/premium_chime.mp3",

    animation: "teddyBear",

    particlePreset: "hearts",

    rarity: "rare",

    scale: 1.1,

    bloomIntensity: 0.75,

    useModel: true,

    useGlow: true,

    useCameraFX: true,

  }),

  "ring": createGift({

    tier: "premium",

    label: "Diamond Ring",

    color: 0xffe9a8,

    shape: "ring",

    modelUrl: "assets/gifts/models/ring.glb",

    textureUrl: "assets/gifts/textures/ring.png",

    sound: "assets/gifts/sounds/ring.mp3",

    animation: "ring",

    particlePreset: "diamondExplosion",

    rarity: "epic",

    scale: 1.2,

    bloomIntensity: 1.2,

    emissiveIntensity: 0.8,

    metallic: 1,

    roughness: 0.05,

    useModel: true,

    useGlow: true,

    useHDR: true,

    useCameraFX: true,

    useLightingFX: true,

  }),

  "diamond": createGift({

    tier: "premium",

    label: "Diamond",

    color: 0x9ff0ff,

    shape: "diamond",

    modelUrl: "assets/gifts/models/diamond.glb",

    textureUrl: "assets/gifts/textures/diamond.png",

    sound: "assets/gifts/sounds/diamond.mp3",

    animation: "diamond",

    particlePreset: "diamondShards",

    rarity: "epic",

    scale: 1.25,

    bloomIntensity: 1.4,

    emissiveIntensity: 0.9,

    metallic: 1,

    roughness: 0,

    useModel: true,

    useGlow: true,

    useHDR: true,

    useCameraFX: true,

    useLightingFX: true,

  }),

  "sports car": createGift({

    tier: "premium",

    label: "Sports Car",

    color: 0xff3d3d,

    shape: "box",

    modelUrl: "assets/gifts/models/sportsCar.glb",

    textureUrl: "assets/gifts/textures/sportsCar.png",

    sound: "assets/gifts/sounds/car.mp3",

    animation: "sportsCar",

    particlePreset: "tireSmoke",

    rarity: "epic",

    scale: 1.4,

    bloomIntensity: 1,

    metallic: 0.9,

    roughness: 0.2,

    useModel: true,

    useGlow: true,

    useHDR: true,

    useCameraFX: true,

    useLightingFX: true,

    useScreenFX: true,

  }),

  "yacht": createGift({

    tier: "premium",

    label: "Luxury Yacht",

    color: 0x9fd8ff,

    shape: "box",

    modelUrl: "assets/gifts/models/yacht.glb",

    textureUrl: "assets/gifts/textures/yacht.png",

    sound: "assets/gifts/sounds/yacht.mp3",

    animation: "yacht",

    particlePreset: "waterSplash",

    rarity: "epic",

    scale: 1.35,

    bloomIntensity: 1,

    useModel: true,

    useGlow: true,

    useHDR: true,

  }),

  "rocket": createGift({

    tier: "premium",

    label: "Rocket",

    color: 0xff8a3d,

    shape: "cone",

    modelUrl: "assets/gifts/models/rocket.glb",

    textureUrl: "assets/gifts/textures/rocket.png",

    sound: "assets/gifts/sounds/rocket_launch.mp3",

    animation: "rocket",

    particlePreset: "rocketSmoke",

    rarity: "epic",

    scale: 1.3,

    bloomIntensity: 1.3,

    useModel: true,

    useGlow: true,

    useHDR: true,

    useCameraFX: true,

    useLightingFX: true,

    useScreenFX: true,

  }),

  "love bomb": createGift({

    tier: "premium",

    label: "Love Bomb",

    color: 0xff3d7f,

    shape: "diamond",

    modelUrl: "assets/gifts/models/loveBomb.glb",

    textureUrl: "assets/gifts/textures/loveBomb.png",

    sound: "assets/gifts/sounds/loveBomb.mp3",

    animation: "loveBomb",

    particlePreset: "heartExplosion",

    rarity: "epic",

    scale: 1.25,

    bloomIntensity: 1.2,

    useModel: true,

    useGlow: true,

    useCameraFX: true,

    useLightingFX: true,

  }),

  "magic wand": createGift({

    tier: "premium",

    label: "Magic Wand",

    color: 0xb38aff,

    shape: "cone",

    modelUrl: "assets/gifts/models/magicWand.glb",

    textureUrl: "assets/gifts/textures/magicWand.png",

    sound: "assets/gifts/sounds/magic.mp3",

    animation: "magicWand",

    particlePreset: "magicDust",

    rarity: "epic",

    scale: 1.2,

    bloomIntensity: 1.2,

    useModel: true,

    useGlow: true,

    useCameraFX: true,

    useLightingFX: true,

  }),

  "fireworks": createGift({

    tier: "premium",

    label: "Fireworks",

    color: 0xffe9a8,

    shape: "star",

    modelUrl: "assets/gifts/models/fireworks.glb",

    textureUrl: "assets/gifts/textures/fireworks.png",

    sound: "assets/gifts/sounds/fireworks.mp3",

    animation: "fireworks",

    particlePreset: "fireworks",

    rarity: "epic",

    scale: 1.4,

    bloomIntensity: 1.5,

    useModel: true,

    useGlow: true,

    useCameraFX: true,

    useLightingFX: true,

    useScreenFX: true,

  }),

  "private jet": createGift({

    tier: "premium",

    label: "Private Jet",

    color: 0xdfe8ff,

    shape: "plane",

    modelUrl: "assets/gifts/models/privateJet.glb",

    textureUrl: "assets/gifts/textures/privateJet.png",

    sound: "assets/gifts/sounds/privateJet.mp3",

    animation: "privateJet",

    particlePreset: "jetSmoke",

    rarity: "legendary",

    scale: 1.6,

    bloomIntensity: 1.5,

    emissiveIntensity: 0.9,

    metallic: 1,

    roughness: 0.08,

    useModel: true,

    useGlow: true,

    useHDR: true,

    useCameraFX: true,

    useLightingFX: true,

    useScreenFX: true,

  }),


    /* ============================================================
     LEGENDARY GIFTS
     ============================================================ */

  "crown": createGift({

    tier: "legendary",

    label: "King's Crown",

    color: 0xffd479,

    shape: "crown",

    modelUrl: "assets/gifts/models/crown.glb",

    textureUrl: "assets/gifts/textures/crown.png",

    sound: "assets/gifts/sounds/legendary_fanfare.mp3",

    animation: "crown",

    particlePreset: "goldExplosion",

    rarity: "legendary",

    scale: 1.6,

    bloomIntensity: 1.8,

    emissiveIntensity: 1,

    metallic: 1,

    roughness: 0.05,

    useModel: true,

    useGlow: true,

    useHDR: true,

    useCameraFX: true,

    useLightingFX: true,

    useScreenFX: true,

  }),

  "money bag": createGift({

    tier: "legendary",

    label: "Money Bag",

    color: 0x6dff8a,

    shape: "bag",

    modelUrl: "assets/gifts/models/moneyBag.glb",

    textureUrl: "assets/gifts/textures/moneyBag.png",

    sound: "assets/gifts/sounds/moneyBag.mp3",

    animation: "moneyBag",

    particlePreset: "coinRain",

    rarity: "legendary",

    scale: 1.5,

    bloomIntensity: 1.6,

    useModel: true,

    useGlow: true,

    useHDR: true,

    useCameraFX: true,

    useLightingFX: true,

    useScreenFX: true,

  }),

  "treasure chest": createGift({

    tier: "legendary",

    label: "Treasure Chest",

    color: 0xd4a23a,

    shape: "chest",

    modelUrl: "assets/gifts/models/treasureChest.glb",

    textureUrl: "assets/gifts/textures/treasureChest.png",

    sound: "assets/gifts/sounds/treasure.mp3",

    animation: "treasureChest",

    particlePreset: "goldCoins",

    rarity: "legendary",

    scale: 1.5,

    bloomIntensity: 1.8,

    useModel: true,

    useGlow: true,

    useHDR: true,

    useCameraFX: true,

    useLightingFX: true,

    useScreenFX: true,

  }),

  "dragon": createGift({

    tier: "legendary",

    label: "Golden Dragon",

    color: 0xffae42,

    shape: "dragon",

    modelUrl: "assets/gifts/models/dragon.glb",

    textureUrl: "assets/gifts/textures/dragon.png",

    sound: "assets/gifts/sounds/dragon.mp3",

    animation: "dragon",

    particlePreset: "dragonFire",

    rarity: "mythic",

    scale: 2,

    bloomIntensity: 2,

    emissiveIntensity: 1.2,

    useModel: true,

    useGlow: true,

    useHDR: true,

    useCameraFX: true,

    useLightingFX: true,

    useScreenFX: true,

  }),

  "angel wings": createGift({

    tier: "legendary",

    label: "Angel Wings",

    color: 0xffffff,

    shape: "wings",

    modelUrl: "assets/gifts/models/angel.glb",

    textureUrl: "assets/gifts/textures/angel.png",

    sound: "assets/gifts/sounds/angel.mp3",

    animation: "angel",

    particlePreset: "feathers",

    rarity: "mythic",

    scale: 1.7,

    bloomIntensity: 1.9,

    useModel: true,

    useGlow: true,

    useHDR: true,

    useCameraFX: true,

    useLightingFX: true,

    useScreenFX: true,

  }),

  "galaxy": createGift({

    tier: "legendary",

    label: "Galaxy",

    color: 0xb38aff,

    shape: "galaxy",

    modelUrl: "assets/gifts/models/galaxy.glb",

    textureUrl: "assets/gifts/textures/galaxy.png",

    sound: "assets/gifts/sounds/galaxy.mp3",

    animation: "galaxy",

    particlePreset: "galaxyStars",

    rarity: "mythic",

    scale: 2,

    bloomIntensity: 2,

    useModel: true,

    useGlow: true,

    useHDR: true,

    useCameraFX: true,

    useLightingFX: true,

    useScreenFX: true,

  }),

  "love castle": createGift({

    tier: "legendary",

    label: "Love Castle",

    color: 0xff3d7f,

    shape: "castle",

    modelUrl: "assets/gifts/models/loveCastle.glb",

    textureUrl: "assets/gifts/textures/loveCastle.png",

    sound: "assets/gifts/sounds/castle.mp3",

    animation: "loveCastle",

    particlePreset: "heartRain",

    rarity: "mythic",

    scale: 2,

    bloomIntensity: 2,

    useModel: true,

    useGlow: true,

    useHDR: true,

    useCameraFX: true,

    useLightingFX: true,

    useScreenFX: true,

  }),

  "infinity heart": createGift({

    tier: "legendary",

    label: "Infinity Heart",

    color: 0xff3d7f,

    shape: "heart",

    modelUrl: "assets/gifts/models/infinityHeart.glb",

    textureUrl: "assets/gifts/textures/infinityHeart.png",

    sound: "assets/gifts/sounds/infinity.mp3",

    animation: "infinityHeart",

    particlePreset: "heartUniverse",

    rarity: "mythic",

    scale: 1.8,

    bloomIntensity: 2,

    useModel: true,

    useGlow: true,

    useHDR: true,

    useCameraFX: true,

    useLightingFX: true,

    useScreenFX: true,

  }),

  "castle": createGift({

    tier: "legendary",

    label: "Castle",

    color: 0xffd479,

    shape: "castle",

    modelUrl: "assets/gifts/models/castle.glb",

    textureUrl: "assets/gifts/textures/castle.png",

    sound: "assets/gifts/sounds/castle.mp3",

    animation: "castle",

    particlePreset: "castleFireworks",

    rarity: "mythic",

    scale: 2,

    bloomIntensity: 2,

    useModel: true,

    useGlow: true,

    useHDR: true,

    useCameraFX: true,

    useLightingFX: true,

    useScreenFX: true,

  }),

};

/* ============================================================
   Public Resolver
   ============================================================ */

export function resolveGiftConfig(giftNameRaw) {

    const key = String(giftNameRaw || "")
        .trim()
        .toLowerCase();

    const config =
        GIFT_REGISTRY[key] ||
        DEFAULT_GIFT_CONFIG;

    return {

        ...config,

        tierInfo:
            GIFT_TIERS[config.tier] ||
            GIFT_TIERS.basic,

    };

}

export function getGiftConfig(name) {
    return resolveGiftConfig(name);
}

export function getAllGiftConfigs() {
    return GIFT_REGISTRY;
}

export function hasGift(name) {
    return !!GIFT_REGISTRY[String(name).trim().toLowerCase()];
}





























