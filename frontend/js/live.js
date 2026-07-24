import * as mediasoupClient from "mediasoup-client";
import { BeautyFilterEngine } from "./beauty-filter.js";
import { FaceEffectsEngine } from "./face-effects.js";
import "./api.js";
import "./app.js";

/* ============================================================
   FIXES APPLIED IN THIS PASS (root-cause trace, not speculative):
   ------------------------------------------------------------
   FIX-1 (root cause of black-screen / "producer replaced" bug):
     consumeProducer() had NO guard against consuming the same
     producerId twice. On any reconnect, the client re-emits
     "joinRoom", the server resends the FULL "existingProducers"
     list, and consumeProducer() ran again for producers already
     being consumed. attachTrackToStage()/attachTrackToParticipantTile()
     both call removeTrack()+track.stop() on whatever track is
     CURRENTLY in the target <video> element before adding the new
     one - so a duplicate consume silently kills a track that was
     already working. This is exactly checklist item #7 ("ensure
     producers/consumers are not being closed or replaced"). Fixed
     with a producerId -> consumerId map that skips re-consumption
     and is cleaned up on producerclose/transportclose.

   FIX-2 (real correctness bug, independent of the above):
     getPreferredVideoCodec() was computed but never actually
     passed into sendTransport.produce()/claimGuestSeat's produce()
     calls, so mediasoup-client always negotiated whatever codec is
     FIRST in the router's list (VP8) regardless of what the UI
     claimed to prefer. Fixed by resolving the actual RtpCodecCapability
     object from device.rtpCapabilities and passing it explicitly.

   FIX-3 (instrumentation - answers "why does host video freeze"):
     No code path in this file touches the HOST's own localStream /
     #local-video / #stage-video in response to guest-join events -
     so if the host's own preview is still freezing after FIX-1,
     it is a browser/OS-level frame stall, not app logic. Added a
     frame-freeze watchdog (requestVideoFrameCallback, with a
     currentTime-polling fallback) on every <video> element this
     file controls, so a stall now produces an unmistakable,
     timestamped console.error the moment it happens, instead of
     being inferred after the fact.

   FIX-4 (requested logging): detailed, tagged logs for producer
     creation, consumer creation, transport connect/state, and
     track mute/unmute/ended - added throughout.

   ------------------------------------------------------------
   HLS-1 (THIS PASS — audience scaling via mediasoup -> FFmpeg ->
     RTMP -> HLS/CDN, see backend/src/mediasoup/liveEgressManager.js):

     Plain audience (not on stage) no longer opens a WebRTC consumer
     for the HOST's producer(s). Instead they play the host through
     hls.js against the `hlsUrl` the backend now returns from
     GET /live/:id (liveRoomController.getById() -> liveEgressManager
     .getEgressStatus()). This is the actual point of the egress
     pipeline: the SFU stops allocating a per-viewer consumer for
     the host stream, which is the thing that doesn't scale past a
     few hundred concurrent viewers.

     What did NOT change:
       - Host publishing (publishStream) — still pure WebRTC, unchanged.
       - Mic-seat / guest-seat occupants — still pure WebRTC
         produce+consume, since they need real low-latency talk-over-
         each-other audio. Claiming a seat flips a viewer from
         HLS -> WebRTC (enterInteractiveMode); leaving flips back
         (enterAudienceMode).
       - Guest/co-host video tiles for OTHER audience members — still
         consumed via WebRTC exactly as before. Only the HOST's
         producer is ever skipped for HLS-mode viewers, because the
         backend only egresses the host's producers (see
         liveEgressManager.js's own integration notes).
       - consumeProducer()'s FIX-1 dedup guard — unchanged, and is
         exactly what makes enterInteractiveMode() safe to implement
         as "just re-emit joinRoom".
   ============================================================ */

/* ── Device ── */
let device = null;

let _deviceReadyResolve;
const deviceReady = new Promise((resolve) => { _deviceReadyResolve = resolve; });

/* ── Transports ── */
let sendTransport = null;
let recvTransport         = null;
let recvTransportPromise  = null;

/* ── Producers (self) ── */
let videoProducer = null;
let audioProducer = null;

/* ── Consumers ── */
const consumers = new Map();
const peerStreams = new Map();

// FIX-1: producerId -> consumerId. Guards against consuming the
// same remote producer twice (reconnect / duplicate existingProducers
// / duplicate newProducer race), which was silently stopping tracks
// that were already attached and working.
const consumedProducers = new Map();

/* ── Audio boost graph ── */
const audioBoosts = new Map();
let audioCtx = null;
const AUDIO_BOOST_GAIN = 1.7;
const SPEAKING_THRESHOLD = 18;

/* ── Beauty / color-filter / AR engines ──
   beautyEngine: smoothing + sharpening + brightness/contrast/
   saturation + color-mood grading + landmark-driven liquify warps,
   all in one WebGL pass (see beauty-filter.js).
   faceEngine: MediaPipe face-landmark tracking that feeds the
   warp control points into beautyEngine and draws stickers into
   its 2D compositing canvas (see face-effects.js). Loaded lazily
   the first time the host actually goes live with a camera, since
   the model download/GPU init is unnecessary for audience/guests. ── */
const beautyEngine = new BeautyFilterEngine();
const faceEngine = new FaceEffectsEngine();
let beautyOn = true;
let faceEngineAttached = false;
let faceEngineAttaching = null; // in-flight attach() promise, so we never double-load the model

/* ── State ── */
let localStream   = null;
let isHost        = false;
let currentRoom   = null;
let viewerCount   = 0;
let following     = false;
let selectedGift  = null;
let secondsLive   = 0;
let coinBalance   = 0;
let isMicMuted    = false;
let isCameraOff   = false;
let GIFT_CATALOG  = [];

let mySeatIndex = null;
let myGuestSlot = null;

/* ── HLS-1: audience playback state ──
   viewMode tracks how #stage-video is currently being fed:
     "webrtc" - host publishing (isHost) OR this viewer is
                interactive (seated / guest) and consuming the
                host's real WebRTC producer.
     "hls"    - plain audience, playing the host via hls.js against
                the egressed HLS stream instead of a WebRTC consumer. */
let viewMode        = "webrtc";
let hls             = null;
let audienceHlsUrl  = null;
let hlsPollTimer    = null;

const params = new URLSearchParams(window.location.search);
const roomId = params.get("room") || params.get("id");

if (!roomId) window.showToast?.("Invalid room link");

const SOCKET_URL = window.API_BASE_URL.replace(/\/api\/?$/, "");
console.log("[live.js socket] Connecting to:", SOCKET_URL);

const socket = io(SOCKET_URL, {
  transports:          ["polling", "websocket"],
  reconnectionAttempts: 5,
  reconnectionDelay:   1000
});

socket.on("connect", () => {
  console.log(
    "[live.js socket] connected. id=", socket.id,
    "transport=", socket.io.engine.transport.name
  );
  window.__mySocketId = socket.id;
});

socket.on("connect_error", (err) => {
  console.error("[live.js socket] connect_error:", err.message, err);
});

socket.on("disconnect", (reason) => {
  console.warn("[live.js socket] disconnected. reason=", reason);
});

socket.on("reconnect_attempt", (attempt) => {
  console.log("[live.js socket] reconnect_attempt #", attempt);
});

socket.on("reconnect_error", (err) => {
  console.error("[live.js socket] reconnect_error:", err.message);
});

socket.on("reconnect_failed", () => {
  console.error("[live.js socket] reconnect_failed - giving up");
});

socket.io.on("error", (err) => {
  console.error("[live.js socket manager] error:", err);
});

socket.io.engine?.on("upgrade", (transport) => {
  console.log("[live.js socket] transport upgraded to:", transport.name);
});

socket.io.engine?.on("upgradeError", (err) => {
  console.error("[live.js socket] upgradeError:", err);
});

function $(id) { return document.getElementById(id); }

function nowMs() { return Math.round(performance.now()); }

function dispatchSpeaking(socketId, isHostFlag, active) {
  window.dispatchEvent(new CustomEvent("speakingChanged", {
    detail: { socketId, isHost: !!isHostFlag, active: !!active }
  }));
}

/* ============================================================
   HLS-1: is this viewer plain audience right now?
   ------------------------------------------------------------
   Host is never audience. A viewer stops being audience the
   instant they claim a mic seat or a guest slot (see
   claimMicSeat/claimGuestSeat -> enterInteractiveMode), and goes
   back to being audience the instant they leave (see
   releaseMicSeat/releaseGuestSeatLocal -> enterAudienceMode).
   ============================================================ */
function isAudienceHlsMode() {
  return !isHost && mySeatIndex === null && myGuestSlot === null;
}

/* ============================================================
   HLS-1: HLS playback for #stage-video (plain audience only)
   ============================================================ */
function attachHlsToStage(url) {
  const stageVideo = $("stage-video");
  if (!stageVideo || !url) return;

  console.log("[attachHlsToStage] Loading HLS stream:", url);
  detachHlsFromStage();
  viewMode = "hls";

  const offlineEl = $("stage-offline");
  if (offlineEl) offlineEl.style.display = "none";

  if (window.Hls && window.Hls.isSupported()) {
    hls = new window.Hls({
      lowLatencyMode: true,
      liveSyncDurationCount: 3,
      backBufferLength: 30
    });
    hls.loadSource(url);
    hls.attachMedia(stageVideo);

    hls.on(window.Hls.Events.ERROR, (_event, data) => {
      console.warn(`[hls.js] error type=${data.type} details=${data.details} fatal=${data.fatal}`);
      if (!data.fatal) return;

      switch (data.type) {
        case window.Hls.ErrorTypes.NETWORK_ERROR:
          console.warn("[hls.js] fatal network error - calling hls.startLoad()");
          try { hls.startLoad(); } catch (e) {}
          break;
        case window.Hls.ErrorTypes.MEDIA_ERROR:
          console.warn("[hls.js] fatal media error - calling hls.recoverMediaError()");
          try { hls.recoverMediaError(); } catch (e) {}
          break;
        default:
          console.error("[hls.js] unrecoverable fatal error - tearing down and re-polling for a fresh hlsUrl");
          detachHlsFromStage();
          pollForHlsUrl();
          break;
      }
    });
  } else if (stageVideo.canPlayType("application/vnd.apple.mpegurl")) {
    // Safari (and some mobile browsers) play HLS natively - no
    // hls.js needed, just point the <video> at the .m3u8 directly.
    console.log("[attachHlsToStage] Using native HLS support (no hls.js)");
    stageVideo.src = url;
  } else {
    console.error("[attachHlsToStage] No HLS playback support in this browser (no hls.js, no native HLS)");
    window.showToast("Your browser can't play this live stream");
    return;
  }

  // Autoplay policies require starting muted; initHlsAudioUnlock()
  // unmutes on the viewer's first tap, same pattern as the existing
  // WebRTC audio-boost tap-to-unmute flow.
  stageVideo.muted = true;
  stageVideo.play().catch(e => console.warn("[attachHlsToStage] play() rejected:", e.message));
  startFreezeWatchdog(stageVideo, "stage-video(hls-audience)");

  const stageLabel = $("stage-host-label");
  if (stageLabel) {
    stageLabel.textContent = currentRoom?.username || currentRoom?.display_name || "Host";
  }
}

