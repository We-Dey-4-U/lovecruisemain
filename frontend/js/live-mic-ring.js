/* ============================================================
   live-mic-ring.js
   ------------------------------------------------------------
   Visual-only enhancement layer, shared by live.html AND
   podcast-live.html. It never touches WebRTC/socket state
   directly — it only reads:
     - DOM structure already produced by js/live.js
       (#arena, #host-card-wrap, #participants-strip,
        #local-tile, .participant-tile, #guest-frame-male,
        #guest-frame-female)
     - window.__mySocketId          (set by live.js on connect)
     - `speakingChanged`    CustomEvent (dispatched by live.js)
     - `giftLanded`         CustomEvent (dispatched by live.js)
     - `guestSeatsChanged`  CustomEvent (dispatched by live.js,
        relaying the server's "guestSeatsUpdated" truth)
     - `micSeatsChanged`    CustomEvent (dispatched by live.js,
        relaying the server's "micSeatsUpdated" truth — an array
        of 8 slots, each null or {socketId, userId})
   ...and, for seat/guest-frame actions, calls functions live.js
   exposes on window (window.claimMicSeat / window.releaseMicSeat /
   window.requestGuestSeat / window.leaveGuestSeat) which just
   emit socket events — no transport/producer/consumer logic
   lives here.

   ── SEAT SLOTS (NEW) ─────────────────────────────────────────
   Previously this file only ever rendered a tile once someone was
   already publishing media — there was nothing to tap. Now it
   creates MIC_SEAT_COUNT permanent slot elements positioned around
   the horseshoe arc, always present:
     - vacant  → dashed circle + seat number, tappable to claim
     - occupied → the real #local-tile / .participant-tile is
       docked inside it (moved into the slot's DOM, sized/laid
       out by the slot rather than by absolute left/top)
   Seat truth comes entirely from the server via `micSeatsChanged`;
   this file just reflects it and forwards taps to
   window.claimMicSeat(seatIndex) / window.releaseMicSeat().

   Responsibilities:
     1. Particle canvas background (#arena-particles)
     2. Fixed 8-slot horseshoe seat layout around the host card
     3. Animated SVG "energy lines" linking the host card to every
        OCCUPIED seat and occupied guest frame, with a brief
        brighten/thicken pulse when a gift lands
     4. Speaking-glow — toggles a `.speaking` class on the host
        card or the relevant seat tile
     5. Guest-seat docking — when the server reports someone
        occupying the "male" or "female" matchmaker frame, that
        person's tile is docked into the frame instead of sitting
        in the horseshoe ring. Tapping a vacant frame requests it;
        tapping your own occupied frame steps you back down.

   Because live.html and podcast-live.html use slightly
   different accent colors, the line/particle color is read
   from a CSS custom property on #arena (--arena-accent /
   --arena-accent-2) so each page can theme it without touching
   this file.
   ============================================================ */

