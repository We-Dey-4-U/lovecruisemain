//
//   GIFT-ENGINE: giftReceived handler also forwards the payload
//         to window.__giftEngine?.playGift(payload) so the 2D PNG-based
//         gift engine (gift-engine/GiftAnimationManager.js, wired up in
//         live.html) can render the gift's own icon animated on top of
//         the stream.
//
//   PNG-ICON FIX (this pass): GIFT_CATALOG now carries `icon`
//         (= gifts.icon_url) alongside `emoji`, and renderGiftGrid()
//         renders that PNG in the gift-selector tiles instead of the
//         emoji, matching the premium look of Bigo/TikTok-style gift
//         boxes. If a PNG 404s, the tile silently falls back to the
//         emoji so a missing asset never breaks the gift sheet.
//         launchGiftBanner() (the on-screen "X sent Y" banner) prefers
//         payload.giftIcon for the same reason — the 3D/2D animation
//         engine itself already reads payload.giftIcon directly, no
//         change needed there since giftController.send() now includes
//         it on every broadcast (see giftController.js).
//
//   ANTI-FRAUD/DEDUP FIX: sendSelectedGift() no longer emits a
//         client-side "sendGift" socket event after the REST call.
//         The server (giftController.send) emits "giftReceived",
//         "topGiftersUpdated", and "battleScoreUpdated" to
//         room:{roomId} itself, once the gift transaction commits.
//
//   ── GIFT-ENGINE LIFECYCLE ───────────────────────
//   FIX-D (GPU/battery leak): the gift engine (renderer, particle
//         pool, queued animations) was created once in live.html and
//         never torn down. leaveRoom() now calls
//         window.__giftEngine?.destroy() so render loops stop and
//         resources are freed deterministically instead of relying on
//         GC/tab teardown timing.
//   FIX-E (stale animations during redirect): on "liveEnded" the
//         page waits ~2s before redirecting to discover.html. We call
//         window.__giftEngine?.stopAll() immediately so the queue and
//         any in-flight cinematic are cleared right away.
//   FIX-F (background tab cost): a live room left open in a
//         background tab kept rendering particles/cinematics at full
//         rate. We pause the gift engine's queue when the tab is
//         hidden and resume it when visible again — this does not
//         touch mediasoup/audio, only the visual queue.
//   FIX-G (mute hook): exposes window.setGiftSoundMuted(bool) so any
//         future UI control can mute/unmute gift sound effects
//         independently of the mediasoup mic/audio-boost pipeline.
//
//   ── BLACK-SCREEN / AUDIO FIXES ──────────────────────────────
//   FIX-A: iceTransportPolicy is only forced to "relay" when a real
//         turn:/turns: server actually loaded; otherwise "all" is
//         used so STUN/host candidates can still form a connection.
//   FIX-B: remote audio is routed through a Web Audio GainNode +
//         DynamicsCompressor chain (setupAudioBoost) instead of an
//         unmuted <video> element, which browsers frequently block
//         from autoplaying with sound. Video elements are always
//         explicitly muted so they reliably render.
//   FIX-C: `deviceReady` resolves as soon as the mediasoup Device is
//         loaded (all consumeProducer() actually needs), and
//         publishStream() runs afterward in its own try/catch — a
//         viewer who can't/won't publish their own camera can still
//         watch the host.
//

import * as mediasoupClient from "mediasoup-client";
import "./api.js";
import "./app.js";

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

/* ── Consumers — consumerId → { consumer, producerId, socketId, kind, isHost } ── */
const consumers = new Map();

/* ── Per-socket media streams (video only — audio is routed via Web Audio) ── */
const peerStreams = new Map();

/* ── Audio boost graph — consumerId → { source, gainNode, compressor, socketId } ── */
const audioBoosts = new Map();
let audioCtx = null;
const AUDIO_BOOST_GAIN = 1.7;

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

/* ── URL params ── */
const params = new URLSearchParams(window.location.search);
const roomId = params.get("room") || params.get("id");