function detachHlsFromStage() {
  if (hls) {
    console.log("[detachHlsFromStage] Destroying hls.js instance");
    try { hls.destroy(); } catch (e) {}
    hls = null;
  }

  const stageVideo = $("stage-video");
  if (stageVideo) {
    stopFreezeWatchdog(stageVideo);
    try {
      stageVideo.removeAttribute("src");
      stageVideo.load();
    } catch (e) {}
    stageVideo.srcObject = null;
  }
}

/**
 * Retries GET /live/:id every 5s until the backend reports a live
 * hlsUrl (covers the gap between "host started publishing" and
 * "FFmpeg/RTMP->HLS packager has produced its first segment").
 * Self-cancels the moment this viewer stops being audience (seated,
 * became host — shouldn't happen mid-poll, but defensive) or the
 * hlsUrl shows up.
 */
function pollForHlsUrl() {
  if (hlsPollTimer) return;
  console.log("[pollForHlsUrl] hlsUrl not ready yet - polling every 5s");

  hlsPollTimer = setInterval(async () => {
    if (isHost || !isAudienceHlsMode()) {
      console.log("[pollForHlsUrl] No longer plain audience - stopping poll");
      clearInterval(hlsPollTimer);
      hlsPollTimer = null;
      return;
    }
    try {
      const response = await window.api.request(`/live/${roomId}`);
      const url = response.data?.hlsUrl;
      if (url) {
        console.log("[pollForHlsUrl] hlsUrl now available:", url);
        audienceHlsUrl = url;
        clearInterval(hlsPollTimer);
        hlsPollTimer = null;
        attachHlsToStage(url);
      }
    } catch (err) {
      console.warn("[pollForHlsUrl] request failed:", err.message);
    }
  }, 5000);
}

function stopHlsPolling() {
  if (hlsPollTimer) {
    clearInterval(hlsPollTimer);
    hlsPollTimer = null;
  }
}

/**
 * Called once, on load, for non-host viewers. Uses whatever hlsUrl
 * loadRoom() already picked up; falls back to polling if the
 * egress pipeline hasn't produced a playlist yet.
 */
function initAudienceHlsMode() {
  audienceHlsUrl = currentRoom?.hlsUrl || null;
  if (audienceHlsUrl) {
    attachHlsToStage(audienceHlsUrl);
  } else {
    console.log("[initAudienceHlsMode] No hlsUrl yet on room payload - will poll");
    pollForHlsUrl();
  }
}

/**
 * Viewer claimed a mic seat or guest slot: stop HLS, stop polling,
 * and re-trigger the server's "existingProducers" resend so the
 * host's WebRTC producer(s) - intentionally skipped while this
 * viewer was audience (see consumeProducer's isAudienceHlsMode()
 * guard below) - get consumed now. FIX-1's dedup guard makes this
 * safe even though it looks like a blunt "just rejoin" call.
 */
function enterInteractiveMode() {
  console.log("[enterInteractiveMode] Leaving HLS audience playback, switching #stage-video to WebRTC");
  stopHlsPolling();
  detachHlsFromStage();
  viewMode = "webrtc";

  const offlineEl = $("stage-offline");
  if (offlineEl) offlineEl.style.display = "flex";

  socket.emit("joinRoom", { roomId, userId: window.CURRENT_USER.id });
}

/**
 * Viewer left their mic seat / guest slot and is back to being
 * plain audience: close whatever WebRTC consumer(s) we were using
 * for the host (no longer needed - the HLS stream already carries
 * the host's video+audio, egressed server-side independently of
 * any individual viewer's consumers) and resume HLS playback.
 */
function enterAudienceMode() {
  console.log("[enterAudienceMode] Returning to HLS audience playback");

  for (const [consumerId, entry] of [...consumers.entries()]) {
    if (!entry.isHost) continue;
    try { entry.consumer.close(); } catch (e) {}
    cleanupAudioBoost(consumerId);
    consumers.delete(consumerId);
    if (consumedProducers.get(entry.producerId) === consumerId) {
      consumedProducers.delete(entry.producerId);
    }
    console.log(`[enterAudienceMode] Closed leftover host consumer=${consumerId} kind=${entry.kind}`);
  }

  if (audienceHlsUrl) {
    attachHlsToStage(audienceHlsUrl);
  } else {
    pollForHlsUrl();
  }
}

function initHlsAudioUnlock() {
  const unmute = () => {
    if (viewMode !== "hls") return;
    const stageVideo = $("stage-video");
    if (stageVideo && stageVideo.muted) {
      stageVideo.muted = false;
      stageVideo.play().catch(() => {});
    }
  };
  document.addEventListener("pointerdown", unmute, { passive: true });
}

/* ============================================================
   FIX-3: FRAME-FREEZE WATCHDOG
   ------------------------------------------------------------
   Attaches to any <video> element this file controls (local
   preview, stage video, participant tiles) and logs a clear,
   timestamped console.error the instant that element stops
   advancing frames for longer than STALL_MS - regardless of
   whether the srcObject/track/connection "look" fine. This turns
   "the host's video freezes" from an inferred symptom into a
   provable, timestamped event that can be correlated against the
   producer/consumer logs below.
   ============================================================ */
const STALL_MS = 2500;
const watchdogs = new Map(); // videoEl -> { stop() }

function watchdogLabel(el) {
  return el?.id || el?.dataset?.socketId || "video";
}

function stopFreezeWatchdog(videoEl) {
  const entry = watchdogs.get(videoEl);
  if (entry) {
    entry.stop();
    watchdogs.delete(videoEl);
  }
}

function startFreezeWatchdog(videoEl, label) {
  if (!videoEl) return;
  stopFreezeWatchdog(videoEl);

  let lastAdvanceAt = nowMs();
  let lastTime = videoEl.currentTime;
  let stalledLogged = false;
  let rvfcHandle = null;
  let pollHandle = null;
  let stopped = false;

  function markAlive() {
    lastAdvanceAt = nowMs();
    if (stalledLogged) {
      console.log(`[freeze-watchdog:${label}] ✅ recovered - frames advancing again`);
      stalledLogged = false;
    }
  }

  function checkStall() {
    if (stopped) return;
    const gap = nowMs() - lastAdvanceAt;
    if (gap > STALL_MS && !stalledLogged) {
      stalledLogged = true;
      console.error(
        `[freeze-watchdog:${label}] ❌ FROZEN - no new frame for ${gap}ms ` +
        `(readyState=${videoEl.readyState}, paused=${videoEl.paused}, ` +
        `srcObject active=${videoEl.srcObject?.active}, ` +
        `videoTracks=${videoEl.srcObject?.getVideoTracks?.().map(t => `${t.label}:${t.readyState}:muted=${t.muted}`)})`
      );
    }
  }

  if ("requestVideoFrameCallback" in HTMLVideoElement.prototype) {
    const onFrame = () => {
      if (stopped) return;
      markAlive();
      rvfcHandle = videoEl.requestVideoFrameCallback(onFrame);
    };
    rvfcHandle = videoEl.requestVideoFrameCallback(onFrame);
    pollHandle = setInterval(checkStall, 500);
  } else {
    // Fallback for browsers without requestVideoFrameCallback:
    // poll currentTime, which still advances even without an rVFC.
    pollHandle = setInterval(() => {
      if (stopped) return;
      if (videoEl.currentTime !== lastTime) {
        lastTime = videoEl.currentTime;
        markAlive();
      }
      checkStall();
    }, 500);
  }

  watchdogs.set(videoEl, {
    stop() {
      stopped = true;
      if (pollHandle) clearInterval(pollHandle);
      if (rvfcHandle != null && videoEl.cancelVideoFrameCallback) {
        try { videoEl.cancelVideoFrameCallback(rvfcHandle); } catch (e) {}
      }
    }
  });

  console.log(`[freeze-watchdog:${label}] armed`);
}

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

function showTapForSound() {
  $("tap-for-sound")?.classList.add("show");
}
function hideTapForSound() {
  $("tap-for-sound")?.classList.remove("show");
}

function resumeAudioContext() {
  const ctx = getAudioContext();
  if (ctx.state === "suspended") {
    ctx.resume().then(hideTapForSound).catch(() => {});
  } else {
    hideTapForSound();
  }
}

function initAudioUnlock() {
  const unlock = () => { resumeAudioContext(); };
  document.addEventListener("pointerdown", unlock, { passive: true });
  $("tap-for-sound")?.addEventListener("click", unlock);
}

function setupAudioBoost(track, consumerId, socketId, isHostFlag = false) {
  try {
    const ctx = getAudioContext();

    const source     = ctx.createMediaStreamSource(new MediaStream([track]));
    const gainNode    = ctx.createGain();
    gainNode.gain.value = AUDIO_BOOST_GAIN;

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.knee.value      = 18;
    compressor.ratio.value     = 4;
    compressor.attack.value    = 0.003;
    compressor.release.value   = 0.25;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.6;
    const analyserData = new Uint8Array(analyser.frequencyBinCount);

    source.connect(gainNode).connect(compressor).connect(ctx.destination);
    compressor.connect(analyser);

    let wasSpeaking = false;
    function tick() {
      const entry = audioBoosts.get(consumerId);
      if (!entry) return;
      analyser.getByteFrequencyData(analyserData);
      const avg = analyserData.reduce((a, b) => a + b, 0) / analyserData.length;
      const speaking = avg > SPEAKING_THRESHOLD;
      if (speaking !== wasSpeaking) {
        wasSpeaking = speaking;
        dispatchSpeaking(socketId, isHostFlag, speaking);
      }
      entry.rafId = requestAnimationFrame(tick);
    }
    const rafId = requestAnimationFrame(tick);

    audioBoosts.set(consumerId, { source, gainNode, compressor, analyser, socketId, isHost: isHostFlag, rafId });

    if (ctx.state === "suspended") showTapForSound();
  } catch (e) {
    console.warn("[setupAudioBoost] failed:", e);
  }
}

function cleanupAudioBoost(consumerId) {
  const entry = audioBoosts.get(consumerId);
  if (!entry) return;
  if (entry.rafId) cancelAnimationFrame(entry.rafId);
  try { entry.source.disconnect(); } catch (e) {}
  try { entry.gainNode.disconnect(); } catch (e) {}
  try { entry.compressor.disconnect(); } catch (e) {}
  try { entry.analyser.disconnect(); } catch (e) {}
  audioBoosts.delete(consumerId);
  dispatchSpeaking(entry.socketId, entry.isHost, false);
}

function cleanupAudioBoostsForSocket(socketId) {
  for (const [id, entry] of audioBoosts) {
    if (entry.socketId === socketId) cleanupAudioBoost(id);
  }
}

function cleanupAllAudioBoosts() {
  for (const id of [...audioBoosts.keys()]) cleanupAudioBoost(id);
}

/* ============================================================
   TRACK EVENT LOGGING (requested: mute/unmute/ended visibility)
   ============================================================ */
function instrumentTrack(track, label) {
  if (!track || track.__instrumented) return;
  track.__instrumented = true;

  console.log(`[track:${label}] created. kind=${track.kind} id=${track.id} readyState=${track.readyState} muted=${track.muted}`);

  track.addEventListener("mute", () => {
    console.warn(`[track:${label}] 🔇 MUTED (no RTP arriving) kind=${track.kind} id=${track.id}`);
  });
  track.addEventListener("unmute", () => {
    console.log(`[track:${label}] 🔊 unmuted (RTP flowing again) kind=${track.kind} id=${track.id}`);
  });
  track.addEventListener("ended", () => {
    console.error(`[track:${label}] ⛔ ENDED kind=${track.kind} id=${track.id}`);
  });
}

/* ============================================================
   CAMERA + MIC INIT (host / full publish)
   ============================================================ */
