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
        of 12 slots, each null or an occupant object:
        { socketId, userId, username, avatarUrl, muted, mutedByHost })
   ...and, for seat/guest-frame actions, calls functions live.js
   exposes on window:
     window.claimMicSeat(i)      — tap a vacant seat
     window.releaseMicSeat()     — leave your seat entirely
     window.toggleMySeatMic()    — mute/unmute WITHOUT leaving
     window.requestGuestSeat(k)  — tap a vacant guest frame
     window.leaveGuestSeat()     — leave your guest frame entirely
     window.toggleMyGuestMic()   — mute/unmute WITHOUT leaving
     window.hostKickSeat(i) / window.hostKickGuest(k)
     window.hostMuteSeat(i) / window.hostMuteGuest(k)
   which just emit socket events — no transport/producer/consumer
   logic lives here.

   ══════════════════════════════════════════════════════════
   THIS PASS — 12 SEATS (4 LEFT WING / 4 RIGHT WING / 4 BOTTOM)
   ------------------------------------------------------------
   Backend (stream.socket.js) raised MIC_SEAT_COUNT from 8 → 12
   and now distributes seats as 4 left wing, 4 right wing, 4
   bottom row. This file must match that distribution exactly —
   micSeatsUpdated now arrives as a 12-element array, and index
   math below (which four indices go in which wing/row) has to
   line up with what the server assigns, or seat N on one client
   won't visually match seat N on another.

   Everything else — seats are voice-only profile-photo slots,
   mute ≠ leave, host kick/mute overlay — is UNCHANGED from the
   previous pass.

   SEATS ARE VOICE-ONLY, PROFILE-PHOTO SLOTS
   ------------------------------------------------------------
   Product decision: the only two places video ever renders are
   the host frame and the two guest frames (matchmaker male/
   female). The 12 circular mic seats never show a camera feed —
   occupied, they show the occupant's profile photo (from the
   server's seat snapshot), a mute/unmute button, and a leave-seat
   button. This is a structural change, not a CSS trick: seats no
   longer dock a <video> tile at all. applyMicSeats() below reads
   occupant.avatarUrl/username straight off the server snapshot
   and paints the seat directly — there is no tileForSocket/
   dockSeatTile path for seats any more.

   Guest frames are unchanged in that respect — they still dock
   the real participant <video> tile (dockTile/undockTile), since
   guest frames are one of the two places video is allowed.

   MUTE ≠ LEAVE
   ------------------------------------------------------------
   Previously, tapping your own occupied seat called
   releaseMicSeat() — mute and leave were the same click. That's
   fixed here: the seat now renders two small, separate buttons
   for its own occupant — a mic toggle (🎤/🔇, calls
   toggleMySeatMic()) and a leave button (⏏, calls
   releaseMicSeat()). Tapping the seat's dashed frame itself only
   ever *claims* a vacant seat; it does nothing when the seat is
   occupied (by self or anyone else) — occupied seats are managed
   exclusively through their buttons/overlay.

   HOST CONTROLS (unchanged in spirit, now toggle-aware)
   ------------------------------------------------------------
   When document.body has the "host-mode" class, every OCCUPIED
   seat slot and guest frame still gets the ✕ (kick) / 🔇 (mute)
   overlay. The mute icon now reflects the occupant's actual
   `mutedByHost` state (🔒 while host-muted) so the host can see
   at a glance who they've silenced, and clicking it again lifts
   the mute (hostMuteSeat/hostMuteGuest toggle server-side).
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

  // Raised 8 → 12 to match backend's MIC_SEAT_COUNT
  // (stream.socket.js): 4 left wing, 4 right wing, 4 bottom row.
  const MIC_SEAT_COUNT = 12;

  const prefersReducedMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Seat slots are superseded-by-design: the old "nobody here yet"
  // hint text no longer applies since all 12 seats are always visible.
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

  function avatarFallback(occupant) {
    const name = (occupant && (occupant.username || occupant.userId)) || "User";
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=9D5CFF&color=fff&size=96`;
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
   Small overlay injected into an occupied guest seat. Visible
   only when `body.host-mode` is active.

   These controls never modify the UI directly. Instead, they
   call the `window.hostKick*` / `window.hostMute*` helpers
   exposed by `live.js`, which emit the appropriate Socket.IO
   events to the server.

   The server is the single source of truth. After processing
   the request, it broadcasts the resulting state changes via
   events such as `micSeatsUpdated`, `guestSeatsUpdated`,
   `removedFromSeat`, and `hostMutedYou`. The client updates the
   interface only after receiving those events, ensuring all
   participants remain synchronized.
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
     SEAT SLOTS — 12 permanent slots, laid out by plain CSS
     flex-wrap in the page's own #participants-strip styling
     (left/right wings + bottom row, all clamp()-sized so they
     shrink together and can't overlap the host card or guest
     frames on a small screen). Occupied seats render the
     occupant's profile photo — never video — plus their own
     mute/leave controls.

     Distribution MUST match the backend's seat-index assignment
     (stream.socket.js): indices 0-3 → left wing, 4-7 → right
     wing, 8-11 → bottom row. Same rule as before, just widened
     from 2/2/4 to 4/4/4.
     ============================================================ */
  const seatSlotEls = [];
  let micSeatsState = Array(MIC_SEAT_COUNT).fill(null);

  function createSeatSlots() {
    strip.innerHTML = "";
    seatSlotEls.length = 0;

    const leftWing = document.createElement("div");
    leftWing.className = "seat-wing seat-wing-left";

    const rightWing = document.createElement("div");
    rightWing.className = "seat-wing seat-wing-right";

    const bottomRow = document.createElement("div");
    bottomRow.className = "seat-row seat-row-bottom";

    for (let i = 0; i < MIC_SEAT_COUNT; i++) {
      const slot = document.createElement("div");
      slot.className = "seat-slot vacant";
      slot.dataset.seatIndex = i;

      slot.innerHTML = `
        <div class="seat-slot-frame">
          <img class="seat-avatar" alt="">
          <span class="seat-plus">+</span>
        </div>
        <div class="seat-slot-num">${i + 1}</div>
        <div class="seat-mute-indicator" title="Muted">🔇</div>
        <div class="seat-self-controls">
          <button type="button" class="seat-self-btn seat-mute-btn" title="Mute / unmute">🎤</button>
          <button type="button" class="seat-self-btn seat-leave-btn" title="Leave seat">⏏</button>
        </div>
      `;

      // Tapping the frame only ever claims a VACANT seat. Occupied
      // seats (self or others) do nothing on a frame tap — they're
      // managed via the dedicated buttons/host overlay instead.
      slot.querySelector(".seat-slot-frame").addEventListener("click", () => {
        const occupant = micSeatsState[i];
        if (!occupant) window.claimMicSeat?.(i);
      });

      slot.querySelector(".seat-mute-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        window.toggleMySeatMic?.();
      });
      slot.querySelector(".seat-leave-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        window.releaseMicSeat?.();
      });

      const overlay = buildHostControlOverlay(
        () => window.hostKickSeat?.(i),
        () => window.hostMuteSeat?.(i)
      );
      slot.appendChild(overlay);

      // 4 left wing (0-3), 4 right wing (4-7), 4 bottom row (8-11) —
      // mirrors the backend's 12-seat layout exactly.
      if (i < 4) leftWing.appendChild(slot);
      else if (i < 8) rightWing.appendChild(slot);
      else bottomRow.appendChild(slot);

      seatSlotEls.push(slot);
    }

    strip.appendChild(leftWing);
    strip.appendChild(rightWing);
    strip.appendChild(bottomRow);
  }

  function applyMicSeats(seats) {
    micSeatsState = seats || Array(MIC_SEAT_COUNT).fill(null);

    micSeatsState.forEach((occupant, i) => {
      const slot = seatSlotEls[i];
      if (!slot) return;

      const isSelf   = !!occupant && occupant.socketId === window.__mySocketId;
      const img      = slot.querySelector(".seat-avatar");
      const muteBtn  = slot.querySelector(".seat-mute-btn");
      const selfCtrl = slot.querySelector(".seat-self-controls");
      const muteDot  = slot.querySelector(".seat-mute-indicator");
      const overlay  = slot.querySelector(".host-ctrl-overlay");

      slot.classList.toggle("occupied", !!occupant);
      slot.classList.toggle("vacant", !occupant);

      if (!occupant) {
        slot.classList.remove("speaking", "seat-muted", "seat-host-muted");
        if (img) { img.style.display = "none"; img.removeAttribute("src"); }
        if (selfCtrl) selfCtrl.style.display = "none";
      } else {
        if (img) {
          img.src = occupant.avatarUrl || avatarFallback(occupant);
          img.style.display = "block";
          img.onerror = () => { img.onerror = null; img.src = avatarFallback(occupant); };
        }
        slot.classList.toggle("seat-muted", !!occupant.muted);
        slot.classList.toggle("seat-host-muted", !!occupant.mutedByHost);

        if (selfCtrl) selfCtrl.style.display = isSelf ? "flex" : "none";
        if (isSelf && muteBtn) {
          if (occupant.mutedByHost) {
            muteBtn.textContent = "🔒";
            muteBtn.disabled = true;
            muteBtn.title = "Muted by host";
          } else {
            muteBtn.textContent = occupant.muted ? "🔇" : "🎤";
            muteBtn.disabled = false;
            muteBtn.title = occupant.muted ? "Unmute" : "Mute";
          }
        }
      }

      if (muteDot) {
        muteDot.style.display = (occupant && occupant.muted && !isSelf) ? "flex" : "none";
      }

      if (overlay) {
        overlay.classList.toggle("hidden-self", isSelf);
        const muteBtnHost = overlay.querySelector(".host-ctrl-mute");
        if (muteBtnHost && occupant) {
          muteBtnHost.textContent = occupant.mutedByHost ? "🔊" : "🔇";
          muteBtnHost.title = occupant.mutedByHost ? "Unmute this user" : "Mute this user";
        }
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
      .map((slot) => pointOf(slot.querySelector(".seat-slot-frame")));
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
     ------------------------------------------------------------
     Seats no longer host a docked video tile, so seat speaking
     glow is driven purely off socketId → seat lookup rather than
     "find the tile this socket's video lives in."
     ============================================================ */
  window.addEventListener("speakingChanged", (e) => {
    const { socketId, isHost: hostFlag, active } = e.detail || {};

    if (hostFlag) {
      hostCardWrap.classList.toggle("speaking", !!active);
      return;
    }

    // Guest frame?
    let handled = false;
    [guestFrameMale, guestFrameFemale].forEach((frameEl) => {
      if (!frameEl) return;
      const docked = frameEl.querySelector(".docked");
      if (docked && docked.dataset.socketId === socketId) {
        frameEl.classList.toggle("speaking", !!active);
        handled = true;
      }
    });

    // Mic seat?
    seatSlotEls.forEach((slot, i) => {
      const occupant = micSeatsState[i];
      if (occupant && occupant.socketId === socketId) {
        slot.classList.toggle("speaking", !!active);
        handled = true;
      }
    });

    // Local tile (only relevant while docked in a guest frame — mic
    // seats don't use local-tile at all any more).
    if (!handled && socketId === window.__mySocketId) {
      localTile?.classList.toggle("speaking", !!active);
    }
  });

  /* ============================================================
     GIFT LANDED — brief connection-line pulse
     ============================================================ */
  window.addEventListener("giftLanded", pulseConnectionLines);

  /* ============================================================
     GUEST SEATS (matchmaker male/female slots)
     ------------------------------------------------------------
     Server truth arrives via `guestSeatsChanged`:
       { male: occupant|null, female: occupant|null }
     Guest frames are one of the two places video is allowed, so
     we dock/undock the real participant <video> tile here — same
     as before — plus a small self mute/leave overlay for the
     current occupant, and the host kick/mute overlay for the host.
     ============================================================ */
  let guestSeatsState = { male: null, female: null };

  function ensureGuestOverlays(frameEl, key) {
    if (!frameEl) return;

    if (!frameEl.querySelector(".host-ctrl-overlay")) {
      const overlay = buildHostControlOverlay(
        () => window.hostKickGuest?.(key),
        () => window.hostMuteGuest?.(key)
      );
      frameEl.appendChild(overlay);
    }

    if (!frameEl.querySelector(".guest-self-controls")) {
      const selfCtrl = document.createElement("div");
      selfCtrl.className = "guest-self-controls";
      selfCtrl.innerHTML = `
        <button type="button" class="guest-self-btn guest-mute-btn" title="Mute / unmute">🎤</button>
        <button type="button" class="guest-self-btn guest-leave-btn" title="Leave seat">⏏</button>
      `;
      selfCtrl.querySelector(".guest-mute-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        window.toggleMyGuestMic?.();
      });
      selfCtrl.querySelector(".guest-leave-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        window.leaveGuestSeat?.();
      });
      frameEl.appendChild(selfCtrl);
    }

    if (!frameEl.querySelector(".guest-mute-indicator")) {
      const dot = document.createElement("div");
      dot.className = "guest-mute-indicator";
      dot.title = "Muted";
      dot.textContent = "🔇";
      frameEl.appendChild(dot);
    }
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

  function tileForSocket(socketId) {
    if (!socketId) return null;
    return socketId === window.__mySocketId
      ? localTile
      : strip.querySelector(`.participant-tile[data-socket-id="${cssEscape(socketId)}"]`);
  }

  function applyGuestSeats(seats) {
    guestSeatsState = seats || { male: null, female: null };

    [["male", guestFrameMale], ["female", guestFrameFemale]].forEach(([key, frameEl]) => {
      if (!frameEl) return;
      const occupant   = guestSeatsState[key];
      const isSelf     = !!occupant && occupant.socketId === window.__mySocketId;
      const dockedNow  = frameEl.querySelector(".docked");
      const wantedTile = occupant ? tileForSocket(occupant.socketId) : null;

      if (dockedNow && dockedNow !== wantedTile) undockTile(dockedNow);
      if (wantedTile && wantedTile.parentElement !== frameEl) dockTile(wantedTile, frameEl);
      if (wantedTile) wantedTile.dataset.socketId = occupant.socketId;

      frameEl.classList.toggle("occupied", !!occupant);
      if (!occupant) {
        frameEl.classList.remove("speaking", "guest-muted", "guest-host-muted");
      } else {
        frameEl.classList.toggle("guest-muted", !!occupant.muted);
        frameEl.classList.toggle("guest-host-muted", !!occupant.mutedByHost);
      }

      const overlay = frameEl.querySelector(".host-ctrl-overlay");
      if (overlay) {
        overlay.classList.toggle("hidden-self", isSelf);
        const muteBtnHost = overlay.querySelector(".host-ctrl-mute");
        if (muteBtnHost && occupant) {
          muteBtnHost.textContent = occupant.mutedByHost ? "🔊" : "🔇";
          muteBtnHost.title = occupant.mutedByHost ? "Unmute this user" : "Mute this user";
        }
      }

      const selfCtrl = frameEl.querySelector(".guest-self-controls");
      if (selfCtrl) selfCtrl.style.display = isSelf ? "flex" : "none";
      const muteBtn = frameEl.querySelector(".guest-mute-btn");
      if (isSelf && muteBtn && occupant) {
        if (occupant.mutedByHost) {
          muteBtn.textContent = "🔒";
          muteBtn.disabled = true;
          muteBtn.title = "Muted by host";
        } else {
          muteBtn.textContent = occupant.muted ? "🔇" : "🎤";
          muteBtn.disabled = false;
          muteBtn.title = occupant.muted ? "Unmute" : "Mute";
        }
      }

      const muteDot = frameEl.querySelector(".guest-mute-indicator");
      if (muteDot) muteDot.style.display = (occupant && occupant.muted && !isSelf) ? "flex" : "none";
    });

    refreshConnectionLines();
  }

  window.addEventListener("guestSeatsChanged", (e) => applyGuestSeats(e.detail));

  [["male", guestFrameMale], ["female", guestFrameFemale]].forEach(([key, frameEl]) => {
    if (!frameEl) return;
    ensureGuestOverlays(frameEl, key);
    frameEl.addEventListener("click", (e) => {
      if (e.target.closest(".host-ctrl-overlay")) return;
      if (e.target.closest(".guest-self-controls")) return;
      const occupant = guestSeatsState[key];
      // Tapping the frame body only claims a VACANT frame now — an
      // occupied frame (self or other) is managed through its own
      // buttons/host overlay, same rule as the mic seats above.
      if (!occupant) window.requestGuestSeat?.(key);
    });
  });

  /* ============================================================
     DOM WATCHERS
     ------------------------------------------------------------
     Tile visibility is driven entirely by server-truth events
     (micSeatsChanged / guestSeatsChanged) rather than by watching
     local media state.
     ============================================================ */
  const stripObserver = new MutationObserver((mutations) => {
    let dirty = false;
    for (const m of mutations) {
      if (m.addedNodes.length || m.removedNodes.length) dirty = true;
    }
    if (dirty) {
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

    // Apply any seat snapshot that live.js already received and
    // cached on window before this module's own listeners were
    // attached, so a late joiner sees the exact same, fully
    // populated seat/guest layout on first paint.
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