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

   ── RESPONSIVE LAYOUT ────────────────────────────────────────
   Earlier versions positioned the 8 mic seats in a trigonometric
   horseshoe wrapped tightly around the host card. That looked
   fine at one reference size but jammed into the host card and
   guest frames on narrow/short screens, since the arc's radius
   scaled with the arena box while the host/guest circles' pixel
   sizes stayed comparatively fixed.

   Seats are now laid out with plain CSS flex-wrap in their own
   strip pinned to the bottom of the arena (see #participants-strip
   in the page's CSS) — entirely separate from the host card and
   guest frames, which live higher up. This can never overlap
   regardless of screen size: on narrow phones the row simply
   wraps to two rows of smaller circles; on wide screens it's one
   loose row. Sizing itself (host card, guest frames, seat circles)
   is handled by CSS clamp() in the page's stylesheet so it scales
   continuously with viewport width instead of jumping.

   This file no longer computes seat x/y — it just reads the real,
   already-laid-out positions of occupied seats/guest frames via
   getBoundingClientRect() to draw the host↔seat connection lines.

   ── FIX-11 (LATE-JOIN SEAT SNAPSHOT — NEW) ────────────────────
   Root cause of "seat placeholders missing for viewers joining an
   existing livestream": the server already emits a full
   guestSeatsUpdated / micSeatsUpdated snapshot to every joiner
   immediately (see stream.socket.js), but this module only ever
   *applied* that state through the micSeatsChanged/guestSeatsChanged
   listeners registered below. On a fast/warm connection it's possible
   for live.js to receive and cache that first snapshot before this
   module's listeners are attached, in which case the snapshot would
   be silently missed and the seat row would fall back to showing
   only the always-rendered seat numbers with no occupancy state
   applied — exactly the reported bug.
   Fix: live.js now stores the latest snapshot it receives on
   window.__lastMicSeats / window.__lastGuestSeats *before*
   dispatching the CustomEvent. This module reads that cache once,
   right after it creates the seat slots in init(), so every viewer —
   regardless of exactly when they joined relative to script load —
   renders the complete, correct seat layout on first paint, and then
   stays in sync via the normal event listeners after that.

   Responsibilities:
     1. Particle canvas background (#arena-particles)
     2. 8 permanent seat slots — vacant (tappable "+" placeholder)
        or occupied (docks the real tile), laid out by CSS flex-wrap
     3. Animated SVG "energy lines" linking the host card to every
        OCCUPIED seat and occupied guest frame, with a brief
        brighten/thicken pulse when a gift lands
     4. Speaking-glow — toggles a `.speaking` class on the host
        card or the relevant seat tile
     5. Guest-seat docking — when the server reports someone
        occupying the "male" or "female" matchmaker frame, that
        person's tile is docked into the frame instead of sitting
        in the seat row. Tapping a vacant frame requests it;
        tapping your own occupied frame steps you back down.

   Because live.html and podcast-live.html use slightly
   different accent colors, the line color is read from a CSS
   custom property on #arena (--arena-accent / --arena-accent-2)
   so each page can theme it without touching this file.
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
     SEAT SLOTS — 8 permanent slots, laid out by plain CSS
     flex-wrap in the page's own #participants-strip styling
     (bottom-of-arena row, wraps on narrow screens). We only
     create them and toggle vacant/occupied state here; position
     is entirely the browser's doing via flexbox.
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

    refreshConnectionLines();
  }

  window.addEventListener("micSeatsChanged", (e) => applyMicSeats(e.detail));

  /* ============================================================
     CONNECTION LINES (host ↔ occupied seats / guest frames)
     ------------------------------------------------------------
     Positions are read directly from the real, already-laid-out
     DOM (getBoundingClientRect), not computed — so they stay
     correct no matter how the flex-wrap seat row reflows at any
     screen size.
     ============================================================ */
  let pulseBoostUntil = 0;

  function pointOf(el) {
    const arenaRect = arena.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return {
      x: r.left + r.width / 2 - arenaRect.left,
      y: r.top + r.height / 2 - arenaRect.top
    };
  }

  function occupiedSeatPoints() {
    return seatSlotEls
      .filter((slot) => slot.classList.contains("occupied"))
      .map(pointOf);
  }

  function occupiedGuestPoints() {
    const pts = [];
    [guestFrameMale, guestFrameFemale].forEach((el) => {
      if (el && el.classList.contains("occupied")) pts.push(pointOf(el));
    });
    return pts;
  }

  function refreshConnectionLines() {
    const points = occupiedSeatPoints().concat(occupiedGuestPoints());
    drawConnectionLines(points);
  }

  function drawConnectionLines(points) {
    if (!svg) return;
    const rect = arena.getBoundingClientRect();
    svg.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);

    if (!points.length) {
      svg.innerHTML = "";
      return;
    }

    const { a, b } = accentColors();
    const host = pointOf(hostCardWrap);

    const lines = points
      .map(
        (p, i) => `<line class="energy-line" data-i="${i}"
            x1="${host.x}" y1="${host.y}" x2="${p.x}" y2="${p.y}"
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
     to match, then refresh the connection lines so newly (un)occupied
     frames are picked up.
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

    refreshConnectionLines();
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
     Tile visibility is driven entirely by server-truth events
     (micSeatsChanged / guestSeatsChanged) rather than by watching
     local media state, since a peer with no seat has nothing to
     show — pure audience, no camera/mic, nothing published.
     ============================================================ */
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

  // Re-draw connection lines on resize / orientation change — the
  // flex-wrap seat row reflows on its own via CSS, we just need to
  // recompute line endpoints against the new positions.
  let resizeRaf = null;
  function scheduleResize() {
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      resizeCanvas();
      refreshConnectionLines();
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

    // ── FIX-11 ── Apply any seat snapshot that live.js already
    // received and cached on window before this module's own
    // micSeatsChanged/guestSeatsChanged listeners were attached.
    // This is what guarantees a viewer joining an already-active
    // livestream sees the exact same, fully-populated seat layout
    // as the host and every other viewer, on the very first paint —
    // not just after the *next* seat change happens to broadcast.
    if (window.__lastMicSeats)   applyMicSeats(window.__lastMicSeats);
    if (window.__lastGuestSeats) applyGuestSeats(window.__lastGuestSeats);

    refreshConnectionLines();
    requestAnimationFrame(loop);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();