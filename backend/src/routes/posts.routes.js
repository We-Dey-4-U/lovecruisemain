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
  requireAuth,
  PostController.getFeed
);

// User posts
router.get(
  "/user/:id",
  requireAuth,
  PostController.getUserPosts
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