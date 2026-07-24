// backend/src/mediasoup/liveEgressManager.js
//
// ════════════════════════════════════════════════════════════════
//   LIVE EGRESS MANAGER — mediasoup → FFmpeg → RTMP → HLS/CDN
// ════════════════════════════════════════════════════════════════
//
// WHY THIS FILE EXISTS
// ---------------------------------------------------------------
// mediasoup/WebRTC is an SFU: every viewer needs their own encrypted
// RTP stream, from a machine near them, with its own consumer,
// transport, and CPU cost. That scales to low hundreds of
// concurrent viewers per room, not millions. There is no CDN for
// raw SRTP — you cannot cache or fan out an encrypted per-viewer
// stream the way you can a plain HTTP file.
//
// What every large platform (Twitch, YouTube Live, TikTok LIVE,
// Bigo) actually does is split "interactive" from "broadcast":
//   - The small interactive stage (host + co-hosts + guests, the
//     people who need <200ms latency to talk over each other) stays
//     on the SFU exactly as it is today (stream.socket.js,
//     room.js, transport.js — UNCHANGED by this file).
//   - The composited output of that stage is piped out ONCE, via a
//     mediasoup PlainTransport (no encryption/ICE, just plain RTP
//     on localhost), into FFmpeg, which muxes it into a single
//     H.264/AAC RTMP stream.
//   - That one RTMP stream goes to an RTMP→HLS packager (this repo
//     already runs one for radio — the same box/software works for
//     video: nginx-rtmp, node-media-server, or a managed service
//     like Cloudflare Stream / Mux Video).
//   - A CDN (CloudFront, Bunny, Cloudflare, Fastly) fans the
//     resulting HLS segments out to unlimited viewers, fully
//     cacheable at edge nodes. Viewers get ~2-6s extra latency —
//     the standard price of serving millions instead of thousands.
//
// This file is ONLY the mediasoup-side half of that pipeline: it
// creates the PlainTransports, pipes the host's existing producers
// into them, and manages the FFmpeg process. It does not touch
// stream.socket.js's WebRTC producer/consumer logic for the
// interactive stage at all — that keeps working exactly as before
// for the host + guests.
//
// ════════════════════════════════════════════════════════════════
// USAGE (wire this into stream.socket.js / room.js — see the two
// call sites documented at the bottom of this file)
// ════════════════════════════════════════════════════════════════
//   const liveEgressManager = require("../mediasoup/liveEgressManager");
//
//   // When the host's video+audio producers both exist (i.e. right
//   // after the "produce" handler resolves for both kinds):
//   liveEgressManager.startEgress({ roomId, router: room.router,
//     videoProducer, audioProducer, streamKey: roomId });
//
//   // When the live ends / host leaves / room closes:
//   liveEgressManager.stopEgress(roomId);
//
// ════════════════════════════════════════════════════════════════
// REQUIRED ENV VARS (add these to .env — same pattern as the
// existing RADIO_RTMP_BASE_URL / RADIO_HLS_BASE_URL):
//   LIVE_RTMP_BASE_URL=rtmp://media.lovecruz.fun/live
//   LIVE_HLS_BASE_URL=https://media.lovecruz.fun/hls
//   LIVE_EGRESS_ENABLED=true     (set false to disable entirely —
//                                 e.g. while you're still setting up
//                                 the RTMP→HLS packager server)
// ════════════════════════════════════════════════════════════════
//
// REQUIRES: ffmpeg installed on this machine/container and on PATH.
//   Debian/Ubuntu: apt-get install -y ffmpeg
//   Docker: FROM node:20 ... RUN apt-get update && apt-get install -y ffmpeg
//
// An RTMP→HLS packager must be running and reachable at
// LIVE_RTMP_BASE_URL (ingest) / LIVE_HLS_BASE_URL (playback). This
// file does not run that packager — it's a separate process/service,
// exactly like your existing radio RTMP/HLS setup.

