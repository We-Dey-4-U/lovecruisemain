// backend/src/controllers/songRequestController.js
//
// Song Request Module + Queue Module. Same pattern as
// radioController's co-host/poll split: these REST endpoints are
// the durable source of truth (DB writes), and radioQueue.socket.js
// broadcasts the resulting state to everyone in the broadcast room
// in real time. A REST caller and a socket caller both end up
// calling into the same functions here where practical.
//
// Flow (matches the spec's listener flow exactly):
//   listener searches a song (musicLibraryController.searchSongs)
//     -> POST /song-requests  (song_id OR freeform title/artist)
//     -> host sees it in their queue manager
//     -> POST /song-requests/:id/approve  -> creates a radio_queue_items row
//        POST /song-requests/:id/reject
//     -> host controls playback: POST /queue/:broadcastId/next | /previous
//        PATCH /queue/:broadcastId/reorder
//        DELETE /queue/:broadcastId/items/:itemId

const db = require("../config/db");
const { getProvider } = require("../services/musicProviders");

async function assertIsHost(broadcastId, userId) {
  const { rows } = await db.query(`SELECT host_id FROM radio_broadcasts WHERE id = $1`, [broadcastId]);
  if (!rows.length) throw Object.assign(new Error("Broadcast not found"), { status: 404 });
  if (String(rows[0].host_id) !== String(userId)) {
    throw Object.assign(new Error("Only the host can do that"), { status: 403 });
  }
  return rows[0];
}

/**
 * Ensures a song referenced by an external provider actually has a
 * row in radio_songs (creating one from the cached provider metadata
 * if needed), so the queue system always deals in radio_songs.id
 * regardless of where the track originally came from.
 */
async function resolveOrCreateSongRow({ songId, externalProvider, externalTrackId }) {
  if (songId) {
    const { rows } = await db.query(`SELECT * FROM radio_songs WHERE id = $1`, [songId]);
    if (!rows.length) throw Object.assign(new Error("Song not found"), { status: 404 });
    return rows[0];
  }

  if (externalProvider && externalTrackId) {
    const { rows: existing } = await db.query(
      `SELECT * FROM radio_songs WHERE external_provider = $1 AND external_track_id = $2`,
      [externalProvider, externalTrackId]
    );
    if (existing.length) return existing[0];

    const provider = getProvider(externalProvider);
    const track = await provider.getSong(externalTrackId);
    if (!track) throw Object.assign(new Error("External track not found"), { status: 404 });

    const { rows: inserted } = await db.query(
      `INSERT INTO radio_songs
         (title, artist, album, genre, duration_seconds, file_url, cover_url,
          source, external_provider, external_track_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'external',$8,$9,'ready')
       RETURNING *`,
      [
        track.title, track.artist, track.album, track.genre, track.durationSeconds,
        track.streamUrl, track.coverUrl, externalProvider, externalTrackId
      ]
    );
    return inserted[0];
  }

  return null; // freeform text-only request — no library row
}

async function nextQueuePosition(broadcastId) {
  const { rows } = await db.query(
    `SELECT COALESCE(MAX(position), -1) + 1 AS next_position
     FROM radio_queue_items WHERE broadcast_id = $1 AND status = 'queued'`,
    [broadcastId]
  );
  return rows[0].next_position;
}

async function fetchQueue(broadcastId) {
  const { rows } = await db.query(
    `SELECT qi.*, s.title, s.artist, s.album, s.cover_url, s.duration_seconds, s.source
     FROM radio_queue_items qi
     JOIN radio_songs s ON s.id = qi.song_id
     WHERE qi.broadcast_id = $1 AND qi.status = 'queued'
     ORDER BY qi.position ASC`,
    [broadcastId]
  );
  return rows;
}

async function fetchNowPlaying(broadcastId) {
  const { rows } = await db.query(
    `SELECT cp.*, s.title, s.artist, s.album, s.cover_url, s.duration_seconds
     FROM radio_current_playback cp
     JOIN radio_songs s ON s.id = cp.song_id
     WHERE cp.broadcast_id = $1`,
    [broadcastId]
  );
  return rows[0] || null;
}

function getIo(req) {
  return req.app.get("io") || null;
}

function broadcastQueueUpdate(io, broadcastId, queue) {
  if (io) io.to(`radio:${broadcastId}`).emit("radioQueueUpdated", { broadcastId, queue });
}

