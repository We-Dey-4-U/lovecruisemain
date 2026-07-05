const express = require("express");
const router = express.Router();

const StoryController = require("../controllers/storyController");

// IMPORTANT: correct named import
const { requireAuth } = require("../middlewares/auth");

router.post("/", requireAuth, StoryController.create);
router.get("/feed", requireAuth, StoryController.feed);
router.post("/:id/view", requireAuth, StoryController.view);
router.delete("/:id", requireAuth, StoryController.delete);

module.exports = router;