const { spawn } = require("child_process");
const os = require("os");

const EGRESS_ENABLED = process.env.LIVE_EGRESS_ENABLED !== "false";
const RTMP_BASE_URL = process.env.LIVE_RTMP_BASE_URL || "rtmp://127.0.0.1/live";
const HLS_BASE_URL = process.env.LIVE_HLS_BASE_URL || "https://media.lovecruz.fun/hls";

// A local, non-routable UDP port range dedicated to plain RTP that
// only ever travels from mediasoup to FFmpeg on THIS SAME machine —
// never exposed publicly, never crosses the network. Kept disjoint
// from the WebRTC RTC_MIN_PORT–RTC_MAX_PORT range used in
// transport.js so the two never collide.
const EGRESS_PORT_MIN = parseInt(process.env.LIVE_EGRESS_PORT_MIN || "50000", 10);
const EGRESS_PORT_MAX = parseInt(process.env.LIVE_EGRESS_PORT_MAX || "50999", 10);

// roomId -> egress session state
const sessions = new Map();

let nextPortCursor = EGRESS_PORT_MIN;
function allocatePortPair() {
  // RTP + RTCP need consecutive ports (RTCP = RTP + 1) per convention.
  if (nextPortCursor + 4 > EGRESS_PORT_MAX) nextPortCursor = EGRESS_PORT_MIN;
  const rtpPort = nextPortCursor;
  nextPortCursor += 4; // leave headroom between allocations for video+audio pairs
  return rtpPort;
}

/* ══════════════════════════════════════════════════════
   FFMPEG COMMAND BUILDER
   ------------------------------------------------------------
   Feeds FFmpeg an SDP file (over stdin, via `-i pipe:0` on a
   generated SDP body) describing both the video and audio RTP
   streams it should expect on localhost. This avoids writing a
   temp file to disk and avoids FFmpeg's own RTP listener quirks —
   the SDP fully describes payload types/codecs so FFmpeg can just
   depacketize and remux, doing the minimum possible CPU work
   (no re-encode needed if source codec is already H.264/Opus;
   otherwise a transcode step is added automatically below).
══════════════════════════════════════════════════════ */
function buildSdp({ videoPort, videoPt, videoCodec, audioPort, audioPt }) {
  const lines = [
    "v=0",
    "o=- 0 0 IN IP4 127.0.0.1",
    "s=mediasoup-egress",
    "c=IN IP4 127.0.0.1",
    "t=0 0"
  ];

  if (videoPort) {
    const rtpmap = videoCodec === "VP8"
      ? `${videoPt} VP8/90000`
      : videoCodec === "VP9"
        ? `${videoPt} VP9/90000`
        : `${videoPt} H264/90000`;
    lines.push(
      `m=video ${videoPort} RTP/AVP ${videoPt}`,
      `a=rtpmap:${rtpmap}`,
      "a=recvonly"
    );
  }

  if (audioPort) {
    lines.push(
      `m=audio ${audioPort} RTP/AVP ${audioPt}`,
      `a=rtpmap:${audioPt} opus/48000/2`,
      "a=recvonly"
    );
  }

  return lines.join("\r\n") + "\r\n";
}

function buildFfmpegArgs({ sdpPath, videoPort, audioPort, videoCodec, rtmpUrl }) {
  const args = [
    "-loglevel", "warning",
    "-protocol_whitelist", "file,udp,rtp",
    "-f", "sdp",
    "-i", sdpPath
  ];

  // Video: VP8/VP9 must be transcoded to H.264 for broad HLS/RTMP
  // player compatibility. If the router negotiated H.264 already
  // (see router.js's codec preference order), we can copy the
  // video stream through untouched — far cheaper on CPU.
  if (videoPort) {
    if (videoCodec === "H264") {
      args.push("-c:v", "copy");
    } else {
      args.push(
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-tune", "zerolatency",
        "-b:v", "2500k",
        "-maxrate", "2500k",
        "-bufsize", "5000k",
        "-g", "60",
        "-pix_fmt", "yuv420p"
      );
    }
  }

  if (audioPort) {
    // Opus (mediasoup's audio codec) is not RTMP-legal — RTMP/FLV
    // requires AAC. This transcode is mandatory, not optional.
    args.push("-c:a", "aac", "-b:a", "128k", "-ar", "44100");
  }

  args.push(
    "-f", "flv",
    "-flvflags", "no_duration_filesize",
    rtmpUrl
  );

  return args;
}

