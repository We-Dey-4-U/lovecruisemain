/* ============================================================
   gift-engine/GiftSpriteAnimator.js   [NEW FILE]
   ------------------------------------------------------------
   Takes the gift's own PNG (gifts.icon_url, forwarded by the
   server as payload.giftIcon) and animates THAT SAME IMAGE
   element — fly in, pulse, spin, drive across, rise up, etc. —
   instead of swapping it for a 3D model. If the PNG 404s or
   icon_url is missing, falls back to the gift's emoji so the
   stream never breaks over a missing asset.

   Public API:
     playSprite({ rootEl, particles, iconUrl, emoji, animation,
                   color, particlePreset, durationMs, sizePx, basic })
       -> Promise<void> resolved when the animation finishes.
   ============================================================ */

function makeEmojiSpan(emoji, sizePx) {
  const span = document.createElement('span');
  span.textContent = emoji || '🎁';
  span.style.cssText = `
    font-size:${Math.round(sizePx * 0.72)}px;
    line-height:1;
    display:block;
  `;
  return span;
}

/**
 * Returns { frames, easing } for element.animate(). All transforms are
 * relative to the sprite's own centered anchor (translate(-50%,-50%) is
 * the resting/center position), so every keyframe set is expressed as an
 * offset from that anchor — this keeps positioning simple regardless of
 * where the wrapper was placed in the viewport.
 */
