// backend/src/controllers/musicLibraryController.js
//
// This controller is what backend/src/routes/musicLibrary.routes.js
// points to for every /radio/music-library/* endpoint — including
// POST /songs/upload, which is the actual upload entry point used by
// radio-room.html's "Upload" tab. It was missing from the codebase
// entirely (referenced by the router, never implemented), which is
// why audio upload silently failed: Express would throw
// "Route.post() requires a callback function but got a [object
// Undefined]" at boot, or 500 at request time depending on how it
// failed to resolve.
//
// Upload flow, matching what radio-room.html already expects:
//   1. multer (audioUpload middleware, diskStorage) saves the raw
//      file to a temp path and populates req.file.
//   2. We insert a radio_songs row immediately with status
//      'processing' and respond 201 right away — the client's
//      pollUploadStatus() then polls GET /songs/:id every 3s.
//   3. In the background we run audioProcessingService
//      .processUploadedSong() (ffprobe -> transcode/normalize ->
//      extract cover art -> upload to Appwrite), then update the row
//      to status 'ready' with the final file_url/cover_url/duration.
//   4. On any failure the row flips to status 'failed' so the client
//      polling loop stops cleanly instead of spinning forever.
//   5. The raw temp file multer wrote to disk is always deleted,
//      success or failure — audioProcessingService cleans up its own
//      intermediate temp files internally.

const fs = require("fs");
const db = require("../config/db");
const { getProvider, listProviderKeys } = require("../services/musicProviders");

function safeUnlink(p) {
  if (!p) return;
  fs.unlink(p, () => {});
}

// ── LAZY-LOAD audioProcessingService ──
// audioProcessingService.js requires fluent-ffmpeg / @ffmpeg-installer/
// @ffprobe-installer — native/optional dependencies. If those aren't
// installed on the server, `require`-ing them at the TOP of this file
// (or anywhere that runs at app boot, like the routes file importing
// this controller) throws MODULE_NOT_FOUND and crashes the ENTIRE
// Node process before it ever binds a port — which takes down every
// socket.io connection app-wide, not just uploads. Loading it lazily,
// only inside the one handler that actually needs it, means a missing
// package degrades to "uploads return 503" instead of "the whole app
// is down."
let _audioProcessingService = null;
let _audioProcessingLoadError = null;
function getAudioProcessingService() {
  if (_audioProcessingService) return _audioProcessingService;
  if (_audioProcessingLoadError) throw _audioProcessingLoadError;
  try {
    _audioProcessingService = require("../services/audioProcessingService");
    return _audioProcessingService;
  } catch (err) {
    console.error(
      "[musicLibraryController] audioProcessingService failed to load — " +
      "run `npm install fluent-ffmpeg @ffmpeg-installer/ffmpeg @ffprobe-installer/ffprobe` " +
      "on the server. Audio upload will return 503 until this is fixed. ❌",
      err.message
    );
    _audioProcessingLoadError = err;
    throw err;
  }
}

