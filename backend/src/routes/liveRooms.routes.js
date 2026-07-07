const express = require("express");
const router = express.Router();

const liveRoomController = require("../controllers/liveRoomController");
const { requireAuth } = require("../middlewares/auth");

/**
 * TURN CREDENTIALS — must be BEFORE /:id routes
 * so Express does not match "turn-credentials" as an :id param
 *
 * ✅ FIX (root cause of "host sees himself, viewers see black screen"):
 * Previously, if METERED_API_KEY failed OR TURN_USERNAME/TURN_CREDENTIAL
 * were not set as env vars on the server, the hardcoded fallback below
 * still returned "turn:" URLs with username/credential simply missing
 * (JSON.stringify silently drops undefined properties). The client's
 * hasRealTurnServer() check only looked at whether a URL started with
 * "turn:" — so it detected a "real" TURN server, forced
 * iceTransportPolicy = "relay", and then every ICE candidate had to
 * authenticate against a TURN server with no credentials. That fails
 * for 100% of peers, both publishing (host) and consuming (viewers).
 * The host's own <video> still shows their camera because that's a
 * raw local getUserMedia() stream — it never touches the network — so
 * only the actual SFU-mediated paths (upload AND download) silently died.
 *
 * Fix: only return TURN entries that actually HAVE both username and
 * credential. STUN-only entries are always safe to return as-is. If no
 * usable TURN entry exists, we return STUN-only, and clearly log a
 * warning server-side so this is diagnosable instead of silently broken.
 */
function sanitizeIceServers(rawList) {
  if (!Array.isArray(rawList)) return [];

  return rawList.filter((entry) => {
    if (!entry || !entry.urls) return false;
    const urls = Array.isArray(entry.urls) ? entry.urls : [entry.urls];
    const isTurn = urls.some(
      (u) => typeof u === "string" && u.toLowerCase().startsWith("turn")
    );

    if (!isTurn) return true; // STUN entries are always fine

    const hasCreds =
      typeof entry.username === "string" && entry.username.length > 0 &&
      typeof entry.credential === "string" && entry.credential.length > 0;

    if (!hasCreds) {
      console.warn(
        "[turn-credentials] Dropping TURN entry with missing username/credential:",
        urls
      );
      return false;
    }
    return true;
  });
}

router.get("/turn-credentials", requireAuth, async (req, res) => {
  try {
    const response = await fetch(
      `https://vconnect-turn.metered.live/api/v1/turn/credentials?apiKey=${process.env.METERED_API_KEY}`
    );
    const iceServers = await response.json();
    const clean = sanitizeIceServers(iceServers);

    if (!clean.some((e) => {
      const urls = Array.isArray(e.urls) ? e.urls : [e.urls];
      return urls.some((u) => typeof u === "string" && u.toLowerCase().startsWith("turn"));
    })) {
      console.warn("[turn-credentials] Metered API returned no usable TURN entries — falling back");
      throw new Error("no usable turn entries from metered");
    }

    return res.json({ success: true, data: clean });
  } catch (err) {
    // Fallback to hardcoded credentials if Metered API call fails
    if (!process.env.TURN_USERNAME || !process.env.TURN_CREDENTIAL) {
      console.warn(
        "[turn-credentials] ⚠️ TURN_USERNAME / TURN_CREDENTIAL env vars are NOT set. " +
        "Falling back to STUN-only ICE servers. Viewers behind strict NATs/firewalls " +
        "(most mobile networks, many corporate/campus networks) will NOT be able to " +
        "receive video — you MUST configure a real TURN server for production use " +
        "at scale. See README / TURN_SETUP for instructions."
      );
    }

    const fallback = sanitizeIceServers([
      { urls: "stun:stun.relay.metered.ca:80" },
      {
        urls: "turn:global.relay.metered.ca:80",
        username:   process.env.TURN_USERNAME,
        credential: process.env.TURN_CREDENTIAL
      },
      {
        urls: "turn:global.relay.metered.ca:80?transport=tcp",
        username:   process.env.TURN_USERNAME,
        credential: process.env.TURN_CREDENTIAL
      },
      {
        urls: "turn:global.relay.metered.ca:443",
        username:   process.env.TURN_USERNAME,
        credential: process.env.TURN_CREDENTIAL
      },
      {
        urls: "turns:global.relay.metered.ca:443?transport=tcp",
        username:   process.env.TURN_USERNAME,
        credential: process.env.TURN_CREDENTIAL
      }
    ]);

    // Always guarantee at least a STUN server so the client never gets an empty array
    if (!fallback.length) {
      fallback.push({ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] });
    }

    res.json({ success: true, data: fallback });
  }
});

/**
 * WEBRTC CONFIG
 */
router.get("/webrtc/config", requireAuth, (req, res) => {
  res.json(require("../config/webrtc"));
});

/**
 * CREATE ROOM
 */
router.post("/create", requireAuth, liveRoomController.create);

/**
 * GET ALL LIVE ROOMS
 */
router.get("/", requireAuth, liveRoomController.list);

/**
 * JOIN ROOM
 */
router.post("/:id/join", requireAuth, liveRoomController.join);

/**
 * LEAVE ROOM
 */
router.post("/:id/leave", requireAuth, liveRoomController.leave);

/**
 * TOP GIFTERS
 */
router.get("/:id/top-gifters", requireAuth, liveRoomController.topGifters);

/**
 * END LIVE
 */
router.post("/:id/end", requireAuth, liveRoomController.end);

/**
 * GET SINGLE ROOM — must be LAST so it doesn't swallow other routes
 */
router.get("/:id", requireAuth, liveRoomController.getById);

module.exports = router;