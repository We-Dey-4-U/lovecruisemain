// backend/src/services/musicProviders/JamendoProvider.js
//
// "Option 2" from the spec — a licensed/royalty-free external
// catalog. Jamendo is used here as the reference implementation
// because it has a free, well-documented public API
// (https://developer.jamendo.com) that's a realistic starting
// point; the exact same pattern (implement MusicProviderInterface,
// cache into music_provider_cache, register in index.js) is how
// you'd wire up 7digital, Free Music Archive, or ccMixter later
// without touching any controller or socket code.
//
// Requires env var: JAMENDO_CLIENT_ID
// (register a free client id at https://devportal.jamendo.com)

const db = require("../../config/db");
const MusicProviderInterface = require("./MusicProviderInterface");

const JAMENDO_API_BASE = "https://api.jamendo.com/v3.0";
const CACHE_TTL_HOURS = 6; // Jamendo stream URLs are long-lived, but we refresh periodically anyway

function requireClientId() {
  const clientId = process.env.JAMENDO_CLIENT_ID;
  if (!clientId) {
    throw new Error(
      "JAMENDO_CLIENT_ID is not set — external music search is unavailable until it's configured"
    );
  }
  return clientId;
}

function toSongShapeFromJamendoTrack(track) {
  return {
    id: track.id,
    source: "external",
    provider: "jamendo",
    title: track.name,
    artist: track.artist_name,
    album: track.album_name || null,
    genre: (track.musicinfo?.tags?.genres || [])[0] || null,
    durationSeconds: track.duration || 0,
    coverUrl: track.image || null,
    streamUrl: track.audio || null,        // full-length, licensed for streaming
    previewUrl: track.audiodownload || track.audio || null,
    isLicensedExternal: true
  };
}

function toSongShapeFromCacheRow(row) {
  return {
    id: row.external_track_id,
    source: "external",
    provider: "jamendo",
    title: row.title,
    artist: row.artist,
    album: row.album,
    genre: row.genre,
    durationSeconds: row.duration_seconds,
    coverUrl: row.cover_url,
    streamUrl: row.stream_url,
    previewUrl: row.preview_url,
    isLicensedExternal: true
  };
}

async function cacheTrack(shape) {
  try {
    await db.query(
      `INSERT INTO music_provider_cache
         (provider, external_track_id, title, artist, album, genre,
          duration_seconds, stream_url, preview_url, cover_url, raw_metadata,
          cached_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, NOW(), NOW() + ($12 || ' hours')::interval)
       ON CONFLICT (provider, external_track_id) DO UPDATE SET
         title = EXCLUDED.title, artist = EXCLUDED.artist, album = EXCLUDED.album,
         genre = EXCLUDED.genre, duration_seconds = EXCLUDED.duration_seconds,
         stream_url = EXCLUDED.stream_url, preview_url = EXCLUDED.preview_url,
         cover_url = EXCLUDED.cover_url, raw_metadata = EXCLUDED.raw_metadata,
         cached_at = NOW(), expires_at = NOW() + ($12 || ' hours')::interval`,
      [
        "jamendo", shape.id, shape.title, shape.artist, shape.album, shape.genre,
        shape.durationSeconds, shape.streamUrl, shape.previewUrl, shape.coverUrl,
        JSON.stringify(shape), CACHE_TTL_HOURS
      ]
    );
  } catch (err) {
    console.warn("[JamendoProvider.cacheTrack] cache write skipped:", err.message);
  }
}

async function getCachedTrack(externalId) {
  const { rows } = await db.query(
    `SELECT * FROM music_provider_cache
     WHERE provider = 'jamendo' AND external_track_id = $1
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [externalId]
  );
  return rows[0] ? toSongShapeFromCacheRow(rows[0]) : null;
}

class JamendoProvider extends MusicProviderInterface {

  async searchSongs(query, opts = {}) {
    const clientId = requireClientId();
    const { genre, page = 1, pageSize = 30 } = opts;

    const params = new URLSearchParams({
      client_id: clientId,
      format: "json",
      limit: String(Math.min(Number(pageSize) || 30, 50)),
      offset: String((Math.max(Number(page) || 1, 1) - 1) * (Number(pageSize) || 30)),
      include: "musicinfo"
    });
    if (query && query.trim()) params.set("search", query.trim());
    if (genre) params.set("tags", genre);

    const res = await fetch(`${JAMENDO_API_BASE}/tracks/?${params.toString()}`);
    if (!res.ok) {
      throw new Error(`Jamendo search failed: HTTP ${res.status}`);
    }
    const data = await res.json();
    const tracks = (data.results || []).map(toSongShapeFromJamendoTrack);

    // Cache in the background so a follow-up "queue this track" call
    // doesn't need to hit the provider again.
    tracks.forEach(t => cacheTrack(t).catch(() => {}));

    return tracks;
  }

  async getSong(externalId) {
    const cached = await getCachedTrack(externalId);
    if (cached) return cached;

    const clientId = requireClientId();
    const params = new URLSearchParams({
      client_id: clientId,
      format: "json",
      id: externalId,
      include: "musicinfo"
    });
    const res = await fetch(`${JAMENDO_API_BASE}/tracks/?${params.toString()}`);
    if (!res.ok) throw new Error(`Jamendo lookup failed: HTTP ${res.status}`);

    const data = await res.json();
    const track = (data.results || [])[0];
    if (!track) return null;

    const shape = toSongShapeFromJamendoTrack(track);
    await cacheTrack(shape);
    return shape;
  }

  async streamSong(externalId) {
    const song = await this.getSong(externalId);
    if (!song) throw new Error("Track not found");
    if (!song.streamUrl) throw new Error("Track has no playable stream");
    // Jamendo stream URLs don't expire quickly in practice, but we
    // still surface an expiry hint driven by our own cache TTL so the
    // queue system knows when it's safe to just reuse vs re-fetch.
    return {
      streamUrl: song.streamUrl,
      expiresAt: new Date(Date.now() + CACHE_TTL_HOURS * 3600 * 1000)
    };
  }

  async getPlaylist() {
    // Jamendo playlists are a further API surface not needed for MVP —
    // stubbed so the interface contract is satisfied and callers get a
    // clear, explicit error instead of a silent no-op.
    throw new Error("Jamendo playlist browsing is not implemented yet");
  }

  async getGenres() {
    // Jamendo doesn't have a clean "list all genres" endpoint; this is
    // a practical, commonly-used tag subset. Swap for a real taxonomy
    // call if/when needed.
    return [
      { key: "pop", label: "Pop" },
      { key: "rock", label: "Rock" },
      { key: "electronic", label: "Electronic" },
      { key: "hiphop", label: "Hip-Hop" },
      { key: "jazz", label: "Jazz" },
      { key: "classical", label: "Classical" },
      { key: "lounge", label: "Lounge" },
      { key: "world", label: "World" }
    ];
  }
}

module.exports = new JamendoProvider();