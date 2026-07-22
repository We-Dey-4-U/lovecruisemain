/* ============================================================
   vConnect Beauty / Sharpness / Filter / AR Engine
   ------------------------------------------------------------
   100% front-end. Wraps a raw camera MediaStream and returns a
   new MediaStream whose video track has been processed through:

     1. Edge-preserving skin smoothing        (beauty)
     2. Brightness / contrast / glow          (beauty)
     3. Unsharp-mask sharpening ("3D" pop)     (beauty)
     4. Color grading / mood filters          (Vintage, B&W,
        Warm, Cool, Vivid, Cinematic — Instagram-style)
     5. Landmark-driven face warps            (Big Eyes, Slim
        Face, Small Nose — fed by FaceEffectsEngine, see
        face-effects.js)
     6. A 2D compositing pass on top of the WebGL output, so
        drawn stickers (from FaceEffectsEngine) land on the
        final frame before it's captured into a MediaStream.

   PIPELINE (per frame):
     <video> --texImage2D--> [WebGL: warp -> blur/smooth ->
     sharpen -> brightness/contrast/saturation -> color grade]
     --drawImage--> [2D output canvas] --overlay draw fn-->
     (stickers drawn here) --captureStream()--> MediaStream

   USAGE
   ------------------------------------------------------------
     import { BeautyFilterEngine } from "./beauty-filter.js";

     const engine = new BeautyFilterEngine();
     const rawStream = await navigator.mediaDevices.getUserMedia({video:true, audio:true});
     const filteredStream = engine.start(rawStream, {
       smoothing:  0.62,
       brightness: 0.06,
       contrast:   1.06,
       saturation: 1.08,
       sharpness:  0.45,
       filter:          "none",   // none|vintage|bw|warm|cool|vivid|cinematic
       filterIntensity: 1.0        // 0..1
     });

     // Beauty intensity presets:
     engine.applyBeautyPreset("light");   // "light" | "medium" | "glam"

     // Color / mood filters:
     engine.setColorFilter("cinematic", 0.85);

     // Live-adjust anything anytime:
     engine.setParams({ smoothing: 0.8 });

     // Face warps (normally driven by FaceEffectsEngine every
     // frame from live landmarks — see face-effects.js — but can
     // also be set directly):
     engine.setFaceWarps([
       { center: [0.42, 0.46], radius: 0.07, strength: 0.35 }, // left eye bulge
       { center: [0.58, 0.46], radius: 0.07, strength: 0.35 }, // right eye bulge
       { center: [0.30, 0.62], radius: 0.10, strength: -0.25 }, // slim: pull jaw in
       { center: [0.70, 0.62], radius: 0.10, strength: -0.25 },
     ]);
     engine.clearFaceWarps();

     // Sticker / AR overlay drawing — called every frame with the
     // 2D context of the OUTPUT canvas (same pixel size as the
     // video), after the WebGL beauty/filter pass has already been
     // drawn into it. FaceEffectsEngine wires this up automatically;
     // you can also set it manually for testing.
     engine.setOverlayDrawFn((ctx, w, h) => {
       ctx.fillStyle = "red";
       ctx.fillRect(10, 10, 20, 20);
     });
     engine.clearOverlayDrawFn();

     engine.stop(); // tears everything down

   If WebGL isn't available, start() falls back to returning the
   original, unfiltered stream — the caller doesn't need to know
   the difference. (Stickers/warps require WebGL + FaceEffectsEngine
   and are simply skipped in that fallback path.)
   ============================================================ */

const VERTEX_SRC = `
  attribute vec2 aPos;
  varying vec2 vUv;
  void main() {
    // Deterministic vertical flip baked into the UV math — do NOT
    // also set gl.pixelStorei(UNPACK_FLIP_Y_WEBGL, true) anywhere,
    // that would flip it twice.
    vec2 uv = aPos * 0.5 + 0.5;
    vUv = vec2(uv.x, 1.0 - uv.y);
    gl_Position = vec4(aPos, 0.0, 1.0);
  }
`;

const MAX_WARPS = 6;

