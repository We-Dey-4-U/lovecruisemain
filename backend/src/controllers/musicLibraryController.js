// backend/src/controllers/musicLibraryController.js
//
// Music Library Module (Option 1: host uploads) + the search
// entry-point into Option 2 (external licensed providers), via
// the MusicProviderInterface registry. This controller never
// talks to S3/FFmpeg directly — that's audioProcessingService's
// job — and never talks to a specific external API directly —
// that's each provider's job. It only orchestrates.

const fs = require("fs");
const db = require("../config/db");
const audioProcessingService = require("../services/audioProcessingService");
const { getProvider, listProviderKeys } = require("../services/musicProviders");

const MusicLibraryController = {

  /* ============================================================
     UPLOAD A SONG
     multer (configured in the route) puts the raw file on disk at
     req.file.path — this handler creates a 'processing' row
     immediately so the UI can show progress, then kicks off FFmpeg
     processing, then flips the row to 'ready' or 'failed'.
     ============================================================ */
  async uploadSong(req, res, next) {
    let dbRow = null;
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: "Audio file is required" });
      }
      const { title, artist, album, genre, stationId } = req.body;
      if (!title || !title.trim()) {
        return res.status(400).json({ success: false, message: "Song title is required" });
      }

      if (stationId) {
        const { rows } = await db.query(
          `SELECT id FROM radio_stations WHERE id = $1 AND host_id = $2`,
          [stationId, req.user.id]
        );
        if (!rows.length) {
          return res.status(403).json({ success: false, message: "Not authorized for this station" });
        }
      }

      const { rows: insertRows } = await db.query(
        `INSERT INTO radio_songs
           (uploader_id, station_id, title, artist, album, genre, source, status, original_file_url)
         VALUES ($1, $2, $3, $4, $5, $6, 'upload', 'processing', NULL)
         RETURNING *`,
        [req.user.id, stationId || null, title.trim(), artist || null, album || null, genre || null]
      );
      dbRow = insertRows[0];

      // Respond immediately with the "processing" row — the client
      // polls GET /music-library/songs/:id or listens for a socket
      // event to know when it flips to "ready". Processing (FFmpeg
      // transcode + S3 upload) can take several seconds for longer
      // tracks and shouldn't block the HTTP response.
      res.status(202).json({ success: true, data: dbRow });

      audioProcessingService
        .processUploadedSong(req.file.path, req.file.originalname, dbRow.id)
        .then(async (result) => {
          await db.query(
            `UPDATE radio_songs SET
               status = 'ready',
               file_url = $2,
               cover_url = COALESCE($3, cover_url),
               duration_seconds = $4,
               artist = COALESCE(artist, $5),
               album = COALESCE(album, $6),
               genre = COALESCE(genre, $7)
             WHERE id = $1`,
            [
              dbRow.id, result.fileUrl, result.coverUrl, result.durationSeconds,
              result.suggestedArtist, result.suggestedAlbum, result.suggestedGenre
            ]
          );
        })
        .catch(async (err) => {
          console.error("[uploadSong] processing failed:", err);
          await db.query(
            `UPDATE radio_songs SET status = 'failed', processing_error = $2 WHERE id = $1`,
            [dbRow.id, err.message]
          ).catch(() => {});
        })
        .finally(() => {
          fs.unlink(req.file.path, () => {});
        });
    } catch (err) {
      if (req.file?.path) fs.unlink(req.file.path, () => {});
      next(err);
    }
  },

  /* ============================================================
     GET SONG (for polling processing status)
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

  /* ============================================================
     UPDATE SONG METADATA
     ============================================================ */
  async updateSong(req, res, next) {
    try {
      const { title, artist, album, genre } = req.body;
      const { rows } = await db.query(
        `UPDATE radio_songs SET
           title  = COALESCE($3, title),
           artist = COALESCE($4, artist),
           album  = COALESCE($5, album),
           genre  = COALESCE($6, genre)
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

  /* ============================================================
     DELETE SONG
     ============================================================ */
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

  /* ============================================================
     SEARCH — unified across the local library and any external
     provider. ?provider=local (default) | jamendo | ...
     ============================================================ */
  async searchSongs(req, res, next) {
    try {
      const { q, genre, provider = "local", page, pageSize, stationId } = req.query;

      const musicProvider = getProvider(provider);
      const results = await musicProvider.searchSongs(q || "", {
        genre,
        page,
        pageSize,
        requesterId: req.user.id,
        stationId
      });

      res.json({ success: true, data: results, provider });
    } catch (err) {
      next(err);
    }
  },

  async listGenres(req, res, next) {
    try {
      const { provider = "local" } = req.query;
      const musicProvider = getProvider(provider);
      const genres = await musicProvider.getGenres();
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
      const { name, stationId } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ success: false, message: "Playlist name is required" });
      }
      const { rows } = await db.query(
        `INSERT INTO radio_playlists (host_id, station_id, name) VALUES ($1, $2, $3) RETURNING *`,
        [req.user.id, stationId || null, name.trim()]
      );
      res.status(201).json({ success: true, data: rows[0] });
    } catch (err) {
      next(err);
    }
  },

  async listPlaylists(req, res, next) {
    try {
      const { rows } = await db.query(
        `SELECT p.*, COUNT(ps.song_id)::int AS song_count
         FROM radio_playlists p
         LEFT JOIN radio_playlist_songs ps ON ps.playlist_id = p.id
         WHERE p.host_id = $1
         GROUP BY p.id
         ORDER BY p.updated_at DESC`,
        [req.user.id]
      );
      res.json({ success: true, data: rows });
    } catch (err) {
      next(err);
    }
  },

  async getPlaylist(req, res, next) {
    try {
      const localProvider = getProvider("local");
      const playlist = await localProvider.getPlaylist(req.params.id);
      if (!playlist) return res.status(404).json({ success: false, message: "Playlist not found" });
      res.json({ success: true, data: playlist });
    } catch (err) {
      next(err);
    }
  },

  async addSongToPlaylist(req, res, next) {
    try {
      const { songId } = req.body;
      const { rows: plRows } = await db.query(
        `SELECT id FROM radio_playlists WHERE id = $1 AND host_id = $2`,
        [req.params.id, req.user.id]
      );
      if (!plRows.length) {
        return res.status(403).json({ success: false, message: "Not authorized for this playlist" });
      }

      const { rows: maxRows } = await db.query(
        `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order
         FROM radio_playlist_songs WHERE playlist_id = $1`,
        [req.params.id]
      );

      await db.query(
        `INSERT INTO radio_playlist_songs (playlist_id, song_id, sort_order)
         VALUES ($1, $2, $3) ON CONFLICT (playlist_id, song_id) DO NOTHING`,
        [req.params.id, songId, maxRows[0].next_order]
      );

      res.status(201).json({ success: true, message: "Added to playlist" });
    } catch (err) {
      next(err);
    }
  },

  async removeSongFromPlaylist(req, res, next) {
    try {
      const { rows: plRows } = await db.query(
        `SELECT id FROM radio_playlists WHERE id = $1 AND host_id = $2`,
        [req.params.id, req.user.id]
      );
      if (!plRows.length) {
        return res.status(403).json({ success: false, message: "Not authorized for this playlist" });
      }
      await db.query(
        `DELETE FROM radio_playlist_songs WHERE playlist_id = $1 AND song_id = $2`,
        [req.params.id, req.params.songId]
      );
      res.json({ success: true, message: "Removed from playlist" });
    } catch (err) {
      next(err);
    }
  },

  /* ============================================================
     LIKE / UNLIKE
     ============================================================ */
  async likeSong(req, res, next) {
    try {
      await db.query(
        `INSERT INTO radio_song_likes (song_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [req.params.id, req.user.id]
      );
      res.status(201).json({ success: true, message: "Liked" });
    } catch (err) {
      next(err);
    }
  },

  async unlikeSong(req, res, next) {
    try {
      await db.query(
        `DELETE FROM radio_song_likes WHERE song_id = $1 AND user_id = $2`,
        [req.params.id, req.user.id]
      );
      res.json({ success: true, message: "Unliked" });
    } catch (err) {
      next(err);
    }
  }
};

module.exports = MusicLibraryController;