function buildKeyframes(name) {
  switch (name) {
    case 'flyInGrow': // rose
      return { frames: [
        { transform: 'translate(-160%,-50%) rotate(-25deg) scale(.4)', opacity: 0 },
        { transform: 'translate(-50%,-50%) rotate(0deg) scale(1.15)', opacity: 1, offset: .35 },
        { transform: 'translate(-50%,-62%) rotate(4deg) scale(1)', opacity: 1, offset: .75 },
        { transform: 'translate(-50%,-92%) rotate(0deg) scale(.85)', opacity: 0 },
      ] };

    case 'pulseFloat': // heart
      return { frames: [
        { transform: 'translate(-50%,-50%) scale(.5)', opacity: 0 },
        { transform: 'translate(-50%,-50%) scale(1.25)', opacity: 1, offset: .2 },
        { transform: 'translate(-50%,-55%) scale(1)', opacity: 1, offset: .4 },
        { transform: 'translate(-50%,-60%) scale(1.15)', opacity: 1, offset: .6 },
        { transform: 'translate(-50%,-92%) scale(.9)', opacity: 0 },
      ] };

    case 'bounceScale': // like
      return { frames: [
        { transform: 'translate(-50%,-30%) scale(.3)', opacity: 0 },
        { transform: 'translate(-50%,-55%) scale(1.3)', opacity: 1, offset: .3 },
        { transform: 'translate(-50%,-48%) scale(.9)', opacity: 1, offset: .5 },
        { transform: 'translate(-50%,-70%) scale(1.05)', opacity: 1, offset: .7 },
        { transform: 'translate(-50%,-96%) scale(.8)', opacity: 0 },
      ] };

    case 'flyAcrossTilt': // kiss
      return { frames: [
        { transform: 'translate(-220%,-50%) rotate(-15deg) scale(.7)', opacity: 0 },
        { transform: 'translate(-50%,-50%) rotate(6deg) scale(1.1)', opacity: 1, offset: .4 },
        { transform: 'translate(60%,-56%) rotate(-4deg) scale(1)', opacity: 1, offset: .75 },
        { transform: 'translate(140%,-60%) rotate(0deg) scale(.9)', opacity: 0 },
      ] };

    case 'spin3d': // golden love
      return { frames: [
        { transform: 'translate(-50%,-50%) scale(.3) rotateY(0deg)', opacity: 0 },
        { transform: 'translate(-50%,-50%) scale(1.2) rotateY(360deg)', opacity: 1, offset: .5 },
        { transform: 'translate(-50%,-50%) scale(1) rotateY(720deg)', opacity: 1, offset: .85 },
        { transform: 'translate(-50%,-50%) scale(.9) rotateY(760deg)', opacity: 0 },
      ], easing: 'ease-in-out' };

    case 'jumpSpin': // teddy bear
      return { frames: [
        { transform: 'translate(-50%,10%) scale(.5) rotate(0deg)', opacity: 0 },
        { transform: 'translate(-50%,-70%) scale(1.1) rotate(180deg)', opacity: 1, offset: .35 },
        { transform: 'translate(-50%,-40%) scale(1) rotate(360deg)', opacity: 1, offset: .6 },
        { transform: 'translate(-50%,-55%) scale(1.05) rotate(360deg)', opacity: 1, offset: .8 },
        { transform: 'translate(-50%,-92%) scale(.85) rotate(360deg)', opacity: 0 },
      ] };

    case 'bloomScale': // bouquet
      return { frames: [
        { transform: 'translate(-50%,-50%) scale(0) rotate(-8deg)', opacity: 0 },
        { transform: 'translate(-50%,-50%) scale(1.2) rotate(4deg)', opacity: 1, offset: .4 },
        { transform: 'translate(-50%,-56%) scale(1) rotate(-2deg)', opacity: 1, offset: .7 },
        { transform: 'translate(-50%,-88%) scale(.85) rotate(0deg)', opacity: 0 },
      ] };

    case 'spinShine': // ring / diamond
      return { frames: [
        { transform: 'translate(-50%,-50%) scale(.4) rotate(0deg)', opacity: 0, filter: 'brightness(1)' },
        { transform: 'translate(-50%,-50%) scale(1.25) rotate(180deg)', opacity: 1, offset: .4, filter: 'brightness(1.9)' },
        { transform: 'translate(-50%,-50%) scale(1) rotate(360deg)', opacity: 1, offset: .7, filter: 'brightness(1.2)' },
        { transform: 'translate(-50%,-82%) scale(.9) rotate(400deg)', opacity: 0, filter: 'brightness(1)' },
      ] };

    case 'popIn': // birthday cake
      return { frames: [
        { transform: 'translate(-50%,-50%) scale(0)', opacity: 0 },
        { transform: 'translate(-50%,-50%) scale(1.25)', opacity: 1, offset: .3 },
        { transform: 'translate(-50%,-50%) scale(.95) rotate(-4deg)', opacity: 1, offset: .5 },
        { transform: 'translate(-50%,-50%) scale(1.05) rotate(3deg)', opacity: 1, offset: .7 },
        { transform: 'translate(-50%,-82%) scale(.9) rotate(0deg)', opacity: 0 },
      ] };

    case 'floatBob': // crown
      return { frames: [
        { transform: 'translate(-50%,10%) scale(.5)', opacity: 0 },
        { transform: 'translate(-50%,-50%) scale(1.15)', opacity: 1, offset: .22 },
        { transform: 'translate(-50%,-58%) scale(1) rotate(-3deg)', opacity: 1, offset: .42 },
        { transform: 'translate(-50%,-48%) scale(1) rotate(3deg)', opacity: 1, offset: .62 },
        { transform: 'translate(-50%,-56%) scale(1) rotate(0deg)', opacity: 1, offset: .84 },
        { transform: 'translate(-50%,-82%) scale(.9)', opacity: 0 },
      ] };

    case 'driveAcross': // sports car
      return { frames: [
        { transform: 'translate(-240%,-50%) scale(.9) skewX(-6deg)', opacity: 0 },
        { transform: 'translate(-50%,-50%) scale(1.1) skewX(-3deg)', opacity: 1, offset: .15 },
        { transform: 'translate(60%,-50%) scale(1.05) skewX(-3deg)', opacity: 1, offset: .7 },
        { transform: 'translate(240%,-50%) scale(1) skewX(-6deg)', opacity: 0 },
      ], easing: 'cubic-bezier(.2,.7,.3,1)' };

    case 'sailAcross': // yacht
      return { frames: [
        { transform: 'translate(-220%,-40%) scale(.8)', opacity: 0 },
        { transform: 'translate(-50%,-52%) scale(1.05)', opacity: 1, offset: .2 },
        { transform: 'translate(0%,-42%) scale(1)', opacity: 1, offset: .5 },
        { transform: 'translate(60%,-52%) scale(1)', opacity: 1, offset: .75 },
        { transform: 'translate(220%,-42%) scale(.9)', opacity: 0 },
      ] };

    case 'flyAcross': // private jet
      return { frames: [
        { transform: 'translate(-200%,60%) rotate(-18deg) scale(.7)', opacity: 0 },
        { transform: 'translate(-40%,-20%) rotate(-10deg) scale(1.1)', opacity: 1, offset: .35 },
        { transform: 'translate(40%,-70%) rotate(-6deg) scale(1)', opacity: 1, offset: .7 },
        { transform: 'translate(200%,-130%) rotate(-4deg) scale(.85)', opacity: 0 },
      ] };

    case 'riseUp': // castle
      return { frames: [
        { transform: 'translate(-50%,80%) scale(.6)', opacity: 0 },
        { transform: 'translate(-50%,-10%) scale(1.1)', opacity: 1, offset: .4 },
        { transform: 'translate(-50%,-45%) scale(1)', opacity: 1, offset: .7 },
        { transform: 'translate(-50%,-55%) scale(1)', opacity: 1, offset: .88 },
        { transform: 'translate(-50%,-72%) scale(.92)', opacity: 0 },
      ] };

    case 'expandPulse': // fireworks
      return { frames: [
        { transform: 'translate(-50%,-50%) scale(.2)', opacity: 0 },
        { transform: 'translate(-50%,-50%) scale(1.4)', opacity: 1, offset: .35 },
        { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: .55 },
        { transform: 'translate(-50%,-50%) scale(1.2)', opacity: 1, offset: .75 },
        { transform: 'translate(-50%,-50%) scale(1.5)', opacity: 0 },
      ] };

    case 'popGlow': // default fallback
    default:
      return { frames: [
        { transform: 'translate(-50%,-50%) scale(.3)', opacity: 0 },
        { transform: 'translate(-50%,-50%) scale(1.2)', opacity: 1, offset: .4 },
        { transform: 'translate(-50%,-70%) scale(1)', opacity: 1, offset: .7 },
        { transform: 'translate(-50%,-92%) scale(.85)', opacity: 0 },
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
    `;

    let visual;
    if (iconUrl) {
      visual = document.createElement('img');
      visual.src = iconUrl;
      visual.alt = '';
      visual.style.cssText = `
        width:${sizePx}px;
        height:${sizePx}px;
        object-fit:contain;
        filter:drop-shadow(0 0 18px ${color}aa);
        display:block;
      `;
      // If the PNG 404s or fails to decode, swap to emoji in place —
      // the animation/particles keep running either way.
      visual.addEventListener('error', () => {
        const fallback = makeEmojiSpan(emoji, sizePx);
        fallback.style.filter = `drop-shadow(0 0 18px ${color}aa)`;
        visual.replaceWith(fallback);
      }, { once: true });
    } else {
      visual = makeEmojiSpan(emoji, sizePx);
      visual.style.filter = `drop-shadow(0 0 18px ${color}aa)`;
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

    wrap.style.left = `${originX}px`;
    wrap.style.top = `${originY}px`;
    wrap.style.transform = 'translate(-50%,-50%)';

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