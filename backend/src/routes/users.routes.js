const express = require("express");
const router = express.Router();

const UserController = require("../controllers/userController");
const { requireAuth } = require("../middlewares/auth");

// ================= ME =================
router.patch("/me", requireAuth, UserController.updateMe);

// ================= DISCOVER =================
router.get("/discover", requireAuth, UserController.discover);

// ================= FRIEND REQUESTS =================
router.post("/friend-requests", requireAuth, UserController.sendFriendRequest);
router.post("/friend-requests/:id/respond", requireAuth, UserController.respondFriendRequest);
router.get("/me/friends", requireAuth, UserController.listFriends);

// ================= BLOCK =================
router.post("/block", requireAuth, UserController.blockUser);

// ================= VERIFICATION =================
router.post("/me/verification", requireAuth, UserController.submitVerification);

// ================= FOLLOW =================
router.post("/:id/follow", requireAuth, UserController.followUser);
router.delete("/:id/follow", requireAuth, UserController.unfollowUser);

// ================= FOLLOWERS / FOLLOWING LISTS =================
router.get("/:id/followers", requireAuth, UserController.listFollowers);
router.get("/:id/following", requireAuth, UserController.listFollowing);

// ================= ROOM / GIFTS =================
router.get("/:id/current-room", requireAuth, UserController.currentRoom);
router.get("/:id/gifts", requireAuth, UserController.giftHistory);

// Keep last — most generic param route.
router.get("/:id", requireAuth, UserController.getProfile);

module.exports = router;