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
   SOCKET.IO CLIENT LOADER
   ============================================================ */
const SOCKET_IO_CDN_URL = "https://cdn.socket.io/4.7.5/socket.io.min.js";
let socketIoLoadingPromise = null;

function ensureSocketIoLoaded() {
  if (typeof window.io !== "undefined") return Promise.resolve();
  if (socketIoLoadingPromise) return socketIoLoadingPromise;

  socketIoLoadingPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${SOCKET_IO_CDN_URL}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Failed to load socket.io")));
      if (typeof window.io !== "undefined") resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = SOCKET_IO_CDN_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load socket.io"));
    document.head.appendChild(script);
  });

  return socketIoLoadingPromise;
}

/* ============================================================
   PRESENCE — "Follow User to Current Live Room"
   ============================================================ */
let presenceSocket = null;

async function initPresenceSocket() {
  if (presenceSocket || !window.CURRENT_USER?.id || !window.API_BASE_URL) return;

  try {
    await ensureSocketIoLoaded();
  } catch (err) {
    console.error("[initPresenceSocket] Could not load socket.io client:", err);
    return;
  }

  if (presenceSocket) return;

  const socketUrl = window.API_BASE_URL.replace("/api", "");
  console.log("[presenceSocket] Connecting to:", socketUrl);

  presenceSocket = window.io(socketUrl, {
    // NOTE: was transports: ["websocket"] only — that skips the
    // normal HTTP polling handshake and goes straight to a WS
    // upgrade, which is the #1 cause of "WebSocket is closed
    // before the connection is established" on Render. Allowing
    // polling first lets the connection establish normally, then
    // upgrade to WS if the proxy supports it.
    transports: ["polling", "websocket"],
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000
  });

  /* ── DIAGNOSTIC LOGGING ──────────────────────────────────
     These fire for every connection attempt/failure so we can
     see exactly what's happening at the transport layer, not
     just "it didn't work". Check the browser console for these
     prefixed lines.
  ────────────────────────────────────────────────────────── */
  presenceSocket.on("connect", () => {
    console.log(
      "[presenceSocket] ✅ connected. id=", presenceSocket.id,
      "transport=", presenceSocket.io.engine.transport.name
    );
    presenceSocket.emit("registerUser", window.CURRENT_USER.id);
  });

  presenceSocket.on("connect_error", (err) => {
    console.error("[presenceSocket] ❌ connect_error:", err.message, err);
  });

  presenceSocket.on("disconnect", (reason) => {
    console.warn("[presenceSocket] ⚠️ disconnected. reason=", reason);
  });

  presenceSocket.on("reconnect_attempt", (attempt) => {
    console.log("[presenceSocket] 🔄 reconnect_attempt #", attempt);
  });

  presenceSocket.on("reconnect_error", (err) => {
    console.error("[presenceSocket] ❌ reconnect_error:", err.message);
  });

  presenceSocket.on("reconnect_failed", () => {
    console.error("[presenceSocket] ❌ reconnect_failed — giving up");
  });

  presenceSocket.io.on("error", (err) => {
    console.error("[presenceSocket manager] ❌ error:", err);
  });

  presenceSocket.io.engine?.on("upgrade", (transport) => {
    console.log("[presenceSocket] ⬆️ transport upgraded to:", transport.name);
  });

  presenceSocket.io.engine?.on("upgradeError", (err) => {
    console.error("[presenceSocket] ❌ upgradeError:", err);
  });

  presenceSocket.on("reconnect", () => {
    console.log("[presenceSocket] ✅ reconnected");
    presenceSocket.emit("registerUser", window.CURRENT_USER.id);
  });

  presenceSocket.on("presenceUpdated", (payload) => {
    window.dispatchEvent(new CustomEvent("presenceUpdated", { detail: payload }));
  });

  // NEW: radio-specific + generic notifications pushed by
  // radioController.js / radioNotifier.js land here too, so any
  // page can listen for window "newNotification" without opening
  // its own socket.
  presenceSocket.on("newNotification", (payload) => {
    window.dispatchEvent(new CustomEvent("newNotification", { detail: payload }));
  });

  window.__presenceSocket = presenceSocket;
}

