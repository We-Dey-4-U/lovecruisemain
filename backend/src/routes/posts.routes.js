const express = require("express");
const router = express.Router();

const { requireAuth } =
  require("../middlewares/auth");

const UserController =
  require("../controllers/userController");
const PostController = require("../controllers/postController");
const uploadPostMedia = require("../middlewares/uploadPostMedia");

// Create post
router.post(
  "/",
  requireAuth,
  uploadPostMedia,
  PostController.createPost
);

// Feed
router.get(
  "/feed",
  PostController.getFeed
);

// User posts
router.get(
  "/user/:id",
  requireAuth,
  PostController.getUserPosts
);

// ✅ NEW: Public share/OG preview page — no auth (crawlers can't log in).
// Must stay ABOVE "/:id" or it will be swallowed by that route.
router.get(
  "/share/:id",
  PostController.renderShare
);

// Single post
router.get(
  "/:id",
  requireAuth,
  PostController.getPost
);

// Delete post
router.delete(
  "/:id",
  requireAuth,
  PostController.deletePost
);

// Like / Unlike
router.post(
  "/:id/like",
  requireAuth,
  PostController.toggleLike
);

// Add comment
router.post(
  "/:id/comments",
  requireAuth,
  PostController.addComment
);

// Get comments
router.get(
  "/:id/comments",
  requireAuth,
  PostController.getComments
);

module.exports = router;