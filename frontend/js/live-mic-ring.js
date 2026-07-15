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
   window.requestGuestSeat / window.leaveGuestSeat / window.hostKickSeat /
   window.hostKickGuest / window.hostMuteSeat / window.hostMuteGuest)
   which just emit socket events — no transport/producer/consumer
   logic lives here.

   ══════════════════════════════════════════════════════════
   ROOT-CAUSE FIX — "seat placeholders render as bare numbers for
   viewers who join an already-live stream" (PRIORITY 1 BUG)
   ------------------------------------------------------------
   This was never a host-vs-viewer LOGIC bug. Every client — host
   or viewer — runs the exact same createSeatSlots()/applyMicSeats()
   code below, so the DOM produced is byte-identical for everyone.
   The two real causes, both fixed here:

     1) MISSING CSS. A stale copy of the page stylesheet had no
        rules at all for .seat-slot / .seat-slot-frame / .seat-plus /
        .seat-slot-num. With nothing to give them a border, size, or
        background, only the raw text (the seat number + a tiny "+")
        was visible — which reads exactly like "just seat numbers,
        no proper placeholder." Confirmed present in this pass's
        stylesheet (see the SEAT SLOTS block).

     2) RACE CONDITION on late join. The server already emits a full
        guestSeatsUpdated / micSeatsUpdated snapshot to every joiner
        immediately (see stream.socket.js). But on a fast/warm
        connection, that snapshot can arrive and be handled by
        live.js BEFORE this module's own micSeatsChanged /
        guestSeatsChanged listeners are registered (this script
        loads after live.js and does its own initParticles/layout
        work first) — so the snapshot would be silently dropped and
        the seat row would render with vacant/occupied state never
        applied for that viewer.

        FIX ("FIX-11"): live.js now caches the latest raw snapshot on
        window.__lastMicSeats / window.__lastGuestSeats *before*
        dispatching the CustomEvent. This module reads that cache
        once, right after it creates the 8 seat slots in init() —
        so every viewer, regardless of exactly when they joined
        relative to script load, renders the complete, correctly
        occupied/vacant seat layout on first paint, then stays in
        sync via the normal event listeners after that.

   Net effect: host and every viewer run identical DOM-creation code
   AND apply identical, complete occupancy state on first paint —
   there is no code path left that can show a plain number instead
   of a full seat frame.

   ── RESPONSIVE LAYOUT ────────────────────────────────────────
   The 8 mic seats live in their own flex-wrap row pinned to the
   bottom of the arena (#participants-strip) — entirely separate
   from the host card and guest frames, which live higher up via
   CSS clamp()-based sizing. This can never overlap regardless of
   screen size: on narrow phones the row wraps to two rows of
   smaller circles; on wide screens it's one loose row. This file
   never computes seat x/y — it just reads the real, already-laid
   -out positions of occupied seats/guest frames via
   getBoundingClientRect() to draw the host↔seat connection lines.

   ── NEW: HOST CONTROLS ──────────────────────────────────────
   When document.body has the "host-mode" class (set by live.js
   only for the actual host, confirmed via DB host_id — see
   stream.socket.js), every OCCUPIED seat slot and guest frame gets
   two small overlay buttons:
     ✕  — kick: calls window.hostKickSeat(i) / window.hostKickGuest(key)
     🔇 — mute: calls window.hostMuteSeat(i) / window.hostMuteGuest(key)
   These are pure UI here; the actual authority check (is this
   socket really the host?) happens server-side in stream.socket.js,
   so a non-host can never see these controls (host-mode is never
   set client-side for them) and even if they forged the emit the
   server would reject it.

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

  function isHostMode() {
    return document.body.classList.contains("host-mode");
  }

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
   HOST CONTROL OVERLAY BUTTONS (Kick / Mute)
   ------------------------------------------------------------
   Small overlay injected into an occupied seat slot or guest
   frame. The overlay is visible only when `body.host-mode`
   is active (see the stylesheet rule:

       .host-mode .seat-slot.occupied .host-ctrl-overlay {
         display: flex;
       }

   Clicking these controls never mutates local UI state
   directly. Instead, they call the `window.hostKick()` and
   `window.hostMute()` helper functions exposed by `live.js`,
   which emit the appropriate socket events.

   The server remains the single source of truth and
   broadcasts the resulting state changes through the existing
   socket events such as:

   - guestSeatsUpdated
   - micSeatsUpdated
   - removedFromSeat
   - hostMutedYou

   The UI should update only after receiving these server
   events.
   ============================================================ */

  function buildHostControlOverlay(onKick, onMute) {
    const overlay = document.createElement("div");
    overlay.className = "host-ctrl-overlay";

    const muteBtn = document.createElement("button");
    muteBtn.type = "button";
    muteBtn.className = "host-ctrl-btn host-ctrl-mute";
    muteBtn.title = "Mute this user";
    muteBtn.textContent = "🔇";
    muteBtn.addEventListener("click", (e) => { e.stopPropagation(); onMute?.(); });

    const kickBtn = document.createElement("button");
    kickBtn.type = "button";
    kickBtn.className = "host-ctrl-btn host-ctrl-kick";
    kickBtn.title = "Remove from seat";
    kickBtn.textContent = "✕";
    kickBtn.addEventListener("click", (e) => { e.stopPropagation(); onKick?.(); });

    overlay.appendChild(muteBtn);
    overlay.appendChild(kickBtn);
    return overlay;
  }

  /* ============================================================
     SEAT SLOTS — 8 permanent slots, laid out by plain CSS
     flex-wrap in the page's own #participants-strip styling
     (bottom-of-arena row, wraps on narrow screens). We only
     create them and toggle vacant/occupied state here; position
     is entirely the browser's doing via flexbox.

     createSeatSlots() runs IDENTICALLY for host and viewer — this
     is the code that guarantees every client gets the same 8 full
     seat-frame elements, never a fallback to bare numbers.
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
        // are self-serve only (host uses the overlay buttons instead).
      });

      const overlay = buildHostControlOverlay(
        () => window.hostKickSeat?.(i),
        () => window.hostMuteSeat?.(i)
      );
      slot.appendChild(overlay);

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
    // keep host-control overlay on top of the docked tile
    const overlay = slot.querySelector(".host-ctrl-overlay");
    if (overlay) slot.appendChild(overlay);
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

      // Host controls only make sense on someone else's seat.
      const overlay = slot.querySelector(".host-ctrl-overlay");
      if (overlay) {
        const isSelf = occupant && occupant.socketId === window.__mySocketId;
        overlay.classList.toggle("hidden-self", !!isSelf);
      }
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
     frames are picked up. Host-control overlays are added once, up
     front, to each guest frame (unlike seat slots, these are static
     elements already in the page HTML).
     ============================================================ */
  let guestSeatsState = { male: null, female: null };

  function ensureGuestOverlay(frameEl, key) {
    if (!frameEl || frameEl.querySelector(".host-ctrl-overlay")) return;
    const overlay = buildHostControlOverlay(
      () => window.hostKickGuest?.(key),
      () => window.hostMuteGuest?.(key)
    );
    frameEl.appendChild(overlay);
  }

  function dockTile(tile, frameEl) {
    if (!tile || !frameEl) return;
    tile.classList.add("docked", "seated");
    frameEl.insertBefore(tile, frameEl.firstChild);
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

      const overlay = frameEl.querySelector(".host-ctrl-overlay");
      if (overlay) {
        const isSelf = occupant && occupant.socketId === window.__mySocketId;
        overlay.classList.toggle("hidden-self", !!isSelf);
      }
    });

    refreshConnectionLines();
  }

  window.addEventListener("guestSeatsChanged", (e) => applyGuestSeats(e.detail));

  [["male", guestFrameMale], ["female", guestFrameFemale]].forEach(([key, frameEl]) => {
    if (!frameEl) return;
    ensureGuestOverlay(frameEl, key);
    frameEl.addEventListener("click", (e) => {
      if (e.target.closest(".host-ctrl-overlay")) return; // let overlay buttons handle their own click
      const occupant = guestSeatsState[key];
      if (occupant?.socketId === window.__mySocketId) {
        window.leaveGuestSeat?.();
      } else if (!occupant) {
        window.requestGuestSeat?.(key);
      }
      // If the frame is occupied by someone else, tapping it does
      // nothing here — seat swapping is self-serve only for the
      // occupant; the host uses the overlay buttons instead.
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

    // ── ROOT-CAUSE FIX ── Apply any seat snapshot that live.js
    // already received and cached on window before this module's
    // own micSeatsChanged/guestSeatsChanged listeners were attached.
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