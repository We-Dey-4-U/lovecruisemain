/* ============================================================
   vConnect API Client
   ============================================================ */
//https://lovecruise-api.onrender.com/
//const API_BASE_URL = "http://localhost:3000/api";
//https://lovecruise-api-1.onrender.com
//https://lovecruisemain.onrender.com
const API_BASE_URL = "https://lovecruisemain.onrender.com/api";

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

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
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
      const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
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

  const response = await fetch(`${API_BASE_URL}/uploads`, {
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
   Required so ES module scripts (live.js loaded as type="module")
   and any other page script can access these globals.
   ============================================================ */
window.API_BASE_URL = API_BASE_URL;
window.api          = api;