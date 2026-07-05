/* ============================================================
   gift-engine/UIOverlay.js   [NEW FILE]
   The text/HUD layer: sender name, receiver name, gift title,
   and the screen-darken-for-recipient-focus effect.
   Pointer-events disabled — never blocks taps on stream UI.
   ============================================================ */

const STYLE_ID = "gift-engine-overlay-style";

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #gift-engine-ui-layer {
      position: fixed; inset: 0; z-index: 16; pointer-events: none;
    }
    .ge-dim {
      position: absolute; inset: 0; background: rgba(0,0,0,0);
      transition: background .35s ease;
    }
    .ge-dim.on { background: rgba(0,0,0,.32); }
    .ge-banner {
      position: absolute; left: 50%; top: 18%;
      transform: translate(-50%, -12px); opacity: 0;
      text-align: center; transition: opacity .35s ease, transform .35s ease;
      text-shadow: 0 2px 12px rgba(0,0,0,.6);
    }
    .ge-banner.show { opacity: 1; transform: translate(-50%, 0); }
    .ge-banner .ge-title {
      font-size: 22px; font-weight: 900; color: #ffc857; letter-spacing: .02em;
    }
    .ge-banner .ge-sub {
      font-size: 13px; font-weight: 700; color: #fff; margin-top: 4px;
    }
    .ge-banner .ge-sub em { color: #ff3d7f; font-style: normal; }
    .ge-combo {
      position: absolute; left: 50%; top: 32%; transform: translate(-50%, 0) scale(1);
      font-size: 28px; font-weight: 900; color: #fff; opacity: 0;
      text-shadow: 0 0 14px #ff3d7f, 0 2px 8px rgba(0,0,0,.7);
      transition: opacity .2s ease;
    }
    .ge-combo.show { opacity: 1; }
  `;
  document.head.appendChild(style);
}

export class UIOverlay {
  constructor(containerEl) {
    ensureStyles();
    this.layer = document.createElement("div");
    this.layer.id = "gift-engine-ui-layer";
    containerEl.appendChild(this.layer);

    this.dim = document.createElement("div");
    this.dim.className = "ge-dim";
    this.layer.appendChild(this.dim);

    this.banner = document.createElement("div");
    this.banner.className = "ge-banner";
    this.banner.innerHTML = `<div class="ge-title"></div><div class="ge-sub"></div>`;
    this.layer.appendChild(this.banner);

    this.comboEl = document.createElement("div");
    this.comboEl.className = "ge-combo";
    this.layer.appendChild(this.comboEl);
  }

  focusDim(on) {
    this.dim.classList.toggle("on", !!on);
  }

  showBanner({ sender, receiver, giftTitle }, durationMs = 2400) {
    this.banner.querySelector(".ge-title").textContent = giftTitle;
    this.banner.querySelector(".ge-sub").innerHTML =
      `<em>${this._esc(sender)}</em> &rarr; ${this._esc(receiver)}`;
    this.banner.classList.add("show");
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => this.banner.classList.remove("show"), durationMs);
  }

  showCombo(count) {
    this.comboEl.textContent = `x${count} COMBO`;
    this.comboEl.classList.add("show");
    clearTimeout(this._comboTimer);
    this._comboTimer = setTimeout(() => this.comboEl.classList.remove("show"), 900);
  }

  _esc(s) {
    return String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }
}