async function getLocalStream() {
  console.log("[getLocalStream] Requesting camera + mic...");
  const audioConstraints = {
    echoCancellation: true, noiseSuppression: true,
    autoGainControl: true, sampleRate: 48000, channelCount: 1
  };

  const videoProfiles = [
    { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, facingMode: "user" },
    { facingMode: "user" }
  ];

  for (const vc of videoProfiles) {
    try {
      const rawStream = await navigator.mediaDevices.getUserMedia({ video: vc, audio: audioConstraints });
      const vt = rawStream.getVideoTracks()[0];
      const at = rawStream.getAudioTracks()[0];
      console.log(`[getLocalStream] video=${vt?.label} audio=${at?.label}`, vt?.getSettings());
      instrumentTrack(vt, "local-video-raw");
      instrumentTrack(at, "local-audio-raw");

      const filtered = beautyEngine.start(rawStream, {
        smoothing:  beautyOn ? 0.62 : 0,
        brightness: beautyOn ? 0.06 : 0,
        contrast:   beautyOn ? 1.06 : 1,
        saturation: beautyOn ? 1.08 : 1,
        sharpness:  beautyOn ? 0.45 : 0,
        filter:          currentColorFilter,
        filterIntensity: currentFilterIntensity
      });

      instrumentTrack(filtered.getVideoTracks()[0], "local-video-filtered");

      // Fire-and-forget: loads the AR model in the background and
      // starts its detection loop once ready. Never blocks publish.
      ensureFaceEngineAttached();

      return filtered;
    } catch (e) {
      console.warn("[getLocalStream] Profile failed, retrying:", e.message);
    }
  }
  throw new Error("Camera/microphone access denied");
}

/**
 * Lazily attaches FaceEffectsEngine to beautyEngine (loads the
 * MediaPipe model once) and starts its detection loop. Safe to
 * call repeatedly - guarded so the model is only ever loaded once
 * per page session.
 */
function ensureFaceEngineAttached() {
  if (faceEngineAttached) { faceEngine.start(); return; }
  if (faceEngineAttaching) return faceEngineAttaching;

  faceEngineAttaching = faceEngine.attach(beautyEngine)
    .then(() => {
      faceEngineAttached = true;
      faceEngine.start();
      console.log("[ensureFaceEngineAttached] AR face-tracking ready");
    })
    .catch((e) => {
      console.warn("[ensureFaceEngineAttached] AR model failed to load - filters/beauty still work:", e);
    })
    .finally(() => { faceEngineAttaching = null; });

  return faceEngineAttaching;
}

/* ============================================================
   AUDIO-ONLY INIT (seat / guest claim - mic only, no camera.)
   ============================================================ */
async function getAudioOnlyStream() {
  console.log("[getAudioOnlyStream] Requesting mic only...");
  const audioConstraints = {
    echoCancellation: true, noiseSuppression: true,
    autoGainControl: true, sampleRate: 48000, channelCount: 1
  };
  return navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
}

async function loadDevice(rtpCapabilities) {
  console.log("[loadDevice] Loading mediasoup Device...");
  device = new mediasoupClient.Device();
  await device.load({ routerRtpCapabilities: rtpCapabilities });
  console.log("[loadDevice] Device loaded. Codecs:", device.rtpCapabilities.codecs.map(c => c.mimeType));
}

/**
 * FIX-2: this used to only decide the ENCODINGS shape, and was
 * never actually passed to sendTransport.produce() as a `codec`
 * override - so the codec actually negotiated (whatever
 * mediasoup-client picks first, i.e. VP8) could silently diverge
 * from what this function claimed to prefer. It now returns the
 * real RtpCodecCapability object so callers can pass it straight
 * into produce({ codec }).
 */
function getPreferredVideoCodecCapability() {
  const codecs = device?.rtpCapabilities?.codecs || [];
  const vp9  = codecs.find(c => c.mimeType.toLowerCase() === "video/vp9");
  const h264 = codecs.find(c => c.mimeType.toLowerCase() === "video/h264");
  const vp8  = codecs.find(c => c.mimeType.toLowerCase() === "video/vp8");
  const chosen = vp9 || h264 || vp8 || null;
  console.log("[getPreferredVideoCodecCapability] chosen:", chosen?.mimeType || "(none found)");
  return chosen;
}

function codecLabel(codecCapability) {
  if (!codecCapability) return "VP8";
  const mt = codecCapability.mimeType.toLowerCase();
  if (mt === "video/vp9") return "VP9";
  if (mt === "video/h264") return "H264";
  return "VP8";
}

function buildIceServers() {
  if (window.__turnConfig && Array.isArray(window.__turnConfig)) {
    console.log("[buildIceServers] Using ICE servers:", window.__turnConfig.length);
    return window.__turnConfig;
  }
  console.warn("[buildIceServers] No TURN config - using STUN only");
  return [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }
  ];
}

function hasRealTurnServer() {
  const cfg = window.__turnConfig;
  if (!Array.isArray(cfg)) return false;
  return cfg.some(entry => {
    const urls = Array.isArray(entry.urls) ? entry.urls : [entry.urls];
    return urls.some(u => typeof u === "string" && u.toLowerCase().startsWith("turn"));
  });
}

function getIceTransportPolicy() {
  const policy = hasRealTurnServer() ? "relay" : "all";
  console.log(`[getIceTransportPolicy] using "${policy}" (real TURN server present: ${hasRealTurnServer()})`);
  return policy;
}

async function createSendTransport() {
  console.log("[createSendTransport] Creating...");
  return new Promise((resolve, reject) => {
    socket.emit("createSendTransport", { roomId }, (params) => {
      if (params?.error) return reject(new Error(params.error));

      sendTransport = device.createSendTransport({
        ...params,
        iceServers:         buildIceServers(),
        iceTransportPolicy: getIceTransportPolicy()
      });

      sendTransport.on("connect", ({ dtlsParameters }, cb, errback) => {
        console.log("[sendTransport] connect event - sending DTLS params");
        socket.emit("connectTransport", { transportId: sendTransport.id, dtlsParameters }, (res) => {
          if (res?.error) return errback(new Error(res.error));
          cb();
        });
      });

      sendTransport.on("produce", ({ kind, rtpParameters, appData }, cb, errback) => {
        console.log(`[sendTransport] produce event kind=${kind}`);
        socket.emit("produce", { transportId: sendTransport.id, kind, rtpParameters, appData }, (res) => {
          if (res?.error) return errback(new Error(res.error));
          cb({ id: res.producerId });
        });
      });

      sendTransport.on("connectionstatechange", (state) => {
        console.log(`[sendTransport] connectionstatechange: ${state} id=${sendTransport.id}`);
        updateNetworkBadge(state);
        if (state === "failed" || state === "disconnected") {
          console.error(`[sendTransport] ⚠️ ${state} - outgoing (your own) video/audio may stall.`);
        }
      });

      console.log("[createSendTransport] id=", sendTransport.id);
      resolve(sendTransport);
    });
  });
}

async function ensureSendTransport() {
  if (sendTransport) return sendTransport;
  return createSendTransport();
}

async function ensureRecvTransport() {
  if (recvTransport) return recvTransport;

  if (recvTransportPromise) {
    console.log("[ensureRecvTransport] Waiting for in-flight creation...");
    return recvTransportPromise;
  }

  console.log("[ensureRecvTransport] Creating recv transport...");
  recvTransportPromise = new Promise((resolve, reject) => {
    socket.emit("createRecvTransport", { roomId }, (params) => {
      if (params?.error) {
        recvTransportPromise = null;
        return reject(new Error(params.error));
      }

      recvTransport = device.createRecvTransport({
        ...params,
        iceServers:         buildIceServers(),
        iceTransportPolicy: getIceTransportPolicy()
      });

      recvTransport.on("connect", ({ dtlsParameters }, cb, errback) => {
        console.log("[recvTransport] connect event - sending DTLS params");
        socket.emit("connectTransport", { transportId: recvTransport.id, dtlsParameters }, (res) => {
          if (res?.error) return errback(new Error(res.error));
          cb();
        });
      });

      recvTransport.on("connectionstatechange", (state) => {
        console.log(`[recvTransport] connectionstatechange: ${state} id=${recvTransport.id} activeConsumers=${consumers.size}`);
        if (state === "failed" || state === "disconnected") {
          console.error(`[recvTransport] ⚠️ ${state} - all incoming remote video/audio may stall (${consumers.size} consumer(s) affected).`);
        }
      });

      console.log("[ensureRecvTransport] id=", recvTransport.id);
      resolve(recvTransport);
    });
  });

  return recvTransportPromise;
}

async function publishStream() {
  console.log("[publishStream] Starting...");
  localStream = await getLocalStream();

  const localVideo = $("local-video");
  if (localVideo) {
    localVideo.srcObject = localStream;
    localVideo.muted = true;
    startFreezeWatchdog(localVideo, "local-video(self)");
  }

  const localName = $("local-name");
  if (localName) {
    localName.textContent = window.CURRENT_USER?.username ||
                            window.CURRENT_USER?.display_name || "You";
  }

  console.log("[publishStream] Host mode - mirroring to stage");
  const stageVideo = $("stage-video");
  if (stageVideo) {
    stageVideo.srcObject = localStream;
    stageVideo.muted = true;
    startFreezeWatchdog(stageVideo, "stage-video(host-self)");
  }
  const offlineEl = $("stage-offline");
  if (offlineEl) offlineEl.style.display = "none";

  const stageLabel = $("stage-host-label");
  if (stageLabel) stageLabel.textContent =
    window.CURRENT_USER?.username || window.CURRENT_USER?.display_name || "Host";

  await ensureSendTransport();

  const codecCapability = getPreferredVideoCodecCapability();
  const codec = codecLabel(codecCapability);
  console.log(`[publishStream] Using codec: ${codec}`);

  const videoTrack = localStream.getVideoTracks()[0];
  if (videoTrack) {
    const settings = videoTrack.getSettings();
    const width    = settings.width  || 1280;
    const height   = settings.height || 720;

    const produceOptions = {
      track: videoTrack,
      codecOptions: {
        videoGoogleStartBitrate: 800,
        videoGoogleMaxBitrate:   4000,
        videoGoogleMinBitrate:   200
      },
      appData: { type: "video", isHost }
    };

    // FIX-2: actually force the codec we claim to prefer, instead
    // of letting mediasoup-client silently pick the first one
    // (VP8) regardless of what codecLabel() said.
    if (codecCapability) produceOptions.codec = codecCapability;

    if (codec === "VP9") {
      produceOptions.encodings = [{ maxBitrate: 4_000_000, scalabilityMode: "L1T3" }];
    } else {
      produceOptions.encodings = buildSimulcastEncodings(width, height);
    }

    videoProducer = await sendTransport.produce(produceOptions);
    videoProducer.on("score", updateVideoScoreIndicator);
    videoProducer.on("transportclose", () => console.warn("[videoProducer] transportclose"));
    videoProducer.on("trackended", () => console.error("[videoProducer] ⛔ trackended - camera track stopped unexpectedly"));
    console.log("[publishStream] videoProducer id=", videoProducer.id, "codec=", codec);
  }

  const audioTrack = localStream.getAudioTracks()[0];
  if (audioTrack) {
    audioProducer = await sendTransport.produce({
      track: audioTrack,
      codecOptions: { opusDtx: true, opusFec: true, opusMaxPlaybackRate: 48000 },
      appData: { type: "audio", isHost }
    });
    audioProducer.on("transportclose", () => console.warn("[audioProducer] transportclose"));
    audioProducer.on("trackended", () => console.error("[audioProducer] ⛔ trackended - mic track stopped unexpectedly"));
    startAudioLevelMonitor(audioTrack);
    console.log("[publishStream] audioProducer id=", audioProducer.id);
  }

  console.log("[publishStream] Done publishing own stream");
}

