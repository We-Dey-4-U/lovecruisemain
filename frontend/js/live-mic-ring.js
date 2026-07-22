/* ============================================================
   live-mic-ring.js  —  SECTIONED-LAYOUT REDESIGN
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

   WHAT CHANGED IN THIS REDESIGN (UI/UX ONLY)
   ------------------------------------------------------------
   The page is no longer a single floating "arena" with a particle
   canvas and orbiting SVG connection-lines linking the host to
   every occupied seat/guest. It is now six stacked, non-overlapping
   sections (header / host / guests / seats / chat / bottom bar).
   Concretely, that means:

     1. Seats are no longer split into left-wing / right-wing /
        bottom-row to visually orbit the host. All 12 seats now
        render as one flat 6x2 grid (createSeatSlots), in plain
        index order 0-11, matching the backend's flat
        micSeatsUpdated array 1:1. No wing math, no absolute
        positioning.

     2. The particle canvas (#arena-particles) and the animated
        SVG "energy lines" from host to seats (#connection-lines)
        have been removed — they only made sense around an
        orbiting/floating layout, and the redesign explicitly
        requires the host frame to never move, rotate, or have
        anything arranged around it. Removing them is a visual
        simplification only; nothing that reads game/room state
        depended on them.

     3. Gift-landed feedback, previously a pulse on the connection
        lines, is now a brief glow pulse directly on the host
        frame's own border/shadow (still purely a CSS class toggle,
        still triggered by the same `giftLanded` event).

     4. The local video tile's "home" when it is not docked into a
        guest frame is now a dedicated hidden holding bay
        (#tile-holding-bay) instead of the old free-floating arena
        surface — same undock/redock logic, just a different, inert
        parking spot.

   Every DOM id/class this module creates or reads (.seat-slot,
   .seat-slot-frame, .seat-avatar, .seat-mute-indicator,
   .seat-self-controls, .host-ctrl-overlay, .guest-frame,
   .guest-self-controls, .guest-mute-indicator, "occupied",
   "vacant", "speaking", "seat-muted", "seat-host-muted",
   "guest-muted", "guest-host-muted", "docked", "seated") is
   unchanged, so no other script needs to change to keep working.
   ============================================================ */

(() => {
  const arena         = document.getElementById("arena");
  const hostCardWrap   = document.getElementById("host-card-wrap");
  const strip          = document.getElementById("participants-strip");
  const localTile      = document.getElementById("local-tile");
  const holdingBay     = document.getElementById("tile-holding-bay");
  const guestFrameMale   = document.getElementById("guest-frame-male");
  const guestFrameFemale = document.getElementById("guest-frame-female");

  // Nothing to enhance on a page that doesn't use the sectioned
  // stage layout.
  if (!arena || !hostCardWrap || !strip) return;

  // Matches backend's MIC_SEAT_COUNT (stream.socket.js): 12 seats,
  // now rendered as one flat 6x2 grid instead of wings/rows.
  const MIC_SEAT_COUNT = 12;

  function isHostMode() {
    return document.body.classList.contains("host-mode");
  }

  function cssEscape(str) {
    return window.CSS && CSS.escape ? CSS.escape(str) : String(str).replace(/["\\]/g, "\\$&");
  }

  function avatarFallback(occupant) {
    const name = (occupant && (occupant.username || occupant.userId)) || "User";
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=9D5CFF&color=fff&size=96`;
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
     SEAT SLOTS — 12 permanent slots in one flat 6x2 CSS grid
     (.seats-grid, styled entirely in CSS via
     grid-template-columns: repeat(6, 1fr)). Occupied seats render
     the occupant's profile photo — never video — plus their own
     mute/leave controls. Index order 0-11 matches the backend's
     flat micSeatsUpdated array exactly; there is no wing/row
     remapping any more.
     ============================================================ */
  const seatSlotEls = [];
  let micSeatsState = Array(MIC_SEAT_COUNT).fill(null);

  function createSeatSlots() {
    strip.innerHTML = "";
    seatSlotEls.length = 0;

    const grid = document.createElement("div");
    grid.className = "seats-grid";

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

      grid.appendChild(slot);
      seatSlotEls.push(slot);
    }

    strip.appendChild(grid);
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
  }

  window.addEventListener("micSeatsChanged", (e) => applyMicSeats(e.detail));

  /* ============================================================
     SPEAKING GLOW
     ------------------------------------------------------------
     Seats don't host a docked video tile, so seat speaking glow is
     driven purely off socketId → seat lookup. The glow itself is
     CSS-only (border-color + box-shadow via the "speaking" class) —
     nothing here ever animates position, rotation, or layout, per
     the redesign's "host/guests never move" requirement.
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
     GIFT LANDED — brief glow pulse directly on the host frame.
     Replaces the old connection-line pulse (which no longer exists
     now that the orbiting arena/lines have been removed). Still a
     pure CSS class toggle, still triggered by the same event.
     ============================================================ */
  let giftPulseTimer = null;
  window.addEventListener("giftLanded", () => {
    hostCardWrap.classList.add("speaking");
    clearTimeout(giftPulseTimer);
    giftPulseTimer = setTimeout(() => {
      // Only clear the glow if the host isn't genuinely speaking —
      // speakingChanged is the source of truth for that state, this
      // is just a courtesy timeout for the gift-triggered flash.
      if (!hostCardWrap.dataset.reallySpeaking) {
        hostCardWrap.classList.remove("speaking");
      }
    }, 900);
  });
  window.addEventListener("speakingChanged", (e) => {
    const { isHost: hostFlag, active } = e.detail || {};
    if (hostFlag) hostCardWrap.dataset.reallySpeaking = active ? "1" : "";
  });

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
    // Local tile parks in the hidden holding bay; any stray
    // participant tile parks back in the seat strip container
    // (it stays invisible there since seats never dock video).
    const home = tile === localTile ? (holdingBay || arena) : strip;
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

  /* ============================================================
     INIT
     ------------------------------------------------------------
     No particle canvas, no connection-line SVG, no per-frame
     animation loop any more — the sectioned layout is static
     document flow, so there's nothing to redraw on resize besides
     what CSS (grid/flex/clamp) already handles on its own.
     ============================================================ */
  function init() {
    createSeatSlots();

    // Apply any seat snapshot that live.js already received and
    // cached on window before this module's own listeners were
    // attached, so a late joiner sees the exact same, fully
    // populated seat/guest layout on first paint.
    if (window.__lastMicSeats)   applyMicSeats(window.__lastMicSeats);
    if (window.__lastGuestSeats) applyGuestSeats(window.__lastGuestSeats);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();