const FRAGMENT_SRC = `
  precision mediump float;
  varying vec2 vUv;
  uniform sampler2D uTex;
  uniform vec2  uTexel;       // 1/width, 1/height
  uniform float uSmoothing;   // 0..1
  uniform float uBrightness;  // additive
  uniform float uContrast;    // multiplicative around 0.5
  uniform float uSaturation;  // multiplicative
  uniform float uSharpness;   // 0..~1.5
  uniform int   uFilterMode;  // 0 none,1 vintage,2 bw,3 warm,4 cool,5 vivid,6 cinematic
  uniform float uFilterIntensity; // 0..1

  // AR face-warp control points (Big Eyes / Slim Face / Small Nose,
  // or any other landmark-anchored liquify effect). Applied in UV
  // space BEFORE everything else, so blur/sharpen/grade all operate
  // on the already-warped image.
  uniform vec2  uWarpCenter[${MAX_WARPS}];
  uniform float uWarpRadius[${MAX_WARPS}];
  uniform float uWarpStrength[${MAX_WARPS}]; // + = bulge/magnify, - = pinch/shrink
  uniform int   uWarpCount;

  vec3 sampleAt(vec2 uv) { return texture2D(uTex, uv).rgb; }

  vec2 applyWarps(vec2 uv) {
    vec2 result = uv;
    for (int i = 0; i < ${MAX_WARPS}; i++) {
      float active = step(float(i) + 0.5, float(uWarpCount)); // 1.0 if i < uWarpCount
      vec2 center = uWarpCenter[i];
      float radius = max(uWarpRadius[i], 0.0001);
      vec2 delta = result - center;
      float dist = length(delta);
      float percent = clamp(1.0 - dist / radius, 0.0, 1.0);
      float factor = 1.0 - uWarpStrength[i] * percent * percent;
      vec2 warped = center + delta * factor;
      result = mix(result, warped, active);
    }
    return result;
  }

  // 9-tap approximate gaussian blur at a given pixel radius.
  vec3 blur9(vec2 uv, float r) {
    vec2 t = uTexel * r;
    vec3 B = vec3(0.0);
    B += sampleAt(uv + vec2(-t.x, -t.y)) * 0.075;
    B += sampleAt(uv + vec2( 0.0, -t.y)) * 0.123;
    B += sampleAt(uv + vec2( t.x, -t.y)) * 0.075;
    B += sampleAt(uv + vec2(-t.x,  0.0)) * 0.123;
    B += sampleAt(uv + vec2( 0.0,  0.0)) * 0.208;
    B += sampleAt(uv + vec2( t.x,  0.0)) * 0.123;
    B += sampleAt(uv + vec2(-t.x,  t.y)) * 0.075;
    B += sampleAt(uv + vec2( 0.0,  t.y)) * 0.123;
    B += sampleAt(uv + vec2( t.x,  t.y)) * 0.075;
    return B;
  }

  // Instagram-style mood grading. Applied post beauty/exposure, then
  // blended back with the un-graded color by uFilterIntensity.
  vec3 applyGrade(vec3 c, int mode) {
    float luma = dot(c, vec3(0.299, 0.587, 0.114));

    if (mode == 1) { // Vintage — faded sepia lift, warm cast
      vec3 sepia = vec3(luma * 1.07, luma * 0.94, luma * 0.71);
      vec3 v = mix(c, sepia, 0.55);
      v *= vec3(1.03, 0.98, 0.90);
      v = mix(v, vec3(0.06, 0.05, 0.04), 0.05); // lift blacks slightly (faded look)
      return v;
    }
    if (mode == 2) { // B&W
      return vec3(luma * 1.02);
    }
    if (mode == 3) { // Warm
      return c * vec3(1.10, 1.02, 0.90);
    }
    if (mode == 4) { // Cool
      return c * vec3(0.90, 1.02, 1.12);
    }
    if (mode == 5) { // Vivid — punchy saturation + contrast
      vec3 v = (c - 0.5) * 1.15 + 0.5;
      float l2 = dot(v, vec3(0.299, 0.587, 0.114));
      v = mix(vec3(l2), v, 1.35);
      return v;
    }
    if (mode == 6) { // Cinematic — teal shadows / orange highlights
      vec3 shadow = vec3(0.0, 0.09, 0.13);
      vec3 highlight = vec3(0.13, 0.06, 0.0);
      float w = smoothstep(0.05, 0.95, luma);
      vec3 tinted = c + mix(shadow, highlight, w) * 0.5;
      return (tinted - 0.5) * 1.08 + 0.5;
    }
    return c;
  }

  void main() {
    // 0) AR warp pass — everything downstream reads from this UV.
    vec2 uv = applyWarps(vUv);

    vec3 C = sampleAt(uv);

    // 1) tight blur, used for edge detection + light smoothing.
    vec3 B1 = blur9(uv, 1.6);

    // 2) wider blur of the blurred result — flattens skin.
    vec3 B2 = blur9(uv, 3.2);
    vec3 B = mix(B1, B2, 0.65);

    // Edge detection off the tight blur so eyes/brows/lips/hairline
    // stay sharp instead of getting smoothed along with skin.
    float diff = length(C - B1);
    float edgeFactor = smoothstep(0.045, 0.16, diff);
    float blendAmount = uSmoothing * (1.0 - edgeFactor);
    vec3 smoothed = mix(C, B, blendAmount);

    // 3) Unsharp mask — re-inject original high-frequency detail.
    vec3 detail = C - B1;
    vec3 sharpened = smoothed + uSharpness * detail;

    // 4) Brightness / contrast / saturation ("glow").
    vec3 color = (sharpened - 0.5) * uContrast + 0.5 + uBrightness;
    float luma = dot(color, vec3(0.299, 0.587, 0.114));
    color = mix(vec3(luma), color, uSaturation);

    // 5) Mood / color-filter grade, blended by intensity.
    if (uFilterMode != 0) {
      vec3 graded = applyGrade(color, uFilterMode);
      color = mix(color, graded, uFilterIntensity);
    }

    gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
  }
`;

