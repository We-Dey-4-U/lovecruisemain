/* ============================================================
   vConnect AR / Face-Effects Engine
   ------------------------------------------------------------
   Sits ON TOP of BeautyFilterEngine (beauty-filter.js). Runs
   real-time face-landmark detection (MediaPipe FaceLandmarker,
   468-point face mesh) against the SAME hidden <video> element
   BeautyFilterEngine already uses to render, so both pipelines
   stay perfectly frame-synced.

   Each detected frame:
     1. Derives a handful of stable reference points (eye centers,
        nose tip, jaw edges, forehead, mouth) from the landmarks.
     2. If a "distortion" is enabled (Big Eyes / Slim Face / Small
        Nose), computes UV-space warp control points and pushes
        them into BeautyFilterEngine.setFaceWarps(...) — the warp
        itself happens inside the WebGL shader, before blur/sharpen/
        grade, so it's a real liquify, not an overlay trick.
     3. If a sticker is selected, draws it (vector graphics — no
        image assets required) into BeautyFilterEngine's 2D output
        canvas via the overlay-draw hook, scaled/rotated to the
        detected face size and head tilt every frame.

   REQUIRES NETWORK ACCESS (browser, not this build sandbox) to:
     - https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@.../vision_bundle.mjs
     - https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@.../wasm/*
     - https://storage.googleapis.com/mediapipe-models/... (the model)
   If your deployment has a strict CSP or no external network, host
   these three asset groups yourself and change the URLs below —
   nothing else about the API changes.

   COORDINATE NOTE: BeautyFilterEngine's vertex shader already
   normalizes orientation (see its "upside-down camera fix" note),
   so its vUv space is top-left-origin, y-down — the same
   convention MediaPipe returns landmarks in. That means landmark
   x/y map DIRECTLY onto both the shader's warp UVs and the 2D
   overlay canvas with no extra flipping. If you ever see
   stickers/warps offset or mirrored after wiring this into a new
   layout, check camera facingMode / any CSS mirroring
   (transform: scaleX(-1)) applied to the preview element — that
   would be a display-only mirror that this module doesn't know
   about, and you'd flip landmark.x -> (1 - landmark.x) to match.

   USAGE
   ------------------------------------------------------------
     import { BeautyFilterEngine } from "./beauty-filter.js";
     import { FaceEffectsEngine }  from "./face-effects.js";

     const beautyEngine = new BeautyFilterEngine();
     const filtered = beautyEngine.start(rawStream, {...});

     const faceEngine = new FaceEffectsEngine();
     await faceEngine.attach(beautyEngine); // loads the model
     faceEngine.start();                     // begins detection loop

     faceEngine.setDistortion({ bigEyes: 0.6 });      // 0..1 each
     faceEngine.setDistortion({ slimFace: 0.4 });
     faceEngine.setDistortion({ smallNose: 0.3 });
     faceEngine.setSticker("glasses");                 // or "dogEars" |
                                                         // "mustache" | "flowerCrown" | null

     faceEngine.stop();     // pause detection + clear warps/overlay
     faceEngine.destroy();  // full teardown (call on leaveRoom)
   ============================================================ */

