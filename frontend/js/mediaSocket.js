// frontend/js/mediaSocket.js
//
// PHASE 2 FRONTEND WIRING
// ------------------------------------------------------------
// Every room/broadcast is now assigned to exactly one media
// cluster node (see backend/src/services/roomAssignmentService.js).
// The client never hardcodes which host runs mediasoup — it asks
// the API, then opens a SECOND socket.io connection directly to
// whichever node comes back. All chat/gift/reaction/presence
// traffic stays on the existing API socket; only mediasoup
// signaling (transports/producers/consumers) and anything that
// depends on holding a live producer (seat/guest-mic state on
// live.html, cohost/guest state on radio-room.html) moves here.
//
// On a single-VPS deployment (today: api/media/radio/turn/ws all
// -> 2.57.91.91) the assigned publicUrl is just media.lovecruz.fun
// again, so this is a no-op extra hop. The day a second media node
// (media2.lovecruz.fun) exists, rooms start spreading across both
// automatically — with NO further frontend changes required.
//
// Requires: window.io (loaded via the socket.io CDN script tag,
// same as the existing API socket), window.api (js/api.js).

/**
 * @param {"live"|"radio"} roomType
 * @param {string} roomId  live_room.id or radio_broadcast.id
 * @returns {Promise<{ mediaSocket: import("socket.io-client").Socket, publicUrl: string, nodeId: string } | null>}
 *   Returns null (does not throw) if no media node is currently
 *   available — callers should degrade to "chat only, no live
 *   audio/video" rather than hard-fail the whole page.
 */
export async function connectMediaSocket(roomType, roomId) {
  if (!roomType || !roomId) {
    console.error("[mediaSocket] roomType and roomId are required");
    return null;
  }

  let assignment;
  try {
    const res = await window.api.request(`/media/assign/${roomType}/${roomId}`);
    assignment = res.data;
  } catch (err) {
    console.error("[mediaSocket] assignment request failed:", err.message);
    window.showToast?.("Live audio/video is temporarily unavailable — you can still chat");
    return null;
  }

  if (!assignment?.publicUrl) {
    console.error("[mediaSocket] assignment response missing publicUrl:", assignment);
    return null;
  }

  console.log(`[mediaSocket] Room ${roomId} (${roomType}) assigned to node "${assignment.nodeId}" @ ${assignment.publicUrl}`);

  const accessToken = localStorage.getItem("accessToken");

  const mediaSocket = window.io(assignment.publicUrl, {
    auth: { token: accessToken },
    transports: ["polling", "websocket"],
    reconnectionAttempts: 8,
    reconnectionDelay: 1000,
    // Distinct namespace-free connection — this is a completely
    // separate transport from the API socket, so it needs its own
    // path if the media node ever runs behind a shared Nginx path
    // prefix. Default "/socket.io/" matches media-server.js as-is.
  });

  mediaSocket.on("connect", () => {
    console.log(`[mediaSocket] ✅ connected to ${assignment.nodeId}. id=${mediaSocket.id}, transport=${mediaSocket.io.engine.transport.name}`);
  });
  mediaSocket.on("connect_error", (err) => {
    console.error(`[mediaSocket] ❌ connect_error (${assignment.nodeId}):`, err.message);
  });
  mediaSocket.on("disconnect", (reason) => {
    console.warn(`[mediaSocket] ⚠️ disconnected from ${assignment.nodeId}. reason=`, reason);
  });
  mediaSocket.io.engine?.on?.("upgrade", (t) => {
    console.log("[mediaSocket] ⬆️ transport upgraded to:", t.name);
  });

  return { mediaSocket, publicUrl: assignment.publicUrl, nodeId: assignment.nodeId };
}

/**
 * Promise-wrapped emit-with-ack helper, matching the pattern already
 * used throughout live.js / radio-room.html for socket calls that
 * expect a callback response.
 */
export function emitAsync(socket, event, payload) {
  return new Promise((resolve, reject) => {
    if (!socket || !socket.connected) {
      return reject(new Error("Media connection not ready — try again in a moment"));
    }
    socket.emit(event, payload, (res) => {
      if (res?.error) reject(new Error(res.error));
      else resolve(res);
    });
  });
}