function compileShader(gl, type, src) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error("Shader compile failed: " + log);
  }
  return shader;
}

const FILTER_MODES = {
  none: 0,
  vintage: 1,
  bw: 2,
  warm: 3,
  cool: 4,
  vivid: 5,
  cinematic: 6
};

export class BeautyFilterEngine {
  // ── Beauty intensity presets (feeds setParams directly) ──
  static BEAUTY_PRESETS = {
    light:  { smoothing: 0.32, brightness: 0.03, contrast: 1.03, saturation: 1.03, sharpness: 0.28 },
    medium: { smoothing: 0.62, brightness: 0.06, contrast: 1.06, saturation: 1.08, sharpness: 0.45 },
    glam:   { smoothing: 0.88, brightness: 0.10, contrast: 1.10, saturation: 1.16, sharpness: 0.65 }
  };

  static COLOR_FILTERS = Object.keys(FILTER_MODES);

  constructor() {
    this._raw = null;
    this._video = null;
    this._glCanvas = null;   // offscreen WebGL render target
    this._outCanvas = null;  // 2D canvas: gl output + sticker overlay -> captureStream()
    this._outCtx = null;
    this._gl = null;
    this._program = null;
    this._texture = null;
    this._uniforms = {};
    this._rafId = null;
    this._outStream = null;
    this._overlayDrawFn = null;
    this._faceWarps = []; // [{center:[x,y], radius, strength}, ...]
    this._params = {
      smoothing: 0.62,
      brightness: 0.06,
      contrast: 1.06,
      saturation: 1.08,
      sharpness: 0.45,
      filter: "none",
      filterIntensity: 1.0
    };
  }

