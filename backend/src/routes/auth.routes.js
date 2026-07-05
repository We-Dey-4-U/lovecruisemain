const express = require("express");
const router = express.Router();

const AuthController = require("../controllers/authController");
const { requireAuth } = require("../middlewares/auth");

// ================= AUTH ROUTES =================

// Public
router.post("/register", AuthController.register);
router.post("/login", AuthController.login);

router.post("/refresh", AuthController.refresh);

router.post("/logout", AuthController.logout);

router.post("/google", AuthController.googleLogin);
router.post("/facebook", AuthController.facebookLogin);

// Protected
router.post(
  "/logout-all",
  requireAuth,
  AuthController.logoutAll
);

router.get(
  "/me",
  requireAuth,
  AuthController.me
);

module.exports = router;