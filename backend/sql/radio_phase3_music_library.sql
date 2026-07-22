-- ============================================================
-- 📻 Lovecruise Radio — Phase 3: Music Library + Song Request
--    + Queue + Provider Cache + Analytics
-- ------------------------------------------------------------
-- Builds on top of the Phase 1/2 radio schema already in your
-- database (radio_stations, radio_broadcasts, radio_categories,
-- radio_song_requests, etc). Does NOT touch or rename anything
-- that already exists — only adds new tables + extends
-- radio_song_requests with backward-compatible columns.
--
-- Safe to re-run (IF NOT EXISTS everywhere).
-- Run with: psql "$DATABASE_URL" -f migrations/radio_phase3_music_library.sql
-- ============================================================

BEGIN;

-- ============================================================
-- 1. SONGS — the actual audio library. A song can come from a
--    host's own upload ("upload") or be a cached reference to
--    an external licensed provider ("external"). Either way it
--    has one consistent shape so the queue/request system never
--    needs to know which source a song came from.
-- ============================================================

CREATE TABLE IF NOT EXISTS radio_songs (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    uploader_id        UUID REFERENCES users(id) ON DELETE CASCADE,   -- NULL for external-provider songs
    station_id         UUID REFERENCES radio_stations(id) ON DELETE CASCADE, -- NULL = personal library, not station-scoped
    title              VARCHAR(200) NOT NULL,
    artist             VARCHAR(200),
    album              VARCHAR(200),
    genre              VARCHAR(80),
    duration_seconds   INT NOT NULL DEFAULT 0,
    file_url           TEXT,               -- processed/normalized audio file (S3) — NULL until 'ready'
    original_file_url  TEXT,               -- pre-processing upload, kept for reprocessing/audit
    cover_url          TEXT,
    source             VARCHAR(20) NOT NULL DEFAULT 'upload'
                       CHECK (source IN ('upload', 'external')),
    external_provider  VARCHAR(40),        -- e.g. 'jamendo', '7digital', 'fma' — NULL for uploads
    external_track_id  VARCHAR(150),       -- provider's own track id — NULL for uploads
    status             VARCHAR(20) NOT NULL DEFAULT 'ready'
                       CHECK (status IN ('processing', 'ready', 'failed')),
    processing_error   TEXT,
    play_count         BIGINT NOT NULL DEFAULT 0,
    like_count         INT NOT NULL DEFAULT 0,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- An external track is unique per provider+external id so we never
    -- duplicate the same licensed track when different listeners/hosts
    -- pull it in independently.
    UNIQUE (external_provider, external_track_id)
);

