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
   SHARPNESS FIX (this pass): gift animations were showing but
   looked blurry/soft. Root cause: an <img> was being animated
   directly with CSS `transform: scale(...)`. Browsers drop image
   scaling quality (often to nearest-neighbor) while a transform
   is actively animating, and if the source PNG is smaller than
   the on-screen size, that live down-quality scaling makes it
   look soft — worse than the same image sitting still.

   Fix: once the PNG loads, it's pre-rendered onto an offscreen
   canvas at the real device-pixel resolution (sizePx * devicePixelRatio)
   using imageSmoothingQuality:"high", and THAT canvas — not the
   raw <img> — is what actually gets animated. The compositor now
   scales a bitmap that's already the correct high-res size, so it
   stays crisp through the whole animation instead of relying on
   the browser's degraded live-scaling. A subtle contrast/saturation
   boost is also applied so gifts read as bolder/more premium.
   ============================================================ */

const MAX_DPR = 3;

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
  // Bolder glow + a touch of contrast/saturation so the gift pops,
  // without the huge blur radius that used to soften the whole sprite.
  return `drop-shadow(0 0 14px ${color}cc) drop-shadow(0 0 28px ${color}66) contrast(1.08) saturate(1.15)`;
}

/**
 * Pre-renders a loaded <img> onto a canvas sized at the real device-pixel
 * resolution, using high-quality smoothing. Returns the canvas element
 * (CSS-sized to sizePx, backing store sized to sizePx * devicePixelRatio),
 * or null if the image hasn't actually finished decoding yet.
 */
function renderSharpCanvas(imgEl, sizePx, color) {

  const iw = imgEl.naturalWidth;
  const ih = imgEl.naturalHeight;

  if (!iw || !ih)
    return null;

  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  const backingSize = Math.max(1, Math.round(sizePx * dpr));

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
  ctx.drawImage(imgEl, dx, dy, dw, dh);

  return canvas;

}

/**
 * Returns { frames, easing } for element.animate(). All transforms are
 * relative to the sprite's own centered anchor (translate(-50%,-50%) is
 * the resting/center position), so every keyframe set is expressed as an
 * offset from that anchor — this keeps positioning simple regardless of
 * where the wrapper was placed in the viewport.

   NOTE: keyframes use translate3d/scale3d (instead of translate/scale)
   so the browser consistently promotes the sprite to its own GPU layer
   for the whole animation rather than switching layer strategy mid-flight
   — that switch is itself a common source of a visible "blur pop" partway
   through an animation.
 */
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
 * Plays one gift's sprite animation. Resolves once the animation
 * finishes (or is cancelled by a queue clear/stopAll).
 */
export function playSprite({
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

    let visual;
    let upgraded = false;

    if (iconUrl) {
      visual = document.createElement('img');
      visual.decoding = 'sync';
      visual.loading = 'eager';
      visual.src = iconUrl;
      visual.alt = '';
      visual.style.cssText = `
        width:${sizePx}px;
        height:${sizePx}px;
        object-fit:contain;
        filter:${sharpFilter(color)};
        display:block;
      `;

      // Once the PNG has actually decoded, swap it for a canvas that's
      // pre-rendered at the real device-pixel resolution with high-quality
      // smoothing. This is what keeps the sprite crisp while it's being
      // scaled up/down by the CSS animation below.
      const upgrade = () => {
        if (upgraded) return;
        const canvas = renderSharpCanvas(visual, sizePx, color);
        if (canvas) {
          upgraded = true;
          visual.replaceWith(canvas);
          visual = canvas;
        }
      };

      if (visual.complete && visual.naturalWidth) {
        // Already cached/decoded synchronously.
        upgrade();
      } else {
        visual.addEventListener('load', upgrade, { once: true });
      }

      // If the PNG 404s or fails to decode, swap to emoji in place —
      // the animation/particles keep running either way.
      visual.addEventListener('error', () => {
        const fallback = makeEmojiSpan(emoji, sizePx);
        fallback.style.filter = sharpFilter(color);
        visual.replaceWith(fallback);
        visual = fallback;
      }, { once: true });

    } else {
      visual = makeEmojiSpan(emoji, sizePx);
      visual.style.filter = sharpFilter(color);
    }

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