/* ══════════════════════════════════════════════════════
   START EGRESS
   ------------------------------------------------------------
   Creates PlainTransports for the host's existing video/audio
   producers, pipes them to localhost UDP ports, then spawns FFmpeg
   to remux/transcode that into a single RTMP stream. Idempotent —
   calling this again for a roomId that already has a live session
   is a no-op (returns the existing session's info).
══════════════════════════════════════════════════════ */
async function startEgress({ roomId, router, videoProducer, audioProducer, streamKey }) {
  if (!EGRESS_ENABLED) {
    console.log(`[liveEgress] Disabled via LIVE_EGRESS_ENABLED=false — skipping egress for room=${roomId}`);
    return null;
  }
  if (!roomId) throw new Error("liveEgressManager.startEgress: roomId is required");
  if (!router) throw new Error("liveEgressManager.startEgress: router is required");
  if (!videoProducer && !audioProducer) throw new Error("liveEgressManager.startEgress: at least one producer required");

  const existing = sessions.get(roomId);
  if (existing) {
    console.log(`[liveEgress] Egress already running for room=${roomId} — reusing`);
    return existing.publicInfo;
  }

  const key = streamKey || roomId;
  const rtmpUrl = `${RTMP_BASE_URL}/${key}`;
  const hlsUrl = `${HLS_BASE_URL}/${key}/index.m3u8`;

  console.log(`[liveEgress] Starting egress for room=${roomId} -> ${rtmpUrl}`);

  const session = {
    roomId,
    router,
    videoTransport: null,
    audioTransport: null,
    videoConsumer: null,
    audioConsumer: null,
    ffmpegProcess: null,
    restartCount: 0,
    restartTimer: null,
    stopped: false,
    publicInfo: { roomId, rtmpUrl, hlsUrl, startedAt: Date.now() }
  };
  sessions.set(roomId, session);

  try {
    await _buildAndLaunch({ session, videoProducer, audioProducer, rtmpUrl });
    return session.publicInfo;
  } catch (err) {
    console.error(`[liveEgress] Failed to start egress for room=${roomId}:`, err);
    await _teardownSession(session);
    sessions.delete(roomId);
    throw err;
  }
}