if (!roomId) window.showToast?.("Invalid room link");

/* ── Socket ── */
const socket = io(window.API_BASE_URL.replace("/api", ""), {
  transports:          ["websocket"],
  reconnectionAttempts: 5,
  reconnectionDelay:   1000
});

function $(id) { return document.getElementById(id); }

/* ============================================================
   AUDIO CONTEXT / "TAP FOR SOUND"
   ============================================================ */
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

/* ============================================================
   AUDIO BOOST
   ============================================================ */
function setupAudioBoost(track, consumerId, socketId) {
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

    source.connect(gainNode).connect(compressor).connect(ctx.destination);

    audioBoosts.set(consumerId, { source, gainNode, compressor, socketId });

    if (ctx.state === "suspended") showTapForSound();
  } catch (e) {
    console.warn("[setupAudioBoost] failed:", e);
  }
}

function cleanupAudioBoost(consumerId) {
  const entry = audioBoosts.get(consumerId);
  if (!entry) return;
  try { entry.source.disconnect(); } catch (e) {}
  try { entry.gainNode.disconnect(); } catch (e) {}
  try { entry.compressor.disconnect(); } catch (e) {}
  audioBoosts.delete(consumerId);
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
   CAMERA INIT
   ============================================================ */
async function getLocalStream() {
  console.log("[getLocalStream] Requesting camera + mic…");
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
      const stream = await navigator.mediaDevices.getUserMedia({ video: vc, audio: audioConstraints });
      const vt = stream.getVideoTracks()[0];
      const at = stream.getAudioTracks()[0];
      console.log(`[getLocalStream] ✅ video=${vt?.label} audio=${at?.label}`, vt?.getSettings());
      return stream;
    } catch (e) {
      console.warn("[getLocalStream] Profile failed, retrying:", e.message);
    }
  }
  throw new Error("Camera/microphone access denied");
}

/* ============================================================
   DEVICE LOAD
   ============================================================ */
async function loadDevice(rtpCapabilities) {
  console.log("[loadDevice] Loading mediasoup Device…");
  device = new mediasoupClient.Device();
  await device.load({ routerRtpCapabilities: rtpCapabilities });
  console.log("[loadDevice] ✅ Device loaded. Codecs:", device.rtpCapabilities.codecs.map(c => c.mimeType));
}

/* ============================================================
   CODEC DETECTION
   ============================================================ */
function getPreferredVideoCodec() {
  if (!device?.rtpCapabilities?.codecs) return "VP8";
  const codecs = device.rtpCapabilities.codecs;
  if (codecs.some(c => c.mimeType.toLowerCase() === "video/vp9"))  return "VP9";
  if (codecs.some(c => c.mimeType.toLowerCase() === "video/h264")) return "H264";
  return "VP8";
}

/* ============================================================
   ICE SERVERS
   ============================================================ */
function buildIceServers() {
  if (window.__turnConfig && Array.isArray(window.__turnConfig)) {
    console.log("[buildIceServers] Using ICE servers:", window.__turnConfig.length);
    return window.__turnConfig;
  }
  console.warn("[buildIceServers] No TURN config — using STUN only");
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

/* ============================================================
   SEND TRANSPORT
   ============================================================ */
async function createSendTransport() {
  console.log("[createSendTransport] Creating…");
  return new Promise((resolve, reject) => {
    socket.emit("createSendTransport", { roomId }, (params) => {
      if (params?.error) return reject(new Error(params.error));

      sendTransport = device.createSendTransport({
        ...params,
        iceServers:         buildIceServers(),
        iceTransportPolicy: getIceTransportPolicy()
      });

      sendTransport.on("connect", ({ dtlsParameters }, cb, errback) => {
        console.log("[sendTransport] connect event — sending DTLS params");
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
        console.log("[sendTransport] connectionstatechange:", state);
        updateNetworkBadge(state);
      });

      console.log("[createSendTransport] ✅ id=", sendTransport.id);
      resolve(sendTransport);
    });
  });
}

/* ============================================================
   RECV TRANSPORT
   ============================================================ */
async function ensureRecvTransport() {
  if (recvTransport) return recvTransport;

  if (recvTransportPromise) {
    console.log("[ensureRecvTransport] Waiting for in-flight creation…");
    return recvTransportPromise;
  }

  console.log("[ensureRecvTransport] Creating recv transport…");
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
        console.log("[recvTransport] connect event — sending DTLS params");
        socket.emit("connectTransport", { transportId: recvTransport.id, dtlsParameters }, (res) => {
          if (res?.error) return errback(new Error(res.error));
          cb();
        });
      });

      recvTransport.on("connectionstatechange", (state) => {
        console.log("[recvTransport] connectionstatechange:", state);
      });

      console.log("[ensureRecvTransport] ✅ id=", recvTransport.id);
      resolve(recvTransport);
    });
  });

  return recvTransportPromise;
}

