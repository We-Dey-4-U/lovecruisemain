/* ============================================================
   vConnect — Shared App Helpers
   ============================================================ */

function showToast(msg, duration = 2200) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.remove("show"), duration);
}

function formatCoins(n) {
  const num = Number(n || 0);
  if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
  if (num >= 1000) return (num / 1000).toFixed(1) + "K";
  return new Intl.NumberFormat("en-US").format(num);
}

function timeAgo(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
  return d.toLocaleDateString();
}

function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ============================================================
   AUTHENTICATED USER
   ============================================================ */
window.CURRENT_USER = JSON.parse(localStorage.getItem("currentUser")) || {};

function persistCurrentUser(user) {
  window.CURRENT_USER = { ...window.CURRENT_USER, ...user };
  localStorage.setItem("currentUser", JSON.stringify(window.CURRENT_USER));
}

async function refreshCurrentUser() {
  const res = await api.request("/auth/me");
  persistCurrentUser(res.data);
  return window.CURRENT_USER;
}

function requireAuthOrRedirect() {
  const token = localStorage.getItem("accessToken");
  if (!token) {
    window.location.href = "index.html";
    return false;
  }
  return true;
}

function logout() {
  const refreshToken = localStorage.getItem("refreshToken");
  api.request("/auth/logout", {
    method: "POST",
    body: JSON.stringify({ refreshToken }),
  }).catch(() => {});
  localStorage.removeItem("accessToken");
  localStorage.removeItem("refreshToken");
  localStorage.removeItem("currentUser");
  window.location.href = "index.html";
}

/* ============================================================
   NOTE: GIFT_CATALOG is declared only in live.js
   ============================================================ */

// Mock conversations for chat page (replace with real API)
const CONVERSATIONS = [
  { id: "c1", name: "Chiamaka",  avatar: "https://i.pravatar.cc/100?img=32", last: "sent a 💍 Ring gift",                time: "2m",  unread: 2, online: true  },
  { id: "c2", name: "Tega Live", avatar: "https://i.pravatar.cc/100?img=12", last: "Pulling up to the stream tonight?", time: "18m", unread: 0, online: true  },
  { id: "c3", name: "Funmi",     avatar: "https://i.pravatar.cc/100?img=45", last: "Lmaooo 😭😭😭",                     time: "1h",  unread: 0, online: false },
  { id: "c4", name: "DJ Koast",  avatar: "https://i.pravatar.cc/100?img=14", last: "You: Drop that mix link",           time: "3h",  unread: 0, online: true  },
  { id: "c5", name: "Big Sammy", avatar: "https://i.pravatar.cc/100?img=51", last: "Bro 😂 you dey mad",               time: "1d",  unread: 0, online: false },
];

/* ============================================================
   WINDOW EXPORTS
   Required so ES module scripts (live.js as type="module") and
   any inline <script> on other pages can access these globals.
   ============================================================ */
window.showToast            = showToast;
window.formatCoins          = formatCoins;
window.timeAgo              = timeAgo;
window.escapeHtml           = escapeHtml;
window.persistCurrentUser   = persistCurrentUser;
window.refreshCurrentUser   = refreshCurrentUser;
window.requireAuthOrRedirect = requireAuthOrRedirect;
window.logout               = logout;
window.CONVERSATIONS        = CONVERSATIONS;