  /**
   * Starts filtering a raw camera MediaStream and returns a new
   * MediaStream (filtered video + passthrough audio).
   * @param {MediaStream} rawStream
   * @param {object} [params] initial filter params (see class doc)
   * @param {number} [fps]
   */
  start(rawStream, params = {}, fps = 30) {
    this._params = { ...this._params, ...params };
    this._raw = rawStream;

    const videoTrack = rawStream.getVideoTracks()[0];
    if (!videoTrack) return rawStream; // audio-only (mic seat / guest) — nothing to filter

    const settings = videoTrack.getSettings();
    const width = settings.width || 1280;
    const height = settings.height || 720;

    const video = document.createElement("video");
    video.srcObject = new MediaStream([videoTrack]);
    video.muted = true;
    video.playsInline = true;
    video.play().catch(() => {});
    this._video = video;

    const glCanvas = document.createElement("canvas");
    glCanvas.width = width;
    glCanvas.height = height;
    this._glCanvas = glCanvas;

    const outCanvas = document.createElement("canvas");
    outCanvas.width = width;
    outCanvas.height = height;
    this._outCanvas = outCanvas;
    this._outCtx = outCanvas.getContext("2d");

    const gl = glCanvas.getContext("webgl", { alpha: false, antialias: false, preserveDrawingBuffer: false });
    if (!gl) {
      console.warn("[BeautyFilterEngine] WebGL unavailable — falling back to unfiltered stream");
      return rawStream;
    }
    this._gl = gl;

    try {
      this._setupGl(gl, width, height);
    } catch (e) {
      console.warn("[BeautyFilterEngine] Shader setup failed — falling back to unfiltered stream:", e);
      return rawStream;
    }

    const draw = () => {
      this._renderFrame();
      this._rafId = requestAnimationFrame(draw);
    };
    this._rafId = requestAnimationFrame(draw);

    const filteredVideoTrack = outCanvas.captureStream(fps).getVideoTracks()[0];
    const audioTrack = rawStream.getAudioTracks()[0];

    const outStream = new MediaStream();
    outStream.addTrack(filteredVideoTrack);
    if (audioTrack) outStream.addTrack(audioTrack);

    this._outStream = outStream;
    return outStream;
  }

