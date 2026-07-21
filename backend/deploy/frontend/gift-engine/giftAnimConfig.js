export const ANIM_TIERS = {
  basic: { priority: 1, durationMs: 1700, allowOverlap: true },
  premium: { priority: 5, durationMs: 4200, allowOverlap: false },
  legendary: { priority: 10, durationMs: 6000, allowOverlap: false },
};

const DEFAULT_ANIM = {
  tier: 'basic',
  animation: 'popGlow',
  particle: 'sparkles',
  color: '#ffffff',
  sound: null,
};

function define(cfg) {
  const tierInfo = ANIM_TIERS[cfg.tier] || ANIM_TIERS.basic;
  return { ...DEFAULT_ANIM, ...cfg, tierInfo };
}

export const GIFT_ANIM_REGISTRY = {
  'rose': define({ tier: 'basic', animation: 'flyInGrow', particle: 'petals', color: '#ff3d7f', sound: '/assets/gifts/sounds/rose.mp3' }),
  'heart': define({ tier: 'basic', animation: 'pulseFloat', particle: 'hearts', color: '#ff4d8d', sound: '/assets/gifts/sounds/heart.mp3' }),
  'like': define({ tier: 'basic', animation: 'bounceScale', particle: 'trailDots', color: '#3d9bff' }),
  'kiss': define({ tier: 'basic', animation: 'flyAcrossTilt', particle: 'lipTrail', color: '#ff75a8', sound: '/assets/gifts/sounds/kiss.mp3' }),

  'golden love': define({ tier: 'premium', animation: 'spin3d', particle: 'goldSparkles', color: '#ffc857', sound: '/assets/gifts/sounds/golden-love.mp3' }),
  'teddy bear': define({ tier: 'premium', animation: 'jumpSpin', particle: 'hearts', color: '#c98a4b' }),
  'bouquet': define({ tier: 'premium', animation: 'bloomScale', particle: 'petals', color: '#ff82b9' }),
  'diamond ring': define({ tier: 'premium', animation: 'spinShine', particle: 'diamondSparkle', color: '#ffe9a8', sound: '/assets/gifts/sounds/ring.mp3' }),
  'diamond': define({ tier: 'premium', animation: 'spinShine', particle: 'rainbowShards', color: '#9ff0ff' }),
  'birthday cake': define({ tier: 'premium', animation: 'popIn', particle: 'confetti', color: '#ffd479', sound: '/assets/gifts/sounds/birthday.mp3' }),

  'crown': define({ tier: 'legendary', animation: 'floatBob', particle: 'goldStars', color: '#ffd479' }),
  'sports car': define({ tier: 'legendary', animation: 'driveAcross', particle: 'smokeTrail', color: '#ff3d3d' }),
  'yacht': define({ tier: 'legendary', animation: 'sailAcross', particle: 'waterSplash', color: '#9fd8ff' }),
  'private jet': define({ tier: 'legendary', animation: 'flyAcross', particle: 'cloudTrail', color: '#dfe8ff' }),
  'castle': define({ tier: 'legendary', animation: 'riseUp', particle: 'fireworks', color: '#ffd479' }),
  'fireworks': define({ tier: 'legendary', animation: 'expandPulse', particle: 'fireworks', color: '#ffe9a8', sound: '/assets/gifts/sounds/fireworks.mp3' }),
};

export function resolveGiftAnim(giftNameRaw) {
  const key = String(giftNameRaw || '').trim().toLowerCase();
  return GIFT_ANIM_REGISTRY[key] || define(DEFAULT_ANIM);
}

export function hasGiftAnim(name) {
  return !!GIFT_ANIM_REGISTRY[String(name || '').trim().toLowerCase()];
}