/* ============================================================
   PUBLISH SELF STREAM
   ============================================================ */
async function publishStream() {
  console.log("[publishStream] Starting…");
  localStream = await getLocalStream();

  const localVideo = $("local-video");
  if (localVideo) {
    localVideo.srcObject = localStream;
    localVideo.muted = true;
  }
  const localTile = $("local-tile");
  if (localTile) localTile.style.display = "flex";

  const localName = $("local-name");
  if (localName) {
    localName.textContent = window.CURRENT_USER?.username ||
                            window.CURRENT_USER?.display_name || "You";
  }

  if (isHost) {
    console.log("[publishStream] Host mode — mirroring to stage");
    const stageVideo = $("stage-video");
    if (stageVideo) {
      stageVideo.srcObject = localStream;
      stageVideo.muted = true;
    }
    const offlineEl = $("stage-offline");
    if (offlineEl) offlineEl.style.display = "none";

    const stageLabel = $("stage-host-label");
    if (stageLabel) stageLabel.textContent =
      window.CURRENT_USER?.username || window.CURRENT_USER?.display_name || "Host";
  }

  await createSendTransport();

  const codec = getPreferredVideoCodec();
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

    if (codec === "VP9") {
      produceOptions.encodings = [{ maxBitrate: 4_000_000, scalabilityMode: "L1T3" }];
    } else {
      produceOptions.encodings = buildSimulcastEncodings(width, height);
    }

    videoProducer = await sendTransport.produce(produceOptions);
    videoProducer.on("score", updateVideoScoreIndicator);
    console.log("[publishStream] ✅ videoProducer id=", videoProducer.id);
  }

  const audioTrack = localStream.getAudioTracks()[0];
  if (audioTrack) {
    audioProducer = await sendTransport.produce({
      track: audioTrack,
      codecOptions: { opusDtx: true, opusFec: true, opusMaxPlaybackRate: 48000 },
      appData: { type: "audio", isHost }
    });
    if (isHost) startAudioLevelMonitor(audioTrack);
    console.log("[publishStream] ✅ audioProducer id=", audioProducer.id);
  }

  console.log("[publishStream] ✅ Done publishing own stream");
}

/* ============================================================
   CONSUME A PRODUCER
   ============================================================ */
