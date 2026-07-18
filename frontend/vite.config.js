import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  server: {
    port: 5173,
    open: false
  },

  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        home: resolve(__dirname, "home.html"),
        discover: resolve(__dirname, "discover.html"),
        live: resolve(__dirname, "live.html"),
        "go-live": resolve(__dirname, "go-live.html"),
        post: resolve(__dirname, "post.html"),
        "create-post": resolve(__dirname, "create-post.html"),
        profile: resolve(__dirname, "profile.html"),
        chat: resolve(__dirname, "chat.html"),
        call: resolve(__dirname, "call.html"),
        notifications: resolve(__dirname, "notifications.html"),
        settings: resolve(__dirname, "settings.html"),
        success: resolve(__dirname, "success.html"),  // ← NEW
        coins: resolve(__dirname, "coins.html"),
        leaderboard: resolve(__dirname, "leaderboard.html"),  // ← NEW
        marketplace: resolve(__dirname, "marketplace.html"),  // ← NEW
        withdrawa: resolve(__dirname, "withdrawal.html"),  // ← NEW
        "podcast-listen": resolve(__dirname, "podcast-listen.html"),
        "podcast-show": resolve(__dirname, "podcast-show.html"),
        "podcast-studio": resolve(__dirname, "podcast-studio.html"),
         "podcast-live": resolve(__dirname, "podcast-live.html"),  // ← NEW
          "admin-dashboard.html": resolve(__dirname, "admin-dashboard.html"),
          "radio-room.html": resolve(__dirname, "radio-room.html"),
           "radio-discover.html": resolve(__dirname, "radio-discover.html"),
            "radio-station.html": resolve(__dirname, "radio-station.html"),

      }
    }
  }
});

