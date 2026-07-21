/* ============================================================
   gift-engine/ParticleLayer2D.js   [NEW FILE]
   ------------------------------------------------------------
   Replaces ParticleSystem.js (which required a THREE.Scene).
   A single fullscreen 2D <canvas>, pooled particles, no
   allocation churn on repeated bursts. Each gift's particle
   "preset" (from giftAnimConfig.js) picks a shape + behavior
   below — sparkles/petals/hearts/confetti/smoke/water/clouds/
   fireworks/stars/shards/trail-dots.
   ============================================================ */

const POOL_SIZE = 900;

const SHAPES = {
  sparkles: 'circle',
  petals: 'petal',
  hearts: 'heart',
  trailDots: 'circle',
  lipTrail: 'petal',
  goldSparkles: 'circle',
  diamondSparkle: 'circle',
  rainbowShards: 'triangle',
  confetti: 'rect',
  goldStars: 'star',
  smokeTrail: 'circle',
  waterSplash: 'circle',
  cloudTrail: 'circle',
  fireworks: 'circle',
};

const CONFETTI_COLORS = ['#ff3d7f', '#ffc857', '#00d9b5', '#b38aff', '#3d9bff'];
const RAINBOW_COLORS = ['#ff3d7f', '#ffc857', '#3d9bff', '#6dff8a', '#b38aff'];

export class ParticleLayer2D {
  constructor(container) {
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; pointer-events:none;';
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this._resizeHandler = () => this.resize();
    window.addEventListener('resize', this._resizeHandler);
    this.resize();

    this.particles = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      this.particles.push({
        active: false, x: 0, y: 0, vx: 0, vy: 0,
        life: 0, maxLife: 0, size: 0, color: '#fff',
        shape: 'circle', rotation: 0, vr: 0,
        gravity: 0.05, drag: 0.98,
      });
    }
    this.cursor = 0;

    this._running = true;
    this._clock = performance.now();
    this._loop();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = w * this.dpr;
    this.canvas.height = h * this.dpr;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /**
   * @param {{x:number,y:number,preset?:string,color?:string,count?:number}} opts
   */
  burst({ x, y, preset = 'sparkles', color = '#ffffff', count = 40 }) {
    const shape = SHAPES[preset] || 'circle';
    const isSmoke = preset === 'smokeTrail' || preset === 'cloudTrail';
    const isWater = preset === 'waterSplash';
    const isConfetti = preset === 'confetti';
    const isFireworks = preset === 'fireworks';
    const isRainbow = preset === 'rainbowShards';

    for (let n = 0; n < count; n++) {
      const p = this.particles[this.cursor];
      this.cursor = (this.cursor + 1) % POOL_SIZE;

      p.active = true;
      p.x = x + (Math.random() - 0.5) * 24;
      p.y = y + (Math.random() - 0.5) * 24;

      const angle = isFireworks ? (n / count) * Math.PI * 2 + Math.random() * 0.2
                                 : Math.random() * Math.PI * 2;
      const speed = isSmoke ? 0.4 + Math.random() * 0.6
                  : isFireworks ? 2.5 + Math.random() * 2.5
                  : 1 + Math.random() * 3;

      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed - (isSmoke ? 1.2 : 0.5);

      p.gravity = isSmoke ? -0.008 : isWater ? 0.14 : 0.06;
      p.drag = isSmoke ? 0.985 : 0.97;

      p.size = isConfetti ? 4 + Math.random() * 4
             : isSmoke ? 10 + Math.random() * 14
             : 2.5 + Math.random() * 3.5;

      p.rotation = Math.random() * Math.PI * 2;
      p.vr = (Math.random() - 0.5) * 0.25;

      p.maxLife = isSmoke ? 1.3 + Math.random() : 0.65 + Math.random() * 0.85;
      p.life = p.maxLife;

      p.shape = shape;
      p.color = isConfetti ? CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0]
              : isRainbow ? RAINBOW_COLORS[(Math.random() * RAINBOW_COLORS.length) | 0]
              : color;
    }
  }

  update(dt) {
    for (const p of this.particles) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) { p.active = false; continue; }

      p.vx *= p.drag;
      p.vy *= p.drag;
      p.vy += p.gravity * dt * 10;

      p.x += p.vx * dt * 60 * 0.5;
      p.y += p.vy * dt * 60 * 0.5;
      p.rotation += p.vr;
    }
  }

  draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    for (const p of this.particles) {
      if (!p.active) continue;

      const alpha = Math.max(0, p.life / p.maxLife);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;

      switch (p.shape) {
        case 'petal':
          ctx.beginPath();
          ctx.ellipse(0, 0, p.size, p.size * 1.7, 0, 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'heart':
          this._drawHeart(ctx, p.size);
          break;
        case 'rect':
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
          break;
        case 'triangle':
          ctx.beginPath();
          ctx.moveTo(0, -p.size);
          ctx.lineTo(p.size, p.size);
          ctx.lineTo(-p.size, p.size);
          ctx.closePath();
          ctx.fill();
          break;
        case 'star':
          this._drawStar(ctx, p.size);
          break;
        default:
          ctx.beginPath();
          ctx.arc(0, 0, p.size, 0, Math.PI * 2);
          ctx.fill();
      }
      ctx.restore();
    }
  }

  _drawHeart(ctx, s) {
    ctx.beginPath();
    ctx.moveTo(0, s * 0.6);
    ctx.bezierCurveTo(0, 0, -s, 0, -s, -s * 0.4);
    ctx.bezierCurveTo(-s, -s, 0, -s, 0, -s * 0.3);
    ctx.bezierCurveTo(0, -s, s, -s, s, -s * 0.4);
    ctx.bezierCurveTo(s, 0, 0, 0, 0, s * 0.6);
    ctx.fill();
  }

  _drawStar(ctx, s) {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const r = i % 2 === 0 ? s : s * 0.4;
      const a = (i / 8) * Math.PI * 2;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
  }

  clear() {
    for (const p of this.particles) p.active = false;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  _loop() {
    if (!this._running) return;
    requestAnimationFrame(() => this._loop());

    const now = performance.now();
    const dt = Math.min((now - this._clock) / 1000, 0.05);
    this._clock = now;

    this.update(dt);
    this.draw();
  }

  dispose() {
    this._running = false;
    window.removeEventListener('resize', this._resizeHandler);
    this.canvas.remove();
  }
}