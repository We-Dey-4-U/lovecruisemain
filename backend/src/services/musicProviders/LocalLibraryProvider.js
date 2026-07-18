// backend/src/services/musicProviders/LocalLibraryProvider.js
//
// "Option 1" from the spec — songs the host has uploaded themselves
// (radio_songs where source = 'upload'). This is the default
// provider and requires no external API keys.

const db = require("../../config/db");
const MusicProviderInterface = require("./MusicProviderInterface");

function toSongShape(row) {
  return {
    id: row.id,
    source: "upload",
    provider: "local",
    title: row.title,
    artist: row.artist,
    album: row.album,
    genre: row.genre,
    durationSeconds: row.duration_seconds,
    coverUrl: row.cover_url,
    streamUrl: row.file_url,
    previewUrl: null,
    isLicensedExternal: false,
    status: row.status,
    uploaderId: row.uploader_id,
    stationId: row.station_id,
    playCount: row.play_count,
    likeCount: row.like_count,
    createdAt: row.created_at
  };
}

class LocalLibraryProvider extends MusicProviderInterface {

  async searchSongs(query, opts = {}) {
    const { genre, page = 1, pageSize = 30, requesterId, stationId } = opts;
    const conditions = [`source = 'upload'`, `status = 'ready'`];
    const params = [];

    if (query && query.trim()) {
      params.push(query.trim());
      conditions.push(
        `to_tsvector('english', title || ' ' || coalesce(artist,'') || ' ' || coalesce(album,'')) @@ plainto_tsquery('english', $${params.length})`
      );
    }
    if (genre) {
      params.push(genre);
      conditions.push(`genre = $${params.length}`);
    }
    if (stationId) {
      params.push(stationId);
      conditions.push(`station_id = $${params.length}`);
    } else if (requesterId) {
      // No station specified — scope to the requester's own uploads.
      params.push(requesterId);
      conditions.push(`uploader_id = $${params.length}`);
    }

    const limit = Math.min(Number(pageSize) || 30, 100);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;
    params.push(limit, offset);

    const { rows } = await db.query(
      `SELECT * FROM radio_songs
       WHERE ${conditions.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return rows.map(toSongShape);
  }

  async getSong(id) {
    const { rows } = await db.query(`SELECT * FROM radio_songs WHERE id = $1`, [id]);
    return rows[0] ? toSongShape(rows[0]) : null;
  }

  async streamSong(id) {
    const song = await this.getSong(id);
    if (!song) throw new Error("Song not found");
    if (song.status !== "ready" || !song.streamUrl) {
      throw new Error("Song is still processing — try again shortly");
    }
    // Local S3 URLs are long-lived / public-read, so no expiry to track.
    return { streamUrl: song.streamUrl, expiresAt: null };
  }

  async getPlaylist(playlistId) {
    const { rows: plRows } = await db.query(
      `SELECT id, name FROM radio_playlists WHERE id = $1`,
      [playlistId]
    );
    if (!plRows.length) return null;

    const { rows: songRows } = await db.query(
      `SELECT s.* FROM radio_playlist_songs ps
       JOIN radio_songs s ON s.id = ps.song_id
       WHERE ps.playlist_id = $1
       ORDER BY ps.sort_order ASC`,
      [playlistId]
    );

    return { id: plRows[0].id, name: plRows[0].name, songs: songRows.map(toSongShape) };
  }

  async getGenres() {
    const { rows } = await db.query(
      `SELECT DISTINCT genre FROM radio_songs
       WHERE source = 'upload' AND genre IS NOT NULL AND genre <> ''
       ORDER BY genre ASC`
    );
    return rows.map(r => ({ key: r.genre, label: r.genre }));
  }
}

module.exports = new LocalLibraryProvider();
module.exports.toSongShape = toSongShape;