function broadcastNowPlaying(io, broadcastId, nowPlaying) {
  if (io) io.to(`radio:${broadcastId}`).emit("radioNowPlaying", { broadcastId, nowPlaying });
}

const SongRequestController = {

  /* ============================================================
     LISTENER: REQUEST A SONG
     ============================================================ */
  async requestSong(req, res, next) {
    try {
      const broadcastId = req.params.broadcastId;
      const { songId, externalProvider, externalTrackId, songName, artistName } = req.body;

      const { rows: bRows } = await db.query(
        `SELECT id, host_id FROM radio_broadcasts WHERE id = $1 AND status = 'live'`,
        [broadcastId]
      );
      if (!bRows.length) {
        return res.status(404).json({ success: false, message: "Broadcast not found or not live" });
      }

      let songRow = null;
      if (songId || (externalProvider && externalTrackId)) {
        songRow = await resolveOrCreateSongRow({ songId, externalProvider, externalTrackId });
      } else if (!songName || !songName.trim()) {
        return res.status(400).json({ success: false, message: "Provide a songId, an external track, or a song name" });
      }

      const { rows } = await db.query(
        `INSERT INTO radio_song_requests
           (broadcast_id, user_id, song_id, song_name, artist_name, status)
         VALUES ($1, $2, $3, $4, $5, 'pending')
         RETURNING *`,
        [
          broadcastId, req.user.id, songRow?.id || null,
          songRow?.title || songName?.trim(), songRow?.artist || artistName || null
        ]
      );
      const request = rows[0];

      const io = getIo(req);
      if (io) {
        io.to(`radio:${broadcastId}`).emit("radioSongRequested", {
          broadcastId,
          request: { ...request, song: songRow || null, requesterUsername: req.user.username }
        });
      }

      res.status(201).json({ success: true, data: request });
    } catch (err) {
      next(err.status ? err : err);
    }
  },

  async listRequests(req, res, next) {
    try {
      const { status = "pending" } = req.query;
      const { rows } = await db.query(
        `SELECT r.*, u.username, u.avatar_url, s.cover_url AS song_cover_url, s.duration_seconds
         FROM radio_song_requests r
         JOIN users u ON u.id = r.user_id
         LEFT JOIN radio_songs s ON s.id = r.song_id
         WHERE r.broadcast_id = $1 AND r.status = $2
         ORDER BY r.vote_count DESC, r.created_at ASC`,
        [req.params.broadcastId, status]
      );
      res.json({ success: true, data: rows });
    } catch (err) {
      next(err);
    }
  },

  /* ============================================================
     LISTENER: VOTE FOR A PENDING REQUEST ("vote for the next song")
     ============================================================ */
  async voteRequest(req, res, next) {
    try {
      await db.query(
        `INSERT INTO radio_song_request_votes (request_id, user_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [req.params.requestId, req.user.id]
      );

      const { rows } = await db.query(
        `SELECT broadcast_id, vote_count FROM radio_song_requests WHERE id = $1`,
        [req.params.requestId]
      );
      if (rows.length) {
        const io = getIo(req);
        if (io) {
          io.to(`radio:${rows[0].broadcast_id}`).emit("radioRequestVoted", {
            requestId: req.params.requestId,
            voteCount: rows[0].vote_count
          });
        }
      }
      res.status(201).json({ success: true, message: "Vote recorded" });
    } catch (err) {
      next(err);
    }
  },

  /* ============================================================
     HOST: APPROVE — moves the request into the play queue.
     ============================================================ */
  async approveRequest(req, res, next) {
    try {
      const { rows: reqRows } = await db.query(
        `SELECT * FROM radio_song_requests WHERE id = $1`,
        [req.params.requestId]
      );
      if (!reqRows.length) return res.status(404).json({ success: false, message: "Request not found" });
      const request = reqRows[0];

      await assertIsHost(request.broadcast_id, req.user.id);

      let songId = request.song_id;
      if (!songId) {
        // Freeform text request with no library match — the host still
        // needs an actual playable song row to queue. In production
        // you'd prompt the host to pick/attach a library match here;
        // for now we reject cleanly rather than queueing something
        // unplayable.
        return res.status(400).json({
          success: false,
          message: "This request has no linked track — attach a library song before approving"
        });
      }

      const position = await nextQueuePosition(request.broadcast_id);
      const { rows: qRows } = await db.query(
        `INSERT INTO radio_queue_items
           (broadcast_id, song_id, added_by, requested_by, request_id, position, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'queued')
         RETURNING *`,
        [request.broadcast_id, songId, req.user.id, request.user_id, request.id, position]
      );

      await db.query(
        `UPDATE radio_song_requests SET
           status = 'approved', responded_by = $2, responded_at = NOW(), queue_item_id = $3
         WHERE id = $1`,
        [request.id, req.user.id, qRows[0].id]
      );

      const queue = await fetchQueue(request.broadcast_id);
      const io = getIo(req);
      broadcastQueueUpdate(io, request.broadcast_id, queue);
      if (io) {
        io.to(`radio:${request.broadcast_id}`).emit("radioRequestApproved", {
          broadcastId: request.broadcast_id, requestId: request.id
        });
      }

      res.json({ success: true, data: qRows[0] });
    } catch (err) {
      next(err);
    }
  },

  async rejectRequest(req, res, next) {
    try {
      const { rows: reqRows } = await db.query(
        `SELECT * FROM radio_song_requests WHERE id = $1`,
        [req.params.requestId]
      );
      if (!reqRows.length) return res.status(404).json({ success: false, message: "Request not found" });
      await assertIsHost(reqRows[0].broadcast_id, req.user.id);

      await db.query(
        `UPDATE radio_song_requests SET status = 'declined', responded_by = $2, responded_at = NOW() WHERE id = $1`,
        [req.params.requestId, req.user.id]
      );

      const io = getIo(req);
      if (io) {
        io.to(`radio:${reqRows[0].broadcast_id}`).emit("radioRequestRejected", {
          broadcastId: reqRows[0].broadcast_id, requestId: req.params.requestId
        });
      }
      res.json({ success: true, message: "Request declined" });
    } catch (err) {
      next(err);
    }
  },

  /* ============================================================
     HOST: QUEUE MANAGEMENT — add directly (bypassing a request),
     reorder, remove, and transport controls (next/previous).
     ============================================================ */
  async getQueue(req, res, next) {
    try {
      const queue = await fetchQueue(req.params.broadcastId);
      const nowPlaying = await fetchNowPlaying(req.params.broadcastId);
      res.json({ success: true, data: { queue, nowPlaying } });
    } catch (err) {
      next(err);
    }
  },

  async addToQueue(req, res, next) {
    try {
      await assertIsHost(req.params.broadcastId, req.user.id);
      const { songId, externalProvider, externalTrackId } = req.body;

      const songRow = await resolveOrCreateSongRow({ songId, externalProvider, externalTrackId });
      if (!songRow) return res.status(400).json({ success: false, message: "songId or external track is required" });

      const position = await nextQueuePosition(req.params.broadcastId);
      await db.query(
        `INSERT INTO radio_queue_items (broadcast_id, song_id, added_by, position, status)
         VALUES ($1, $2, $3, $4, 'queued')`,
        [req.params.broadcastId, songRow.id, req.user.id, position]
      );

      const queue = await fetchQueue(req.params.broadcastId);
      broadcastQueueUpdate(getIo(req), req.params.broadcastId, queue);
      res.status(201).json({ success: true, data: queue });
    } catch (err) {
      next(err);
    }
  },

  async removeFromQueue(req, res, next) {
    try {
      await assertIsHost(req.params.broadcastId, req.user.id);
      await db.query(
        `UPDATE radio_queue_items SET status = 'skipped'
         WHERE id = $1 AND broadcast_id = $2 AND status = 'queued'`,
        [req.params.itemId, req.params.broadcastId]
      );
      const queue = await fetchQueue(req.params.broadcastId);
      broadcastQueueUpdate(getIo(req), req.params.broadcastId, queue);
      res.json({ success: true, data: queue });
    } catch (err) {
      next(err);
    }
  },

  async reorderQueue(req, res, next) {
    try {
      await assertIsHost(req.params.broadcastId, req.user.id);
      const { orderedItemIds } = req.body; // array of radio_queue_items.id in desired order
      if (!Array.isArray(orderedItemIds) || !orderedItemIds.length) {
        return res.status(400).json({ success: false, message: "orderedItemIds array is required" });
      }

      await db.query("BEGIN");
      try {
        for (let i = 0; i < orderedItemIds.length; i++) {
          await db.query(
            `UPDATE radio_queue_items SET position = $1 WHERE id = $2 AND broadcast_id = $3`,
            [i, orderedItemIds[i], req.params.broadcastId]
          );
        }
        await db.query("COMMIT");
      } catch (e) {
        await db.query("ROLLBACK");
        throw e;
      }

      const queue = await fetchQueue(req.params.broadcastId);
      broadcastQueueUpdate(getIo(req), req.params.broadcastId, queue);
      res.json({ success: true, data: queue });
    } catch (err) {
      next(err);
    }
  },

  /* ============================================================
     HOST: TRANSPORT CONTROLS
     ============================================================ */
  async playNext(req, res, next) {
    try {
      await assertIsHost(req.params.broadcastId, req.user.id);

      // Mark whatever's currently playing as played.
      const current = await fetchNowPlaying(req.params.broadcastId);
      if (current?.queue_item_id) {
        await db.query(
          `UPDATE radio_queue_items SET status = 'played', played_at = NOW() WHERE id = $1`,
          [current.queue_item_id]
        );
      }

      const { rows: nextRows } = await db.query(
        `SELECT * FROM radio_queue_items
         WHERE broadcast_id = $1 AND status = 'queued'
         ORDER BY position ASC LIMIT 1`,
        [req.params.broadcastId]
      );

      if (!nextRows.length) {
        await db.query(`DELETE FROM radio_current_playback WHERE broadcast_id = $1`, [req.params.broadcastId]);
        broadcastNowPlaying(getIo(req), req.params.broadcastId, null);
        const queue = await fetchQueue(req.params.broadcastId);
        broadcastQueueUpdate(getIo(req), req.params.broadcastId, queue);
        return res.json({ success: true, data: { nowPlaying: null, message: "Queue is empty" } });
      }

      const next = nextRows[0];
      await db.query(
        `UPDATE radio_queue_items SET status = 'playing' WHERE id = $1`,
        [next.id]
      );
      await db.query(
        `INSERT INTO radio_current_playback (broadcast_id, queue_item_id, song_id, started_at, position_seconds, is_paused)
         VALUES ($1, $2, $3, NOW(), 0, FALSE)
         ON CONFLICT (broadcast_id) DO UPDATE SET
           queue_item_id = EXCLUDED.queue_item_id, song_id = EXCLUDED.song_id,
           started_at = NOW(), position_seconds = 0, is_paused = FALSE, updated_at = NOW()`,
        [req.params.broadcastId, next.id, next.song_id]
      );
      await db.query(`UPDATE radio_songs SET play_count = play_count + 1 WHERE id = $1`, [next.song_id]);

      const nowPlaying = await fetchNowPlaying(req.params.broadcastId);
      const io = getIo(req);
      broadcastNowPlaying(io, req.params.broadcastId, nowPlaying);
      broadcastQueueUpdate(io, req.params.broadcastId, await fetchQueue(req.params.broadcastId));

      res.json({ success: true, data: { nowPlaying } });
    } catch (err) {
      next(err);
    }
  },

  async pausePlayback(req, res, next) {
    try {
      await assertIsHost(req.params.broadcastId, req.user.id);
      await db.query(
        `UPDATE radio_current_playback SET is_paused = TRUE, updated_at = NOW() WHERE broadcast_id = $1`,
        [req.params.broadcastId]
      );
      const nowPlaying = await fetchNowPlaying(req.params.broadcastId);
      broadcastNowPlaying(getIo(req), req.params.broadcastId, nowPlaying);
      res.json({ success: true, data: { nowPlaying } });
    } catch (err) {
      next(err);
    }
  },

  async resumePlayback(req, res, next) {
    try {
      await assertIsHost(req.params.broadcastId, req.user.id);
      await db.query(
        `UPDATE radio_current_playback SET is_paused = FALSE, updated_at = NOW() WHERE broadcast_id = $1`,
        [req.params.broadcastId]
      );
      const nowPlaying = await fetchNowPlaying(req.params.broadcastId);
      broadcastNowPlaying(getIo(req), req.params.broadcastId, nowPlaying);
      res.json({ success: true, data: { nowPlaying } });
    } catch (err) {
      next(err);
    }
  }
};

module.exports = SongRequestController;