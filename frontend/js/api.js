/* ============================================================
   vConnect API Client
   ------------------------------------------------------------
   FIX (root cause of the "https:/.lovecruz.fun/api",
   ERR_NAME_NOT_RESOLVED, xhr poll error / connect_error loop
   seen on radio-room.html, live.js, mediaSocket.js, etc.):

   Every other script in the app (app.js's presenceSocket,
   radio-room.html's socket, live.js's socket, mediaSocket.js)
   reads `window.API_BASE_URL` and does its own ad-hoc string
   surgery on it (`.replace(/\/api\/?$/, "")`, manual polling
   loops waiting for it to "look right", etc). That's fragile:
   if API_BASE_URL is ever unset, mistyped, missing a slash, or
   read a tick before this file finishes running, every one of
   those call sites builds a broken socket URL independently and
   fails in a different confusing way.

   This file now owns that problem ONCE, centrally:
     1. The base URL is validated and normalized (no trailing
        slash, guaranteed "https://host" shape) at load time.
        If it's ever malformed, we fail loudly in the console
        instead of silently producing "https:/.something".
     2. `window.API_BASE_URL` is still set synchronously, exactly
        like before, so all existing synchronous readers keep
        working unmodified.
     3. We ALSO expose:
          - `window.getApiBaseUrl()`      → always-valid string
          - `window.getSocketBaseUrl()`   → API_BASE_URL with the
                                            trailing "/api" removed,
                                            i.e. the raw socket.io
                                            host every socket
                                            connection in the app
                                            needs. No more every
                                            file reimplementing its
                                            own regex for this.
          - `window.apiReady`             → a Promise that resolves
                                            once this module has
                                            finished validating and
                                            setting everything up.
                                            Any script can
                                            `await window.apiReady`
                                            before touching sockets
                                            instead of writing its
                                            own polling loop.
          - `"apiReady"` DOM event         → for non-module scripts
                                            that can't `await` at
                                            the top level.
   ============================================================ */

//https://lovecruise-api.onrender.com/
//const RAW_API_BASE_URL = "http://localhost:3000/api";
//https://lovecruise-api-1.onrender.com
//https://lovecruisemain.onrender.com
//https://api.lovecruz.fun/
const RAW_API_BASE_URL = "https://api.lovecruz.fun/api";
//const RAW_API_BASE_URL = "https://lovecruisemain.onrender.com/api";

/**
 * Normalizes a base URL string into a guaranteed-safe
 * "https://host[/path]" shape with no trailing slash.
 * Returns null if the input doesn't look like a real absolute URL
 * (this is what stops a typo like "https:/.lovecruz.fun/api" or an
 * empty/undefined value from ever silently propagating).
 */
