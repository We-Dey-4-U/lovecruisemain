/* ============================================================
   gift-engine/GiftSpriteAnimator.js
   ------------------------------------------------------------
   Takes the gift's own PNG (gifts.icon_url, forwarded by the
   server as payload.giftIcon) and animates THAT SAME IMAGE
   element — fly in, pulse, spin, drive across, rise up, etc. —
   instead of swapping it for a 3D model. If the PNG 404s or
   icon_url is missing, falls back to the gift's emoji so the
   stream never breaks over a missing asset.

   ─────────────────────────────────────────────────────────────
   SHARPNESS FIX v2 (this pass) — root causes of the remaining
   blur, and what changed:

   BUG 1 — RACE CONDITION (the big one):
     Previously the CSS animation (wrap.animate(...)) started
     synchronously right after the sprite was appended to the
     DOM, while the "upgrade to sharp canvas" step only ran on
     the <img>'s `load` event, asynchronously, sometime later.
     On a fast/cached connection the image frequently loaded
     mid-animation or even after it finished — so for most of
     (sometimes ALL of) the animation's duration, the browser
     was live-scaling a raw <img> with a CSS transform, which is
     exactly the degraded-quality scaling path we were trying to
     avoid. Fix: playSprite() is now async and AWAITS
     imgEl.decode() (with a safety timeout) before the sprite is
     even appended to the DOM. The canvas is pre-rendered BEFORE
     the animation starts, every time, no race possible.

   BUG 2 — NO SUPERSAMPLING FLOOR:
     The canvas backing store was sized at exactly
     sizePx * devicePixelRatio. For a source PNG that's smaller
     than the on-screen size (common for icon-style gift art),
     that's still fundamentally an upscale with no extra detail
     to recover. Fix: backing store is now sized at
     sizePx * devicePixelRatio * SUPERSAMPLE (2x), then the CSS
     box stays at sizePx — the compositor downsamples a larger
     bitmap onto the final size, which measurably sharpens edges
     versus scaling up to exactly the display size.

   BUG 3 — HAZY DOUBLE-BLUR GLOW:
     The old filter stacked two drop-shadows (14px + 28px blur)
     which produced a soft halo around every sprite — visually
     read as "blurry" even when the bitmap itself was crisp.
     Fix: single tighter drop-shadow (6px) for glow + a thin
     crisp outline layer (via a second, offset canvas draw) so
     gifts read as BOLDER without turning into a haze. Contrast/
     saturation boost increased slightly for a punchier look.

   None of this requires backend, database, or API changes —
   it's purely client-side rendering. Public API (playSprite())
   is unchanged, so GiftAnimationManager.js needs no edits.
   ============================================================ */

const MAX_DPR = 3;
const SUPERSAMPLE = 2; // render at 2x the final backing resolution, then let the compositor downsample

function makeEmojiSpan(emoji, sizePx) {
  const span = document.createElement('span');
  span.textContent = emoji || '🎁';
  span.style.cssText = `
    font-size:${Math.round(sizePx * 0.72)}px;
    line-height:1;
    display:block;
    text-rendering:optimizeLegibility;
  `;
  return span;
}

function sharpFilter(color) {
  // Tighter glow (was 14px+28px, now a single 8px) plus a bolder
  // contrast/saturation push so the gift itself reads as punchier
  // without a soft halo around it.
  return `drop-shadow(0 0 8px ${color}dd) contrast(1.14) saturate(1.25) brightness(1.03)`;
}

/**
 * Waits for an <img> to actually finish decoding pixel data,
 * not just fire the network `load` event. Falls back to a
 * short timeout so a slow/broken decode() implementation can
 * never hang the animation forever.
 */
function waitForDecode(imgEl) {
  if (imgEl.complete && imgEl.naturalWidth) {
    if (typeof imgEl.decode === 'function') {
      return imgEl.decode().catch(() => {});
    }
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    imgEl.addEventListener('load', () => {
      if (typeof imgEl.decode === 'function') {
        imgEl.decode().then(finish).catch(finish);
      } else {
        finish();
      }
    }, { once: true });
    imgEl.addEventListener('error', finish, { once: true });
    setTimeout(finish, 1200); // safety net — never block the queue forever
  });
}