CREATE TABLE IF NOT EXISTS radio_song_likes (
    song_id    UUID NOT NULL REFERENCES radio_songs(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (song_id, user_id)
);

CREATE OR REPLACE FUNCTION trg_radio_song_like_count() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE radio_songs SET like_count = like_count + 1 WHERE id = NEW.song_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE radio_songs SET like_count = GREATEST(like_count - 1, 0) WHERE id = OLD.song_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_radio_song_likes_ins ON radio_song_likes;
CREATE TRIGGER trg_radio_song_likes_ins AFTER INSERT ON radio_song_likes
  FOR EACH ROW EXECUTE FUNCTION trg_radio_song_like_count();

DROP TRIGGER IF EXISTS trg_radio_song_likes_del ON radio_song_likes;
CREATE TRIGGER trg_radio_song_likes_del AFTER DELETE ON radio_song_likes
  FOR EACH ROW EXECUTE FUNCTION trg_radio_song_like_count();

-- ============================================================
-- 2. PLAYLISTS — a host's personal or station-scoped ordered
--    collection of songs. Independent of any single broadcast.
-- ============================================================

CREATE TABLE IF NOT EXISTS radio_playlists (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    host_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    station_id UUID REFERENCES radio_stations(id) ON DELETE CASCADE,
    name       VARCHAR(150) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS radio_playlist_songs (
    playlist_id UUID NOT NULL REFERENCES radio_playlists(id) ON DELETE CASCADE,
    song_id     UUID NOT NULL REFERENCES radio_songs(id) ON DELETE CASCADE,
    sort_order  INT NOT NULL DEFAULT 0,
    added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (playlist_id, song_id)
);

-- ============================================================
-- 3. SONG REQUESTS — extend the EXISTING radio_song_requests
--    table (Phase 1) rather than replacing it. The original
--    table only supported freeform "song name / artist name"
--    text requests (no library). We add an optional song_id so
--    a request can point at a real library/external track, plus
--    a vote counter and an approver/queue link.
-- ============================================================

ALTER TABLE radio_song_requests
  ADD COLUMN IF NOT EXISTS song_id       UUID REFERENCES radio_songs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vote_count    INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS responded_by  UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS responded_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS queue_item_id UUID;   -- FK added after radio_queue_items exists below

CREATE TABLE IF NOT EXISTS radio_song_request_votes (
    request_id UUID NOT NULL REFERENCES radio_song_requests(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (request_id, user_id)
);

CREATE OR REPLACE FUNCTION trg_radio_request_vote_count() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE radio_song_requests SET vote_count = vote_count + 1 WHERE id = NEW.request_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE radio_song_requests SET vote_count = GREATEST(vote_count - 1, 0) WHERE id = OLD.request_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_radio_request_votes_ins ON radio_song_request_votes;
CREATE TRIGGER trg_radio_request_votes_ins AFTER INSERT ON radio_song_request_votes
  FOR EACH ROW EXECUTE FUNCTION trg_radio_request_vote_count();

DROP TRIGGER IF EXISTS trg_radio_request_votes_del ON radio_song_request_votes;
CREATE TRIGGER trg_radio_request_votes_del AFTER DELETE ON radio_song_request_votes
  FOR EACH ROW EXECUTE FUNCTION trg_radio_request_vote_count();

-- ============================================================
-- 4. QUEUE — the host's live play queue for a broadcast. This is
--    the single source of truth for "what plays next." Approved
--    requests, playlist tracks, and host-added library songs all
--    land here as queue items.
-- ============================================================

CREATE TABLE IF NOT EXISTS radio_queue_items (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    broadcast_id  UUID NOT NULL REFERENCES radio_broadcasts(id) ON DELETE CASCADE,
    song_id       UUID NOT NULL REFERENCES radio_songs(id) ON DELETE CASCADE,
    added_by      UUID REFERENCES users(id),          -- host who queued it, or NULL if auto-added from an approved request
    requested_by  UUID REFERENCES users(id),           -- listener who originally requested it, if any
    request_id    UUID REFERENCES radio_song_requests(id) ON DELETE SET NULL,
    position       INT NOT NULL DEFAULT 0,
    status        VARCHAR(20) NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued', 'playing', 'played', 'skipped')),
    added_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    played_at     TIMESTAMPTZ
);

ALTER TABLE radio_song_requests
  ADD CONSTRAINT fk_radio_song_requests_queue_item
  FOREIGN KEY (queue_item_id) REFERENCES radio_queue_items(id) ON DELETE SET NULL;

-- One row per broadcast describing exactly what's on air right now,
-- and at what playback offset — lets a listener who joins mid-song
-- resume in sync instead of starting the track from zero.
CREATE TABLE IF NOT EXISTS radio_current_playback (
    broadcast_id     UUID PRIMARY KEY REFERENCES radio_broadcasts(id) ON DELETE CASCADE,
    queue_item_id    UUID REFERENCES radio_queue_items(id) ON DELETE SET NULL,
    song_id          UUID REFERENCES radio_songs(id),
    started_at       TIMESTAMPTZ,
    position_seconds INT NOT NULL DEFAULT 0,
    is_paused        BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 5. EXTERNAL PROVIDER CACHE — search results / track metadata
--    pulled from licensed providers (Jamendo, 7digital, FMA,
--    ccMixter, ...) are cached here so repeated searches/browses
--    don't re-hit the provider's rate limits, and so a cached
--    track can be turned into a radio_songs row instantly when
--    someone actually queues it.
-- ============================================================

CREATE TABLE IF NOT EXISTS music_provider_cache (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider          VARCHAR(40) NOT NULL,
    external_track_id VARCHAR(150) NOT NULL,
    title             VARCHAR(200) NOT NULL,
    artist            VARCHAR(200),
    album             VARCHAR(200),
    genre             VARCHAR(80),
    duration_seconds  INT NOT NULL DEFAULT 0,
    stream_url        TEXT,     -- full-length licensed stream URL (provider-signed, may expire)
    preview_url       TEXT,     -- short preview clip, usually longer-lived
    cover_url         TEXT,
    raw_metadata      JSONB,    -- full provider payload, for debugging/future fields
    cached_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at        TIMESTAMPTZ,  -- provider stream URLs often expire; NULL = doesn't expire
    UNIQUE (provider, external_track_id)
);

CREATE INDEX IF NOT EXISTS idx_music_provider_cache_search
  ON music_provider_cache USING GIN (to_tsvector('english', title || ' ' || coalesce(artist, '')));

-- ============================================================
-- 6. LISTENER HISTORY + ANALYTICS
-- ============================================================

CREATE TABLE IF NOT EXISTS radio_listener_history (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    broadcast_id     UUID NOT NULL REFERENCES radio_broadcasts(id) ON DELETE CASCADE,
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    left_at          TIMESTAMPTZ,
    seconds_listened INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS radio_analytics_daily (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    station_id          UUID NOT NULL REFERENCES radio_stations(id) ON DELETE CASCADE,
    log_date            DATE NOT NULL,
    total_listeners      INT NOT NULL DEFAULT 0,   -- unique listeners that day
    peak_concurrent      INT NOT NULL DEFAULT 0,
    total_broadcasts     INT NOT NULL DEFAULT 0,
    total_song_requests  INT NOT NULL DEFAULT 0,
    total_gift_coins     BIGINT NOT NULL DEFAULT 0,
    total_chat_messages  INT NOT NULL DEFAULT 0,
    new_followers        INT NOT NULL DEFAULT 0,
    UNIQUE (station_id, log_date)
);

-- ============================================================
-- 7. INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_radio_songs_uploader        ON radio_songs(uploader_id);
CREATE INDEX IF NOT EXISTS idx_radio_songs_station          ON radio_songs(station_id);
CREATE INDEX IF NOT EXISTS idx_radio_songs_status            ON radio_songs(status);
CREATE INDEX IF NOT EXISTS idx_radio_songs_search
  ON radio_songs USING GIN (to_tsvector('english', title || ' ' || coalesce(artist, '') || ' ' || coalesce(album, '')));

CREATE INDEX IF NOT EXISTS idx_radio_playlists_host          ON radio_playlists(host_id);
CREATE INDEX IF NOT EXISTS idx_radio_playlist_songs_playlist  ON radio_playlist_songs(playlist_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_radio_queue_broadcast          ON radio_queue_items(broadcast_id, position);
CREATE INDEX IF NOT EXISTS idx_radio_queue_status              ON radio_queue_items(broadcast_id, status);

CREATE INDEX IF NOT EXISTS idx_radio_song_requests_song_id     ON radio_song_requests(song_id);
CREATE INDEX IF NOT EXISTS idx_radio_listener_history_bcast    ON radio_listener_history(broadcast_id);
CREATE INDEX IF NOT EXISTS idx_radio_listener_history_user     ON radio_listener_history(user_id);
CREATE INDEX IF NOT EXISTS idx_radio_analytics_daily_station   ON radio_analytics_daily(station_id, log_date);

-- ============================================================
-- 8. updated_at triggers
-- ============================================================

DROP TRIGGER IF EXISTS trg_radio_songs_updated ON radio_songs;
CREATE TRIGGER trg_radio_songs_updated BEFORE UPDATE ON radio_songs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_radio_playlists_updated ON radio_playlists;
CREATE TRIGGER trg_radio_playlists_updated BEFORE UPDATE ON radio_playlists
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;