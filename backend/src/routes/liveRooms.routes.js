const express = require("express");
const router = express.Router();

const liveRoomController = require("../controllers/liveRoomController");
const { requireAuth } = require("../middlewares/auth");

/**
 * TURN CREDENTIALS — must be BEFORE /:id routes
 * so Express does not match "turn-credentials" as an :id param
 */
router.get("/turn-credentials", requireAuth, async (req, res) => {
  try {
    const response = await fetch(
      `https://vconnect-turn.metered.live/api/v1/turn/credentials?apiKey=${process.env.METERED_API_KEY}`
    );
    const iceServers = await response.json();
    res.json({ success: true, data: iceServers });
  } catch (err) {
    // Fallback to hardcoded credentials if Metered API call fails
    res.json({
      success: true,
      data: [
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
      ]
    });
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