function normalizeBaseUrl(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().replace(/\/+$/, ""); // strip trailing slash(es)
  // Must look like an absolute http(s) URL with a real host, e.g.
  // "https://api.lovecruz.fun" or "https://api.lovecruz.fun/api" —
  // NOT "https:/.lovecruz.fun" (single slash / missing host) and
  // NOT "https://" with nothing after it.
  if (!/^https?:\/\/[a-zA-Z0-9]([a-zA-Z0-9.-]*)(:\d+)?(\/.*)?$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

const API_BASE_URL = normalizeBaseUrl(RAW_API_BASE_URL);

if (!API_BASE_URL) {
  // Loud, immediate, impossible-to-miss failure instead of quietly
  // handing every socket/file/API consumer in the app a broken URL.
  console.error(
    "[api.js] FATAL: RAW_API_BASE_URL is malformed:", RAW_API_BASE_URL,
    "— every API request and socket connection in this app will fail " +
    "until this is corrected."
  );
}

/**
 * The socket.io host every socket connection in the app needs
 * (API_BASE_URL with a trailing "/api" removed). Every file that
 * used to do `window.API_BASE_URL.replace(/\/api\/?$/, "")` itself
 * (app.js, radio-room.html, live.js) should call this instead so
 * there is exactly one place that logic lives.
 */
function computeSocketBaseUrl(base) {
  if (!base) return null;
  return base.replace(/\/api\/?$/, "");
}

const SOCKET_BASE_URL = computeSocketBaseUrl(API_BASE_URL);

/**
 * Always returns a valid API base URL string, or throws with a
 * clear error rather than letting a caller silently build a
 * broken request/socket URL.
 */
function getApiBaseUrl() {
  if (!API_BASE_URL) {
    throw new Error("API_BASE_URL is not configured correctly — check js/api.js");
  }
  return API_BASE_URL;
}

/**
 * Always returns a valid socket.io host string, or throws with a
 * clear error. Callers (app.js presenceSocket, radio-room.html,
 * live.js, mediaSocket.js) should prefer this over hand-rolling
 * their own regex/polling logic against window.API_BASE_URL.
 */
function getSocketBaseUrl() {
  if (!SOCKET_BASE_URL) {
    throw new Error("Socket base URL could not be derived — check js/api.js");
  }
  return SOCKET_BASE_URL;
}

const api = {
  async request(endpoint, options = {}) {
    const accessToken = localStorage.getItem("accessToken");

    const headers = { ...(options.headers || {}) };

    if (!options.isFormData) {
      headers["Content-Type"] = "application/json";
    }

    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }

    const response = await fetch(`${getApiBaseUrl()}${endpoint}`, {
      ...options,
      headers
    });

    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }

    if (response.status === 401) {
      const refreshed = await api._tryRefresh();
      if (refreshed) {
        return api.request(endpoint, options);
      } else {
        localStorage.removeItem("accessToken");
        localStorage.removeItem("refreshToken");
        localStorage.removeItem("currentUser");
        window.location.href = "index.html";
        throw new Error("Session expired");
      }
    }

    if (!response.ok) {
      throw new Error(data.message || "Request failed");
    }

    return data;
  },

  async _tryRefresh() {
    const refreshToken = localStorage.getItem("refreshToken");
    if (!refreshToken) return false;

    try {
      const res = await fetch(`${getApiBaseUrl()}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken })
      });
      if (!res.ok) return false;
      const data = await res.json();
      if (data.data?.accessToken) {
        localStorage.setItem("accessToken", data.data.accessToken);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
};

api.uploadFile = async function (file) {
  const accessToken = localStorage.getItem("accessToken");
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${getApiBaseUrl()}/uploads`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: formData
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "Upload failed");
  return data;
};

/* ============================================================
   WINDOW EXPORTS
   ------------------------------------------------------------
   Required so ES module scripts (live.js loaded as type="module")
   and any other page script can access these globals.

   window.API_BASE_URL / window.SOCKET_BASE_URL are still set
   synchronously here, exactly as before, so every existing
   consumer that reads them directly keeps working with zero
   changes needed elsewhere. New code should prefer
   window.getApiBaseUrl() / window.getSocketBaseUrl() (throws
   clearly instead of silently handing back a broken string) or
   `await window.apiReady` if it needs to be certain this module
   has fully initialized first.
   ============================================================ */
window.API_BASE_URL    = API_BASE_URL;
window.SOCKET_BASE_URL = SOCKET_BASE_URL;
window.getApiBaseUrl    = getApiBaseUrl;
window.getSocketBaseUrl = getSocketBaseUrl;
window.api              = api;

// Promise-based readiness signal for any script (module or not)
// that wants to `await` instead of writing its own polling loop
// against window.API_BASE_URL (e.g. the waitForSocketUrl() helper
// that used to live duplicated in radio-room.html can now just
// `await window.apiReady` instead).
window.apiReady = Promise.resolve({
  apiBaseUrl: API_BASE_URL,
  socketBaseUrl: SOCKET_BASE_URL
});

// DOM event version, for classic (non-module, non-async-context)
// scripts that can't top-level `await window.apiReady`.
document.dispatchEvent(new CustomEvent("apiReady", {
  detail: { apiBaseUrl: API_BASE_URL, socketBaseUrl: SOCKET_BASE_URL }
}));