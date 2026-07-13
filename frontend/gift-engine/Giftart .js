/* ============================================================
   gift-engine/GiftArt.js   [NEW FILE]
   ------------------------------------------------------------
   Draws a beautiful, GIFT-SPECIFIC illustration onto a <canvas>
   using only gradients/shapes — no external image files, so
   nothing can 404 and there's zero copyright risk (we are not
   copying TikTok/Chatta artwork, just taking inspiration from
   "the picture should look like the gift").

   Each gift in giftConfig.js has an `art` key. Add a new gift?
   Add one new `case` below (or reuse an existing one) — nothing
   else in the engine needs to change.

   Everything is cached (see GiftFactory.js), so this only runs
   once per gift type, not once per animation.
   ============================================================ */

const SIZE = 512;
const CX = SIZE / 2;
const CY = SIZE / 2;

function canvas() {
  const c = document.createElement("canvas");
  c.width = SIZE; c.height = SIZE;
  return c;
}

function glow(ctx, color, radius = 230) {
  const g = ctx.createRadialGradient(CX, CY, 0, CX, CY, radius);
  g.addColorStop(0, color + "cc");
  g.addColorStop(0.5, color + "33");
  g.addColorStop(1, color + "00");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SIZE, SIZE);
}

function sparkles(ctx, cx, cy, spread, count = 10, color = "#ffffff") {
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = spread * (0.4 + Math.random() * 0.6);
    const s = 2 + Math.random() * 3;
    ctx.globalAlpha = 0.5 + Math.random() * 0.5;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/* Layered flower — used by rose / golden love / bouquet, colors differ */
function flower(ctx, { cx, cy, petalColors, petals = 6, layers = 5, stem = false }) {
  if (stem) {
    ctx.strokeStyle = "#2e7d32"; ctx.lineWidth = 9; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx, cy + 55);
    ctx.quadraticCurveTo(cx - 18, cy + 130, cx, cy + 190);
    ctx.stroke();
    ctx.fillStyle = "#3fa34d";
    ctx.beginPath();
    ctx.ellipse(cx - 26, cy + 110, 24, 11, -0.6, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let layer = 0; layer < layers; layer++) {
    const r = 90 - layer * 12;
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * Math.PI * 2 + layer * (Math.PI / petals);
      const px = cx + Math.cos(a) * r * 0.42;
      const py = cy + Math.sin(a) * r * 0.42 - (stem ? 30 : 0);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(a);
      const grad = ctx.createLinearGradient(0, -r * 0.7, 0, r * 0.7);
      grad.addColorStop(0, petalColors.light);
      grad.addColorStop(1, petalColors.layers[layer % petalColors.layers.length]);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.5, r * 0.78, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
  ctx.fillStyle = petalColors.center;
  ctx.beginPath();
  ctx.arc(cx, cy - (stem ? 30 : 0), 15, 0, Math.PI * 2);
  ctx.fill();
}

function drawRose(ctx) {
  glow(ctx, "#ff3d7f");
  flower(ctx, {
    cx: CX, cy: CY + 10, stem: true, petals: 6, layers: 5,
    petalColors: { light: "#ffb3c6", center: "#ffd1de",
      layers: ["#7a0d2e", "#c2185b", "#e63970", "#ff5c8a", "#ff8fae"] },
  });
}

function drawGoldenLove(ctx) {
  glow(ctx, "#ffc857", 260);
  flower(ctx, {
    cx: CX, cy: CY, stem: false, petals: 8, layers: 5,
    petalColors: { light: "#fff6d8", center: "#fffbe8",
      layers: ["#8a5a00", "#c8891a", "#e9b23d", "#ffd479", "#fff0c2"] },
  });
  sparkles(ctx, CX, CY, 150, 14, "#fff6d8");
}

function drawBouquet(ctx) {
  glow(ctx, "#ff8fb3");
  const offsets = [[-70, 20], [70, 20], [0, -30]];
  const colorSets = [
    { light: "#ffe1ea", center: "#fff", layers: ["#c2185b", "#ff5c8a", "#ff8fae"] },
    { light: "#fff3d6", center: "#fff", layers: ["#c8891a", "#ffd479", "#fff0c2"] },
    { light: "#f0e6ff", center: "#fff", layers: ["#7b4fa0", "#b38aff", "#dcc8ff"] },
  ];
  offsets.forEach(([dx, dy], i) => {
    flower(ctx, { cx: CX + dx, cy: CY + dy, stem: false, petals: 6, layers: 3, petalColors: colorSets[i] });
  });
}

function drawHeart(ctx, color = "#ff3d7f") {
  glow(ctx, color);
  ctx.save();
  ctx.translate(CX, CY + 20);
  ctx.scale(1.8, 1.8);
  const grad = ctx.createLinearGradient(0, -60, 0, 60);
  grad.addColorStop(0, "#ff8fae");
  grad.addColorStop(1, color);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(0, 25);
  ctx.bezierCurveTo(0, 5, -55, -10, -55, -45);
  ctx.bezierCurveTo(-55, -75, -15, -75, 0, -35);
  ctx.bezierCurveTo(15, -75, 55, -75, 55, -45);
  ctx.bezierCurveTo(55, -10, 0, 5, 0, 25);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,.5)";
  ctx.beginPath();
  ctx.ellipse(-22, -40, 12, 20, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawLips(ctx) {
  glow(ctx, "#ff3d7f");
  ctx.save();
  ctx.translate(CX, CY);
  ctx.scale(2.2, 2.2);
  ctx.fillStyle = "#e63970";
  ctx.beginPath();
  ctx.moveTo(-60, 0);
  ctx.bezierCurveTo(-40, -22, -10, -18, 0, -6);
  ctx.bezierCurveTo(10, -18, 40, -22, 60, 0);
  ctx.bezierCurveTo(35, -6, 15, 8, 0, 8);
  ctx.bezierCurveTo(-15, 8, -35, -6, -60, 0);
  ctx.fill();
  ctx.fillStyle = "#ff6f94";
  ctx.beginPath();
  ctx.moveTo(-55, 3);
  ctx.bezierCurveTo(-30, 20, 30, 20, 55, 3);
  ctx.bezierCurveTo(35, 30, -35, 30, -55, 3);
  ctx.fill();
  ctx.restore();
}

function drawStarburst(ctx, color = "#ffc857") {
  glow(ctx, color);
  ctx.save();
  ctx.translate(CX, CY);
  ctx.fillStyle = color;
  const spikes = 8, outer = 110, inner = 45;
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / (spikes * 2)) * Math.PI * 2;
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#fff9e0";
  ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  sparkles(ctx, CX, CY, 140, 8, color);
}

function drawCake(ctx) {
  glow(ctx, "#ffd479");
  ctx.save();
  ctx.translate(CX - 90, CY - 60);
  ctx.fillStyle = "#fff0d0";
  ctx.fillRect(0, 60, 180, 70);
  ctx.fillStyle = "#ffb6c8";
  ctx.fillRect(0, 40, 180, 24);
  ctx.fillStyle = "#c2185b";
  for (let i = 0; i < 6; i++) {
    ctx.beginPath(); ctx.arc(15 + i * 30, 40, 6, Math.PI, 0); ctx.fill();
  }
  for (const cx of [40, 90, 140]) {
    ctx.strokeStyle = "#e9a13a"; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(cx, 40); ctx.lineTo(cx, 5); ctx.stroke();
    ctx.fillStyle = "#ffcf5c";
    ctx.beginPath(); ctx.ellipse(cx, -6, 6, 12, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawTeddyBear(ctx) {
  glow(ctx, "#c98a4b");
  ctx.save();
  ctx.translate(CX, CY);
  ctx.fillStyle = "#b5794a";
  [[-70, -70], [70, -70]].forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 32, 0, Math.PI * 2); ctx.fill(); });
  ctx.fillStyle = "#c98a4b";
  ctx.beginPath(); ctx.arc(0, -20, 78, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#e8bf95";
  ctx.beginPath(); ctx.ellipse(0, 0, 34, 28, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#3a2a1c";
  [[-24, -35], [24, -35]].forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill(); });
  ctx.beginPath(); ctx.ellipse(0, 3, 8, 6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#3a2a1c"; ctx.lineWidth = 3; ctx.beginPath();
  ctx.moveTo(0, 9); ctx.lineTo(0, 18); ctx.moveTo(0, 18); ctx.lineTo(-10, 24);
  ctx.moveTo(0, 18); ctx.lineTo(10, 24); ctx.stroke();
  ctx.restore();
}

function drawRing(ctx) {
  glow(ctx, "#ffe9a8");
  ctx.save();
  ctx.translate(CX, CY + 40);
  const grad = ctx.createLinearGradient(-90, 0, 90, 0);
  grad.addColorStop(0, "#a67a2a"); grad.addColorStop(0.5, "#ffe9a8"); grad.addColorStop(1, "#a67a2a");
  ctx.strokeStyle = grad; ctx.lineWidth = 22;
  ctx.beginPath(); ctx.arc(0, 40, 78, 0.15 * Math.PI, 0.95 * Math.PI); ctx.stroke();
  // gem
  ctx.translate(0, -40);
  ctx.fillStyle = "#bdf3ff";
  ctx.beginPath();
  ctx.moveTo(0, -55); ctx.lineTo(38, -10); ctx.lineTo(0, 50); ctx.lineTo(-38, -10); ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#eafeff";
  ctx.beginPath(); ctx.moveTo(0, -55); ctx.lineTo(20, -15); ctx.lineTo(-20, -15); ctx.closePath(); ctx.fill();
  ctx.restore();
  sparkles(ctx, CX, CY - 40, 90, 8, "#ffffff");
}

function drawDiamond(ctx) {
  glow(ctx, "#9ff0ff", 260);
  ctx.save();
  ctx.translate(CX, CY);
  ctx.scale(1.6, 1.6);
  ctx.fillStyle = "#7fe0f0";
  ctx.beginPath();
  ctx.moveTo(0, -70); ctx.lineTo(55, -10); ctx.lineTo(0, 75); ctx.lineTo(-55, -10); ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#dffcff";
  ctx.beginPath(); ctx.moveTo(0, -70); ctx.lineTo(25, -18); ctx.lineTo(-25, -18); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = "#ffffffaa"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-55, -10); ctx.lineTo(55, -10); ctx.stroke();
  ctx.restore();
  sparkles(ctx, CX, CY, 130, 10, "#ffffff");
}

function drawCrown(ctx) {
  glow(ctx, "#ffd479", 260);
  ctx.save();
  ctx.translate(CX, CY + 20);
  const grad = ctx.createLinearGradient(0, -70, 0, 60);
  grad.addColorStop(0, "#fff2b8"); grad.addColorStop(1, "#c8891a");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(-90, 60); ctx.lineTo(-90, 0);
  ctx.lineTo(-55, 35); ctx.lineTo(-20, -35); ctx.lineTo(0, 10);
  ctx.lineTo(20, -35); ctx.lineTo(55, 35); ctx.lineTo(90, 0);
  ctx.lineTo(90, 60); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#ff3d7f";
  [[-55, 35], [0, 10], [55, 35]].forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y - 20, 8, 0, Math.PI * 2); ctx.fill(); });
  ctx.restore();
  sparkles(ctx, CX, CY, 140, 10, "#fff2b8");
}

