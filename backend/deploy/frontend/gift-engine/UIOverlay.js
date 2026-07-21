/* ============================================================
   gift-engine/UIOverlay.js   [NEW FILE]
   The text/HUD layer: sender name, receiver name, gift title,
   and the screen-darken-for-recipient-focus effect.
   Pointer-events disabled — never blocks taps on stream UI.
   ============================================================ */
/* ============================================================
   gift-engine/UIOverlay.js
   Premium HUD overlay with banner, combo, dimmer and toast.
   ============================================================ */

const STYLE_ID = "gift-engine-overlay-style";

function ensureStyles() {

    if (document.getElementById(STYLE_ID))
        return;

    const style = document.createElement("style");

    style.id = STYLE_ID;

    style.textContent = `

#gift-engine-ui-layer{
position:fixed;
inset:0;
z-index:16;
pointer-events:none;
overflow:hidden;
font-family:Inter,Segoe UI,sans-serif;
}

.ge-dim{
position:absolute;
inset:0;
background:rgba(0,0,0,0);
backdrop-filter:blur(0px);
transition:
background .35s ease,
backdrop-filter .35s ease;
}

.ge-dim.on{
background:rgba(0,0,0,.32);
backdrop-filter:blur(2px);
}

.ge-banner{
position:absolute;
left:50%;
top:18%;
transform:translate(-50%,-18px) scale(.95);
opacity:0;
transition:
opacity .35s ease,
transform .35s ease;
text-align:center;
min-width:280px;
padding:18px 26px;
border-radius:22px;
background:linear-gradient(180deg,
rgba(255,255,255,.18),
rgba(255,255,255,.05));
border:1px solid rgba(255,255,255,.18);
backdrop-filter:blur(12px);
box-shadow:
0 18px 60px rgba(0,0,0,.35),
0 0 40px rgba(255,200,87,.18);
}

.ge-banner.show{
opacity:1;
transform:translate(-50%,0) scale(1);
}

.ge-title{
font-size:24px;
font-weight:900;
letter-spacing:.04em;
color:#FFC857;
text-shadow:
0 0 20px rgba(255,200,87,.5),
0 3px 12px rgba(0,0,0,.6);
}

.ge-sub{
margin-top:8px;
font-size:14px;
font-weight:700;
color:#fff;
}

.ge-sub em{
font-style:normal;
color:#ff4f90;
}

.ge-combo{
position:absolute;
left:50%;
top:34%;
transform:translate(-50%,0) scale(.75);
opacity:0;
font-size:38px;
font-weight:900;
color:#fff;
letter-spacing:.08em;
transition:
opacity .2s ease,
transform .2s ease;
text-shadow:
0 0 18px #ff3d7f,
0 0 40px rgba(255,61,127,.5),
0 3px 8px rgba(0,0,0,.7);
}

.ge-combo.show{
opacity:1;
transform:translate(-50%,0) scale(1);
}

.ge-toast{

position:absolute;

left:50%;

bottom:80px;

transform:translateX(-50%) translateY(30px);

padding:12px 22px;

border-radius:999px;

background:rgba(25,25,25,.82);

color:#fff;

font-size:14px;

font-weight:700;

opacity:0;

transition:
opacity .3s ease,
transform .3s ease;

box-shadow:0 10px 40px rgba(0,0,0,.35);

}

.ge-toast.show{

opacity:1;

transform:translateX(-50%) translateY(0);

}

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

        this.banner.innerHTML = `

<div class="ge-title"></div>

<div class="ge-sub"></div>

`;

        this.layer.appendChild(this.banner);

        this.comboEl = document.createElement("div");

        this.comboEl.className = "ge-combo";

        this.layer.appendChild(this.comboEl);

        this.toast = document.createElement("div");

        this.toast.className = "ge-toast";

        this.layer.appendChild(this.toast);

    }

    focusDim(on) {

        this.dim.classList.toggle("on", !!on);

    }

    showBanner({

        sender,

        receiver,

        giftTitle

    }, duration = 2400) {

        this.banner.querySelector(".ge-title").textContent =
            giftTitle;

        this.banner.querySelector(".ge-sub").innerHTML =

            `<em>${this._esc(sender)}</em> &rarr; ${this._esc(receiver)}`;

        this.banner.classList.add("show");

        clearTimeout(this.bannerTimer);

        this.bannerTimer = setTimeout(() => {

            this.banner.classList.remove("show");

        }, duration);

    }

    showCombo(count) {

        this.comboEl.textContent = `x${count} COMBO`;

        this.comboEl.classList.add("show");

        clearTimeout(this.comboTimer);

        this.comboTimer = setTimeout(() => {

            this.comboEl.classList.remove("show");

        }, 900);

    }

    showToast(message, duration = 1800) {

        this.toast.textContent = message;

        this.toast.classList.add("show");

        clearTimeout(this.toastTimer);

        this.toastTimer = setTimeout(() => {

            this.toast.classList.remove("show");

        }, duration);

    }

    clear() {

        this.focusDim(false);

        this.banner.classList.remove("show");

        this.comboEl.classList.remove("show");

        this.toast.classList.remove("show");

    }

    destroy() {

        this.layer.remove();

    }

    _esc(text) {

        return String(text || "").replace(

            /[&<>"]/g,

            c => ({

                "&": "&amp;",

                "<": "&lt;",

                ">": "&gt;",

                '"': "&quot;"

            })[c]

        );

    }

}