const TASKS_VISION_VERSION = "0.10.14";
const CDN_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}`;
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

// Stable 468-point face-mesh landmark indices used throughout.
const LM = {
  EYE_L_OUTER: 33, EYE_L_INNER: 133,
  EYE_R_INNER: 362, EYE_R_OUTER: 263,
  NOSE_TIP: 1, NASION: 168,
  CHIN: 152, FOREHEAD: 10,
  MOUTH_L: 61, MOUTH_R: 291,
  JAW_L: 234, JAW_R: 454
};

export class FaceEffectsEngine {
  constructor() {
    this._beautyEngine = null;
    this._landmarker = null;
    this._rafId = null;
    this._lastVideoTime = -1;
    this._landmarks = null;
    this._sticker = null; // "glasses" | "dogEars" | "mustache" | "flowerCrown" | null
    this._distortion = { bigEyes: 0, slimFace: 0, smallNose: 0 };
    this._ready = false;
    this._onFaceLost = null;
    this._onFaceFound = null;
    this._hadFace = false;
  }

  /** Attaches to a running BeautyFilterEngine and loads the face model. Call once. */
  async attach(beautyEngine) {
    this._beautyEngine = beautyEngine;
    beautyEngine.setOverlayDrawFn((ctx, w, h) => this._drawOverlay(ctx, w, h));
    await this._loadModel();
  }

  async _loadModel() {
    const { FaceLandmarker, FilesetResolver } = await import(
      /* webpackIgnore: true */ `${CDN_BASE}/vision_bundle.mjs`
    );
    const filesetResolver = await FilesetResolver.forVisionTasks(`${CDN_BASE}/wasm`);
    this._landmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
      runningMode: "VIDEO",
      numFaces: 1
    });
    this._ready = true;
  }

  /** Begins the per-frame detection loop. No-op if the model isn't loaded yet or already running. */
  start() {
    if (!this._ready || this._rafId) return;
    const loop = () => {
      this._detect();
      this._rafId = requestAnimationFrame(loop);
    };
    this._rafId = requestAnimationFrame(loop);
  }

  /** Stops detection and clears any active warps/overlay (beauty/color filters keep running untouched). */
  stop() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = null;
    this._landmarks = null;
    if (this._beautyEngine) {
      this._beautyEngine.clearFaceWarps();
    }
  }

  /** Full teardown — releases the MediaPipe model. Call on room/page exit. */
  destroy() {
    this.stop();
    try { this._landmarker?.close(); } catch (e) {}
    this._landmarker = null;
    if (this._beautyEngine) {
      this._beautyEngine.clearOverlayDrawFn();
      this._beautyEngine.clearFaceWarps();
    }
    this._beautyEngine = null;
  }

  isReady() { return this._ready; }
  isActive() { return !!this._rafId; }
  hasFace() { return !!this._landmarks; }

  /** name: "glasses" | "dogEars" | "mustache" | "flowerCrown" | null (null clears it). */
  setSticker(name) { this._sticker = name || null; }
  getSticker() { return this._sticker; }

  /** partial: any subset of {bigEyes, slimFace, smallNose}, each 0..1. */
  setDistortion(partial) {
    this._distortion = { ...this._distortion, ...partial };
    if (!this._landmarks) return;
    this._applyWarpsFromLandmarks(); // re-apply immediately so a slider feels live
  }
  getDistortion() { return { ...this._distortion }; }

  /** Optional callbacks: fn() called once when a face appears/disappears (e.g. to show a "face not found" hint). */
  onFaceFound(fn) { this._onFaceFound = fn; }
  onFaceLost(fn) { this._onFaceLost = fn; }

  // ── Detection loop ──

  _detect() {
    const video = this._beautyEngine?.getVideoElement();
    if (!video || video.readyState < 2 || !this._landmarker) return;
    if (video.currentTime === this._lastVideoTime) return; // no new frame decoded yet
    this._lastVideoTime = video.currentTime;

    let result;
    try {
      result = this._landmarker.detectForVideo(video, performance.now());
    } catch (e) {
      return; // transient decode/inference hiccup — try again next frame
    }

    const faces = result?.faceLandmarks;
    if (!faces || !faces.length) {
      this._landmarks = null;
      this._beautyEngine.clearFaceWarps();
      if (this._hadFace) { this._hadFace = false; this._onFaceLost?.(); }
      return;
    }

    if (!this._hadFace) { this._hadFace = true; this._onFaceFound?.(); }
    this._landmarks = faces[0];
    this._applyWarpsFromLandmarks();
  }

  // ── Landmark helpers ──

  _pt(i) {
    const lm = this._landmarks[i];
    return [lm.x, lm.y];
  }
  _mid(a, b) {
    const pa = this._pt(a), pb = this._pt(b);
    return [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2];
  }
  _dist(a, b) {
    const dx = a[0] - b[0], dy = a[1] - b[1];
    return Math.hypot(dx, dy);
  }

  _derivedPoints() {
    const eyeL = this._mid(LM.EYE_L_OUTER, LM.EYE_L_INNER);
    const eyeR = this._mid(LM.EYE_R_INNER, LM.EYE_R_OUTER);
    return {
      eyeL, eyeR,
      eyeDist: this._dist(eyeL, eyeR),
      noseTip: this._pt(LM.NOSE_TIP),
      nasion: this._pt(LM.NASION),
      chin: this._pt(LM.CHIN),
      forehead: this._pt(LM.FOREHEAD),
      mouthL: this._pt(LM.MOUTH_L),
      mouthR: this._pt(LM.MOUTH_R),
      mouthCenter: this._mid(LM.MOUTH_L, LM.MOUTH_R),
      jawL: this._pt(LM.JAW_L),
      jawR: this._pt(LM.JAW_R)
    };
  }

  // ── Distortion (liquify warp control points, fed to the WebGL shader) ──

  _applyWarpsFromLandmarks() {
    if (!this._beautyEngine || !this._landmarks) return;
    const d = this._derivedPoints();
    const warps = [];

    if (this._distortion.bigEyes > 0) {
      const r = d.eyeDist * 0.9;
      const s = 0.5 * this._distortion.bigEyes;
      warps.push({ center: d.eyeL, radius: r, strength: s });
      warps.push({ center: d.eyeR, radius: r, strength: s });
    }
    if (this._distortion.slimFace > 0) {
      const r = d.eyeDist * 1.1;
      const s = -0.4 * this._distortion.slimFace;
      warps.push({ center: d.jawL, radius: r, strength: s });
      warps.push({ center: d.jawR, radius: r, strength: s });
    }
    if (this._distortion.smallNose > 0) {
      warps.push({
        center: d.noseTip,
        radius: d.eyeDist * 0.55,
        strength: -0.35 * this._distortion.smallNose
      });
    }

    this._beautyEngine.setFaceWarps(warps);
  }

  // ── Sticker overlay (vector-drawn — no image assets needed) ──

  _drawOverlay(ctx, w, h) {
    if (!this._landmarks || !this._sticker) return;
    const d = this._derivedPoints();
    const toPx = ([x, y]) => [x * w, y * h];
    const eyeLpx = toPx(d.eyeL), eyeRpx = toPx(d.eyeR);
    const angle = Math.atan2(eyeRpx[1] - eyeLpx[1], eyeRpx[0] - eyeLpx[0]);
    const eyeDistPx = this._dist(eyeLpx, eyeRpx);

    ctx.save();
    switch (this._sticker) {
      case "glasses":
        this._drawGlasses(ctx, toPx(d.nasion), eyeDistPx, angle);
        break;
      case "dogEars":
        this._drawDogEars(ctx, toPx(d.forehead), eyeDistPx, angle);
        break;
      case "mustache":
        this._drawMustache(ctx, toPx(d.mouthCenter), toPx(d.noseTip), eyeDistPx, angle);
        break;
      case "flowerCrown":
        this._drawFlowerCrown(ctx, toPx(d.forehead), eyeDistPx, angle);
        break;
    }
    ctx.restore();
  }

  _drawGlasses(ctx, center, eyeDistPx, angle) {
    const [cx, cy] = center;
    const lensR = eyeDistPx * 0.34;
    const gap = eyeDistPx * 0.22;
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.lineWidth = Math.max(2, eyeDistPx * 0.06);
    ctx.strokeStyle = "rgba(20,20,24,0.92)";
    ctx.fillStyle = "rgba(120,190,255,0.18)";
    [-1, 1].forEach((side) => {
      const lx = side * (gap / 2 + lensR);
      ctx.beginPath();
      ctx.ellipse(lx, 0, lensR, lensR * 0.82, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
    ctx.beginPath();
    ctx.moveTo(-gap / 2, 0);
    ctx.lineTo(gap / 2, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-(gap / 2 + lensR * 2), 0);
    ctx.lineTo(-(gap / 2 + lensR * 2.6), -lensR * 0.3);
    ctx.moveTo(gap / 2 + lensR * 2, 0);
    ctx.lineTo(gap / 2 + lensR * 2.6, -lensR * 0.3);
    ctx.stroke();
  }

  _drawDogEars(ctx, foreheadPt, eyeDistPx, angle) {
    const [cx, cy] = foreheadPt;
    const earH = eyeDistPx * 1.5;
    const earW = eyeDistPx * 0.9;
    const spread = eyeDistPx * 1.4;
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    [-1, 1].forEach((side) => {
      ctx.save();
      ctx.translate((side * spread) / 2, -earH * 0.15);
      ctx.rotate(side * 0.35);
      ctx.fillStyle = "rgba(120,72,40,0.95)";
      ctx.strokeStyle = "rgba(60,32,16,0.9)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(side * earW * 0.9, -earH * 0.6, 0, -earH);
      ctx.quadraticCurveTo(side * -earW * 0.15, -earH * 0.5, 0, 0);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "rgba(230,170,150,0.85)";
      ctx.beginPath();
      ctx.moveTo(0, -earH * 0.15);
      ctx.quadraticCurveTo(side * earW * 0.4, -earH * 0.5, 0, -earH * 0.8);
      ctx.quadraticCurveTo(side * -earW * 0.05, -earH * 0.45, 0, -earH * 0.15);
      ctx.fill();
      ctx.restore();
    });
    ctx.fillStyle = "rgba(30,20,20,0.9)";
    ctx.beginPath();
    ctx.ellipse(0, eyeDistPx * 1.1, eyeDistPx * 0.16, eyeDistPx * 0.11, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawMustache(ctx, mouthCenter, noseTip, eyeDistPx, angle) {
    const cx = mouthCenter[0];
    const cy = (mouthCenter[1] + noseTip[1]) / 2;
    const w = eyeDistPx * 0.95;
    const h = eyeDistPx * 0.28;
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.fillStyle = "rgba(35,24,18,0.95)";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(w * 0.15, -h * 0.6, w * 0.4, h * 0.3, w * 0.55, -h * 0.1);
    ctx.bezierCurveTo(w * 0.35, h * 0.15, w * 0.12, h * 0.05, 0, h * 0.2);
    ctx.bezierCurveTo(-w * 0.12, h * 0.05, -w * 0.35, h * 0.15, -w * 0.55, -h * 0.1);
    ctx.bezierCurveTo(-w * 0.4, h * 0.3, -w * 0.15, -h * 0.6, 0, 0);
    ctx.fill();
  }

  _drawFlowerCrown(ctx, foreheadPt, eyeDistPx, angle) {
    const [cx, cy] = foreheadPt;
    ctx.translate(cx, cy - eyeDistPx * 0.35);
    ctx.rotate(angle);
    const petals = ["#FF8FD1", "#FFD36E", "#9D5CFF", "#6FC7FF", "#FF6F6F"];
    const spread = eyeDistPx * 2.1;
    const count = 5;
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const fx = (t - 0.5) * spread;
      const fy = -Math.abs(t - 0.5) * eyeDistPx * 0.5;
      const r = eyeDistPx * (0.16 - Math.abs(t - 0.5) * 0.05);
      ctx.fillStyle = petals[i % petals.length];
      for (let p = 0; p < 5; p++) {
        const a = (p / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.ellipse(
          fx + Math.cos(a) * r * 0.55,
          fy + Math.sin(a) * r * 0.55,
          r * 0.55, r * 0.32, a, 0, Math.PI * 2
        );
        ctx.fill();
      }
      ctx.fillStyle = "rgba(255,230,120,0.95)";
      ctx.beginPath();
      ctx.arc(fx, fy, r * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}