const MusicLibraryController = {

  /* ============================================================
     UPLOAD A SONG (host's own library)
     ============================================================ */
  async uploadSong(req, res, next) {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "Audio file is required" });
    }

    let audioService;
    try {
      audioService = getAudioProcessingService();
    } catch (err) {
      safeUnlink(req.file.path);
      return res.status(503).json({
        success: false,
        message: "Audio processing isn't available on the server right now — try again shortly"
      });
    }

    const { title, artist, album, genre, stationId } = req.body;
    if (!title || !title.trim()) {
      safeUnlink(req.file.path);
      return res.status(400).json({ success: false, message: "Song title is required" });
    }

    let song;
    try {
      // If a stationId is supplied, confirm the uploader actually owns it —
      // otherwise scope the song to just the uploader (no station).
      let confirmedStationId = null;
      if (stationId) {
        const { rows: stationRows } = await db.query(
          `SELECT id FROM radio_stations WHERE id = $1 AND host_id = $2`,
          [stationId, req.user.id]
        );
        confirmedStationId = stationRows.length ? stationId : null;
      }

      const { rows } = await db.query(
        `INSERT INTO radio_songs
           (title, artist, album, genre, source, status, uploader_id, station_id)
         VALUES ($1, $2, $3, $4, 'upload', 'processing', $5, $6)
         RETURNING *`,
        [title.trim(), artist || null, album || null, genre || null, req.user.id, confirmedStationId]
      );
      song = rows[0];
    } catch (err) {
      safeUnlink(req.file.path);
      return next(err);
    }

    // Respond immediately so the client can start polling — processing
    // (ffmpeg transcode/loudness-normalize) can take real time.
    res.status(201).json({ success: true, data: song });

    // Process in the background; the HTTP response above is already sent.
    const tempPath = req.file.path;
    const originalName = req.file.originalname;

    audioService.processUploadedSong(tempPath, originalName, song.id)
      .then(async (result) => {
        await db.query(
          `UPDATE radio_songs SET
             file_url         = $2,
             file_id          = $3,
             cover_url        = COALESCE(cover_url, $4),
             cover_file_id    = COALESCE(cover_file_id, $5),
             duration_seconds = $6,
             artist           = COALESCE(artist, $7),
             album            = COALESCE(album, $8),
             genre            = COALESCE(genre, $9),
             status           = 'ready',
             updated_at       = NOW()
           WHERE id = $1`,
          [
            song.id,
            result.fileUrl,
            result.fileId,
            result.coverUrl,
            result.coverFileId,
            result.durationSeconds,
            result.suggestedArtist,
            result.suggestedAlbum,
            result.suggestedGenre
          ]
        );
      })
      .catch(async (err) => {
        console.error(`[uploadSong] processing failed for song ${song.id} ❌`, err);
        try {
          await db.query(`UPDATE radio_songs SET status = 'failed', updated_at = NOW() WHERE id = $1`, [song.id]);
        } catch (e) {
          console.error("[uploadSong] couldn't mark song as failed:", e.message);
        }
      })
      .finally(() => {
        safeUnlink(tempPath);
      });
  },

  /* ============================================================
     GET / UPDATE / DELETE
     ============================================================ */
  async getSong(req, res, next) {
    try {
      const { rows } = await db.query(`SELECT * FROM radio_songs WHERE id = $1`, [req.params.id]);
      if (!rows.length) return res.status(404).json({ success: false, message: "Song not found" });
      res.json({ success: true, data: rows[0] });
    } catch (err) {
      next(err);
    }
  },

  async updateSong(req, res, next) {
    try {
      const { title, artist, album, genre } = req.body;
      const { rows } = await db.query(
        `UPDATE radio_songs SET
           title  = COALESCE($3, title),
           artist = COALESCE($4, artist),
           album  = COALESCE($5, album),
           genre  = COALESCE($6, genre),
           updated_at = NOW()
         WHERE id = $1 AND uploader_id = $2
         RETURNING *`,
        [req.params.id, req.user.id, title, artist, album, genre]
      );
      if (!rows.length) {
        return res.status(403).json({ success: false, message: "Not authorized or song not found" });
      }
      res.json({ success: true, data: rows[0] });
    } catch (err) {
      next(err);
    }
  },

  async deleteSong(req, res, next) {
    try {
      const { rows } = await db.query(
        `DELETE FROM radio_songs WHERE id = $1 AND uploader_id = $2 RETURNING id`,
        [req.params.id, req.user.id]
      );
      if (!rows.length) {
        return res.status(403).json({ success: false, message: "Not authorized or song not found" });
      }
      res.json({ success: true, message: "Song deleted" });
    } catch (err) {
      next(err);
    }
  },

  async likeSong(req, res, next) {
    try {
      await db.query(
        `INSERT INTO radio_song_likes (song_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [req.params.id, req.user.id]
      );
      await db.query(`UPDATE radio_songs SET like_count = like_count + 1 WHERE id = $1`, [req.params.id]).catch(() => {});
      res.status(201).json({ success: true, message: "Song liked" });
    } catch (err) {
      next(err);
    }
  },

  async unlikeSong(req, res, next) {
    try {
      await db.query(`DELETE FROM radio_song_likes WHERE song_id = $1 AND user_id = $2`, [req.params.id, req.user.id]);
      await db.query(`UPDATE radio_songs SET like_count = GREATEST(like_count - 1, 0) WHERE id = $1`, [req.params.id]).catch(() => {});
      res.json({ success: true, message: "Song unliked" });
    } catch (err) {
      next(err);
    }
  },

  /* ============================================================
     SEARCH / METADATA — across local + external providers
     ============================================================ */
  async searchSongs(req, res, next) {
    try {
      const { q, provider = "local", genre, page, pageSize, stationId } = req.query;
      const impl = getProvider(provider);
      const results = await impl.searchSongs(q || "", {
        genre,
        page: page ? Number(page) : undefined,
        pageSize: pageSize ? Number(pageSize) : undefined,
        requesterId: req.user.id,
        stationId: stationId || undefined
      });
      res.json({ success: true, data: results });
    } catch (err) {
      // External providers can throw on misconfiguration (e.g. missing
      // JAMENDO_CLIENT_ID) — surface that as a clean 400 rather than 500.
      res.status(400).json({ success: false, message: err.message });
    }
  },

  async listGenres(req, res, next) {
    try {
      const provider = req.query.provider || "local";
      const impl = getProvider(provider);
      const genres = await impl.getGenres();
      res.json({ success: true, data: genres });
    } catch (err) {
      next(err);
    }
  },

  async listAvailableProviders(req, res, next) {
    try {
      res.json({ success: true, data: listProviderKeys() });
    } catch (err) {
      next(err);
    }
  },

  /* ============================================================
     PLAYLISTS
     ============================================================ */
  async createPlaylist(req, res, next) {
    try {
      const { name } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ success: false, message: "Playlist name is required" });
      }
      const { rows } = await db.query(
        `INSERT INTO radio_playlists (owner_id, name) VALUES ($1, $2) RETURNING *`,
        [req.user.id, name.trim()]
      );
      res.status(201).json({ success: true, data: rows[0] });
    } catch (err) {
      next(err);
    }
  },

  async listPlaylists(req, res, next) {
    try {
      const { rows } = await db.query(
        `SELECT * FROM radio_playlists WHERE owner_id = $1 ORDER BY created_at DESC`,
        [req.user.id]
      );
      res.json({ success: true, data: rows });
    } catch (err) {
      next(err);
    }
  },

  async getPlaylist(req, res, next) {
    try {
      const impl = getProvider("local");
      const playlist = await impl.getPlaylist(req.params.id);
      if (!playlist) return res.status(404).json({ success: false, message: "Playlist not found" });
      res.json({ success: true, data: playlist });
    } catch (err) {
      next(err);
    }
  },

  async addSongToPlaylist(req, res, next) {
    try {
      const { songId } = req.body;
      if (!songId) return res.status(400).json({ success: false, message: "songId is required" });

      const { rows: plRows } = await db.query(
        `SELECT id FROM radio_playlists WHERE id = $1 AND owner_id = $2`,
        [req.params.id, req.user.id]
      );
      if (!plRows.length) return res.status(403).json({ success: false, message: "Not authorized or playlist not found" });

      const { rows: posRows } = await db.query(
        `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM radio_playlist_songs WHERE playlist_id = $1`,
        [req.params.id]
      );

      await db.query(
        `INSERT INTO radio_playlist_songs (playlist_id, song_id, sort_order)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [req.params.id, songId, posRows[0].next_order]
      );

      res.status(201).json({ success: true, message: "Added to playlist" });
    } catch (err) {
      next(err);
    }
  },

  async removeSongFromPlaylist(req, res, next) {
    try {
      const { rows: plRows } = await db.query(
        `SELECT id FROM radio_playlists WHERE id = $1 AND owner_id = $2`,
        [req.params.id, req.user.id]
      );
      if (!plRows.length) return res.status(403).json({ success: false, message: "Not authorized or playlist not found" });

      await db.query(
        `DELETE FROM radio_playlist_songs WHERE playlist_id = $1 AND song_id = $2`,
        [req.params.id, req.params.songId]
      );
      res.json({ success: true, message: "Removed from playlist" });
    } catch (err) {
      next(err);
    }
  }
};

module.exports = MusicLibraryController;