async function claimMicSeat(seatIndex) {
  if (typeof seatIndex !== "number") return;
  if (mySeatIndex !== null) {
    window.showToast("Leave your current seat first");
    return;
  }
  if (myGuestSlot !== null) {
    window.showToast("Leave your guest seat first");
    return;
  }

  let audioStream = null;
  try {
    audioStream = await getAudioOnlyStream();
  } catch (e) {
    window.showToast("Microphone access denied");
    return;
  }

  try {
    localStream = audioStream;

    await ensureSendTransport();

    const audioTrack = audioStream.getAudioTracks()[0];
    instrumentTrack(audioTrack, "mic-seat-audio");
    audioProducer = await sendTransport.produce({
      track: audioTrack,
      codecOptions: { opusDtx: true, opusFec: true, opusMaxPlaybackRate: 48000 },
      appData: { type: "audio", isHost: false, seatIndex }
    });
    startAudioLevelMonitor(audioTrack);

    socket.emit("requestMicSeat", { roomId, seatIndex }, (res) => {
      if (res?.error) {
        console.warn("[claimMicSeat] Seat rejected:", res.error);
        window.showToast(res.error);
        try { audioProducer?.close(); } catch (e) {}
        audioProducer = null;
        localStream?.getTracks().forEach(t => t.stop());
        localStream = null;
        return;
      }
      mySeatIndex = seatIndex;
      isMicMuted  = false;
      console.log(`[claimMicSeat] Seated at ${seatIndex}, mic live`);
      window.showToast(`Seat ${seatIndex + 1} joined - mic on`);
      // HLS-1: no longer plain audience - switch #stage-video back
      // to a real WebRTC consumer of the host.
      enterInteractiveMode();
    });
  } catch (e) {
    console.error("[claimMicSeat]", e);
    window.showToast("Couldn't join that seat");
    audioStream?.getTracks().forEach(t => t.stop());
  }
}

function releaseMicSeat() {
  if (mySeatIndex === null) return;

  try { audioProducer?.close(); } catch (e) {}
  audioProducer = null;

  if (videoProducer) {
    try { videoProducer.close(); } catch (e) {}
    videoProducer = null;
    isCameraOff = false;
  }

  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }

  const localVideo = $("local-video");
  if (localVideo) { stopFreezeWatchdog(localVideo); localVideo.srcObject = null; }

  socket.emit("leaveMicSeat", { roomId });
  console.log(`[releaseMicSeat] Left seat ${mySeatIndex}`);
  mySeatIndex = null;
  isMicMuted  = false;
  window.showToast("Left seat");

  // HLS-1: back to plain audience once neither seat state is held.
  if (!isHost && mySeatIndex === null && myGuestSlot === null) enterAudienceMode();
}

function toggleMySeatMic() {
  if (mySeatIndex === null || !audioProducer) return;
  socket.emit("toggleSeatMic", { roomId, seatIndex: mySeatIndex }, (res) => {
    if (res?.error) {
      window.showToast(res.error);
      return;
    }
    isMicMuted = res.muted;
    try { isMicMuted ? audioProducer.pause() : audioProducer.resume(); } catch (e) {}
    if (isMicMuted) dispatchSpeaking(socket.id, false, false);
  });
}

async function claimGuestSeat(slot) {
  if (slot !== "male" && slot !== "female") return;
  if (myGuestSlot !== null) {
    window.showToast("Leave your current guest seat first");
    return;
  }
  if (mySeatIndex !== null) releaseMicSeat();

  let stream = null;
  try {
    stream = await getLocalStream(); // camera + mic, same pipeline the host uses
  } catch (e) {
    window.showToast("Camera/microphone access denied");
    return;
  }

  try {
    localStream = stream;

    const localVideo = $("local-video");
    if (localVideo) {
      localVideo.srcObject = localStream;
      localVideo.muted = true;
      startFreezeWatchdog(localVideo, "local-video(self-guest)");
    }

    await ensureSendTransport();

    const codecCapability = getPreferredVideoCodecCapability();
    const codec = codecLabel(codecCapability);
    const videoTrack = localStream.getVideoTracks()[0];

    if (videoTrack) {
      const settings = videoTrack.getSettings();
      const width  = settings.width  || 1280;
      const height = settings.height || 720;

      const produceOptions = {
        track: videoTrack,
        codecOptions: {
          videoGoogleStartBitrate: 800,
          videoGoogleMaxBitrate:   4000,
          videoGoogleMinBitrate:   200
        },
        appData: { type: "video", isHost: false, guestSlot: slot }
      };

      // FIX-2: force the actual negotiated codec to match what we claim.
      if (codecCapability) produceOptions.codec = codecCapability;

      if (codec === "VP9") {
        produceOptions.encodings = [{ maxBitrate: 4_000_000, scalabilityMode: "L1T3" }];
      } else {
        produceOptions.encodings = buildSimulcastEncodings(width, height);
      }

      videoProducer = await sendTransport.produce(produceOptions);
      videoProducer.on("score", updateVideoScoreIndicator);
      videoProducer.on("transportclose", () => console.warn("[guest videoProducer] transportclose"));
      videoProducer.on("trackended", () => console.error("[guest videoProducer] ⛔ trackended"));
      console.log("[claimGuestSeat] videoProducer id=", videoProducer.id, "codec=", codec);
    }

    const audioTrack = localStream.getAudioTracks()[0];
    audioProducer = await sendTransport.produce({
      track: audioTrack,
      codecOptions: { opusDtx: true, opusFec: true, opusMaxPlaybackRate: 48000 },
      appData: { type: "audio", isHost: false, guestSlot: slot }
    });
    startAudioLevelMonitor(audioTrack);

    socket.emit("requestGuestSeat", { roomId, slot }, (res) => {
      if (res?.error) {
        window.showToast(res.error);
        try { videoProducer?.close(); } catch (e) {}
        try { audioProducer?.close(); } catch (e) {}
        videoProducer = null;
        audioProducer = null;
        localStream?.getTracks().forEach(t => t.stop());
        localStream = null;
        if (localVideo) { stopFreezeWatchdog(localVideo); localVideo.srcObject = null; }
        return;
      }
      myGuestSlot = slot;
      isMicMuted  = false;
      isCameraOff = false;
      window.showToast(`Joined ${slot} guest seat - camera & mic on`);
      // HLS-1: no longer plain audience - switch #stage-video back
      // to a real WebRTC consumer of the host.
      enterInteractiveMode();
    });
  } catch (e) {
    console.error("[claimGuestSeat]", e);
    window.showToast("Couldn't join that guest seat");
    stream?.getTracks().forEach(t => t.stop());
  }
}

function releaseGuestSeatLocal() {
  if (myGuestSlot === null) return;

  try { audioProducer?.close(); } catch (e) {}
  audioProducer = null;

  if (videoProducer) {
    try { videoProducer.close(); } catch (e) {}
    videoProducer = null;
    isCameraOff = false;
  }

  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }

  const localVideo = $("local-video");
  if (localVideo) { stopFreezeWatchdog(localVideo); localVideo.srcObject = null; }

  socket.emit("leaveGuestSeat", { roomId });
  myGuestSlot = null;
  isMicMuted  = false;
  window.showToast("Left guest seat");

  // HLS-1: back to plain audience once neither seat state is held.
  if (!isHost && mySeatIndex === null && myGuestSlot === null) enterAudienceMode();
}

function toggleMyGuestMic() {
  if (myGuestSlot === null || !audioProducer) return;
  socket.emit("toggleGuestMic", { roomId, slot: myGuestSlot }, (res) => {
    if (res?.error) {
      window.showToast(res.error);
      return;
    }
    isMicMuted = res.muted;
    try { isMicMuted ? audioProducer.pause() : audioProducer.resume(); } catch (e) {}
    if (isMicMuted) dispatchSpeaking(socket.id, false, false);
  });
}

/**
 * FIX-1: guarded against duplicate consumption of the same
 * producerId. This is the actual root cause fix - previously,
 * any re-emission of "existingProducers" (e.g. on socket
 * reconnect / rejoin) or an overlapping "newProducer" would call
 * this a second time for a producer already being consumed,
 * silently creating a second consumer whose track attachment
 * would removeTrack()+stop() the FIRST (already working) track.
 *
 * HLS-1: also guarded against ever WebRTC-consuming the HOST's
 * producer while this viewer is plain audience - that video/audio
 * is being served via hls.js instead (see attachHlsToStage /
 * isAudienceHlsMode). Guest/co-host producers are never skipped
 * here, only the host's.
 */
async function consumeProducer({ producerId, socketId, userId, kind, isHost: producerIsHostHint }) {
  console.log(`[consumeProducer] producerId=${producerId} kind=${kind} socketId=${socketId} isHostHint=${producerIsHostHint}`);

  await deviceReady;

  if (socketId === socket.id) {
    console.log("[consumeProducer] Skipping self");
    return;
  }

  if (producerIsHostHint && isAudienceHlsMode()) {
    console.log(`[consumeProducer] ⏭️  Skipping host producerId=${producerId} kind=${kind} - this viewer is plain audience in HLS mode (see attachHlsToStage).`);
    return;
  }

  if (consumedProducers.has(producerId)) {
    console.warn(
      `[consumeProducer] ⏭️  Already consuming producerId=${producerId} ` +
      `(existing consumerId=${consumedProducers.get(producerId)}) - skipping duplicate ` +
      `consume to avoid stopping the already-attached track.`
    );
    return;
  }

  const transport = await ensureRecvTransport();

  socket.emit(
    "consume",
    {
      transportId:     transport.id,
      producerId,
      rtpCapabilities: device.rtpCapabilities
    },
    async (params) => {
      if (params?.error) {
        console.error("[consumeProducer] Server consume error:", params.error);
        return;
      }

      // Re-check after the round trip - a duplicate call could have
      // raced ahead and completed while this one was awaiting the
      // server response. Also re-check the HLS-mode guard, in case
      // the viewer switched back to audience mode while this consume
      // was in flight.
      if (consumedProducers.has(producerId)) {
        console.warn(`[consumeProducer] ⏭️  Duplicate resolved after round-trip for producerId=${producerId} - discarding.`);
        return;
      }
      if ((params.isHost ?? producerIsHostHint) && isAudienceHlsMode()) {
        console.warn(`[consumeProducer] ⏭️  Viewer returned to audience HLS mode mid-consume for producerId=${producerId} - discarding host consumer.`);
        return;
      }

      console.log(`[consumeProducer] Got params - consumerId=${params.id} kind=${params.kind} isHost=${params.isHost}`);

      try {
        const consumer = await transport.consume({
          id:            params.id,
          producerId:    params.producerId,
          kind:          params.kind,
          rtpParameters: params.rtpParameters
        });

        const producerIsHost = params.isHost ?? producerIsHostHint;

        consumers.set(consumer.id, { consumer, producerId, socketId, kind, isHost: producerIsHost });
        consumedProducers.set(producerId, consumer.id);

        instrumentTrack(consumer.track, `remote-${producerIsHost ? "host" : "guest"}-${kind}-${socketId}`);

        console.log(`[consumeProducer] Routing track: kind=${consumer.kind} isHost=${producerIsHost} socketId=${socketId} consumerId=${consumer.id}`);

        if (consumer.kind === "video") {
          if (producerIsHost) {
            attachTrackToStage(consumer.track);
          } else {
            attachTrackToParticipantTile(consumer.track, socketId, userId);
          }
        } else if (consumer.kind === "audio") {
          setupAudioBoost(consumer.track, consumer.id, socketId, producerIsHost);
        }

        socket.emit("resumeConsumer", { consumerId: consumer.id }, (res) => {
          if (res?.error) {
            console.error("[consumeProducer] resumeConsumer error:", res.error);
          } else {
            console.log(`[consumeProducer] Consumer resumed: ${consumer.id} track.readyState=${consumer.track.readyState} track.muted=${consumer.track.muted}`);
          }
        });

        consumer.on("transportclose", () => {
          console.log(`[consumer] transportclose: ${consumer.id}`);
          cleanupAudioBoost(consumer.id);
          consumers.delete(consumer.id);
          if (consumedProducers.get(producerId) === consumer.id) consumedProducers.delete(producerId);
        });

        consumer.on("producerclose", () => {
          console.log(`[consumer] producerclose: ${consumer.id}`);
          consumer.close();
          cleanupAudioBoost(consumer.id);
          consumers.delete(consumer.id);
          if (consumedProducers.get(producerId) === consumer.id) consumedProducers.delete(producerId);
          if (consumer.kind === "video" && !producerIsHost) {
            removeParticipantVideo(socketId);
          }
        });

      } catch (err) {
        console.error("[consumeProducer] transport.consume() failed:", err);
      }
    }
  );
}

