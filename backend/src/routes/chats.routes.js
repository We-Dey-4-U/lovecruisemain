const express = require("express");
const router = express.Router();

const ChatController = require("../controllers/chatController");

// ✅ FIXED PATH
const { requireAuth } = require("../middlewares/auth");

// ================= CHATS =================

// Create or get conversation
router.post("/", requireAuth, ChatController.getOrCreateConversation);

// List conversations
router.get("/", requireAuth, ChatController.listConversations);

// Get messages in conversation
router.get("/:id/messages", requireAuth, ChatController.getMessages);

// Send message
router.post("/:id/messages", requireAuth, ChatController.sendMessage);

module.exports = router;