function drawCastle(ctx) {
  glow(ctx, "#ffb3d1", 260);
  ctx.save();
  ctx.translate(CX, CY + 30);
  ctx.fillStyle = "#ffd9e8";
  ctx.fillRect(-100, -10, 200, 90);
  [-100, -34, 32, 100].forEach((x) => {
    ctx.fillStyle = "#ffc2dc";
    ctx.fillRect(x - 16, -70, 32, 70);
    ctx.fillStyle = "#c890ff";
    ctx.beginPath(); ctx.moveTo(x - 20, -70); ctx.lineTo(x, -105); ctx.lineTo(x + 20, -70); ctx.closePath(); ctx.fill();
  });
  ctx.fillStyle = "#7b4fa0";
  ctx.fillRect(-18, 30, 36, 50);
  ctx.beginPath(); ctx.arc(0, 30, 18, Math.PI, 0); ctx.fill();
  ctx.restore();
}

function drawSportsCar(ctx) {
  glow(ctx, "#ff5a4d", 260);
  ctx.save();
  ctx.translate(CX, CY + 20);
  const grad = ctx.createLinearGradient(-120, 0, 120, 0);
  grad.addColorStop(0, "#b5241a"); grad.addColorStop(0.5, "#ff5a4d"); grad.addColorStop(1, "#b5241a");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(-120, 20); ctx.quadraticCurveTo(-100, -30, -50, -35);
  ctx.quadraticCurveTo(-10, -55, 40, -35); ctx.quadraticCurveTo(100, -30, 120, 20);
  ctx.quadraticCurveTo(120, 40, 95, 40); ctx.lineTo(-95, 40); ctx.quadraticCurveTo(-120, 40, -120, 20);
  ctx.fill();
  ctx.fillStyle = "#bfe9ff";
  ctx.beginPath(); ctx.moveTo(-40, -33); ctx.quadraticCurveTo(-8, -50, 30, -33); ctx.lineTo(20, -12); ctx.lineTo(-30, -12); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#1a1a1a";
  [[-65, 42], [70, 42]].forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 22, 0, Math.PI * 2); ctx.fill(); });
  ctx.fillStyle = "#666";
  [[-65, 42], [70, 42]].forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill(); });
  // speed lines
  ctx.strokeStyle = "rgba(255,255,255,.5)"; ctx.lineWidth = 4;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath(); ctx.moveTo(-170, -10 + i * 14); ctx.lineTo(-130, -10 + i * 14); ctx.stroke();
  }
  ctx.restore();
}