function attachTrackToStage(track) {
  console.log("[attachTrackToStage] Attaching video track to #stage-video");
  const stageVideo = $("stage-video");
  if (!stageVideo) { console.error("[attachTrackToStage] #stage-video not found!"); return; }

  // HLS-1: a WebRTC host track is about to own #stage-video - make
  // sure any hls.js instance/native HLS src is fully torn down
  // first so the two never fight over the same <video> element.
  if (viewMode === "hls") detachHlsFromStage();
  viewMode = "webrtc";

  stageVideo.muted = true;

  if (!stageVideo.srcObject) stageVideo.srcObject = new MediaStream();
  const existingTracks = stageVideo.srcObject.getVideoTracks();
  if (existingTracks.length) {
    console.log(`[attachTrackToStage] Replacing ${existingTracks.length} existing track(s) on #stage-video`);
  }
  existingTracks.forEach(t => { stageVideo.srcObject.removeTrack(t); t.stop(); });
  stageVideo.srcObject.addTrack(track);

  const offlineEl = $("stage-offline");
  if (offlineEl) offlineEl.style.display = "none";

  stageVideo.play().catch(e => console.warn("[attachTrackToStage] play() rejected:", e.message));
  startFreezeWatchdog(stageVideo, "stage-video(remote-host)");
  console.log("[attachTrackToStage] Stage video attached");
}

function getOrCreateParticipantTile(socketId, userId) {
  let tile = document.querySelector(`.participant-tile[data-socket-id="${socketId}"]`);
  if (!tile) {
    tile = document.createElement("div");
    tile.className = "participant-tile";
    tile.dataset.socketId = socketId;

    const seatFrame = document.createElement("div");
    seatFrame.className = "seat-frame";

    const video = document.createElement("video");
    video.autoplay    = true;
    video.playsInline = true;
    video.muted        = true;

    seatFrame.appendChild(video);
    tile.appendChild(seatFrame);

    const nameEl = document.createElement("div");
    nameEl.className   = "ptile-name";
    nameEl.textContent = userId ? `User ${String(userId).slice(0, 6)}` : "Peer";

    const mutedBadge = document.createElement("div");
    mutedBadge.className   = "ptile-muted-badge";
    mutedBadge.textContent = "muted";
    mutedBadge.style.display = "none";

    tile.appendChild(mutedBadge);
    tile.appendChild(nameEl);

    const strip = $("participants-strip");
    if (strip) strip.appendChild(tile);

    peerStreams.set(socketId, new MediaStream());
    video.srcObject = peerStreams.get(socketId);

    console.log(`[getOrCreateParticipantTile] Created new tile for socketId=${socketId}`);
  }
  return tile;
}

function attachTrackToParticipantTile(track, socketId, userId) {
  console.log(`[attachTrackToParticipantTile] Attaching video track for socketId=${socketId}`);
  const tile  = getOrCreateParticipantTile(socketId, userId);
  const video = tile.querySelector("video");
  if (!video) return;

  let stream = peerStreams.get(socketId);
  if (!stream) { stream = new MediaStream(); peerStreams.set(socketId, stream); }
  const existingTracks = stream.getVideoTracks();
  if (existingTracks.length) {
    console.log(`[attachTrackToParticipantTile] Replacing ${existingTracks.length} existing track(s) for socketId=${socketId}`);
  }
  existingTracks.forEach(t => { stream.removeTrack(t); t.stop(); });
  stream.addTrack(track);
  video.srcObject = stream;
  video.muted = true;
  video.play().catch(e => console.warn("[attachTrackToParticipantTile] play() rejected:", e.message));
  startFreezeWatchdog(video, `guest-tile(${socketId})`);
}

function removeParticipantVideo(socketId) {
  const tile = document.querySelector(`.participant-tile[data-socket-id="${socketId}"]`);
  if (tile) {
    const video = tile.querySelector("video");
    if (video) stopFreezeWatchdog(video);
    tile.remove();
  }
  peerStreams.delete(socketId);
  cleanupAudioBoostsForSocket(socketId);
}

function buildSimulcastEncodings(width, height) {
  if (width >= 1280) {
    return [
      { rid: "r0", maxBitrate:   150_000 },
      { rid: "r1", maxBitrate: 1_000_000 },
      { rid: "r2", maxBitrate: 3_000_000 }
    ];
  }
  return [
    { rid: "r0", maxBitrate:   150_000 },
    { rid: "r1", maxBitrate: 1_000_000 }
  ];
}

