-- ============================================================
-- 📻 Lovecruise Radio — schema migration
-- ------------------------------------------------------------
-- Adds a third live-experience pillar alongside Social Live
-- (live_rooms, mediasoup/WebRTC) and Podcast Live (also
-- live_rooms). Radio is intentionally NOT built on live_rooms:
--
--   - Social/Podcast Live = WebRTC via mediasoup, ephemeral room
--     per broadcast, video-capable.
--   - Radio = HLS ingest (RTMP in -> .m3u8/.ts out), audio-only,
--     and has a persistent "station" identity that outlives any
--     single broadcast (so hosts can schedule shows ahead, build
--     a following on the STATION not just the session, and past
--     episodes can be listed even after the broadcast ends).
--
-- Reuses: users, followers (for "follow this host"), gifts,
-- gift_transactions (context_type = 'radio_broadcast'),
-- notifications, user_presence (extended with two new statuses).
--
-- Safe to re-run (IF NOT EXISTS everywhere).
-- ============================================================

BEGIN;

-- ============================================================
-- 1. CATEGORIES (admin-managed, seeded below)
-- ============================================================

CREATE TABLE IF NOT EXISTS radio_categories (
    key        VARCHAR(40) PRIMARY KEY,
    label      VARCHAR(80) NOT NULL,
    icon       VARCHAR(10),
    sort_order INT NOT NULL DEFAULT 0,
    is_active  BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO radio_categories (key, label, icon, sort_order) VALUES
  ('matchmaking',   'Matchmaking & Dating Advice',       '❤️', 1),
  ('relationship',  'Relationship Talk Shows',           '💕', 2),
  ('music',         'Music Radio',                       '🎵', 3),
  ('celebrity',     'Celebrity Interviews',               '🎙️', 4),
  ('dj_sessions',   'Live DJ Sessions',                   '🎤', 5),
  ('comedy',        'Comedy Hour',                        '😂', 6),
  ('inspiration',   'Inspirational Programs',             '🙏', 7),
  ('education',     'Educational Programs',               '📚', 8),
  ('business',      'Business & Entrepreneurship',        '💼', 9),
  ('sports',        'Sports Talk',                        '⚽', 10),
  ('news',          'News & Trending Topics',              '📰', 11),
  ('night_talk',    'Late Night Love Confessions',        '🌙', 12)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 2. STATIONS — persistent identity for a host's radio channel.
--    A user can have multiple stations (e.g. "Love FM" + "Night
--    Talk with Tega"), each with its own followers and schedule.
-- ============================================================

CREATE TABLE IF NOT EXISTS radio_stations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    host_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title           VARCHAR(150) NOT NULL,
    description     TEXT,
    category_key    VARCHAR(40) REFERENCES radio_categories(key),
    cover_url       TEXT,
    jingle_url      TEXT,                      -- intro/jingle audio
    is_official     BOOLEAN NOT NULL DEFAULT FALSE, -- admin-created "Lovecruise Radio" stations
    status          VARCHAR(20) NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','suspended')),
    follower_count  INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

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

-- ============================================================
-- 3. SHOWS — scheduled programs on a station ("every Friday
--    9pm"). A show is a template; each time it airs it produces
--    a radio_broadcasts row.
-- ============================================================

CREATE TABLE IF NOT EXISTS radio_shows (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    station_id       UUID NOT NULL REFERENCES radio_stations(id) ON DELETE CASCADE,
    title            VARCHAR(150) NOT NULL,
    description      TEXT,
    scheduled_at     TIMESTAMPTZ,          -- next/first air time
    recurring_rule   VARCHAR(30),          -- NULL | 'weekly' | 'daily' | 'weekdays' (simple cron-ish tag)
    duration_minutes INT NOT NULL DEFAULT 60,
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 4. BROADCASTS — one actual live audio session (what listeners
--    join). This is the HLS-facing row: rtmp ingest key in, HLS
--    playlist URL out.
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
    rtmp_stream_key    VARCHAR(255) UNIQUE,   -- host's OBS/encoder publishes to rtmp://.../{key}
    hls_playlist_url   TEXT,                  -- .m3u8 URL listeners' <audio>/hls.js hits
    listener_count     INT NOT NULL DEFAULT 0,
    total_coins_earned BIGINT NOT NULL DEFAULT 0,
    started_at         TIMESTAMPTZ,
    ended_at           TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS radio_cohosts (
    broadcast_id UUID NOT NULL REFERENCES radio_broadcasts(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role         VARCHAR(20) NOT NULL DEFAULT 'cohost' CHECK (role IN ('cohost','caller')),
    joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (broadcast_id, user_id)
);

CREATE TABLE IF NOT EXISTS radio_listeners (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    broadcast_id UUID NOT NULL REFERENCES radio_broadcasts(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    left_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS radio_messages (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    broadcast_id UUID NOT NULL REFERENCES radio_broadcasts(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body         TEXT,
    message_type VARCHAR(20) NOT NULL DEFAULT 'comment', -- comment|reaction|gift|join|system
    gift_id      UUID,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS radio_song_requests (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    broadcast_id UUID NOT NULL REFERENCES radio_broadcasts(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    song_name    VARCHAR(150) NOT NULL,
    artist_name  VARCHAR(150),
    status       VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','played','declined')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);





CREATE TABLE IF NOT EXISTS radio_station_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id UUID NOT NULL REFERENCES radio_stations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(station_id, user_id)
);




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
-- 5. PRESENCE — extend the status machine with radio states.
--    Mirrors what stream.socket.js already does for
--    WATCHING_LIVE/HOSTING_LIVE.
-- ============================================================

DO $$
BEGIN
  ALTER TABLE user_presence DROP CONSTRAINT IF EXISTS user_presence_status_check;
  ALTER TABLE user_presence
    ADD CONSTRAINT user_presence_status_check
    CHECK (status IN (
      'OFFLINE','ONLINE','WATCHING_LIVE','HOSTING_LIVE','CO_HOST','GUEST_SEAT',
      'LISTENING_RADIO','HOSTING_RADIO'
    ));
END $$;

-- ============================================================
-- 6. INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_radio_stations_host        ON radio_stations(host_id);
CREATE INDEX IF NOT EXISTS idx_radio_stations_category     ON radio_stations(category_key);
CREATE INDEX IF NOT EXISTS idx_radio_shows_station         ON radio_shows(station_id);
CREATE INDEX IF NOT EXISTS idx_radio_shows_scheduled       ON radio_shows(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_radio_broadcasts_station    ON radio_broadcasts(station_id);
CREATE INDEX IF NOT EXISTS idx_radio_broadcasts_host       ON radio_broadcasts(host_id);
CREATE INDEX IF NOT EXISTS idx_radio_broadcasts_status     ON radio_broadcasts(status);
CREATE INDEX IF NOT EXISTS idx_radio_listeners_broadcast   ON radio_listeners(broadcast_id);
CREATE INDEX IF NOT EXISTS idx_radio_messages_broadcast    ON radio_messages(broadcast_id, created_at);
CREATE INDEX IF NOT EXISTS idx_radio_song_requests_bcast   ON radio_song_requests(broadcast_id);

-- ============================================================
-- 7. updated_at triggers
-- ============================================================

DROP TRIGGER IF EXISTS trg_radio_stations_updated ON radio_stations;
CREATE TRIGGER trg_radio_stations_updated BEFORE UPDATE ON radio_stations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_radio_shows_updated ON radio_shows;
CREATE TRIGGER trg_radio_shows_updated BEFORE UPDATE ON radio_shows
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;






