-- ============================================================
-- 📻 Lovecruise Radio — MASTER SCHEMA (consolidated)
-- ------------------------------------------------------------
-- This file replaces and merges, in order:
--   1. radio-schema.sql               (base: categories/stations/
--                                       shows/broadcasts/cohosts/
--                                       listeners/messages/requests)
--   2. migrate-radio-phase2.js         (members-only, subscriptions,
--                                       polls, cohost status columns)
--   3. radio-phase3-music-library.sql  (songs, playlists, queue,
--                                       provider cache, analytics)
--   4. radio-phase4-guest-invites.sql  (invite/mic-control columns)
--   5. fix-radio-schema.js             (follows table, status drift)
--   6. fix_radio_cohosts_guest_invites.sql
--   7. fix_radio_songs_upload_columns.sql
--
-- Every statement is IF NOT EXISTS / idempotent — safe to run on a
-- brand-new database OR against your existing production database
-- with data already in it. Nothing here drops or renames existing
-- data. Run once, and use THIS file for any future radio schema
-- changes instead of one-off patch scripts.
--
--   psql "$DATABASE_URL" -f radio-schema-master.sql
--
-- Also fixes a real bug found while consolidating: radio.socket.js
-- writes live chat into `radio_broadcast_messages`, but no prior
-- migration ever created that table (only the differently-named
-- `radio_messages`) — so radio chat persistence has been silently
-- failing. Both tables now exist; the code path that matters
-- (`radio_broadcast_messages`) is created explicitly below.
-- ============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- 0. shared updated_at trigger fn (create if your DB doesn't
--    already have one from elsewhere in the app)
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 1. CATEGORIES
-- ============================================================