function startAudioLevelMonitor(audioTrack) {
  try {
    const ctx      = new AudioContext();
    const src      = ctx.createMediaStreamSource(new MediaStream([audioTrack]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser);
    const data   = new Uint8Array(analyser.frequencyBinCount);
    const micBar = $("mic-level");

    let wasSpeaking = false;
    function tick() {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      const pct = Math.min(100, (avg / 128) * 100);
      if (micBar) micBar.style.height = pct + "%";

      const speaking = avg > SPEAKING_THRESHOLD && !isMicMuted;
      if (speaking !== wasSpeaking) {
        wasSpeaking = speaking;
        dispatchSpeaking(socket.id, isHost, speaking);
      }
      requestAnimationFrame(tick);
    }
    tick();
  } catch (e) {
    console.warn("[audioMonitor] Error:", e);
  }
}

function updateNetworkBadge(state) {
  const badge = $("network-badge");
  if (!badge) return;
  if (state === "connected") {
    badge.textContent = "HD"; badge.style.background = "rgba(0,200,100,.7)";
  } else if (state === "connecting") {
    badge.textContent = "..."; badge.style.background = "rgba(255,160,0,.7)";
  } else if (state === "failed" || state === "closed") {
    badge.textContent = "!"; badge.style.background = "rgba(255,61,127,.7)";
  }
}

function updateVideoScoreIndicator(scores) {
  if (!scores?.length) return;
  const best  = scores.reduce((a, b) => (b.score > a.score ? b : a));
  const badge = $("network-badge");
  if (!badge) return;
  if (best.score >= 9)      { badge.textContent = "HD"; badge.style.background = "rgba(0,200,100,.7)"; }
  else if (best.score >= 6) { badge.textContent = "SD"; badge.style.background = "rgba(255,160,0,.7)"; }
  else                      { badge.textContent = "!"; badge.style.background = "rgba(255,61,127,.7)"; }
}

function toggleMic() {
  if (!audioProducer) return;
  isMicMuted = !isMicMuted;
  isMicMuted ? audioProducer.pause() : audioProducer.resume();

  const hostBtn = $("mic-btn");
  if (hostBtn) hostBtn.textContent = isMicMuted ? "muted" : "mic";

  updateLocalMicButton(isMicMuted);
  if (isMicMuted) dispatchSpeaking(socket.id, isHost, false);

  socket.emit("peerMicToggled", { roomId, socketId: socket.id, muted: isMicMuted });
  window.showToast(isMicMuted ? "Mic muted" : "Mic on");
}

function updateLocalMicButton(muted) {
  const localMicBtn = $("local-mic-btn");
  if (!localMicBtn) return;
  localMicBtn.textContent = muted ? "muted" : "mic";
  localMicBtn.classList.toggle("muted", muted);
  localMicBtn.title = muted ? "Unmute mic" : "Mute mic";
}

async function toggleCamera() {
  if (!isHost || !videoProducer) return;

  isCameraOff = !isCameraOff;
  isCameraOff ? videoProducer.pause() : videoProducer.resume();

  const stageVideo = $("stage-video");
  if (stageVideo) stageVideo.style.opacity = isCameraOff ? "0.15" : "1";

  const localVideo = $("local-video");
  if (localVideo) localVideo.style.opacity = isCameraOff ? "0.15" : "1";

  const btn = $("camera-btn");
  if (btn) btn.textContent = isCameraOff ? "off" : "cam";
  window.showToast(isCameraOff ? "Camera off" : "Camera on");
}

async function switchCamera() {
  if (!localStream) return;
  const currentFacing = localStream.getVideoTracks()[0]?.getSettings()?.facingMode || "user";
  const newFacing     = currentFacing === "user" ? "environment" : "user";
  try {
    const newRawStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: newFacing, width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    const newRawVideoTrack = newRawStream.getVideoTracks()[0];
    instrumentTrack(newRawVideoTrack, "switched-camera-raw");
    const existingAudioTrack = localStream.getAudioTracks()[0];

    const combinedRaw = new MediaStream();
    combinedRaw.addTrack(newRawVideoTrack);
    if (existingAudioTrack) combinedRaw.addTrack(existingAudioTrack);

    const carriedParams = beautyEngine.getParams();
    beautyEngine.stop();
    const filteredStream = beautyEngine.start(combinedRaw, carriedParams);
    const filteredVideoTrack = filteredStream.getVideoTracks()[0];
    instrumentTrack(filteredVideoTrack, "switched-camera-filtered");

    if (videoProducer) await videoProducer.replaceTrack({ track: filteredVideoTrack });

    const oldVideoTrack = localStream.getVideoTracks()[0];
    if (oldVideoTrack) oldVideoTrack.stop();

    localStream = filteredStream;

    const localVideo = $("local-video");
    if (localVideo) localVideo.srcObject = localStream;

    if (isHost) {
      const stageVideo = $("stage-video");
      if (stageVideo) stageVideo.srcObject = localStream;
    }

    // beautyEngine.stop()/start() tore down the old hidden <video>
    // and rebuilt a new one - re-point the AR engine's overlay hook
    // at the fresh instance (attach() is cheap/idempotent past the
    // first real model load; it just re-registers the draw hook).
    if (faceEngineAttached) faceEngine.attach(beautyEngine).then(() => faceEngine.start());

    window.showToast("Camera switched");
  } catch (e) {
    window.showToast("Camera switch failed");
  }
}

/* ============================================================
   BEAUTY / SHARPNESS FILTER TOGGLE
   ============================================================ */
function toggleBeautyFilter() {
  beautyOn = !beautyOn;
  beautyEngine.setParams({
    smoothing:  beautyOn ? 0.62 : 0,
    brightness: beautyOn ? 0.06 : 0,
    contrast:   beautyOn ? 1.06 : 1,
    saturation: beautyOn ? 1.08 : 1,
    sharpness:  beautyOn ? 0.45 : 0
  });
  window.showToast(beautyOn ? "Beauty filter on" : "Beauty filter off");

  const btn = $("beauty-btn");
  if (btn) btn.classList.toggle("off", !beautyOn);
}

/* ============================================================
   EFFECTS SHEET - color filters, beauty presets, AR (stickers +
   distortion). All three panes drive the SAME beautyEngine /
   faceEngine instances that are already running the live preview,
   so every change here is visible immediately, live, before
   anything is sent - and is baked into the actual outgoing video
   track (not just a local CSS preview), same as the beauty filter.
   ============================================================ */
let currentColorFilter    = "none";
let currentFilterIntensity = 1.0;
let currentBeautyPreset   = "medium";

const COLOR_FILTER_OPTIONS = [
  { id: "none",      label: "Original",  emoji: "\u2b1c" },
  { id: "vintage",   label: "Vintage",   emoji: "\ud83c\udf9e\ufe0f" },
  { id: "bw",        label: "B&W",       emoji: "\u26ab" },
  { id: "warm",      label: "Warm",      emoji: "\ud83c\udf07" },
  { id: "cool",      label: "Cool",      emoji: "\u2744\ufe0f" },
  { id: "vivid",     label: "Vivid",     emoji: "\ud83c\udf08" },
  { id: "cinematic", label: "Cinematic", emoji: "\ud83c\udfac" }
];

const BEAUTY_PRESET_OPTIONS = [
  { id: "light",  label: "Light",     emoji: "\ud83d\ude42" },
  { id: "medium", label: "Medium",    emoji: "\u2728" },
  { id: "glam",   label: "Full Glam", emoji: "\ud83d\udc84" }
];

const STICKER_OPTIONS = [
  { id: null,          label: "None",         emoji: "\ud83d\udeab" },
  { id: "glasses",     label: "Glasses",      emoji: "\ud83d\udd76\ufe0f" },
  { id: "dogEars",     label: "Dog Ears",     emoji: "\ud83d\udc36" },
  { id: "mustache",    label: "Mustache",     emoji: "\ud83d\udc68" },
  { id: "flowerCrown", label: "Flower Crown", emoji: "\ud83c\udf38" }
];

function setColorFilterUI(filterId) {
  currentColorFilter = filterId;
  beautyEngine.setColorFilter(filterId, currentFilterIntensity);
  document.querySelectorAll("#filter-grid .effect-tile").forEach(t =>
    t.classList.toggle("selected", t.dataset.filterId === filterId));
}

function setFilterIntensityUI(value) {
  currentFilterIntensity = value;
  beautyEngine.setParams({ filterIntensity: value });
  const slider = $("filter-intensity-slider");
  if (slider) slider.value = String(Math.round(value * 100));
}

function applyBeautyPresetUI(presetId) {
  currentBeautyPreset = presetId;
  beautyOn = true;
  beautyEngine.applyBeautyPreset(presetId);
  document.querySelectorAll("#beauty-preset-grid .effect-tile").forEach(t =>
    t.classList.toggle("selected", t.dataset.presetId === presetId));
  const btn = $("beauty-btn");
  if (btn) btn.classList.remove("off");
}

function setStickerUI(stickerId) {
  faceEngine.setSticker(stickerId);
  document.querySelectorAll("#sticker-grid .effect-tile").forEach(t =>
    t.classList.toggle("selected", (t.dataset.stickerId || null) === stickerId));
}

function setDistortionUI(key, value) {
  faceEngine.setDistortion({ [key]: value });
  const slider = $(`distortion-${key}-slider`);
  if (slider) slider.value = String(Math.round(value * 100));
}

function renderEffectsSheet() {
  const filterGrid = $("filter-grid");
  if (filterGrid) {
    filterGrid.innerHTML = COLOR_FILTER_OPTIONS.map(f => `
      <button class="effect-tile${f.id === currentColorFilter ? " selected" : ""}" data-filter-id="${f.id}">
        <span class="effect-emoji">${f.emoji}</span>
        <span class="effect-label">${f.label}</span>
      </button>`).join("");
    filterGrid.querySelectorAll(".effect-tile").forEach(tile => {
      tile.addEventListener("click", () => setColorFilterUI(tile.dataset.filterId));
    });
  }

  const presetGrid = $("beauty-preset-grid");
  if (presetGrid) {
    presetGrid.innerHTML = BEAUTY_PRESET_OPTIONS.map(p => `
      <button class="effect-tile${p.id === currentBeautyPreset ? " selected" : ""}" data-preset-id="${p.id}">
        <span class="effect-emoji">${p.emoji}</span>
        <span class="effect-label">${p.label}</span>
      </button>`).join("");
    presetGrid.querySelectorAll(".effect-tile").forEach(tile => {
      tile.addEventListener("click", () => applyBeautyPresetUI(tile.dataset.presetId));
    });
  }

  const stickerGrid = $("sticker-grid");
  if (stickerGrid) {
    stickerGrid.innerHTML = STICKER_OPTIONS.map(s => `
      <button class="effect-tile" data-sticker-id="${s.id ?? ""}">
        <span class="effect-emoji">${s.emoji}</span>
        <span class="effect-label">${s.label}</span>
      </button>`).join("");
    stickerGrid.querySelectorAll(".effect-tile").forEach(tile => {
      tile.addEventListener("click", () => setStickerUI(tile.dataset.stickerId || null));
    });
    setStickerUI(null);
  }

  ["bigEyes", "slimFace", "smallNose"].forEach(key => {
    const slider = $(`distortion-${key}-slider`);
    slider?.addEventListener("input", (e) => setDistortionUI(key, Number(e.target.value) / 100));
  });

  $("filter-intensity-slider")?.addEventListener("input", (e) => setFilterIntensityUI(Number(e.target.value) / 100));
}

function openEffectsSheet() {
  if (!localStream) {
    window.showToast("Start your camera first");
    return;
  }
  $("effects-backdrop")?.classList.add("open");
  $("effects-sheet")?.classList.add("open");
  if (!faceEngineAttached) {
    ensureFaceEngineAttached().then(() => {
      if (!faceEngine.isReady()) window.showToast("AR effects unavailable on this device");
    });
  }
}

function closeEffectsSheet() {
  $("effects-backdrop")?.classList.remove("open");
  $("effects-sheet")?.classList.remove("open");
}

function switchEffectsTab(tabName) {
  document.querySelectorAll(".effects-tab-btn").forEach(b =>
    b.classList.toggle("active", b.dataset.tab === tabName));
  document.querySelectorAll(".effects-tab-panel").forEach(p =>
    p.classList.toggle("active", p.dataset.tabPanel === tabName));
}

/* ============================================================
   ROOM DATA
   ============================================================ */
async function loadRoom() {
  if (!roomId) return;
  try {
    console.log(`[loadRoom] Fetching /live/${roomId}`);
    const response = await window.api.request(`/live/${roomId}`);
    const room     = response.data;

    if (!room) {
      window.showToast("Room not found");
      setTimeout(() => { window.location.href = "discover.html"; }, 1500);
      return;
    }

    currentRoom = room;
    viewerCount = room.viewer_count || 0;

    // HLS-1: keep our own audienceHlsUrl in sync with whatever the
    // room payload carries (liveRoomController.getById() -> egress
    // status). initAudienceHlsMode()/pollForHlsUrl() read this.
    audienceHlsUrl = room.hlsUrl || null;

    $("host-name").textContent = room.username || room.display_name || "Host";
    $("viewer-count").textContent = window.formatCoins(viewerCount);

    const titleEl = $("stream-title");
    if (titleEl && !titleEl.textContent.trim()) {
      titleEl.textContent = room.title || "Live Stream";
    }
    const descEl = $("stream-desc");
    if (descEl && !descEl.textContent.trim() && room.description) {
      descEl.textContent = room.description;
    }

    const hostAvatar = $("host-avatar");
    if (hostAvatar) {
      hostAvatar.src = room.avatar_url ||
        `https://ui-avatars.com/api/?name=${encodeURIComponent(room.username || "Host")}&background=random&color=fff&size=80`;
      hostAvatar.addEventListener("click", openGiftSheet);
    }

    const stageLbl = $("stage-host-label");
    if (stageLbl) stageLbl.textContent = room.username || room.display_name || "Host";

    if (room.started_at) {
      secondsLive = Math.floor((Date.now() - new Date(room.started_at).getTime()) / 1000);
    }

    console.log(`[loadRoom] room=${roomId} host_id=${room.host_id} hlsUrl=${room.hlsUrl || "(none yet)"}`);
  } catch (err) {
    console.error("[loadRoom]", err);
    window.showToast("Failed to load room");
  }
}

async function joinRoom() {
  if (!roomId) return;
  try {
    await window.api.request(`/live/${roomId}/join`, { method: "POST" });
    socket.emit("joinRoom", { roomId, userId: window.CURRENT_USER.id });
    console.log(`[joinRoom] Emitted joinRoom room=${roomId}`);
  } catch (err) {
    console.error("[joinRoom]", err);
  }
}

async function leaveRoom() {
  if (videoProducer) { try { videoProducer.close(); } catch (e) {} }
  if (audioProducer) { try { audioProducer.close(); } catch (e) {} }
  if (sendTransport) { try { sendTransport.close(); } catch (e) {} }
  if (recvTransport) { try { recvTransport.close(); } catch (e) {} }
  if (localStream)   localStream.getTracks().forEach(t => t.stop());
  cleanupAllAudioBoosts();

  for (const videoEl of [...watchdogs.keys()]) stopFreezeWatchdog(videoEl);
  consumedProducers.clear();

  // HLS-1: tear down hls.js / stop the audience polling loop too.
  stopHlsPolling();
  detachHlsFromStage();

  try { faceEngine.destroy(); } catch (e) {}
  faceEngineAttached = false;
  try { beautyEngine.stop(); } catch (e) {}

  try {
    await window.api.request(`/live/${roomId}/leave`, { method: "POST" });
    socket.emit("leaveGuestSeat", { roomId });
    socket.emit("leaveMicSeat", { roomId });
    socket.emit("leaveRoom", { roomId });
  } catch (e) {}
}

function destroyGiftEngineForRealExit() {
  try { window.__giftEngine?.destroy(); } catch (e) {}
}

function isParticipantsModalOpen() {
  return $("viewers-modal")?.classList.contains("open");
}

function seatBadgeForSocket(socketId) {
  const micSeats = window.__lastMicSeats || [];
  const idx = micSeats.findIndex(s => s && s.socketId === socketId);
  if (idx !== -1) return `Seat ${idx + 1}`;

  const guestSeats = window.__lastGuestSeats || { male: null, female: null };
  if (guestSeats.male?.socketId === socketId) return "Guest (Male)";
  if (guestSeats.female?.socketId === socketId) return "Guest (Female)";

  return "Audience";
}

function renderParticipantsList(list) {
  const wrap = $("viewers-list");
  if (!wrap) return;

  if (!list || !list.length) {
    wrap.innerHTML = `<div class="viewers-empty">No one else is here yet.</div>`;
    return;
  }

  wrap.innerHTML = list.map(p => {
    const isMe   = p.socketId === socket.id;
    const avatar = p.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(p.username || "User")}&background=9D5CFF&color=fff&size=64`;
    const badge  = p.isHost ? "Host" : seatBadgeForSocket(p.socketId);

    return `
      <div class="viewer-row" data-socket-id="${p.socketId}">
        <img src="${avatar}" alt="">
        <div class="viewer-info">
          <div class="viewer-name">${window.escapeHtml(p.username || "User")}${isMe ? " (You)" : ""}</div>
          <div class="viewer-badge">${badge}</div>
        </div>
        ${(!p.isHost && !isMe) ? `<button class="viewer-kick-btn" data-kick="${p.socketId}">Kick</button>` : ""}
      </div>
    `;
  }).join("");

  wrap.querySelectorAll(".viewer-kick-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const targetSocketId = btn.dataset.kick;
      if (!confirm("Remove this person from the live entirely?")) return;
      hostKickUserFromRoom(targetSocketId);
    });
  });
}

function openParticipantsModal() {
  if (!isHost) return;
  $("viewers-backdrop")?.classList.add("open");
  $("viewers-modal")?.classList.add("open");

  socket.emit("getParticipants", { roomId }, (res) => {
    if (res?.error) {
      window.showToast(res.error);
      return;
    }
    window.__lastParticipants = res.participants;
    renderParticipantsList(res.participants);
    const countEl = $("viewers-total-count");
    if (countEl) countEl.textContent = res.participants.length;
  });
}

function closeParticipantsModal() {
  $("viewers-backdrop")?.classList.remove("open");
  $("viewers-modal")?.classList.remove("open");
}

function hostKickUserFromRoom(targetSocketId) {
  socket.emit("hostKickUser", { roomId, targetSocketId }, (res) => {
    if (res?.error) {
      window.showToast(res.error);
      return;
    }
    window.showToast("User removed from the live");
  });
}

function initSocket() {

  socket.on("routerRtpCapabilities", async ({ rtpCapabilities }) => {
    console.log("[socket] routerRtpCapabilities received");

    try {
      await loadDevice(rtpCapabilities);
      _deviceReadyResolve();
      console.log("[socket] deviceReady resolved (device loaded)");
    } catch (err) {
      console.error("[socket] loadDevice failed - cannot consume OR publish:", err);
      window.showToast("Failed to connect: " + err.message);
      return;
    }

    if (isHost) {
      try {
        await publishStream();
      } catch (err) {
        console.warn("[socket] publishStream failed - continuing in watch-only mode:", err.message);
        window.showToast("Watching only (camera unavailable)");
      }
    }
  });

  socket.on("existingProducers", async (producers) => {
    console.log(`[socket] existingProducers: ${producers.length} producer(s)`, producers);
    for (const info of producers) {
      await consumeProducer(info);
    }
  });

  socket.on("newProducer", async (info) => {
    console.log("[socket] newProducer:", info);
    if (info.socketId === socket.id) return;
    await consumeProducer(info);
  });

  socket.on("peerLeft", ({ socketId }) => {
    console.log("[socket] peerLeft:", socketId);
    if (socketId === socket.id) return;
    removeParticipantVideo(socketId);

    // Clean up any dedup entries left over for this peer's producers.
    for (const [producerId, consumerId] of [...consumedProducers.entries()]) {
      const entry = consumers.get(consumerId);
      if (entry?.socketId === socketId) consumedProducers.delete(producerId);
    }

    // HLS-1: this fallback (showing the "waiting for host" overlay
    // when no host consumer is left) only makes sense while this
    // viewer is actually consuming the host over WebRTC. Plain
    // audience in HLS mode has no host consumer to check by design
    // - the HLS stream itself ending is what signals host-offline
    // for them (handled separately via the "hostLeft" event below).
    if (viewMode === "webrtc") {
      const hostConsumerExists = [...consumers.values()].some(c => c.isHost && !c.consumer.closed);
      if (!hostConsumerExists && !isHost) {
        const stageVideo = $("stage-video");
        if (stageVideo) { stopFreezeWatchdog(stageVideo); stageVideo.srcObject = null; }
        const offlineEl = $("stage-offline");
        if (offlineEl) offlineEl.style.display = "flex";
      }
    }
  });

  socket.on("peerMicToggled", ({ socketId, muted }) => {
    if (socketId === socket.id) return;
    const tile = document.querySelector(`.participant-tile[data-socket-id="${socketId}"]`);
    if (!tile) return;
    const badge = tile.querySelector(".ptile-muted-badge");
    if (badge) badge.style.display = muted ? "flex" : "none";
    if (muted) dispatchSpeaking(socketId, false, false);
  });

  socket.on("viewerCountUpdated", ({ viewerCount: vc }) => {
    viewerCount = vc;
    const el = $("viewer-count");
    if (el) el.textContent = window.formatCoins(vc);
  });

  socket.on("newComment", (payload) => {
    if (payload.system) {
      appendComment({ type: "system", text: payload.text });
      return;
    }
    appendComment({ avatar: payload.avatar, name: payload.name, text: payload.text });
  });

  socket.on("newReaction", ({ emoji }) => { spawnFloatParticle(emoji); });

  socket.on("giftReceived", (payload) => {
    appendComment({ avatar: payload.avatar, name: payload.name,
                    text: `sent ${payload.giftEmoji} ${payload.giftName}`, type: "gift" });
    launchGiftBanner(payload);
    window.__giftEngine?.playGift(payload);
    window.dispatchEvent(new CustomEvent("giftLanded", { detail: payload }));
  });

  socket.on("topGiftersUpdated", (gifters) => { renderTopGifters(gifters); });

  socket.on("guestSeatsUpdated", (seats) => {
    window.__lastGuestSeats = seats;
    window.dispatchEvent(new CustomEvent("guestSeatsChanged", { detail: seats }));
    if (isParticipantsModalOpen() && window.__lastParticipants) {
      renderParticipantsList(window.__lastParticipants);
    }
  });

  socket.on("micSeatsUpdated", (seats) => {
    window.__lastMicSeats = seats;
    window.dispatchEvent(new CustomEvent("micSeatsChanged", { detail: seats }));
    if (isParticipantsModalOpen() && window.__lastParticipants) {
      renderParticipantsList(window.__lastParticipants);
    }
  });

  socket.on("participantsUpdated", (list) => {
    window.__lastParticipants = list;
    if (isParticipantsModalOpen()) renderParticipantsList(list);
    const countEl = $("viewers-total-count");
    if (countEl) countEl.textContent = list.length;
  });

  socket.on("liveEnded", () => {
    try { window.__giftEngine?.stopAll(); } catch (e) {}
    window.showToast("This live has ended");
    setTimeout(() => { window.location.href = "discover.html"; }, 2000);
  });

  socket.on("hostLeft", () => {
    window.showToast("Host disconnected");
    // HLS-1: relevant regardless of viewMode - if the viewer was in
    // HLS mode, the stream itself will also error out shortly after
    // (egress stops with the host), this just surfaces it sooner.
    const offlineEl = $("stage-offline");
    if (offlineEl && !isHost) offlineEl.style.display = "flex";
  });

  socket.on("reconnect", () => {
    window.showToast("Reconnected");
    // NOTE: this re-emits joinRoom, which will cause the server to
    // resend "existingProducers" - consumeProducer()'s FIX-1 guard
    // is what prevents this from duplicating/killing already-working
    // consumers, and its HLS-1 guard is what prevents it from
    // needlessly WebRTC-consuming the host for a viewer who's still
    // plain audience.
    socket.emit("joinRoom", { roomId, userId: window.CURRENT_USER.id });
  });

  socket.on("removedFromSeat", ({ seatIndex, slot } = {}) => {
    if (typeof seatIndex === "number" && mySeatIndex !== null) {
      releaseMicSeat();
    }
    if (slot && myGuestSlot !== null) {
      releaseGuestSeatLocal();
    }
    window.showToast("You were removed by the host");
  });

  socket.on("hostMutedYou", ({ muted }) => {
    if (!audioProducer) return;
    isMicMuted = muted;
    try { isMicMuted ? audioProducer.pause() : audioProducer.resume(); } catch (e) {}
    dispatchSpeaking(socket.id, isHost, false);
    window.showToast(isMicMuted ? "Host muted your mic" : "Host unmuted your mic");
  });

  socket.on("youWereKicked", async () => {
    window.showToast("You were removed from this live by the host");
    await leaveRoom();
    destroyGiftEngineForRealExit();
    setTimeout(() => { window.location.href = "discover.html"; }, 1200);
  });
}

function appendComment({ avatar, name, text, type = "comment" }) {
  const wrap = $("comments-scroll");
  if (!wrap) return;
  const row = document.createElement("div");
  row.className = `comment-row${type === "gift" ? " gift-row" : type === "system" ? " system" : ""}`;
  row.innerHTML = avatar
    ? `<img src="${avatar}" alt=""><div class="bubble"><span class="uname">${window.escapeHtml(name)}</span>${window.escapeHtml(text)}</div>`
    : `<div class="bubble">${text}</div>`;
  wrap.appendChild(row);
  while (wrap.children.length > 60) wrap.removeChild(wrap.firstChild);
  wrap.scrollTop = wrap.scrollHeight;
}

function sendComment() {
  const input = $("comment-input");
  const text  = input?.value.trim();
  if (!text || text.length > 200) return;
  socket.emit("streamComment", {
    roomId,
    userId: window.CURRENT_USER.id,
    avatar: window.CURRENT_USER.avatar_url || window.CURRENT_USER.avatarUrl,
    name:   window.CURRENT_USER.username   || window.CURRENT_USER.display_name,
    text
  });
  input.value = "";
}

function sendReaction(emoji) {
  socket.emit("streamReaction", { roomId, emoji, userId: window.CURRENT_USER.id });
}

function spawnFloatParticle(emoji) {
  const layer = $("fx-layer");
  if (!layer) return;
  const el = document.createElement("span");
  el.className = "fx-particle";
  el.textContent = emoji;
  el.style.setProperty("--drift", `${(Math.random() * 60 - 30).toFixed(0)}px`);
  el.style.setProperty("--rot",   `${(Math.random() * 30 - 15).toFixed(0)}deg`);
  el.style.right = `${Math.random() * 50 + 10}px`;
  layer.appendChild(el);
  setTimeout(() => el.remove(), 2700);
}

async function loadGiftCatalog() {
  try {
    const response = await window.api.request("/gifts");
    GIFT_CATALOG   = (response.data || []).map(g => ({
      id: g.id,
      name: g.name,
      emoji: g.emoji,
      icon: g.icon_url || null,
      price: g.price_coins
    }));
    renderGiftGrid();
  } catch (err) {
    console.error("[loadGiftCatalog]", err);
  }
}

function renderGiftGrid() {
  const grid = $("gift-grid");
  if (!grid) return;

  grid.innerHTML = GIFT_CATALOG.map(gift => `
    <button class="gift-tile" id="gift-${gift.id}" data-gift-id="${gift.id}">
      ${gift.icon
        ? `<img class="gift-icon-img" src="${gift.icon}" alt="${window.escapeHtml(gift.name)}" data-fallback-emoji="${window.escapeHtml(gift.emoji || "gift")}">`
        : `<span class="emoji">${gift.emoji || "gift"}</span>`}
      <span class="name">${window.escapeHtml(gift.name)}</span>
      <span class="price">${gift.price}</span>
    </button>
  `).join("");

  grid.querySelectorAll(".gift-icon-img").forEach(img => {
    img.addEventListener("error", () => {
      const span = document.createElement("span");
      span.className = "emoji";
      span.textContent = img.dataset.fallbackEmoji || "gift";
      img.replaceWith(span);
    }, { once: true });
  });

  grid.querySelectorAll(".gift-tile").forEach(tile => {
    tile.addEventListener("click", () => selectGift(tile.dataset.giftId));
  });
}

function selectGift(giftId) {
  selectedGift = GIFT_CATALOG.find(g => String(g.id) === String(giftId));
  if (!selectedGift) return;
  document.querySelectorAll(".gift-tile").forEach(t => t.classList.remove("selected"));
  $(`gift-${giftId}`)?.classList.add("selected");
  const btn = $("send-gift-btn");
  if (btn) {
    btn.disabled    = false;
    btn.textContent = `Send ${selectedGift.emoji || "gift"} ${selectedGift.name} (${selectedGift.price} coins)`;
  }
}

async function sendSelectedGift() {
  if (!selectedGift || !currentRoom) return;
  try {
    await window.api.request("/gifts/send", {
      method: "POST",
      body:   JSON.stringify({
        receiverId:  currentRoom.host_id,
        giftId:      selectedGift.id,
        quantity:    1,
        contextType: "live_room",
        contextId:   roomId
      })
    });

    coinBalance -= selectedGift.price;
    window.CURRENT_USER.coinBalance = coinBalance;
    localStorage.setItem("currentUser", JSON.stringify(window.CURRENT_USER));
    const balEl = $("sheet-coin-balance");
    if (balEl) balEl.textContent = window.formatCoins(coinBalance);
    closeGiftSheet();
    window.showToast(`${selectedGift.emoji || "gift"} Gift sent!`);
  } catch (err) {
    window.showToast(err.message || "Gift failed");
  }
}

function openGiftSheet() {
  const balEl = $("sheet-coin-balance");
  if (balEl) balEl.textContent = window.formatCoins(coinBalance);
  $("sheet-backdrop")?.classList.add("open");
  $("gift-sheet")?.classList.add("open");
}

function closeGiftSheet() {
  $("sheet-backdrop")?.classList.remove("open");
  $("gift-sheet")?.classList.remove("open");
}

function launchGiftBanner(payload) {
  const layer = $("gift-streak-layer");
  if (!layer) return;
  const banner = document.createElement("div");
  banner.className = "gift-banner";

  const avatarHtml = payload.giftIcon
    ? `<img class="gift-banner-icon" src="${payload.giftIcon}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'gift-banner-avatar',textContent:'${(payload.giftEmoji || "gift").replace(/'/g, "\\'")}'}))">`
    : `<span class="gift-banner-avatar">${payload.giftEmoji || "gift"}</span>`;

  banner.innerHTML = `
    ${avatarHtml}
    <div class="gift-banner-text">
      <strong>${window.escapeHtml(payload.name)}</strong>
      sent <em>${window.escapeHtml(payload.giftName)}</em>
    </div>`;
  layer.appendChild(banner);
  setTimeout(() => banner.remove(), 3000);
}