(() => {
  const arena        = document.getElementById("arena");
  const hostCardWrap  = document.getElementById("host-card-wrap");
  const strip         = document.getElementById("participants-strip");
  const canvas        = document.getElementById("arena-particles");
  const svg           = document.getElementById("connection-lines");
  const localTile     = document.getElementById("local-tile");
  const guestFrameMale   = document.getElementById("guest-frame-male");
  const guestFrameFemale = document.getElementById("guest-frame-female");
  const stripHint     = document.getElementById("strip-hint");

  // Nothing to enhance on a page that doesn't use the arena layout.
  if (!arena || !hostCardWrap || !strip) return;

  const MIC_SEAT_COUNT = 8;

  const prefersReducedMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Seat slots are superseded-by-design: the old "nobody here yet"
  // hint text no longer applies since all 8 seats are always visible.
  if (stripHint) stripHint.style.display = "none";

  /* Reads the page's own accent colors so live.html (violet/magenta)
     and podcast-live.html (violet/purple) each get their own tone
     without any branching here. */
  function getAccent(varName, fallback) {
    const v = getComputedStyle(arena).getPropertyValue(varName).trim();
    return v || fallback;
  }
  function accentColors() {
    return {
      a: getAccent("--arena-accent", "#9D5CFF"),
      b: getAccent("--arena-accent-2", "#FF3D7F")
    };
  }

  function cssEscape(str) {
    return window.CSS && CSS.escape ? CSS.escape(str) : String(str).replace(/["\\]/g, "\\$&");
  }

  /* ============================================================
     PARTICLE BACKGROUND
     ============================================================ */
  let particles = [];
  let ctx = null;
  let dpr = Math.min(window.devicePixelRatio || 1, 2);

  function initParticles() {
    if (!canvas) return;
    ctx = canvas.getContext("2d");
    const count = prefersReducedMotion ? 0 : 26;
    particles = Array.from({ length: count }, () => spawnParticle());
  }

  function spawnParticle() {
    const rect = arena.getBoundingClientRect();
    return {
      x: Math.random() * rect.width,
      y: Math.random() * rect.height,
      r: 0.6 + Math.random() * 1.8,
      vy: -(0.08 + Math.random() * 0.18),
      vx: (Math.random() - 0.5) * 0.06,
      alpha: 0.12 + Math.random() * 0.28,
      twinkleSpeed: 0.4 + Math.random() * 0.8,
      twinklePhase: Math.random() * Math.PI * 2
    };
  }

  function resizeCanvas() {
    if (!canvas) return;
    const rect = arena.getBoundingClientRect();
    canvas.width  = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    canvas.style.width  = rect.width + "px";
    canvas.style.height = rect.height + "px";
  }

  function drawParticles(tSec) {
    if (!ctx || !canvas) return;
    const rect = arena.getBoundingClientRect();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const { a } = accentColors();
    const rgb = hexToRgb(a) || { r: 157, g: 92, b: 255 };

    for (const p of particles) {
      if (!prefersReducedMotion) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.y < -4) { p.y = rect.height + 4; p.x = Math.random() * rect.width; }
        if (p.x < -4) p.x = rect.width + 4;
        if (p.x > rect.width + 4) p.x = -4;
      }
      const twinkle = prefersReducedMotion
        ? p.alpha
        : p.alpha * (0.7 + 0.3 * Math.sin(tSec * p.twinkleSpeed + p.twinklePhase));

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${twinkle.toFixed(3)})`;
      ctx.fill();
    }
  }

  function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!m) return null;
    return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
  }

  /* ============================================================
     SEAT SLOTS — 8 permanent, always-visible slots placed in a
     horseshoe arc around the host card. Vacant slots are tappable
     placeholders; occupied slots dock the real tile.
     ============================================================ */
  const seatSlotEls = [];
  let micSeatsState = Array(MIC_SEAT_COUNT).fill(null);

  function createSeatSlots() {
    for (let i = 0; i < MIC_SEAT_COUNT; i++) {
      const slot = document.createElement("div");
      slot.className = "seat-slot vacant";
      slot.dataset.seatIndex = String(i);
      slot.innerHTML = `
        <div class="seat-slot-frame">
          <span class="seat-plus">+</span>
        </div>
        <div class="seat-slot-num">${i + 1}</div>
      `;
      slot.addEventListener("click", () => {
        const occupant = micSeatsState[i];
        if (occupant && occupant.socketId === window.__mySocketId) {
          window.releaseMicSeat?.();
        } else if (!occupant) {
          window.claimMicSeat?.(i);
        }
        // Occupied by someone else — tapping does nothing; seats
        // are self-serve only.
      });
      strip.appendChild(slot);
      seatSlotEls.push(slot);
    }
  }

  function tileForSocket(socketId) {
    if (!socketId) return null;
    return socketId === window.__mySocketId
      ? localTile
      : strip.querySelector(`.participant-tile[data-socket-id="${cssEscape(socketId)}"]`);
  }

  function dockSeatTile(tile, slot) {
    if (!tile || !slot) return;
    tile.classList.add("seat-docked", "seated");
    slot.appendChild(tile);
  }

  function undockSeatTile(tile) {
    if (!tile) return;
    tile.classList.remove("seat-docked", "seated");
    const home = tile === localTile ? arena : strip;
    home.appendChild(tile);
  }

  function applyMicSeats(seats) {
    micSeatsState = seats || Array(MIC_SEAT_COUNT).fill(null);

    micSeatsState.forEach((occupant, i) => {
      const slot = seatSlotEls[i];
      if (!slot) return;

      const dockedNow  = slot.querySelector(".participant-tile, #local-tile");
      const wantedTile = occupant ? tileForSocket(occupant.socketId) : null;

      if (dockedNow && dockedNow !== wantedTile) undockSeatTile(dockedNow);
      if (wantedTile && wantedTile.parentElement !== slot) dockSeatTile(wantedTile, slot);

      slot.classList.toggle("occupied", !!occupant);
      slot.classList.toggle("vacant", !occupant);
      if (!occupant) slot.classList.remove("speaking");
    });

    layoutSeatSlots();
  }

  window.addEventListener("micSeatsChanged", (e) => applyMicSeats(e.detail));

  /* ============================================================
     LAYOUT — positions the 8 fixed seat slots in a horseshoe arc
     so nothing overlaps the top bar, then feeds occupied-seat +
     occupied-guest-frame points to the connection-line renderer.
     ============================================================ */
  function guestFramePoints() {
    const arenaRect = arena.getBoundingClientRect();
    const pts = [];
    [guestFrameMale, guestFrameFemale].forEach((el) => {
      if (el && el.classList.contains("occupied")) {
        const r = el.getBoundingClientRect();
        pts.push({
          x: r.left + r.width / 2 - arenaRect.left,
          y: r.top + r.height / 2 - arenaRect.top
        });
      }
    });
    return pts;
  }

  function layoutSeatSlots() {
    const rect = arena.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const cx = rect.width * 0.5;
    const cy = rect.height * 0.47; // matches .host-card-wrap's CSS position

    const maxRadius = Math.min(rect.width * 0.42, rect.height * 0.46);
    const radius = Math.max(64, Math.min(maxRadius, Math.min(rect.width, rect.height) * 0.36));

    // Horseshoe arc (degrees, measured clockwise from straight-up)
    // skips the top ~70° sector so seats never sit under the top bar.
    const arcStart = 35;
    const arcSpan  = 290;
    const n = MIC_SEAT_COUNT;

    const seatPoints = [];
    seatSlotEls.forEach((slot, i) => {
      const theta = arcStart + (arcSpan * i) / (n - 1);
      const rad = (theta * Math.PI) / 180;
      const dx = radius * Math.sin(rad);
      const dy = -radius * Math.cos(rad);

      const marginX = 34;
      const x = Math.max(marginX, Math.min(rect.width - marginX, cx + dx));
      const y = Math.max(56, Math.min(rect.height - 12, cy + dy));

      slot.style.left = `${x}px`;
      slot.style.top  = `${y}px`;

      if (slot.classList.contains("occupied")) seatPoints.push({ x, y });
    });

    drawConnectionLines(seatPoints.concat(guestFramePoints()));
  }

  /* ============================================================
     CONNECTION LINES (host ↔ occupied seats / guest frames)
     ============================================================ */
  let pulseBoostUntil = 0;

  function drawConnectionLines(points) {
    if (!svg) return;
    const rect = arena.getBoundingClientRect();
    svg.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);

    if (!points.length) {
      svg.innerHTML = "";
      return;
    }

    const { a, b } = accentColors();
    const hostX = rect.width * 0.5;
    const hostY = rect.height * 0.47;

    const lines = points
      .map(
        (p, i) => `<line class="energy-line" data-i="${i}"
            x1="${hostX}" y1="${hostY}" x2="${p.x}" y2="${p.y}"
            stroke="url(#energyGrad)" stroke-linecap="round" />`
      )
      .join("");

    svg.innerHTML = `
      <defs>
        <linearGradient id="energyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${a}"></stop>
          <stop offset="100%" stop-color="${b}"></stop>
        </linearGradient>
      </defs>
      ${lines}
    `;
  }

  function pulseConnectionLines() {
    pulseBoostUntil = performance.now() + 900;
  }

  function tickConnectionLines(now) {
    if (!svg) return;
    const lines = svg.querySelectorAll(".energy-line");
    if (!lines.length) return;

    const boosted = now < pulseBoostUntil;
    const boostFactor = boosted ? 1 - (pulseBoostUntil - now) / 900 : 0;

    lines.forEach((line, i) => {
      const base = prefersReducedMotion
        ? 0.45
        : 0.35 + 0.18 * Math.sin(now / 900 + i);
      const opacity = boosted ? Math.min(1, base + 0.5 * (1 - boostFactor)) : base;
      const width = boosted ? 1.4 + 1.8 * (1 - boostFactor) : 1.3;
      line.setAttribute("opacity", opacity.toFixed(2));
      line.setAttribute("stroke-width", width.toFixed(2));
    });
  }

  /* ============================================================
     SPEAKING GLOW
     ============================================================ */
  window.addEventListener("speakingChanged", (e) => {
    const { socketId, isHost: hostFlag, active } = e.detail || {};

    if (hostFlag) {
      hostCardWrap.classList.toggle("speaking", !!active);
      return;
    }

    let el = null;
    if (socketId && socketId === window.__mySocketId) {
      el = localTile;
    } else if (socketId) {
      el = strip.querySelector(`.participant-tile[data-socket-id="${cssEscape(socketId)}"]`);
    }
    if (el) el.classList.toggle("speaking", !!active);

    // Reflect speaking state on whichever seat slot or guest frame
    // this socket is currently docked in, if any.
    seatSlotEls.forEach((slot) => {
      const docked = slot.querySelector(".seat-docked");
      if (docked === el) slot.classList.toggle("speaking", !!active);
    });
    [guestFrameMale, guestFrameFemale].forEach((frameEl) => {
      if (!frameEl) return;
      const docked = frameEl.querySelector(".docked");
      if (docked === el) frameEl.classList.toggle("speaking", !!active);
    });
  });

  /* ============================================================
     GIFT LANDED — brief connection-line pulse
     ============================================================ */
  window.addEventListener("giftLanded", pulseConnectionLines);

  /* ============================================================
     GUEST SEATS (matchmaker male/female slots)
     ------------------------------------------------------------
     Server truth arrives via `guestSeatsChanged`:
       { male: {socketId,userId}|null, female: {...}|null }
     We dock/undock tiles into #guest-frame-male / #guest-frame-female
     to match, then re-run layoutSeatSlots() so the connection
     lines pick up newly (un)occupied frames.
     ============================================================ */
  let guestSeatsState = { male: null, female: null };

  function dockTile(tile, frameEl) {
    if (!tile || !frameEl) return;
    tile.classList.add("docked", "seated");
    frameEl.appendChild(tile);
  }

  function undockTile(tile) {
    if (!tile) return;
    tile.classList.remove("docked", "seated");
    const home = tile === localTile ? arena : strip;
    home.appendChild(tile);
  }

  function applyGuestSeats(seats) {
    guestSeatsState = seats || { male: null, female: null };

    [["male", guestFrameMale], ["female", guestFrameFemale]].forEach(([key, frameEl]) => {
      if (!frameEl) return;
      const occupant   = guestSeatsState[key];
      const dockedNow  = frameEl.querySelector(".docked");
      const wantedTile = occupant ? tileForSocket(occupant.socketId) : null;

      if (dockedNow && dockedNow !== wantedTile) undockTile(dockedNow);
      if (wantedTile && wantedTile.parentElement !== frameEl) dockTile(wantedTile, frameEl);

      frameEl.classList.toggle("occupied", !!occupant);
      if (!occupant) frameEl.classList.remove("speaking");
    });

    layoutSeatSlots();
  }

  window.addEventListener("guestSeatsChanged", (e) => applyGuestSeats(e.detail));

  [["male", guestFrameMale], ["female", guestFrameFemale]].forEach(([key, frameEl]) => {
    if (!frameEl) return;
    frameEl.addEventListener("click", () => {
      const occupant = guestSeatsState[key];
      if (occupant?.socketId === window.__mySocketId) {
        window.leaveGuestSeat?.();
      } else if (!occupant) {
        window.requestGuestSeat?.(key);
      }
      // If the frame is occupied by someone else, tapping it does
      // nothing here — seat swapping is self-serve only for now.
    });
  });

  /* ============================================================
     DOM WATCHERS
     ------------------------------------------------------------
     Tile visibility is now driven entirely by server-truth events
     (micSeatsChanged / guestSeatsChanged) rather than by watching
     local media state, since a peer with no seat has nothing to
     show — pure audience, no camera/mic, nothing published.
     ============================================================ */

  // Remote tiles are created/destroyed dynamically by live.js.
  // We don't position them ourselves any more (seat slots do that),
  // but a newly-created tile still needs to exist somewhere before
  // the next micSeatsChanged/guestSeatsChanged event docks it.
  const stripObserver = new MutationObserver((mutations) => {
    let dirty = false;
    for (const m of mutations) {
      if (m.addedNodes.length || m.removedNodes.length) dirty = true;
    }
    if (dirty) {
      applyMicSeats(micSeatsState);
      applyGuestSeats(guestSeatsState);
    }
  });
  stripObserver.observe(strip, { childList: true, subtree: true });

  // Re-layout on resize / orientation change.
  let resizeRaf = null;
  function scheduleResize() {
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      resizeCanvas();
      layoutSeatSlots();
    });
  }

  if (window.ResizeObserver) {
    new ResizeObserver(scheduleResize).observe(arena);
  } else {
    window.addEventListener("resize", scheduleResize);
  }

  /* ============================================================
     MAIN LOOP
     ============================================================ */
  function loop(tMs) {
    const tSec = tMs / 1000;
    drawParticles(tSec);
    tickConnectionLines(tMs);
    requestAnimationFrame(loop);
  }

  function init() {
    createSeatSlots();
    resizeCanvas();
    initParticles();
    layoutSeatSlots();
    requestAnimationFrame(loop);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();