async function consumeProducer({ producerId, socketId, userId, kind, isHost: producerIsHostHint }) {
  console.log(`[consumeProducer] producerId=${producerId} kind=${kind} socketId=${socketId} isHostHint=${producerIsHostHint}`);

  await deviceReady;

  if (socketId === socket.id) {
    console.log("[consumeProducer] Skipping self");
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

      console.log(`[consumeProducer] Got params — consumerId=${params.id} kind=${params.kind} isHost=${params.isHost}`);

      try {
        const consumer = await transport.consume({
          id:            params.id,
          producerId:    params.producerId,
          kind:          params.kind,
          rtpParameters: params.rtpParameters
        });

        const producerIsHost = params.isHost ?? producerIsHostHint;

        consumers.set(consumer.id, { consumer, producerId, socketId, kind, isHost: producerIsHost });

        console.log(`[consumeProducer] Routing track: kind=${consumer.kind} isHost=${producerIsHost} socketId=${socketId}`);

        if (consumer.kind === "video") {
          if (producerIsHost) {
            attachTrackToStage(consumer.track);
          } else {
            attachTrackToParticipantTile(consumer.track, socketId, userId);
          }
        } else if (consumer.kind === "audio") {
          setupAudioBoost(consumer.track, consumer.id, socketId);
        }

        socket.emit("resumeConsumer", { consumerId: consumer.id }, (res) => {
          if (res?.error) {
            console.error("[consumeProducer] resumeConsumer error:", res.error);
          } else {
            console.log(`[consumeProducer] ✅ Consumer resumed: ${consumer.id}`);
          }
        });

        consumer.on("transportclose", () => {
          console.log(`[consumer] transportclose: ${consumer.id}`);
          cleanupAudioBoost(consumer.id);
          consumers.delete(consumer.id);
        });

        consumer.on("producerclose", () => {
          console.log(`[consumer] producerclose: ${consumer.id}`);
          consumer.close();
          cleanupAudioBoost(consumer.id);
          consumers.delete(consumer.id);
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

/* ============================================================
   TRACK ROUTING HELPERS
   ============================================================ */
function attachTrackToStage(track) {
  console.log("[attachTrackToStage] Attaching video track to #stage-video");
  const stageVideo = $("stage-video");
  if (!stageVideo) { console.error("[attachTrackToStage] #stage-video not found!"); return; }

  stageVideo.muted = true;

  if (!stageVideo.srcObject) stageVideo.srcObject = new MediaStream();
  stageVideo.srcObject.getVideoTracks().forEach(t => { stageVideo.srcObject.removeTrack(t); t.stop(); });
  stageVideo.srcObject.addTrack(track);

  const offlineEl = $("stage-offline");
  if (offlineEl) offlineEl.style.display = "none";

  stageVideo.play().catch(e => console.warn("[attachTrackToStage] play() rejected:", e.message));
  console.log("[attachTrackToStage] ✅ Stage video attached");
}

function getOrCreateParticipantTile(socketId, userId) {
  let tile = document.querySelector(`.participant-tile[data-socket-id="${socketId}"]`);
  if (!tile) {
    tile = document.createElement("div");
    tile.className = "participant-tile";
    tile.dataset.socketId = socketId;

    const video = document.createElement("video");
    video.autoplay    = true;
    video.playsInline = true;
    video.muted        = true;
    video.style.cssText = "width:72px;height:96px;border-radius:12px;object-fit:cover;border:2px solid rgba(255,255,255,.15);background:#111;display:block;";

    const nameEl = document.createElement("div");
    nameEl.className   = "ptile-name";
    nameEl.textContent = userId ? `User ${String(userId).slice(0, 6)}` : "Peer";

    const mutedBadge = document.createElement("div");
    mutedBadge.className   = "ptile-muted-badge";
    mutedBadge.textContent = "🔇";
    mutedBadge.style.display = "none";

    tile.appendChild(video);
    tile.appendChild(mutedBadge);
    tile.appendChild(nameEl);

    const strip = $("participants-strip");
    const hint  = $("strip-hint");
    if (hint) hint.style.display = "none";
    if (strip) strip.appendChild(tile);

    peerStreams.set(socketId, new MediaStream());
    video.srcObject = peerStreams.get(socketId);
  }
  return tile;
}

function attachTrackToParticipantTile(track, socketId, userId) {
  const tile  = getOrCreateParticipantTile(socketId, userId);
  const video = tile.querySelector("video");
  if (!video) return;

  let stream = peerStreams.get(socketId);
  if (!stream) { stream = new MediaStream(); peerStreams.set(socketId, stream); }
  stream.getVideoTracks().forEach(t => { stream.removeTrack(t); t.stop(); });
  stream.addTrack(track);
  video.srcObject = stream;
  video.muted = true;
  video.play().catch(e => console.warn("[attachTrackToParticipantTile] play() rejected:", e.message));
}

function removeParticipantVideo(socketId) {
  const tile = document.querySelector(`.participant-tile[data-socket-id="${socketId}"]`);
  if (tile) tile.remove();
  peerStreams.delete(socketId);
  cleanupAudioBoostsForSocket(socketId);

  const strip     = $("participants-strip");
  const hasRemote = strip?.querySelector(".participant-tile");
  const localShown = $("local-tile")?.style.display !== "none";
  if (!hasRemote && !localShown) {
    const hint = $("strip-hint");
    if (hint) hint.style.display = "flex";
  }
}

/* ============================================================
   SIMULCAST / SVC ENCODINGS
   ============================================================ */
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

/* ============================================================
   AUDIO LEVEL MONITOR
   ============================================================ */
function startAudioLevelMonitor(audioTrack) {
  try {
    const ctx      = new AudioContext();
    const src      = ctx.createMediaStreamSource(new MediaStream([audioTrack]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser);
    const data   = new Uint8Array(analyser.frequencyBinCount);
    const micBar = $("mic-level");

    function tick() {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      const pct = Math.min(100, (avg / 128) * 100);
      if (micBar) micBar.style.height = pct + "%";
      requestAnimationFrame(tick);
    }
    tick();
  } catch (e) {
    console.warn("[audioMonitor] Error:", e);
  }
}

/* ============================================================
   NETWORK BADGE
   ============================================================ */
function updateNetworkBadge(state) {
  const badge = $("network-badge");
  if (!badge) return;
  if (state === "connected") {
    badge.textContent = "HD"; badge.style.background = "rgba(0,200,100,.7)";
  } else if (state === "connecting") {
    badge.textContent = "…";  badge.style.background = "rgba(255,160,0,.7)";
  } else if (state === "failed" || state === "closed") {
    badge.textContent = "⚠️"; badge.style.background = "rgba(255,61,127,.7)";
  }
}

function updateVideoScoreIndicator(scores) {
  if (!scores?.length) return;
  const best  = scores.reduce((a, b) => (b.score > a.score ? b : a));
  const badge = $("network-badge");
  if (!badge) return;
  if (best.score >= 9)      { badge.textContent = "HD"; badge.style.background = "rgba(0,200,100,.7)"; }
  else if (best.score >= 6) { badge.textContent = "SD"; badge.style.background = "rgba(255,160,0,.7)"; }
  else                      { badge.textContent = "⚠️"; badge.style.background = "rgba(255,61,127,.7)"; }
}

/* ============================================================
   HOST CONTROLS
   ============================================================ */
function toggleMic() {
  if (!audioProducer) return;
  isMicMuted = !isMicMuted;
  isMicMuted ? audioProducer.pause() : audioProducer.resume();

  const hostBtn = $("mic-btn");
  if (hostBtn) hostBtn.textContent = isMicMuted ? "🔇" : "🎤";

  updateLocalMicButton(isMicMuted);

  socket.emit("peerMicToggled", { roomId, socketId: socket.id, muted: isMicMuted });
  window.showToast(isMicMuted ? "Mic muted" : "Mic on");
}

function updateLocalMicButton(muted) {
  const localMicBtn = $("local-mic-btn");
  if (!localMicBtn) return;
  localMicBtn.textContent = muted ? "🔇" : "🎤";
  localMicBtn.classList.toggle("muted", muted);
  localMicBtn.title = muted ? "Unmute mic" : "Mute mic";

  const localVideo = $("local-video");
  if (localVideo) localVideo.style.borderColor = muted ? "rgba(255,255,255,.2)" : "#ff3d7f";
}

function toggleCamera() {
  if (!videoProducer) return;
  isCameraOff = !isCameraOff;
  isCameraOff ? videoProducer.pause() : videoProducer.resume();

  const stageVideo = $("stage-video");
  if (stageVideo) stageVideo.style.opacity = isCameraOff ? "0.15" : "1";

  const localVideo = $("local-video");
  if (localVideo) localVideo.style.opacity = isCameraOff ? "0.15" : "1";

  const btn = $("camera-btn");
  if (btn) btn.textContent = isCameraOff ? "📵" : "📷";
  window.showToast(isCameraOff ? "Camera off" : "Camera on");
}

async function switchCamera() {
  if (!localStream) return;
  const currentFacing = localStream.getVideoTracks()[0]?.getSettings()?.facingMode || "user";
  const newFacing     = currentFacing === "user" ? "environment" : "user";
  try {
    const newStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: newFacing, width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    const newTrack = newStream.getVideoTracks()[0];
    if (videoProducer) await videoProducer.replaceTrack({ track: newTrack });

    const oldTrack = localStream.getVideoTracks()[0];
    if (oldTrack) { oldTrack.stop(); localStream.removeTrack(oldTrack); }
    localStream.addTrack(newTrack);

    const localVideo = $("local-video");
    if (localVideo) localVideo.srcObject = localStream;

    if (isHost) {
      const stageVideo = $("stage-video");
      if (stageVideo) stageVideo.srcObject = localStream;
    }
    window.showToast("Camera switched");
  } catch (e) {
    window.showToast("Camera switch failed");
  }
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

    $("host-name").textContent = room.username || room.display_name || "Host";
    $("viewer-count").textContent = window.formatCoins(viewerCount);

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

    console.log(`[loadRoom] ✅ room=${roomId} host_id=${room.host_id}`);
  } catch (err) {
    console.error("[loadRoom] ❌", err);
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
    console.error("[joinRoom] ❌", err);
  }
}

async function leaveRoom() {
  if (videoProducer) { try { videoProducer.close(); } catch (e) {} }
  if (audioProducer) { try { audioProducer.close(); } catch (e) {} }
  if (sendTransport) { try { sendTransport.close(); } catch (e) {} }
  if (recvTransport) { try { recvTransport.close(); } catch (e) {} }
  if (localStream)   localStream.getTracks().forEach(t => t.stop());
  cleanupAllAudioBoosts();

  try {
    await window.api.request(`/live/${roomId}/leave`, { method: "POST" });
    socket.emit("leaveRoom", { roomId });
  } catch (e) {}
}

/* ============================================================
   GIFT ENGINE — DELIBERATE-EXIT TEARDOWN ONLY
   ============================================================ */
function destroyGiftEngineForRealExit() {
  try { window.__giftEngine?.destroy(); } catch (e) {}
}

/* ============================================================
   SOCKET EVENTS
   ============================================================ */
function initSocket() {

  socket.on("routerRtpCapabilities", async ({ rtpCapabilities }) => {
    console.log("[socket] routerRtpCapabilities received");

    try {
      await loadDevice(rtpCapabilities);
      _deviceReadyResolve();
      console.log("[socket] ✅ deviceReady resolved (device loaded)");
    } catch (err) {
      console.error("[socket] loadDevice failed — cannot consume OR publish:", err);
      window.showToast("Failed to connect: " + err.message);
      return;
    }

    try {
      await publishStream();
    } catch (err) {
      console.warn("[socket] publishStream failed — continuing in watch-only mode:", err.message);
      window.showToast("Watching only (camera unavailable)");
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

    const hostConsumerExists = [...consumers.values()].some(c => c.isHost && !c.consumer.closed);
    if (!hostConsumerExists && !isHost) {
      const stageVideo = $("stage-video");
      if (stageVideo) stageVideo.srcObject = null;
      const offlineEl = $("stage-offline");
      if (offlineEl) offlineEl.style.display = "flex";
    }
  });

  socket.on("peerMicToggled", ({ socketId, muted }) => {
    if (socketId === socket.id) return;
    const tile = document.querySelector(`.participant-tile[data-socket-id="${socketId}"]`);
    if (!tile) return;
    const badge = tile.querySelector(".ptile-muted-badge");
    if (badge) badge.style.display = muted ? "flex" : "none";
    const video = tile.querySelector("video");
    if (video) video.style.borderColor = muted ? "rgba(255,255,255,.1)" : "rgba(255,255,255,.15)";
  });

  socket.on("viewerCountUpdated", ({ viewerCount: vc }) => {
    viewerCount = vc;
    const el = $("viewer-count");
    if (el) el.textContent = window.formatCoins(vc);
  });

  socket.on("newComment", (payload) => {
    appendComment({ avatar: payload.avatar, name: payload.name, text: payload.text });
  });

  socket.on("newReaction", ({ emoji }) => { spawnFloatParticle(emoji); });

  // ──────────────────────────────────────────────────────────
  // GIFT-ENGINE INTEGRATION
  // payload now includes giftIcon (gifts.icon_url) — see
  // giftController.js. The gift engine reads it directly to
  // animate the gift's own PNG; the on-screen banner here also
  // prefers it over the emoji.
  // ──────────────────────────────────────────────────────────
  socket.on("giftReceived", (payload) => {
    appendComment({ avatar: payload.avatar, name: payload.name,
                    text: `sent ${payload.giftEmoji} ${payload.giftName}`, type: "gift" });
    launchGiftBanner(payload);
    window.__giftEngine?.playGift(payload); // triggers the PNG sprite animation, never throws
  });

  socket.on("topGiftersUpdated", (gifters) => { renderTopGifters(gifters); });

  socket.on("liveEnded", () => {
    try { window.__giftEngine?.stopAll(); } catch (e) {}
    window.showToast("This live has ended");
    setTimeout(() => { window.location.href = "discover.html"; }, 2000);
  });

  socket.on("hostLeft", () => {
    window.showToast("Host disconnected");
    const offlineEl = $("stage-offline");
    if (offlineEl && !isHost) offlineEl.style.display = "flex";
  });

  socket.on("reconnect", () => {
    window.showToast("Reconnected");
    socket.emit("joinRoom", { roomId, userId: window.CURRENT_USER.id });
  });
}

/* ============================================================
   COMMENTS
   ============================================================ */
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

/* ============================================================
   REACTIONS
   ============================================================ */
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

/* ============================================================
   GIFTS
   PNG-ICON FIX: GIFT_CATALOG now carries `icon` (gifts.icon_url)
   alongside `emoji`, so the gift-selector grid can render the
   real gift PNG instead of an emoji, and so the animation engine
   always has an icon to fall back on if a socket payload is ever
   missing giftIcon for some reason.
   ============================================================ */
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
    console.error("[loadGiftCatalog] ❌", err);
  }
}

function renderGiftGrid() {
  const grid = $("gift-grid");
  if (!grid) return;

  grid.innerHTML = GIFT_CATALOG.map(gift => `
    <button class="gift-tile" id="gift-${gift.id}" data-gift-id="${gift.id}">
      ${gift.icon
        ? `<img class="gift-icon-img" src="${gift.icon}" alt="${window.escapeHtml(gift.name)}" data-fallback-emoji="${window.escapeHtml(gift.emoji || "🎁")}">`
        : `<span class="emoji">${gift.emoji || "🎁"}</span>`}
      <span class="name">${window.escapeHtml(gift.name)}</span>
      <span class="price">${gift.price}</span>
    </button>
  `).join("");

  // PNG → emoji fallback: if a gift's icon_url 404s or fails to
  // decode, swap it for the emoji span in place so the tile never
  // shows a broken-image icon.
  grid.querySelectorAll(".gift-icon-img").forEach(img => {
    img.addEventListener("error", () => {
      const span = document.createElement("span");
      span.className = "emoji";
      span.textContent = img.dataset.fallbackEmoji || "🎁";
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
    btn.textContent = `Send ${selectedGift.emoji || "🎁"} ${selectedGift.name} (${selectedGift.price} coins)`;
  }
}

/* ============================================================
   SEND SELECTED GIFT
   ============================================================ */
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
    window.showToast(`${selectedGift.emoji || "🎁"} Gift sent!`);
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
    ? `<img class="gift-banner-icon" src="${payload.giftIcon}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'gift-banner-avatar',textContent:'${(payload.giftEmoji || "🎁").replace(/'/g, "\\'")}'}))">`
    : `<span class="gift-banner-avatar">${payload.giftEmoji || "🎁"}</span>`;

  banner.innerHTML = `
    ${avatarHtml}
    <div class="gift-banner-text">
      <strong>${window.escapeHtml(payload.name)}</strong>
      sent <em>${window.escapeHtml(payload.giftName)}</em>
    </div>`;
  layer.appendChild(banner);
  setTimeout(() => banner.remove(), 3000);
}

/* ============================================================
   TOP GIFTERS
   ============================================================ */
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

/* ============================================================
   FOLLOW
   ============================================================ */
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

/* ============================================================
   END LIVE
   ============================================================ */
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

/* ============================================================
   CLOCK
   ============================================================ */
function tickClock() {
  secondsLive++;
  const m  = Math.floor(secondsLive / 60).toString().padStart(2, "0");
  const s  = (secondsLive % 60).toString().padStart(2, "0");
  const el = $("live-duration");
  if (el) el.textContent = `${m}:${s}`;
}

/* ============================================================
   GIFT ENGINE — TAB VISIBILITY
   ============================================================ */
function initGiftEngineVisibilityHandling() {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      window.__giftEngine?.pauseQueue?.();
    } else {
      window.__giftEngine?.resumeQueue?.();
    }
  });
}

/* ============================================================
   UI LISTENERS
   ============================================================ */
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

  $("local-mic-btn")?.addEventListener("click", toggleMic);
  $("local-camera-btn")?.addEventListener("click", toggleCamera);

  $("comment-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendComment();
  });
  $("comment-send-btn")?.addEventListener("click", sendComment);

  $("heart-btn")?.addEventListener("click", () => sendReaction("❤️"));
  $("fire-btn")?.addEventListener("click",  () => sendReaction("🔥"));

  $("gift-btn")?.addEventListener("click", openGiftSheet);
  $("sheet-backdrop")?.addEventListener("click", closeGiftSheet);
  $("send-gift-btn")?.addEventListener("click", sendSelectedGift);
  $("topup-btn")?.addEventListener("click", () => { window.location.href = "coins.html"; });
}

/* ============================================================
   INIT
   ============================================================ */
document.addEventListener("DOMContentLoaded", async () => {
  console.log("[init] Room:", roomId, "User:", window.CURRENT_USER?.id);

  if (!roomId) { window.showToast("Room ID missing"); return; }

  coinBalance = window.CURRENT_USER.coinBalance || window.CURRENT_USER.coin_balance || 0;

  attachUIListeners();
  initAudioUnlock();
  initGiftEngineVisibilityHandling();

  if (window.CURRENT_USER.id) {
    socket.emit("registerUser", window.CURRENT_USER.id);
  }

  try {
    const turnRes = await window.api.request("/live/turn-credentials");
    if (turnRes?.data) {
      window.__turnConfig = turnRes.data;
      console.log("[init] ✅ ICE config loaded, servers:", window.__turnConfig.length,
        "real TURN present:", hasRealTurnServer());
    }
  } catch (e) {
    console.warn("[init] ⚠️ Could not load TURN config — falling back to STUN-only, non-relay ICE:", e.message);
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
  }

  initSocket();
  await joinRoom();

  await loadGiftCatalog();
  await loadTopGifters();

  appendComment({ type: "system", text: "Welcome to the live room 🎉 Be kind and have fun!" });

  setInterval(tickClock, 1000);
});

/* ── Cleanup ── */
window.addEventListener("beforeunload", leaveRoom);
window.addEventListener("pagehide",     leaveRoom);

/* ── Window exports ── */
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

window.setGiftSoundMuted = (muted = true) => {
  window.__giftEngine?.setMuted(muted);
};