async function _buildAndLaunch({ session, videoProducer, audioProducer, rtmpUrl }) {
  const { router, roomId } = session;
  const listenIp = { ip: "127.0.0.1", announcedIp: undefined };

  let videoPort = null, videoPt = null, videoCodec = null;
  let audioPort = null, audioPt = null;

  if (videoProducer && !videoProducer.closed) {
    const videoTransport = await router.createPlainTransport({
      listenIp,
      rtcpMux: false,
      comedia: false
    });
    videoPort = allocatePortPair();
    await videoTransport.connect({ ip: "127.0.0.1", port: videoPort, rtcpPort: videoPort + 1 });

    const videoConsumer = await videoTransport.consume({
      producerId: videoProducer.id,
      rtpCapabilities: router.rtpCapabilities,
      paused: false
    });

    const codecMime = videoConsumer.rtpParameters.codecs[0]?.mimeType?.toLowerCase() || "";
    videoCodec = codecMime.includes("h264") ? "H264" : codecMime.includes("vp9") ? "VP9" : "VP8";
    videoPt = videoConsumer.rtpParameters.codecs[0]?.payloadType ?? 96;

    session.videoTransport = videoTransport;
    session.videoConsumer = videoConsumer;
    console.log(`[liveEgress] room=${roomId} video piped: port=${videoPort} codec=${videoCodec} pt=${videoPt}`);
  }

  if (audioProducer && !audioProducer.closed) {
    const audioTransport = await router.createPlainTransport({
      listenIp,
      rtcpMux: false,
      comedia: false
    });
    audioPort = allocatePortPair();
    await audioTransport.connect({ ip: "127.0.0.1", port: audioPort, rtcpPort: audioPort + 1 });

    const audioConsumer = await audioTransport.consume({
      producerId: audioProducer.id,
      rtpCapabilities: router.rtpCapabilities,
      paused: false
    });

    audioPt = audioConsumer.rtpParameters.codecs[0]?.payloadType ?? 97;

    session.audioTransport = audioTransport;
    session.audioConsumer = audioConsumer;
    console.log(`[liveEgress] room=${roomId} audio piped: port=${audioPort} pt=${audioPt}`);
  }

  const sdp = buildSdp({ videoPort, videoPt, videoCodec, audioPort, audioPt });
  const sdpPath = `/tmp/egress-${roomId}-${Date.now()}.sdp`;
  require("fs").writeFileSync(sdpPath, sdp);
  session.sdpPath = sdpPath;

  const args = buildFfmpegArgs({ sdpPath, videoPort, audioPort, videoCodec, rtmpUrl });
  _spawnFfmpeg(session, args, { videoProducer, audioProducer, rtmpUrl });
}

function _spawnFfmpeg(session, args, retryContext) {
  console.log(`[liveEgress] room=${session.roomId} spawning: ffmpeg ${args.join(" ")}`);
  const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
  session.ffmpegProcess = proc;

  proc.stdout.on("data", (d) => console.log(`[ffmpeg:${session.roomId}] ${d.toString().trim()}`));
  proc.stderr.on("data", (d) => {
    const line = d.toString().trim();
    // FFmpeg logs normal progress to stderr at "warning" level too —
    // only flag genuinely alarming lines loudly.
    if (/error|failed|invalid|refused/i.test(line)) {
      console.error(`[ffmpeg:${session.roomId}] ⚠️ ${line}`);
    }
  });

  proc.on("exit", (code, signal) => {
    if (session.stopped) {
      console.log(`[liveEgress] room=${session.roomId} ffmpeg exited cleanly (stop requested)`);
      return;
    }
    console.error(`[liveEgress] room=${session.roomId} ffmpeg exited unexpectedly code=${code} signal=${signal}`);

    // Bounded auto-restart: transient RTMP hiccups shouldn't kill the
    // whole broadcast, but a persistently broken pipeline shouldn't
    // spin forever either.
    session.restartCount += 1;
    if (session.restartCount > 5) {
      console.error(`[liveEgress] room=${session.roomId} exceeded 5 restart attempts — giving up on egress (interactive stage/mediasoup room is unaffected)`);
      return;
    }
    const delay = Math.min(1000 * 2 ** session.restartCount, 15000);
    console.warn(`[liveEgress] room=${session.roomId} restarting ffmpeg in ${delay}ms (attempt ${session.restartCount}/5)`);
    session.restartTimer = setTimeout(() => {
      if (session.stopped) return;
      _spawnFfmpeg(session, args, retryContext);
    }, delay);
  });

  proc.on("error", (err) => {
    console.error(`[liveEgress] room=${session.roomId} ffmpeg spawn error (is ffmpeg installed on PATH?):`, err.message);
  });
}

/* ══════════════════════════════════════════════════════
   STOP EGRESS
══════════════════════════════════════════════════════ */
async function stopEgress(roomId) {
  const session = sessions.get(roomId);
  if (!session) return;
  console.log(`[liveEgress] Stopping egress for room=${roomId}`);
  session.stopped = true;
  await _teardownSession(session);
  sessions.delete(roomId);
}