function drawYacht(ctx) {
  glow(ctx, "#9fd8ff", 260);
  ctx.save();
  ctx.translate(CX, CY + 30);
  ctx.fillStyle = "#eaf7ff";
  ctx.beginPath();
  ctx.moveTo(-120, 30); ctx.lineTo(120, 30); ctx.lineTo(90, 55); ctx.lineTo(-90, 55); ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#4fa8d8";
  ctx.fillRect(-60, -30, 90, 60);
  ctx.fillStyle = "#bfe9ff";
  ctx.fillRect(-45, -18, 60, 24);
  ctx.strokeStyle = "#eaf7ff"; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(60, 30); ctx.lineTo(60, -70); ctx.stroke();
  ctx.fillStyle = "#ff5a4d";
  ctx.beginPath(); ctx.moveTo(60, -70); ctx.lineTo(60, 10); ctx.lineTo(100, 10); ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawPrivateJet(ctx) {
  glow(ctx, "#dfe8ff", 260);
  ctx.save();
  ctx.translate(CX, CY);
  ctx.rotate(-0.12);
  const grad = ctx.createLinearGradient(-150, 0, 150, 0);
  grad.addColorStop(0, "#dfe8ff"); grad.addColorStop(1, "#ffffff");
  ctx.fillStyle = grad;
  // fuselage
  ctx.beginPath();
  ctx.moveTo(-150, 6); ctx.quadraticCurveTo(-140, -14, -90, -14);
  ctx.lineTo(110, -8); ctx.quadraticCurveTo(160, -4, 160, 4);
  ctx.quadraticCurveTo(160, 12, 110, 14); ctx.lineTo(-90, 16);
  ctx.quadraticCurveTo(-140, 18, -150, 6); ctx.closePath(); ctx.fill();
  // wings
  ctx.fillStyle = "#c7d6ff";
  ctx.beginPath(); ctx.moveTo(-10, 6); ctx.lineTo(-70, 90); ctx.lineTo(-40, 90); ctx.lineTo(20, 10); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(90, 0); ctx.lineTo(150, -50); ctx.lineTo(130, -50); ctx.lineTo(75, -6); ctx.closePath(); ctx.fill();
  // tail
  ctx.fillStyle = "#a8bbff";
  ctx.beginPath(); ctx.moveTo(-150, 4); ctx.lineTo(-180, -46); ctx.lineTo(-160, -20); ctx.closePath(); ctx.fill();
  // windows
  ctx.fillStyle = "#3a5a9a";
  for (let i = 0; i < 8; i++) { ctx.beginPath(); ctx.arc(-70 + i * 24, 0, 4, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
  // contrail
  ctx.strokeStyle = "rgba(255,255,255,.4)"; ctx.lineWidth = 8; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(60, 360); ctx.quadraticCurveTo(180, 260, 320, 200); ctx.stroke();
}

function drawFireworks(ctx) {
  glow(ctx, "#ffe9a8", 280);
  const colors = ["#ff3d7f", "#ffc857", "#00d9b5", "#b38aff", "#ff8a3d"];
  const bursts = [[CX - 70, CY - 60, 55], [CX + 60, CY - 20, 45], [CX, CY + 55, 60]];
  bursts.forEach(([bx, by, r], idx) => {
    const color = colors[idx % colors.length];
    ctx.strokeStyle = color; ctx.lineWidth = 3;
    const rays = 14;
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * Math.PI * 2;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + Math.cos(a) * r, by + Math.sin(a) * r);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(bx + Math.cos(a) * r, by + Math.sin(a) * r, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  });
}

function drawGem(ctx, color = "#b38aff") {
  glow(ctx, color, 260);
  ctx.save();
  ctx.translate(CX, CY);
  ctx.scale(1.5, 1.5);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -65); ctx.lineTo(50, -12); ctx.lineTo(0, 70); ctx.lineTo(-50, -12); ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#ffffffaa";
  ctx.beginPath(); ctx.moveTo(0, -65); ctx.lineTo(22, -16); ctx.lineTo(-22, -16); ctx.closePath(); ctx.fill();
  ctx.restore();
  sparkles(ctx, CX, CY, 130, 10, color);
}

function drawMoneyBag(ctx) {
  glow(ctx, "#6dff8a", 260);
  ctx.save();
  ctx.translate(CX, CY + 20);
  ctx.fillStyle = "#c8891a";
  ctx.beginPath();
  ctx.moveTo(-60, -10); ctx.quadraticCurveTo(-80, 60, -50, 90);
  ctx.quadraticCurveTo(0, 110, 50, 90); ctx.quadraticCurveTo(80, 60, 60, -10);
  ctx.quadraticCurveTo(20, 10, 0, -10); ctx.quadraticCurveTo(-20, 10, -60, -10);
  ctx.fill();
  ctx.strokeStyle = "#8a5a00"; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(-15, -10); ctx.quadraticCurveTo(0, -35, 15, -10); ctx.stroke();
  ctx.fillStyle = "#fff2b8";
  ctx.font = "bold 42px sans-serif"; ctx.textAlign = "center";
  ctx.fillText("$", 0, 55);
  ctx.restore();
}

const DRAWERS = {
  rose: drawRose,
  goldenLove: drawGoldenLove,
  bouquet: drawBouquet,
  heart: (ctx) => drawHeart(ctx, "#ff3d7f"),
  kiss: drawLips,
  clap: (ctx) => drawStarburst(ctx, "#ffc857"),
  cake: drawCake,
  teddyBear: drawTeddyBear,
  ring: drawRing,
  diamond: drawDiamond,
  crown: drawCrown,
  castle: drawCastle,
  sportsCar: drawSportsCar,
  yacht: drawYacht,
  privateJet: drawPrivateJet,
  fireworks: drawFireworks,
  moneyBag: drawMoneyBag,
  gem: (ctx) => drawGem(ctx, "#b38aff"),
  loveGem: (ctx) => drawGem(ctx, "#ff3d7f"),
  default: (ctx) => drawStarburst(ctx, "#ff3d7f"),
};

export const GiftArt = {
  draw(key) {
    const c = canvas();
    const ctx = c.getContext("2d");
    const fn = DRAWERS[key] || DRAWERS.default;
    fn(ctx);
    return c;
  },
};