/* ────────────────────────────────────────────────────────────
   FIX #1 (audit bug 1): presenceStatusLabel had no case for
   radio statuses, so a user hosting/listening to radio showed
   as "Offline" everywhere (profile follow-list badges, live-
   strip banner). Added HOSTING_RADIO / LISTENING_RADIO cases.
──────────────────────────────────────────────────────────── */
function presenceStatusLabel(p) {
  if (!p) return "Offline";
  switch (p.status) {
    case "HOSTING_LIVE":     return "🔴 Hosting Live";
    case "WATCHING_LIVE":    return p.hostName ? `Watching ${p.hostName}'s Live` : "🟢 Live";
    case "CO_HOST":          return p.hostName ? `Co-hosting ${p.hostName}'s Live` : "Co-host";
    case "GUEST_SEAT":       return p.hostName ? `Guest in ${p.hostName}'s Live` : "Guest";
    case "HOSTING_RADIO":    return "📻 Hosting Radio";
    case "LISTENING_RADIO":  return p.hostName ? `Listening to ${p.hostName}'s Radio` : "📻 Listening to Radio";
    case "ONLINE":           return "Online";
    default:                 return "Offline";
  }
}

/* ────────────────────────────────────────────────────────────
   FIX #2 (audit bug 2): isPresenceLive() excluded radio statuses,
   so profile.html's "Live now — Join" strip never appeared for
   someone currently on radio. Added HOSTING_RADIO / LISTENING_RADIO.
──────────────────────────────────────────────────────────── */
function isPresenceLive(p) {
  return !!p && [
    "HOSTING_LIVE", "WATCHING_LIVE", "CO_HOST", "GUEST_SEAT",
    "HOSTING_RADIO", "LISTENING_RADIO"
  ].includes(p.status);
}

async function fetchFollowersLiveStatus() {
  try {
    const res = await api.request("/presence/followers/live-status");
    return res.data || [];
  } catch (err) {
    console.error("[fetchFollowersLiveStatus] ❌", err);
    return [];
  }
}

/* ────────────────────────────────────────────────────────────
   FIX #3 (audit bug 3): goToUserLocation() always redirected to
   live.html?room=... with no branch for radio, so tapping a
   radio-listening/hosting follower sent them into the WebRTC
   live-room UI with a broadcast ID it can't use. Now branches on
   the `status` field the endpoint already returns.
──────────────────────────────────────────────────────────── */
async function goToUserLocation(userId) {
  try {
    const res = await api.request(`/presence/room/current/${userId}`);
    const { roomId, status } = res.data || {};
    if (roomId) {
      const isRadio = status === "HOSTING_RADIO" || status === "LISTENING_RADIO";
      window.location.href = isRadio
        ? `radio-room.html?id=${roomId}`
        : `live.html?room=${roomId}`;
      return;
    }
  } catch (err) {
    console.error("[goToUserLocation] ❌", err);
  }
  window.location.href = `profile.html?id=${userId}`;
}

/* ============================================================
   NOTE: GIFT_CATALOG is declared only in live.js
   ============================================================ */

const CONVERSATIONS = [
  { id: "c1", name: "Chiamaka",  avatar: "https://i.pravatar.cc/100?img=32", last: "sent a 💍 Ring gift",                time: "2m",  unread: 2, online: true  },
  { id: "c2", name: "Tega Live", avatar: "https://i.pravatar.cc/100?img=12", last: "Pulling up to the stream tonight?", time: "18m", unread: 0, online: true  },
  { id: "c3", name: "Funmi",     avatar: "https://i.pravatar.cc/100?img=45", last: "Lmaooo 😭😭😭",                     time: "1h",  unread: 0, online: false },
  { id: "c4", name: "DJ Koast",  avatar: "https://i.pravatar.cc/100?img=14", last: "You: Drop that mix link",           time: "3h",  unread: 0, online: true  },
  { id: "c5", name: "Big Sammy", avatar: "https://i.pravatar.cc/100?img=51", last: "Bro 😂 you dey mad",               time: "1d",  unread: 0, online: false },
];

/* ============================================================
   WINDOW EXPORTS
   ============================================================ */
window.showToast              = showToast;
window.formatCoins            = formatCoins;
window.timeAgo                = timeAgo;
window.escapeHtml             = escapeHtml;
window.persistCurrentUser     = persistCurrentUser;
window.refreshCurrentUser     = refreshCurrentUser;
window.requireAuthOrRedirect  = requireAuthOrRedirect;
window.logout                 = logout;
window.CONVERSATIONS          = CONVERSATIONS;

window.initPresenceSocket       = initPresenceSocket;
window.presenceStatusLabel      = presenceStatusLabel;
window.isPresenceLive           = isPresenceLive;
window.fetchFollowersLiveStatus = fetchFollowersLiveStatus;
window.goToUserLocation         = goToUserLocation;

initPresenceSocket();