async function loadTopGifters() {
  if (!roomId) return;
  try {
    const response = await window.api.request(`/live/${roomId}/top-gifters`);
    const gifters  = response.data?.data || response.data || [];
    renderTopGifters(gifters);
  } catch (err) {}
}

function renderTopGifters(gifters) {
  const el = $("top-gifters");
  if (!el) return;
  el.innerHTML = gifters.map(u => `
    <img src="${u.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.username)}&size=40`}"
         alt="${window.escapeHtml(u.username)}" title="${window.escapeHtml(u.username)}">
  `).join("") + `<span class="label">Top Gifters</span>`;
}

async function toggleFollow() {
  if (!currentRoom) return;
  try {
    await window.api.request(`/users/${currentRoom.host_id}/follow`,
                             { method: following ? "DELETE" : "POST" });
    following = !following;
    const btn = $("follow-btn");
    if (btn) {
      btn.textContent = following ? "Following" : "Follow";
      btn.classList.toggle("active", following);
    }
  } catch (err) {
    window.showToast("Follow action failed");
  }
}

async function endLive() {
  if (!confirm("End this live stream?")) return;
  try {
    await window.api.request(`/live/${roomId}/end`, { method: "POST" });
    socket.emit("liveEnded", { roomId });
    await leaveRoom();
    destroyGiftEngineForRealExit();
    window.location.href = "discover.html";
  } catch (err) {
    window.showToast("Failed to end live");
  }
}

function tickClock() {
  secondsLive++;
  const m  = Math.floor(secondsLive / 60).toString().padStart(2, "0");
  const s  = (secondsLive % 60).toString().padStart(2, "0");
  const el = $("live-duration");
  if (el) el.textContent = `${m}:${s}`;
}

function initGiftEngineVisibilityHandling() {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      window.__giftEngine?.pauseQueue?.();
    } else {
      window.__giftEngine?.resumeQueue?.();
    }
  });
}

function attachUIListeners() {
  $("follow-btn")?.addEventListener("click", toggleFollow);
  $("end-live-btn")?.addEventListener("click", endLive);

  $("close-btn")?.addEventListener("click", async () => {
    await leaveRoom();
    destroyGiftEngineForRealExit();
    window.location.href = "discover.html";
  });

  $("mic-btn")?.addEventListener("click", toggleMic);
  $("camera-btn")?.addEventListener("click", toggleCamera);
  $("switch-camera-btn")?.addEventListener("click", switchCamera);
  $("beauty-btn")?.addEventListener("click", toggleBeautyFilter);

  $("local-mic-btn")?.addEventListener("click", toggleMic);
  $("local-camera-btn")?.addEventListener("click", toggleCamera);

  $("comment-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendComment();
  });
  $("comment-send-btn")?.addEventListener("click", sendComment);

  $("heart-btn")?.addEventListener("click", () => sendReaction("heart"));
  $("fire-btn")?.addEventListener("click",  () => sendReaction("fire"));

  $("gift-btn")?.addEventListener("click", openGiftSheet);
  $("sheet-backdrop")?.addEventListener("click", closeGiftSheet);
  $("send-gift-btn")?.addEventListener("click", sendSelectedGift);
  $("topup-btn")?.addEventListener("click", () => { window.location.href = "coins.html"; });

  $("viewers-btn")?.addEventListener("click", openParticipantsModal);
  $("viewers-close-btn")?.addEventListener("click", closeParticipantsModal);
  $("viewers-backdrop")?.addEventListener("click", closeParticipantsModal);

  // Effects sheet (color filters / beauty presets / AR)
  $("effects-btn")?.addEventListener("click", openEffectsSheet);
  $("effects-close-btn")?.addEventListener("click", closeEffectsSheet);
  $("effects-backdrop")?.addEventListener("click", closeEffectsSheet);
  document.querySelectorAll(".effects-tab-btn").forEach(btn => {
    btn.addEventListener("click", () => switchEffectsTab(btn.dataset.tab));
  });
  renderEffectsSheet();
}

document.addEventListener("DOMContentLoaded", async () => {
  console.log("[init] Room:", roomId, "User:", window.CURRENT_USER?.id);

  if (!roomId) { window.showToast("Room ID missing"); return; }

  coinBalance = window.CURRENT_USER.coinBalance || window.CURRENT_USER.coin_balance || 0;

  attachUIListeners();
  initAudioUnlock();
  initHlsAudioUnlock();
  initGiftEngineVisibilityHandling();

  if (window.CURRENT_USER.id) {
    socket.emit("registerUser", window.CURRENT_USER.id);
  }

  try {
    const turnRes = await window.api.request("/live/turn-credentials");
    if (turnRes?.data) {
      window.__turnConfig = turnRes.data;
      console.log("[init] ICE config loaded, servers:", window.__turnConfig.length,
        "real TURN present:", hasRealTurnServer());
    }
  } catch (e) {
    console.warn("[init] Could not load TURN config - falling back to STUN-only, non-relay ICE:", e.message);
  }

  await loadRoom();

  isHost = currentRoom?.host_id === window.CURRENT_USER.id;
  console.log("[init] isHost:", isHost, "host_id:", currentRoom?.host_id, "myId:", window.CURRENT_USER.id);

  if (isHost) {
    document.body.classList.add("host-mode");
    const endBtn    = $("end-live-btn");
    const hostCtrls = $("host-controls");
    if (endBtn)    endBtn.style.display    = "flex";
    if (hostCtrls) hostCtrls.style.display = "flex";
  } else {
    // HLS-1: plain audience (not seated/guest yet) starts on HLS,
    // not a WebRTC consumer of the host. Host/co-host/guest video
    // for OTHER stage occupants is completely unaffected - this
    // only concerns #stage-video / the host's own producer.
    initAudienceHlsMode();
  }

  initSocket();
  await joinRoom();

  await loadGiftCatalog();
  await loadTopGifters();

  appendComment({
    type: "system",
    text: isHost
      ? "Welcome to the live room! Be kind and have fun."
      : "Welcome! Tap any empty seat below to join the conversation."
  });

  setInterval(tickClock, 1000);
});

window.addEventListener("beforeunload", leaveRoom);
window.addEventListener("pagehide",     leaveRoom);

window.toggleMic        = toggleMic;
window.toggleCamera     = toggleCamera;
window.switchCamera     = switchCamera;
window.sendComment      = sendComment;
window.sendReaction     = sendReaction;
window.openGiftSheet    = openGiftSheet;
window.closeGiftSheet   = closeGiftSheet;
window.toggleFollow     = toggleFollow;
window.endLive          = endLive;
window.sendSelectedGift = sendSelectedGift;
window.selectGift       = selectGift;
window.leaveRoom        = leaveRoom;
window.toggleBeautyFilter = toggleBeautyFilter;

window.setGiftSoundMuted = (muted = true) => {
  window.__giftEngine?.setMuted(muted);
};

window.hostKickSeat = (seatIndex) => {
  socket.emit("hostKickSeat", { roomId, seatIndex }, (res) => {
    if (res?.error) window.showToast(res.error);
  });
};
window.hostMuteSeat = (seatIndex) => {
  socket.emit("hostMuteSeat", { roomId, seatIndex }, (res) => {
    if (res?.error) window.showToast(res.error);
  });
};
window.hostKickGuest = (slot) => {
  socket.emit("hostKickGuest", { roomId, slot }, (res) => {
    if (res?.error) window.showToast(res.error);
  });
};
window.hostMuteGuest = (slot) => {
  socket.emit("hostMuteGuest", { roomId, slot }, (res) => {
    if (res?.error) window.showToast(res.error);
  });
};

window.requestGuestSeat = claimGuestSeat;
window.leaveGuestSeat   = releaseGuestSeatLocal;
window.toggleMyGuestMic = toggleMyGuestMic;

window.claimMicSeat    = claimMicSeat;
window.releaseMicSeat  = releaseMicSeat;
window.toggleMySeatMic = toggleMySeatMic;

window.openParticipantsModal  = openParticipantsModal;
window.closeParticipantsModal = closeParticipantsModal;
window.hostKickUserFromRoom    = hostKickUserFromRoom;

// Effects (color filters / beauty presets / AR)
window.openEffectsSheet   = openEffectsSheet;
window.closeEffectsSheet  = closeEffectsSheet;
window.setColorFilter     = setColorFilterUI;
window.applyBeautyPreset  = applyBeautyPresetUI;
window.setSticker         = setStickerUI;
window.setDistortion      = setDistortionUI;