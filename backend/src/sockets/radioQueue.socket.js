// backend/src/sockets/radioQueue.socket.js
//
// Most queue/request state changes are driven by the REST endpoints
// in songRequestController.js, which already broadcast the result
// via req.app.get("io") — that keeps a single source of truth (the
// DB write) instead of duplicating logic between REST and sockets,
// the same pattern radio.socket.js already uses for co-hosts/polls.
//
// This file covers the two things that genuinely need to be socket-
// native:
//   1. Sending a fresh queue + now-playing SNAPSHOT to a listener the
//      moment they join a broadcast room (radio.socket.js already
//      does this for co-hosts/polls — this mirrors that for queue).
//   2. A couple of low-friction socket-native aliases (vote, request)
//      for clients that prefer firing a socket event over an HTTP
//      call while already mid-broadcast — these still hit the exact
//      same DB writes so there's no logic duplication.
//
// Wire this into your socket bootstrap the same place
// radio.socket.js and stream.socket.js are attached, e.g.:
//   io.on("connection", (socket) => {
//     require("./stream.socket.js")(io, socket);
//     require("./radio.socket.js")(io, socket);
//     require("./radioQueue.socket.js")(io, socket);
//   });

const db = require("../config/db");

async function fetchQueueSnapshot(broadcastId) {
  const { rows: queue } = await db.query(
    `SELECT qi.*, s.title, s.artist, s.album, s.cover_url, s.duration_seconds, s.source
     FROM radio_queue_items qi
     JOIN radio_songs s ON s.id = qi.song_id
     WHERE qi.broadcast_id = $1 AND qi.status = 'queued'
     ORDER BY qi.position ASC`,
    [broadcastId]
  );

  const { rows: nowPlayingRows } = await db.query(
    `SELECT cp.*, s.title, s.artist, s.album, s.cover_url, s.duration_seconds
     FROM radio_current_playback cp
     JOIN radio_songs s ON s.id = cp.song_id
     WHERE cp.broadcast_id = $1`,
    [broadcastId]
  );

  return { queue, nowPlaying: nowPlayingRows[0] || null };
}

module.exports = (io, socket) => {

  /* ══════════════════════════════════════════════════════
     SNAPSHOT ON DEMAND — the client calls this right after
     joinRadio (radio.socket.js) to hydrate the queue UI without
     waiting for the next mutation to broadcast one.
  ══════════════════════════════════════════════════════ */
  socket.on("radioGetQueueSnapshot", async ({ broadcastId }, callback) => {
    try {
      if (!broadcastId) throw new Error("broadcastId is required");
      const snapshot = await fetchQueueSnapshot(broadcastId);
      callback?.({ ok: true, ...snapshot });
    } catch (err) {
      callback?.({ error: err.message });
    }
  });

  /* ══════════════════════════════════════════════════════
     SOCKET-NATIVE VOTE — same effect as
     POST /song-requests/requests/:requestId/vote
  ══════════════════════════════════════════════════════ */
  socket.on("radioVoteSong", async ({ broadcastId, requestId, userId }, callback) => {
    try {
      if (!requestId || !userId) throw new Error("requestId and userId are required");

      await db.query(
        `INSERT INTO radio_song_request_votes (request_id, user_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [requestId, userId]
      );

      const { rows } = await db.query(
        `SELECT broadcast_id, vote_count FROM radio_song_requests WHERE id = $1`,
        [requestId]
      );
      if (!rows.length) throw new Error("Request not found");

      const targetBroadcastId = broadcastId || rows[0].broadcast_id;
      io.to(`radio:${targetBroadcastId}`).emit("radioRequestVoted", {
        requestId, voteCount: rows[0].vote_count
      });

      callback?.({ ok: true, voteCount: rows[0].vote_count });
    } catch (err) {
      callback?.({ error: err.message });
    }
  });
};