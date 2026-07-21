/* ============================================================
   gift-engine/giftAnimConfig.js
   ------------------------------------------------------------
   Replaces the old giftConfig.js (which pointed at .glb models).

   Every gift is still shown to the viewer as its own PNG
   (gifts.icon_url) — this file only decides HOW that PNG moves
   (the animation name), what particles surround it, what color
   the glow/particles use, and which tier it belongs to (which
   controls queueing/overlap behavior via QueueManager).

   Keys are lowercased gift `name` values — must match exactly
   what's in the `gifts` table (see the reset migration).
   ============================================================ */

export const ANIM_TIERS = {
  // Basic: fire-and-forget, many can play at once, short & cheap.
  basic: { priority: 1, durationMs: 1700, allowOverlap: true },

  // Premium: one at a time, screen-dim + banner, medium length.
  premium: { priority: 5, durationMs: 4200, allowOverlap: false },

  // Legendary: one at a time, biggest/longest, full-focus cinematic.
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

/* ============================================================
   REGISTRY — one entry per gift in the reset migration
   ============================================================ */
export const GIFT_ANIM_REGISTRY = {

  /* ── Basic (overlap, ~1.7s) ── */
  'rose': define({
    tier: 'basic',
    animation: 'flyInGrow',
    particle: 'petals',
    color: '#ff3d7f',
    sound: '/assets/gifts/sounds/rose.mp3',
  }),

  'heart': define({
    tier: 'basic',
    animation: 'pulseFloat',
    particle: 'hearts',
    color: '#ff4d8d',
    sound: '/assets/gifts/sounds/heart.mp3',
  }),

  'like': define({
    tier: 'basic',
    animation: 'bounceScale',
    particle: 'trailDots',
    color: '#3d9bff',
  }),

  'kiss': define({
    tier: 'basic',
    animation: 'flyAcrossTilt',
    particle: 'lipTrail',
    color: '#ff75a8',
    sound: '/assets/gifts/sounds/kiss.mp3',
  }),

  /* ── Premium (queued, ~3.5-4.5s) ── */
  'golden love': define({
    tier: 'premium',
    animation: 'spin3d',
    particle: 'goldSparkles',
    color: '#ffc857',
    sound: '/assets/gifts/sounds/golden-love.mp3',
  }),

  'teddy bear': define({
    tier: 'premium',
    animation: 'jumpSpin',
    particle: 'hearts',
    color: '#c98a4b',
  }),

  'bouquet': define({
    tier: 'premium',
    animation: 'bloomScale',
    particle: 'petals',
    color: '#ff82b9',
  }),

  'diamond ring': define({
    tier: 'premium',
    animation: 'spinShine',
    particle: 'diamondSparkle',
    color: '#ffe9a8',
    sound: '/assets/gifts/sounds/ring.mp3',
  }),

  'diamond': define({
    tier: 'premium',
    animation: 'spinShine',
    particle: 'rainbowShards',
    color: '#9ff0ff',
  }),

  'birthday cake': define({
    tier: 'premium',
    animation: 'popIn',
    particle: 'confetti',
    color: '#ffd479',
    sound: '/assets/gifts/sounds/birthday.mp3',
  }),

  /* ── Legendary (queued, ~5-6s, full-screen focus) ── */
  'crown': define({
    tier: 'legendary',
    animation: 'floatBob',
    particle: 'goldStars',
    color: '#ffd479',
  }),

  'sports car': define({
    tier: 'legendary',
    animation: 'driveAcross',
    particle: 'smokeTrail',
    color: '#ff3d3d',
  }),

  'yacht': define({
    tier: 'legendary',
    animation: 'sailAcross',
    particle: 'waterSplash',
    color: '#9fd8ff',
  }),

  'private jet': define({
    tier: 'legendary',
    animation: 'flyAcross',
    particle: 'cloudTrail',
    color: '#dfe8ff',
  }),

  'castle': define({
    tier: 'legendary',
    animation: 'riseUp',
    particle: 'fireworks',
    color: '#ffd479',
  }),

  'fireworks': define({
    tier: 'legendary',
    animation: 'expandPulse',
    particle: 'fireworks',
    color: '#ffe9a8',
    sound: '/assets/gifts/sounds/fireworks.mp3',
  }),
};

/**
 * Resolves a gift name (any case/spacing) to its animation profile.
 * Falls back to a generic pop+glow+sparkles basic animation for any
 * gift added to the DB later that hasn't been given a bespoke profile.
 */
export function resolveGiftAnim(giftNameRaw) {
  const key = String(giftNameRaw || '').trim().toLowerCase();
  return GIFT_ANIM_REGISTRY[key] || define(DEFAULT_ANIM);
}

export function hasGiftAnim(name) {
  return !!GIFT_ANIM_REGISTRY[String(name || '').trim().toLowerCase()];
}