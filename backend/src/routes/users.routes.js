const express = require("express");
const router = express.Router();

const UserController = require("../controllers/userController");

// ✅ FIXED PATH
const { requireAuth } = require("../middlewares/auth");

// ================= USER PROFILE =================

// ================= ME =================
router.patch("/me", requireAuth, UserController.updateMe);

// ================= DISCOVER =================
router.get("/discover", requireAuth, UserController.discover);

// ================= FRIEND REQUESTS =================
router.post("/friend-requests", requireAuth, UserController.sendFriendRequest);

router.post(
  "/friend-requests/:id/respond",
  requireAuth,
  UserController.respondFriendRequest
);

router.get("/me/friends", requireAuth, UserController.listFriends);


// ================= BLOCK =================
router.post("/block", requireAuth, UserController.blockUser);

// ================= VERIFICATION =================
router.post("/me/verification", requireAuth, UserController.submitVerification);


router.post(
    "/:id/follow",
    requireAuth,
    UserController.followUser
);

router.delete(
    "/:id/follow",
    requireAuth,
    UserController.unfollowUser
);



// ================= ROOM =================
router.get("/:id/current-room", requireAuth, UserController.currentRoom);

router.get(
  "/:id/gifts",
  requireAuth,
  UserController.giftHistory
);


router.get("/:id", requireAuth, UserController.getProfile);




module.exports = router;