async function _teardownSession(session) {
  if (session.restartTimer) clearTimeout(session.restartTimer);

  if (session.ffmpegProcess && !session.ffmpegProcess.killed) {
    try { session.ffmpegProcess.kill("SIGINT"); } catch (e) {}
  }

  if (session.videoConsumer) { try { session.videoConsumer.close(); } catch (e) {} }
  if (session.audioConsumer) { try { session.audioConsumer.close(); } catch (e) {} }
  if (session.videoTransport) { try { session.videoTransport.close(); } catch (e) {} }
  if (session.audioTransport) { try { session.audioTransport.close(); } catch (e) {} }

  if (session.sdpPath) {
    try { require("fs").unlinkSync(session.sdpPath); } catch (e) {}
  }
}

/* ══════════════════════════════════════════════════════
   STATUS / INTROSPECTION
══════════════════════════════════════════════════════ */
function getEgressStatus(roomId) {
  const session = sessions.get(roomId);
  if (!session) return { active: false };
  return {
    active: !session.stopped,
    ...session.publicInfo,
    restartCount: session.restartCount,
    hasVideo: !!session.videoConsumer,
    hasAudio: !!session.audioConsumer
  };
}

function getAllEgressSessions() {
  return [...sessions.keys()].map((roomId) => getEgressStatus(roomId));
}

/* ══════════════════════════════════════════════════════
   GRACEFUL SHUTDOWN — stop all ffmpeg children if this Node
   process exits, so they don't become orphaned zombies.
══════════════════════════════════════════════════════ */
function stopAll() {
  for (const roomId of [...sessions.keys()]) {
    stopEgress(roomId).catch(() => {});
  }
}
process.on("exit", stopAll);
process.on("SIGINT", () => { stopAll(); process.exit(0); });
process.on("SIGTERM", () => { stopAll(); process.exit(0); });

module.exports = {
  startEgress,
  stopEgress,
  getEgressStatus,
  getAllEgressSessions
};

/* ════════════════════════════════════════════════════════════════
   INTEGRATION — exact call sites (not part of this file's export,
   documented here for the two files that need one small addition
   each; both are additive, nothing existing is removed)

   1) backend/src/sockets/stream.socket.js — inside the existing
      "produce" handler, AFTER `room.producers.set(producer.id, producer)`,
      add:

        const liveEgressManager = require("../mediasoup/liveEgressManager");
        if (isHost) {
          const videoProducer = [...room.producers.values()]
            .find(p => p.appData?.socketId === room.hostSocketId && p.kind === "video" && !p.closed);
          const audioProducer = [...room.producers.values()]
            .find(p => p.appData?.socketId === room.hostSocketId && p.kind === "audio" && !p.closed);
          if (videoProducer && audioProducer) {
            liveEgressManager.startEgress({
              roomId: socket.currentRoomId,
              router: room.router,
              videoProducer,
              audioProducer,
              streamKey: socket.currentRoomId
            }).catch(err => console.error("[produce] egress start failed:", err.message));
          }
        }

   2) backend/src/sockets/stream.socket.js — inside the existing
      "liveEnded" handler, right before `closeRoom(roomId)`, add:

        const liveEgressManager = require("../mediasoup/liveEgressManager");
        await liveEgressManager.stopEgress(roomId);

      And inside `_handlePeerLeave`, in the `if (wasHost) { ... }`
      block, add the same stopEgress(roomId) call — a host
      disconnecting should stop the RTMP feed too.

   3) Expose the HLS URL to viewers: liveRoomController.js's
      getById() can include liveEgressManager.getEgressStatus(id).hlsUrl
      in its response so live.html can decide whether to offer an
      "HLS/lite" viewing mode once viewerCount crosses a threshold.
   ════════════════════════════════════════════════════════════════ */