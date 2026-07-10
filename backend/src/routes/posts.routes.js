const express = require("express");
const router = express.Router();

const { requireAuth } = require("../middlewares/auth");
const { optionalAuth } = require("../middlewares/optionalAuth");

const PostController = require("../controllers/postController");
const uploadPostMedia = require("../middlewares/uploadPostMedia");

// Create post — must be logged in
router.post(
  "/",
  requireAuth,
  uploadPostMedia,
  PostController.createPost
);

// Feed — public. optionalAuth means guests see it too,
// and logged-in users still get correct is_liked flags.
router.get(
  "/feed",
  optionalAuth,
  PostController.getFeed
);

// User posts (profile page) — must be logged in
router.get(
  "/user/:id",
  requireAuth,
  PostController.getUserPosts
);

// Public share/OG preview page — no auth (crawlers can't log in).
// Must stay ABOVE "/:id" or it will be swallowed by that route.
router.get(
  "/share/:id",
  PostController.renderShare
);

// Single post — public (guests can open a shared post link too)
router.get(
  "/:id",
  optionalAuth,
  PostController.getPost
);

// Delete post — must be logged in
router.delete(
  "/:id",
  requireAuth,
  PostController.deletePost
);

// Like / Unlike — must be logged in
router.post(
  "/:id/like",
  requireAuth,
  PostController.toggleLike
);

// Add comment — must be logged in
router.post(
  "/:id/comments",
  requireAuth,
  PostController.addComment
);

// Get comments — public read
router.get(
  "/:id/comments",
  PostController.getComments
);

module.exports = router;