CREATE TABLE IF NOT EXISTS radio_categories (
    key        VARCHAR(40) PRIMARY KEY,
    label      VARCHAR(80) NOT NULL,
    icon       VARCHAR(10),
    sort_order INT NOT NULL DEFAULT 0,
    is_active  BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO radio_categories (key, label, icon, sort_order) VALUES
  ('matchmaking',   'Matchmaking & Dating Advice',   '❤️', 1),
  ('relationship',  'Relationship Talk Shows',       '💕', 2),
  ('music',         'Music Radio',                   '🎵', 3),
  ('celebrity',     'Celebrity Interviews',          '🎙️', 4),
  ('dj_sessions',   'Live DJ Sessions',              '🎤', 5),
  ('comedy',        'Comedy Hour',                   '😂', 6),
  ('inspiration',   'Inspirational Programs',        '🙏', 7),
  ('education',     'Educational Programs',          '📚', 8),
  ('business',      'Business & Entrepreneurship',   '💼', 9),
  ('sports',        'Sports Talk',                   '⚽', 10),
  ('news',          'News & Trending Topics',        '📰', 11),
  ('night_talk',    'Late Night Love Confessions',   '🌙', 12),
  ('party',         'Party FM',                      '🎉', 13)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 2. STATIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS radio_stations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    host_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title           VARCHAR(150) NOT NULL,
    description     TEXT,
    category_key    VARCHAR(40) REFERENCES radio_categories(key),
    cover_url       TEXT,
    jingle_url      TEXT,
    is_official     BOOLEAN NOT NULL DEFAULT FALSE,
    is_members_only BOOLEAN NOT NULL DEFAULT FALSE,
    status          VARCHAR(20) NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','suspended')),
    follower_count  INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE radio_stations ADD COLUMN IF NOT EXISTS is_members_only BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS radio_station_follows (
    station_id UUID NOT NULL REFERENCES radio_stations(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (station_id, user_id)
);

CREATE OR REPLACE FUNCTION trg_radio_station_follow_count() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE radio_stations SET follower_count = follower_count + 1 WHERE id = NEW.station_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE radio_stations SET follower_count = GREATEST(follower_count - 1, 0) WHERE id = OLD.station_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_radio_station_follows_ins ON radio_station_follows;
CREATE TRIGGER trg_radio_station_follows_ins AFTER INSERT ON radio_station_follows
  FOR EACH ROW EXECUTE FUNCTION trg_radio_station_follow_count();

DROP TRIGGER IF EXISTS trg_radio_station_follows_del ON radio_station_follows;
CREATE TRIGGER trg_radio_station_follows_del AFTER DELETE ON radio_station_follows
  FOR EACH ROW EXECUTE FUNCTION trg_radio_station_follow_count();

CREATE TABLE IF NOT EXISTS radio_station_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id UUID NOT NULL REFERENCES radio_stations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(station_id, user_id)
);

-- ============================================================
-- 3. SHOWS
-- ============================================================

CREATE TABLE IF NOT EXISTS radio_shows (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    station_id       UUID NOT NULL REFERENCES radio_stations(id) ON DELETE CASCADE,
    title            VARCHAR(150) NOT NULL,
    description      TEXT,
    scheduled_at     TIMESTAMPTZ,
    recurring_rule   VARCHAR(30),
    duration_minutes INT NOT NULL DEFAULT 60,
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    notified_at      TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE radio_shows ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;

-- ============================================================
-- 4. BROADCASTS
-- ============================================================

CREATE TABLE IF NOT EXISTS radio_broadcasts (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    station_id         UUID NOT NULL REFERENCES radio_stations(id) ON DELETE CASCADE,
    show_id            UUID REFERENCES radio_shows(id) ON DELETE SET NULL,
    host_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title              VARCHAR(150) NOT NULL,
    description        TEXT,
    status             VARCHAR(20) NOT NULL DEFAULT 'live'
                       CHECK (status IN ('scheduled','live','ended')),
    rtmp_stream_key    VARCHAR(255) UNIQUE,
    hls_playlist_url   TEXT,
    listener_count     INT NOT NULL DEFAULT 0,
    total_coins_earned BIGINT NOT NULL DEFAULT 0,
    started_at         TIMESTAMPTZ,
    ended_at           TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 5. CO-HOSTS / GUEST BOOTH (final, fully merged column set)
-- ============================================================

CREATE TABLE IF NOT EXISTS radio_cohosts (
    broadcast_id UUID NOT NULL REFERENCES radio_broadcasts(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role         VARCHAR(20) NOT NULL DEFAULT 'cohost' CHECK (role IN ('cohost','caller')),
    joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (broadcast_id, user_id)
);

ALTER TABLE radio_cohosts ADD COLUMN IF NOT EXISTS status        VARCHAR(20) NOT NULL DEFAULT 'approved';
ALTER TABLE radio_cohosts ADD COLUMN IF NOT EXISTS invited_by    UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE radio_cohosts ADD COLUMN IF NOT EXISTS requested_at  TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE radio_cohosts ADD COLUMN IF NOT EXISTS approved_at   TIMESTAMPTZ;
ALTER TABLE radio_cohosts ADD COLUMN IF NOT EXISTS mic_muted     BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE radio_cohosts ADD COLUMN IF NOT EXISTS mic_volume    INT NOT NULL DEFAULT 100;
ALTER TABLE radio_cohosts ADD COLUMN IF NOT EXISTS mic_locked    BOOLEAN NOT NULL DEFAULT FALSE;

-- mic_volume bounds check, added separately so re-runs never fail
-- on "constraint already exists"
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'radio_cohosts_mic_volume_check'
  ) THEN
    ALTER TABLE radio_cohosts
      ADD CONSTRAINT radio_cohosts_mic_volume_check CHECK (mic_volume BETWEEN 0 AND 100);
  END IF;
END $$;

-- (broadcast_id, user_id) is already the PRIMARY KEY above, which
-- satisfies ON CONFLICT (broadcast_id, user_id) — no separate unique
-- constraint needed. This DO block only adds one if some earlier
-- patch script somehow dropped the PK without you noticing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'radio_cohosts'::regclass AND contype IN ('p','u')
  ) THEN
    ALTER TABLE radio_cohosts
      ADD CONSTRAINT radio_cohosts_broadcast_user_uniq UNIQUE (broadcast_id, user_id);
  END IF;
END $$;

-- status: widen whether it's an enum or a CHECK constraint, to cover
-- every value the app sends: pending/approved/rejected/left/invited/
-- declined_invite
DO $$
DECLARE
  col_type TEXT;
BEGIN
  SELECT data_type INTO col_type
  FROM information_schema.columns
  WHERE table_name = 'radio_cohosts' AND column_name = 'status';

  IF col_type = 'USER-DEFINED' THEN
    DECLARE
      enum_type_name TEXT;
    BEGIN
      SELECT t.typname INTO enum_type_name
      FROM pg_type t
      JOIN pg_attribute a ON a.atttypid = t.oid
      JOIN pg_class c ON c.oid = a.attrelid
      WHERE c.relname = 'radio_cohosts' AND a.attname = 'status' AND t.typtype = 'e';

      IF enum_type_name IS NOT NULL THEN
        EXECUTE format('ALTER TYPE %I ADD VALUE IF NOT EXISTS %L', enum_type_name, 'pending');
        EXECUTE format('ALTER TYPE %I ADD VALUE IF NOT EXISTS %L', enum_type_name, 'approved');
        EXECUTE format('ALTER TYPE %I ADD VALUE IF NOT EXISTS %L', enum_type_name, 'rejected');
        EXECUTE format('ALTER TYPE %I ADD VALUE IF NOT EXISTS %L', enum_type_name, 'left');
        EXECUTE format('ALTER TYPE %I ADD VALUE IF NOT EXISTS %L', enum_type_name, 'invited');
        EXECUTE format('ALTER TYPE %I ADD VALUE IF NOT EXISTS %L', enum_type_name, 'declined_invite');
      END IF;
    END;
  ELSE
    EXECUTE (
      SELECT COALESCE(string_agg('ALTER TABLE radio_cohosts DROP CONSTRAINT ' || quote_ident(conname) || ';', ' '), '')
      FROM pg_constraint
      WHERE conrelid = 'radio_cohosts'::regclass
        AND contype = 'c'
        AND pg_get_constraintdef(oid) ILIKE '%status%'
    );
    ALTER TABLE radio_cohosts
      ADD CONSTRAINT radio_cohosts_status_check
      CHECK (status IN ('pending','approved','rejected','left','invited','declined_invite'));
  END IF;
END $$;

UPDATE radio_cohosts SET
  requested_at = COALESCE(requested_at, now()),
  mic_muted    = COALESCE(mic_muted, TRUE),
  mic_volume   = COALESCE(mic_volume, 100),
  mic_locked   = COALESCE(mic_locked, FALSE),
  status       = COALESCE(status, 'approved');

CREATE INDEX IF NOT EXISTS idx_radio_cohosts_status ON radio_cohosts(broadcast_id, status);

-- ============================================================
-- 6. LISTENERS
-- ============================================================

CREATE TABLE IF NOT EXISTS radio_listeners (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    broadcast_id UUID NOT NULL REFERENCES radio_broadcasts(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    left_at      TIMESTAMPTZ
);

-- ============================================================
-- 7. CHAT
-- ------------------------------------------------------------
-- radio_messages was the original (Phase 1) table name.
-- radio_broadcast_messages is what radioComment in radio.socket.js
-- actually writes to — create both so nothing silently no-ops.
-- ============================================================

CREATE TABLE IF NOT EXISTS radio_messages (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    broadcast_id UUID NOT NULL REFERENCES radio_broadcasts(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body         TEXT,
    message_type VARCHAR(20) NOT NULL DEFAULT 'comment',
    gift_id      UUID,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS radio_broadcast_messages (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    broadcast_id UUID NOT NULL REFERENCES radio_broadcasts(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body         TEXT,
    message_type VARCHAR(20) NOT NULL DEFAULT 'comment',
    gift_id      UUID,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_radio_broadcast_messages_bcast ON radio_broadcast_messages(broadcast_id, created_at);

-- ============================================================
-- 8. SONG REQUESTS (base + Phase 3 additions)
-- ============================================================

CREATE TABLE IF NOT EXISTS radio_song_requests (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    broadcast_id UUID NOT NULL REFERENCES radio_broadcasts(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    song_name    VARCHAR(150) NOT NULL,
    artist_name  VARCHAR(150),
    status       VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','played','declined','approved')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Widen status if an earlier install has a stricter CHECK (approveRequest
-- sets status = 'approved', which the original base table didn't allow).
DO $$
BEGIN
  EXECUTE (
    SELECT COALESCE(string_agg('ALTER TABLE radio_song_requests DROP CONSTRAINT ' || quote_ident(conname) || ';', ' '), '')
    FROM pg_constraint
    WHERE conrelid = 'radio_song_requests'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  );
  ALTER TABLE radio_song_requests
    ADD CONSTRAINT radio_song_requests_status_check
    CHECK (status IN ('pending','approved','played','declined'));
END $$;

-- ============================================================
-- 9. MUSIC LIBRARY (Phase 3): songs, likes, playlists
-- ============================================================

CREATE TABLE IF NOT EXISTS radio_songs (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    uploader_id        UUID REFERENCES users(id) ON DELETE CASCADE,
    station_id         UUID REFERENCES radio_stations(id) ON DELETE CASCADE,
    title              VARCHAR(200) NOT NULL,
    artist             VARCHAR(200),
    album              VARCHAR(200),
    genre              VARCHAR(80),
    duration_seconds   INT NOT NULL DEFAULT 0,
    file_url           TEXT,
    file_id            TEXT,
    original_file_url  TEXT,
    cover_url          TEXT,
    cover_file_id      TEXT,
    source             VARCHAR(20) NOT NULL DEFAULT 'upload'
                       CHECK (source IN ('upload', 'external')),
    external_provider  VARCHAR(40),
    external_track_id  VARCHAR(150),
    status             VARCHAR(20) NOT NULL DEFAULT 'ready'
                       CHECK (status IN ('processing', 'ready', 'failed')),
    processing_error   TEXT,
    play_count         BIGINT NOT NULL DEFAULT 0,
    like_count         INT NOT NULL DEFAULT 0,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (external_provider, external_track_id)
);

ALTER TABLE radio_songs ADD COLUMN IF NOT EXISTS file_id TEXT;
ALTER TABLE radio_songs ADD COLUMN IF NOT EXISTS cover_file_id TEXT;
ALTER TABLE radio_songs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE radio_songs ADD COLUMN IF NOT EXISTS like_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE radio_songs ADD COLUMN IF NOT EXISTS play_count BIGINT NOT NULL DEFAULT 0;

DO $$
DECLARE
  col_type TEXT;
BEGIN
  SELECT data_type INTO col_type
  FROM information_schema.columns
  WHERE table_name = 'radio_songs' AND column_name = 'status';

  IF col_type = 'USER-DEFINED' THEN
    BEGIN
      ALTER TYPE radio_song_status ADD VALUE IF NOT EXISTS 'processing';
      ALTER TYPE radio_song_status ADD VALUE IF NOT EXISTS 'ready';
      ALTER TYPE radio_song_status ADD VALUE IF NOT EXISTS 'failed';
    EXCEPTION WHEN undefined_object THEN
      NULL;
    END;
  ELSIF col_type IS NOT NULL THEN
    EXECUTE (
      SELECT COALESCE(string_agg('ALTER TABLE radio_songs DROP CONSTRAINT ' || quote_ident(conname) || ';', ' '), '')
      FROM pg_constraint
      WHERE conrelid = 'radio_songs'::regclass
        AND contype = 'c'
        AND pg_get_constraintdef(oid) ILIKE '%status%'
    );
    ALTER TABLE radio_songs
      ADD CONSTRAINT radio_songs_status_check
      CHECK (status IN ('processing','ready','failed'));
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_radio_songs_updated ON radio_songs;
CREATE TRIGGER trg_radio_songs_updated BEFORE UPDATE ON radio_songs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

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

CREATE TABLE IF NOT EXISTS radio_playlists (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    host_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    station_id UUID REFERENCES radio_stations(id) ON DELETE CASCADE,
    name       VARCHAR(150) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_radio_playlists_updated ON radio_playlists;
CREATE TRIGGER trg_radio_playlists_updated BEFORE UPDATE ON radio_playlists
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS radio_playlist_songs (
    playlist_id UUID NOT NULL REFERENCES radio_playlists(id) ON DELETE CASCADE,
    song_id     UUID NOT NULL REFERENCES radio_songs(id) ON DELETE CASCADE,
    sort_order  INT NOT NULL DEFAULT 0,
    added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (playlist_id, song_id)
);

-- ============================================================
-- 10. SONG REQUESTS ↔ MUSIC LIBRARY LINK (Phase 3)
-- ============================================================

ALTER TABLE radio_song_requests ADD COLUMN IF NOT EXISTS song_id       UUID REFERENCES radio_songs(id) ON DELETE SET NULL;
ALTER TABLE radio_song_requests ADD COLUMN IF NOT EXISTS vote_count    INT NOT NULL DEFAULT 0;
ALTER TABLE radio_song_requests ADD COLUMN IF NOT EXISTS responded_by  UUID REFERENCES users(id);
ALTER TABLE radio_song_requests ADD COLUMN IF NOT EXISTS responded_at  TIMESTAMPTZ;
ALTER TABLE radio_song_requests ADD COLUMN IF NOT EXISTS queue_item_id UUID;

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
-- 11. QUEUE
-- ============================================================

CREATE TABLE IF NOT EXISTS radio_queue_items (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    broadcast_id  UUID NOT NULL REFERENCES radio_broadcasts(id) ON DELETE CASCADE,
    song_id       UUID NOT NULL REFERENCES radio_songs(id) ON DELETE CASCADE,
    added_by      UUID REFERENCES users(id),
    requested_by  UUID REFERENCES users(id),
    request_id    UUID REFERENCES radio_song_requests(id) ON DELETE SET NULL,
    position      INT NOT NULL DEFAULT 0,
    status        VARCHAR(20) NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued', 'playing', 'played', 'skipped')),
    added_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    played_at     TIMESTAMPTZ
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_radio_song_requests_queue_item'
  ) THEN
    ALTER TABLE radio_song_requests
      ADD CONSTRAINT fk_radio_song_requests_queue_item
      FOREIGN KEY (queue_item_id) REFERENCES radio_queue_items(id) ON DELETE SET NULL;
  END IF;
END $$;

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
-- 12. EXTERNAL PROVIDER CACHE
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
    stream_url        TEXT,
    preview_url       TEXT,
    cover_url         TEXT,
    raw_metadata      JSONB,
    cached_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at        TIMESTAMPTZ,
    UNIQUE (provider, external_track_id)
);

CREATE INDEX IF NOT EXISTS idx_music_provider_cache_search
  ON music_provider_cache USING GIN (to_tsvector('english', title || ' ' || coalesce(artist, '')));

-- ============================================================
-- 13. POLLS
-- ============================================================

CREATE TABLE IF NOT EXISTS radio_polls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id UUID NOT NULL REFERENCES radio_broadcasts(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  options JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS radio_poll_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id UUID NOT NULL REFERENCES radio_polls(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  option_index INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(poll_id, user_id)
);

-- ============================================================
-- 14. LISTENER HISTORY + ANALYTICS
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
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    station_id           UUID NOT NULL REFERENCES radio_stations(id) ON DELETE CASCADE,
    log_date             DATE NOT NULL,
    total_listeners      INT NOT NULL DEFAULT 0,
    peak_concurrent       INT NOT NULL DEFAULT 0,
    total_broadcasts      INT NOT NULL DEFAULT 0,
    total_song_requests   INT NOT NULL DEFAULT 0,
    total_gift_coins      BIGINT NOT NULL DEFAULT 0,
    total_chat_messages   INT NOT NULL DEFAULT 0,
    new_followers         INT NOT NULL DEFAULT 0,
    UNIQUE (station_id, log_date)
);

-- ============================================================
-- 15. GENERAL SOCIAL-GRAPH TABLE RADIO DEPENDS ON
--     ("follow this host" / notifications-to-followers). If your
--     app already has this table under a different name, this is
--     a harmless no-op.
-- ============================================================

CREATE TABLE IF NOT EXISTS follows (
  follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (follower_id, following_id)
);

CREATE INDEX IF NOT EXISTS idx_follows_following_id ON follows(following_id);
CREATE INDEX IF NOT EXISTS idx_follows_follower_id ON follows(follower_id);

-- ============================================================
-- 16. PRESENCE — radio statuses
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_presence') THEN
    ALTER TABLE user_presence DROP CONSTRAINT IF EXISTS user_presence_status_check;
    ALTER TABLE user_presence
      ADD CONSTRAINT user_presence_status_check
      CHECK (status IN (
        'OFFLINE','ONLINE','WATCHING_LIVE','HOSTING_LIVE','CO_HOST','GUEST_SEAT',
        'LISTENING_RADIO','HOSTING_RADIO'
      ));
  END IF;
END $$;

-- ============================================================
-- 17. INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_radio_stations_host          ON radio_stations(host_id);
CREATE INDEX IF NOT EXISTS idx_radio_stations_category       ON radio_stations(category_key);
CREATE INDEX IF NOT EXISTS idx_radio_shows_station           ON radio_shows(station_id);
CREATE INDEX IF NOT EXISTS idx_radio_shows_scheduled         ON radio_shows(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_radio_broadcasts_station      ON radio_broadcasts(station_id);
CREATE INDEX IF NOT EXISTS idx_radio_broadcasts_host         ON radio_broadcasts(host_id);
CREATE INDEX IF NOT EXISTS idx_radio_broadcasts_status       ON radio_broadcasts(status);
CREATE INDEX IF NOT EXISTS idx_radio_listeners_broadcast     ON radio_listeners(broadcast_id);
CREATE INDEX IF NOT EXISTS idx_radio_messages_broadcast      ON radio_messages(broadcast_id, created_at);
CREATE INDEX IF NOT EXISTS idx_radio_song_requests_bcast     ON radio_song_requests(broadcast_id);
CREATE INDEX IF NOT EXISTS idx_radio_song_requests_song_id   ON radio_song_requests(song_id);
CREATE INDEX IF NOT EXISTS idx_radio_songs_uploader          ON radio_songs(uploader_id);
CREATE INDEX IF NOT EXISTS idx_radio_songs_station           ON radio_songs(station_id);
CREATE INDEX IF NOT EXISTS idx_radio_songs_status             ON radio_songs(status);
CREATE INDEX IF NOT EXISTS idx_radio_songs_search
  ON radio_songs USING GIN (to_tsvector('english', title || ' ' || coalesce(artist, '') || ' ' || coalesce(album, '')));
CREATE INDEX IF NOT EXISTS idx_radio_playlists_host           ON radio_playlists(host_id);
CREATE INDEX IF NOT EXISTS idx_radio_playlist_songs_playlist  ON radio_playlist_songs(playlist_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_radio_queue_broadcast          ON radio_queue_items(broadcast_id, position);
CREATE INDEX IF NOT EXISTS idx_radio_queue_status              ON radio_queue_items(broadcast_id, status);
CREATE INDEX IF NOT EXISTS idx_radio_listener_history_bcast    ON radio_listener_history(broadcast_id);
CREATE INDEX IF NOT EXISTS idx_radio_listener_history_user     ON radio_listener_history(user_id);
CREATE INDEX IF NOT EXISTS idx_radio_analytics_daily_station   ON radio_analytics_daily(station_id, log_date);
CREATE INDEX IF NOT EXISTS idx_radio_station_subscriptions_station ON radio_station_subscriptions(station_id);
CREATE INDEX IF NOT EXISTS idx_radio_station_subscriptions_user    ON radio_station_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_radio_polls_broadcast               ON radio_polls(broadcast_id);
CREATE INDEX IF NOT EXISTS idx_radio_poll_votes_poll               ON radio_poll_votes(poll_id);

-- ============================================================
-- 18. updated_at triggers
-- ============================================================

DROP TRIGGER IF EXISTS trg_radio_stations_updated ON radio_stations;
CREATE TRIGGER trg_radio_stations_updated BEFORE UPDATE ON radio_stations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_radio_shows_updated ON radio_shows;
CREATE TRIGGER trg_radio_shows_updated BEFORE UPDATE ON radio_shows
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;

-- ============================================================
-- VERIFY — run manually after, to confirm the merge landed
-- ============================================================
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'radio_cohosts' ORDER BY ordinal_position;
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'radio_songs' ORDER BY ordinal_position;
-- SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'radio_%' ORDER BY table_name;