/**
 * Pre-renders a loaded <img> onto a canvas sized at
 * sizePx * devicePixelRatio * SUPERSAMPLE, using high-quality
 * smoothing plus a crisp offset outline pass for boldness.
 * Returns the canvas element (CSS-sized to sizePx), or null if
 * the image has no usable pixel data (failed decode).
 */
function renderSharpCanvas(imgEl, sizePx, color) {
  const iw = imgEl.naturalWidth;
  const ih = imgEl.naturalHeight;
  if (!iw || !ih) return null;

  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  const backingSize = Math.max(1, Math.round(sizePx * dpr * SUPERSAMPLE));

  const canvas = document.createElement('canvas');
  canvas.width = backingSize;
  canvas.height = backingSize;

  canvas.style.cssText = `
    width:${sizePx}px;
    height:${sizePx}px;
    display:block;
    filter:${sharpFilter(color)};
  `;

  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // "contain" fit, matching the old object-fit:contain behavior.
  const scale = Math.min(backingSize / iw, backingSize / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  const dx = (backingSize - dw) / 2;
  const dy = (backingSize - dh) / 2;

  ctx.clearRect(0, 0, backingSize, backingSize);

  // Bold outline pass: draw the image faintly offset in 4 directions
  // at slightly boosted opacity first, so edges read thicker/bolder,
  // then draw the crisp full-opacity image on top. This reads as
  // "bolder" without blurring — it's an edge-reinforcement trick,
  // not a blur.
  const outlinePx = Math.max(1, Math.round(backingSize * 0.006));
  ctx.globalAlpha = 0.35;
  [[outlinePx, 0], [-outlinePx, 0], [0, outlinePx], [0, -outlinePx]].forEach(([ox, oy]) => {
    ctx.drawImage(imgEl, dx + ox, dy + oy, dw, dh);
  });
  ctx.globalAlpha = 1;
  ctx.drawImage(imgEl, dx, dy, dw, dh);

  return canvas;
}

function buildKeyframes(name) {
  switch (name) {
    case 'flyInGrow': // rose
      return { frames: [
        { transform: 'translate3d(-160%,-50%,0) rotate(-25deg) scale3d(.4,.4,1)', opacity: 0 },
        { transform: 'translate3d(-50%,-50%,0) rotate(0deg) scale3d(1.15,1.15,1)', opacity: 1, offset: .35 },
        { transform: 'translate3d(-50%,-62%,0) rotate(4deg) scale3d(1,1,1)', opacity: 1, offset: .75 },
        { transform: 'translate3d(-50%,-92%,0) rotate(0deg) scale3d(.85,.85,1)', opacity: 0 },
      ] };

    case 'pulseFloat': // heart
      return { frames: [
        { transform: 'translate3d(-50%,-50%,0) scale3d(.5,.5,1)', opacity: 0 },
        { transform: 'translate3d(-50%,-50%,0) scale3d(1.25,1.25,1)', opacity: 1, offset: .2 },
        { transform: 'translate3d(-50%,-55%,0) scale3d(1,1,1)', opacity: 1, offset: .4 },
        { transform: 'translate3d(-50%,-60%,0) scale3d(1.15,1.15,1)', opacity: 1, offset: .6 },
        { transform: 'translate3d(-50%,-92%,0) scale3d(.9,.9,1)', opacity: 0 },
      ] };

    case 'bounceScale': // like
      return { frames: [
        { transform: 'translate3d(-50%,-30%,0) scale3d(.3,.3,1)', opacity: 0 },
        { transform: 'translate3d(-50%,-55%,0) scale3d(1.3,1.3,1)', opacity: 1, offset: .3 },
        { transform: 'translate3d(-50%,-48%,0) scale3d(.9,.9,1)', opacity: 1, offset: .5 },
        { transform: 'translate3d(-50%,-70%,0) scale3d(1.05,1.05,1)', opacity: 1, offset: .7 },
        { transform: 'translate3d(-50%,-96%,0) scale3d(.8,.8,1)', opacity: 0 },
      ] };

    case 'flyAcrossTilt': // kiss
      return { frames: [
        { transform: 'translate3d(-220%,-50%,0) rotate(-15deg) scale3d(.7,.7,1)', opacity: 0 },
        { transform: 'translate3d(-50%,-50%,0) rotate(6deg) scale3d(1.1,1.1,1)', opacity: 1, offset: .4 },
        { transform: 'translate3d(60%,-56%,0) rotate(-4deg) scale3d(1,1,1)', opacity: 1, offset: .75 },
        { transform: 'translate3d(140%,-60%,0) rotate(0deg) scale3d(.9,.9,1)', opacity: 0 },
      ] };

    case 'spin3d': // golden love
      return { frames: [
        { transform: 'translate3d(-50%,-50%,0) scale3d(.3,.3,1) rotateY(0deg)', opacity: 0 },
        { transform: 'translate3d(-50%,-50%,0) scale3d(1.2,1.2,1) rotateY(360deg)', opacity: 1, offset: .5 },
        { transform: 'translate3d(-50%,-50%,0) scale3d(1,1,1) rotateY(720deg)', opacity: 1, offset: .85 },
        { transform: 'translate3d(-50%,-50%,0) scale3d(.9,.9,1) rotateY(760deg)', opacity: 0 },
      ], easing: 'ease-in-out' };

    case 'jumpSpin': // teddy bear
      return { frames: [
        { transform: 'translate3d(-50%,10%,0) scale3d(.5,.5,1) rotate(0deg)', opacity: 0 },
        { transform: 'translate3d(-50%,-70%,0) scale3d(1.1,1.1,1) rotate(180deg)', opacity: 1, offset: .35 },
        { transform: 'translate3d(-50%,-40%,0) scale3d(1,1,1) rotate(360deg)', opacity: 1, offset: .6 },
        { transform: 'translate3d(-50%,-55%,0) scale3d(1.05,1.05,1) rotate(360deg)', opacity: 1, offset: .8 },
        { transform: 'translate3d(-50%,-92%,0) scale3d(.85,.85,1) rotate(360deg)', opacity: 0 },
      ] };

    case 'bloomScale': // bouquet
      return { frames: [
        { transform: 'translate3d(-50%,-50%,0) scale3d(0,0,1) rotate(-8deg)', opacity: 0 },
        { transform: 'translate3d(-50%,-50%,0) scale3d(1.2,1.2,1) rotate(4deg)', opacity: 1, offset: .4 },
        { transform: 'translate3d(-50%,-56%,0) scale3d(1,1,1) rotate(-2deg)', opacity: 1, offset: .7 },
        { transform: 'translate3d(-50%,-88%,0) scale3d(.85,.85,1) rotate(0deg)', opacity: 0 },
      ] };

    case 'spinShine': // ring / diamond
      return { frames: [
        { transform: 'translate3d(-50%,-50%,0) scale3d(.4,.4,1) rotate(0deg)', opacity: 0, filter: 'brightness(1)' },
        { transform: 'translate3d(-50%,-50%,0) scale3d(1.25,1.25,1) rotate(180deg)', opacity: 1, offset: .4, filter: 'brightness(1.9)' },
        { transform: 'translate3d(-50%,-50%,0) scale3d(1,1,1) rotate(360deg)', opacity: 1, offset: .7, filter: 'brightness(1.2)' },
        { transform: 'translate3d(-50%,-82%,0) scale3d(.9,.9,1) rotate(400deg)', opacity: 0, filter: 'brightness(1)' },
      ] };

    case 'popIn': // birthday cake
      return { frames: [
        { transform: 'translate3d(-50%,-50%,0) scale3d(0,0,1)', opacity: 0 },
        { transform: 'translate3d(-50%,-50%,0) scale3d(1.25,1.25,1)', opacity: 1, offset: .3 },
        { transform: 'translate3d(-50%,-50%,0) scale3d(.95,.95,1) rotate(-4deg)', opacity: 1, offset: .5 },
        { transform: 'translate3d(-50%,-50%,0) scale3d(1.05,1.05,1) rotate(3deg)', opacity: 1, offset: .7 },
        { transform: 'translate3d(-50%,-82%,0) scale3d(.9,.9,1) rotate(0deg)', opacity: 0 },
      ] };

    case 'floatBob': // crown
      return { frames: [
        { transform: 'translate3d(-50%,10%,0) scale3d(.5,.5,1)', opacity: 0 },
        { transform: 'translate3d(-50%,-50%,0) scale3d(1.15,1.15,1)', opacity: 1, offset: .22 },
        { transform: 'translate3d(-50%,-58%,0) scale3d(1,1,1) rotate(-3deg)', opacity: 1, offset: .42 },
        { transform: 'translate3d(-50%,-48%,0) scale3d(1,1,1) rotate(3deg)', opacity: 1, offset: .62 },
        { transform: 'translate3d(-50%,-56%,0) scale3d(1,1,1) rotate(0deg)', opacity: 1, offset: .84 },
        { transform: 'translate3d(-50%,-82%,0) scale3d(.9,.9,1)', opacity: 0 },
      ] };

    case 'driveAcross': // sports car
      return { frames: [
        { transform: 'translate3d(-240%,-50%,0) scale3d(.9,.9,1) skewX(-6deg)', opacity: 0 },
        { transform: 'translate3d(-50%,-50%,0) scale3d(1.1,1.1,1) skewX(-3deg)', opacity: 1, offset: .15 },
        { transform: 'translate3d(60%,-50%,0) scale3d(1.05,1.05,1) skewX(-3deg)', opacity: 1, offset: .7 },
        { transform: 'translate3d(240%,-50%,0) scale3d(1,1,1) skewX(-6deg)', opacity: 0 },
      ], easing: 'cubic-bezier(.2,.7,.3,1)' };

    case 'sailAcross': // yacht
      return { frames: [
        { transform: 'translate3d(-220%,-40%,0) scale3d(.8,.8,1)', opacity: 0 },
        { transform: 'translate3d(-50%,-52%,0) scale3d(1.05,1.05,1)', opacity: 1, offset: .2 },
        { transform: 'translate3d(0%,-42%,0) scale3d(1,1,1)', opacity: 1, offset: .5 },
        { transform: 'translate3d(60%,-52%,0) scale3d(1,1,1)', opacity: 1, offset: .75 },
        { transform: 'translate3d(220%,-42%,0) scale3d(.9,.9,1)', opacity: 0 },
      ] };

    case 'flyAcross': // private jet
      return { frames: [
        { transform: 'translate3d(-200%,60%,0) rotate(-18deg) scale3d(.7,.7,1)', opacity: 0 },
        { transform: 'translate3d(-40%,-20%,0) rotate(-10deg) scale3d(1.1,1.1,1)', opacity: 1, offset: .35 },
        { transform: 'translate3d(40%,-70%,0) rotate(-6deg) scale3d(1,1,1)', opacity: 1, offset: .7 },
        { transform: 'translate3d(200%,-130%,0) rotate(-4deg) scale3d(.85,.85,1)', opacity: 0 },
      ] };

    case 'riseUp': // castle
      return { frames: [
        { transform: 'translate3d(-50%,80%,0) scale3d(.6,.6,1)', opacity: 0 },
        { transform: 'translate3d(-50%,-10%,0) scale3d(1.1,1.1,1)', opacity: 1, offset: .4 },
        { transform: 'translate3d(-50%,-45%,0) scale3d(1,1,1)', opacity: 1, offset: .7 },
        { transform: 'translate3d(-50%,-55%,0) scale3d(1,1,1)', opacity: 1, offset: .88 },
        { transform: 'translate3d(-50%,-72%,0) scale3d(.92,.92,1)', opacity: 0 },
      ] };

    case 'expandPulse': // fireworks
      return { frames: [
        { transform: 'translate3d(-50%,-50%,0) scale3d(.2,.2,1)', opacity: 0 },
        { transform: 'translate3d(-50%,-50%,0) scale3d(1.4,1.4,1)', opacity: 1, offset: .35 },
        { transform: 'translate3d(-50%,-50%,0) scale3d(1,1,1)', opacity: 1, offset: .55 },
        { transform: 'translate3d(-50%,-50%,0) scale3d(1.2,1.2,1)', opacity: 1, offset: .75 },
        { transform: 'translate3d(-50%,-50%,0) scale3d(1.5,1.5,1)', opacity: 0 },
      ] };

    case 'popGlow': // default fallback
    default:
      return { frames: [
        { transform: 'translate3d(-50%,-50%,0) scale3d(.3,.3,1)', opacity: 0 },
        { transform: 'translate3d(-50%,-50%,0) scale3d(1.2,1.2,1)', opacity: 1, offset: .4 },
        { transform: 'translate3d(-50%,-70%,0) scale3d(1,1,1)', opacity: 1, offset: .7 },
        { transform: 'translate3d(-50%,-92%,0) scale3d(.85,.85,1)', opacity: 0 },
      ] };
  }
}

/**
 * Builds the visual element (canvas or emoji span) to animate.
 * If iconUrl is provided, waits for it to fully decode and
 * pre-renders a sharp supersampled canvas BEFORE returning —
 * this is the key fix, the animation never starts on a raw,
 * not-yet-decoded <img>.
 */
async function buildVisual(iconUrl, emoji, sizePx, color) {
  if (!iconUrl) {
    const span = makeEmojiSpan(emoji, sizePx);
    span.style.filter = sharpFilter(color);
    return span;
  }

  const img = new Image();
  img.decoding = 'sync';
  img.src = iconUrl;

  await waitForDecode(img);

  if (!img.naturalWidth) {
    // Failed to load/decode — fall back to emoji, never break the queue.
    const span = makeEmojiSpan(emoji, sizePx);
    span.style.filter = sharpFilter(color);
    return span;
  }

  const canvas = renderSharpCanvas(img, sizePx, color);
  if (!canvas) {
    const span = makeEmojiSpan(emoji, sizePx);
    span.style.filter = sharpFilter(color);
    return span;
  }
  return canvas;
}

/**
 * Plays one gift's sprite animation. Resolves once the animation
 * finishes (or is cancelled by a queue clear/stopAll).
 * Now async: the sharp visual is fully built and decoded BEFORE
 * anything is appended to the DOM or animated.
 */
export async function playSprite({
  rootEl,
  particles,
  iconUrl,
  emoji,
  animation = 'popGlow',
  color = '#ffffff',
  particlePreset = 'sparkles',
  durationMs = 2000,
  sizePx = 140,
  basic = false,
}) {
  const visual = await buildVisual(iconUrl, emoji, sizePx, color);

  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.style.cssText = `
      position:absolute;
      will-change:transform,opacity;
      pointer-events:none;
      display:flex;
      align-items:center;
      justify-content:center;
      perspective:600px;
      backface-visibility:hidden;
    `;
    wrap.appendChild(visual);

    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let originX;
    let originY;
    if (basic) {
      originX = 24 + Math.random() * (vw - 48);
      originY = vh - 130;
    } else {
      originX = vw / 2;
      originY = vh * 0.42;
    }

    // Round to whole pixels — fractional positioning is a common,
    // easy-to-miss source of soft/blurry edges on animated layers.
    originX = Math.round(originX);
    originY = Math.round(originY);

    wrap.style.left = `${originX}px`;
    wrap.style.top = `${originY}px`;
    wrap.style.transform = 'translate3d(-50%,-50%,0)';

    rootEl.appendChild(wrap);

    // Initial burst right where the sprite starts.
    particles.burst({
      x: originX,
      y: originY,
      preset: particlePreset,
      color,
      count: basic ? 18 : 60,
    });

    let midTimer = null;
    if (!basic) {
      midTimer = setTimeout(() => {
        particles.burst({
          x: originX,
          y: originY,
          preset: particlePreset,
          color,
          count: 80,
        });
      }, durationMs * 0.5);
    }

    const { frames, easing } = buildKeyframes(animation);
    const anim = wrap.animate(frames, {
      duration: durationMs,
      easing: easing || 'ease-out',
      fill: 'forwards',
    });

    const cleanup = () => {
      if (midTimer) clearTimeout(midTimer);
      wrap.remove();
      resolve();
    };

    anim.onfinish = cleanup;
    anim.oncancel = cleanup;
  });
}