  _setupGl(gl, width, height) {
    const vShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SRC);
    const fShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC);
    const program = gl.createProgram();
    gl.attachShader(program, vShader);
    gl.attachShader(program, fShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error("Program link failed: " + gl.getProgramInfoLog(program));
    }
    gl.useProgram(program);
    this._program = program;

    const quad = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    this._texture = texture;

    this._uniforms = {
      uTexel: gl.getUniformLocation(program, "uTexel"),
      uSmoothing: gl.getUniformLocation(program, "uSmoothing"),
      uBrightness: gl.getUniformLocation(program, "uBrightness"),
      uContrast: gl.getUniformLocation(program, "uContrast"),
      uSaturation: gl.getUniformLocation(program, "uSaturation"),
      uSharpness: gl.getUniformLocation(program, "uSharpness"),
      uFilterMode: gl.getUniformLocation(program, "uFilterMode"),
      uFilterIntensity: gl.getUniformLocation(program, "uFilterIntensity"),
      uWarpCenter: gl.getUniformLocation(program, "uWarpCenter"),
      uWarpRadius: gl.getUniformLocation(program, "uWarpRadius"),
      uWarpStrength: gl.getUniformLocation(program, "uWarpStrength"),
      uWarpCount: gl.getUniformLocation(program, "uWarpCount")
    };

    gl.viewport(0, 0, width, height);
    gl.uniform2f(this._uniforms.uTexel, 1 / width, 1 / height);
  }

  _renderFrame() {
    const { _gl: gl, _video: video, _texture: texture } = this;
    if (!gl || !video || video.readyState < 2) return;

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);

    const p = this._params;
    gl.uniform1f(this._uniforms.uSmoothing, p.smoothing);
    gl.uniform1f(this._uniforms.uBrightness, p.brightness);
    gl.uniform1f(this._uniforms.uContrast, p.contrast);
    gl.uniform1f(this._uniforms.uSaturation, p.saturation);
    gl.uniform1f(this._uniforms.uSharpness, p.sharpness);
    gl.uniform1i(this._uniforms.uFilterMode, FILTER_MODES[p.filter] ?? 0);
    gl.uniform1f(this._uniforms.uFilterIntensity, p.filterIntensity ?? 1.0);

    // Face warps (AR liquify) — pack up to MAX_WARPS control points.
    const warps = this._faceWarps.slice(0, MAX_WARPS);
    const centers = new Float32Array(MAX_WARPS * 2);
    const radii = new Float32Array(MAX_WARPS);
    const strengths = new Float32Array(MAX_WARPS);
    warps.forEach((w, i) => {
      centers[i * 2] = w.center[0];
      centers[i * 2 + 1] = w.center[1];
      radii[i] = w.radius;
      strengths[i] = w.strength;
    });
    gl.uniform2fv(this._uniforms.uWarpCenter, centers);
    gl.uniform1fv(this._uniforms.uWarpRadius, radii);
    gl.uniform1fv(this._uniforms.uWarpStrength, strengths);
    gl.uniform1i(this._uniforms.uWarpCount, warps.length);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Composite: WebGL output -> 2D output canvas -> overlay (stickers).
    if (this._outCtx) {
      this._outCtx.drawImage(this._glCanvas, 0, 0);
      if (this._overlayDrawFn) {
        try {
          this._overlayDrawFn(this._outCtx, this._outCanvas.width, this._outCanvas.height);
        } catch (e) {
          console.warn("[BeautyFilterEngine] overlay draw fn threw:", e);
        }
      }
    }
  }

  /** Live-update any subset of {smoothing, brightness, contrast, saturation, sharpness, filter, filterIntensity}. */
  setParams(partial) {
    this._params = { ...this._params, ...partial };
  }

  getParams() {
    return { ...this._params };
  }

  /** Beauty intensity presets: "light" | "medium" | "glam". */
  applyBeautyPreset(name) {
    const preset = BeautyFilterEngine.BEAUTY_PRESETS[name];
    if (!preset) {
      console.warn(`[BeautyFilterEngine] Unknown beauty preset "${name}"`);
      return;
    }
    this.setParams(preset);
  }

  /** Mood / color filter: "none"|"vintage"|"bw"|"warm"|"cool"|"vivid"|"cinematic", intensity 0..1. */
  setColorFilter(name, intensity = 1.0) {
    if (!(name in FILTER_MODES)) {
      console.warn(`[BeautyFilterEngine] Unknown color filter "${name}"`);
      return;
    }
    this.setParams({ filter: name, filterIntensity: intensity });
  }

  /**
   * Set AR face-warp control points, driven each frame by
   * FaceEffectsEngine's live landmarks (or manually for testing).
   * @param {Array<{center:[number,number], radius:number, strength:number}>} warps
   *   center/radius are in UV space (0..1, same convention as vUv:
   *   x = left-to-right, y = top-to-bottom of the rendered frame).
   *   strength: positive bulges/magnifies (e.g. bigger eyes),
   *   negative pinches/shrinks (e.g. slimmer jaw/nose).
   */
  setFaceWarps(warps) {
    this._faceWarps = Array.isArray(warps) ? warps.slice(0, MAX_WARPS) : [];
  }

  clearFaceWarps() {
    this._faceWarps = [];
  }

  /**
   * Register a function called every frame with (ctx, width, height)
   * of the 2D output canvas, AFTER the WebGL beauty/filter pass has
   * been drawn into it — this is how stickers/AR overlays get
   * composited into the final MediaStream. See FaceEffectsEngine.
   */
  setOverlayDrawFn(fn) {
    this._overlayDrawFn = typeof fn === "function" ? fn : null;
  }

  clearOverlayDrawFn() {
    this._overlayDrawFn = null;
  }

  /** The hidden <video> element driving the render — FaceEffectsEngine
   *  can reuse this same element's track for landmark detection so
   *  both pipelines stay perfectly in sync frame-to-frame. */
  getVideoElement() {
    return this._video;
  }

  getOutputSize() {
    if (!this._outCanvas) return { width: 0, height: 0 };
    return { width: this._outCanvas.width, height: this._outCanvas.height };
  }

  /** True while a WebGL filter pipeline is actively running. */
  isActive() {
    return !!this._rafId;
  }

  /** Stops the render loop and releases the hidden video/canvas/GL resources. */
  stop() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = null;

    if (this._video) {
      this._video.srcObject = null;
      this._video = null;
    }
    if (this._gl) {
      const gl = this._gl;
      if (this._texture) gl.deleteTexture(this._texture);
      if (this._program) gl.deleteProgram(this._program);
      this._gl = null;
    }
    this._glCanvas = null;
    this._outCanvas = null;
    this._outCtx = null;
    this._overlayDrawFn = null;
    this._faceWarps = [];
    this._outStream = null;
  }
}