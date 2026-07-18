require("dotenv").config();
const db = require("../src/config/db");

async function migrateRadioPhase3() {
  try {
    console.log("====================================");
    console.log("Radio Phase 3 Migration");
    console.log("====================================");

    await db.query("BEGIN");

    await db.query(`
    ------------------------------------------------------------------
    -- RADIO SONGS
    ------------------------------------------------------------------

    CREATE TABLE IF NOT EXISTS radio_songs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        uploader_id UUID REFERENCES users(id) ON DELETE CASCADE,
        station_id UUID REFERENCES radio_stations(id) ON DELETE CASCADE,

        title VARCHAR(200) NOT NULL,
        artist VARCHAR(200),
        album VARCHAR(200),
        genre VARCHAR(80),

        duration_seconds INT NOT NULL DEFAULT 0,

        file_url TEXT,
        original_file_url TEXT,
        cover_url TEXT,

        source VARCHAR(20) NOT NULL DEFAULT 'upload'
            CHECK (source IN ('upload','external')),

        external_provider VARCHAR(40),
        external_track_id VARCHAR(150),

        status VARCHAR(20) NOT NULL DEFAULT 'ready'
            CHECK (status IN ('processing','ready','failed')),

        processing_error TEXT,

        play_count BIGINT NOT NULL DEFAULT 0,
        like_count INT NOT NULL DEFAULT 0,

        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        UNIQUE(external_provider, external_track_id)
    );

    ------------------------------------------------------------------
    -- SONG LIKES
    ------------------------------------------------------------------

    CREATE TABLE IF NOT EXISTS radio_song_likes (
        song_id UUID NOT NULL REFERENCES radio_songs(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY(song_id,user_id)
    );

    CREATE OR REPLACE FUNCTION trg_radio_song_like_count()
    RETURNS TRIGGER AS $$
    BEGIN
      IF TG_OP='INSERT' THEN
          UPDATE radio_songs
          SET like_count=like_count+1
          WHERE id=NEW.song_id;
          RETURN NEW;
      ELSIF TG_OP='DELETE' THEN
          UPDATE radio_songs
          SET like_count=GREATEST(like_count-1,0)
          WHERE id=OLD.song_id;
          RETURN OLD;
      END IF;
      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_radio_song_likes_ins
    ON radio_song_likes;

    CREATE TRIGGER trg_radio_song_likes_ins
    AFTER INSERT ON radio_song_likes
    FOR EACH ROW
    EXECUTE FUNCTION trg_radio_song_like_count();

    DROP TRIGGER IF EXISTS trg_radio_song_likes_del
    ON radio_song_likes;

    CREATE TRIGGER trg_radio_song_likes_del
    AFTER DELETE ON radio_song_likes
    FOR EACH ROW
    EXECUTE FUNCTION trg_radio_song_like_count();

    ------------------------------------------------------------------
    -- PLAYLISTS
    ------------------------------------------------------------------

    CREATE TABLE IF NOT EXISTS radio_playlists (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        host_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        station_id UUID REFERENCES radio_stations(id) ON DELETE CASCADE,
        name VARCHAR(150) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS radio_playlist_songs (
        playlist_id UUID NOT NULL REFERENCES radio_playlists(id) ON DELETE CASCADE,
        song_id UUID NOT NULL REFERENCES radio_songs(id) ON DELETE CASCADE,
        sort_order INT NOT NULL DEFAULT 0,
        added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY(playlist_id,song_id)
    );

    ------------------------------------------------------------------
    -- EXTEND SONG REQUESTS
    ------------------------------------------------------------------

    ALTER TABLE radio_song_requests
        ADD COLUMN IF NOT EXISTS song_id UUID REFERENCES radio_songs(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS vote_count INT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS responded_by UUID REFERENCES users(id),
        ADD COLUMN IF NOT EXISTS responded_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS queue_item_id UUID;

    CREATE TABLE IF NOT EXISTS radio_song_request_votes (
        request_id UUID NOT NULL REFERENCES radio_song_requests(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY(request_id,user_id)
    );

    CREATE OR REPLACE FUNCTION trg_radio_request_vote_count()
    RETURNS TRIGGER AS $$
    BEGIN
      IF TG_OP='INSERT' THEN
        UPDATE radio_song_requests
        SET vote_count=vote_count+1
        WHERE id=NEW.request_id;
        RETURN NEW;
      ELSIF TG_OP='DELETE' THEN
        UPDATE radio_song_requests
        SET vote_count=GREATEST(vote_count-1,0)
        WHERE id=OLD.request_id;
        RETURN OLD;
      END IF;
      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_radio_request_votes_ins
    ON radio_song_request_votes;

    CREATE TRIGGER trg_radio_request_votes_ins
    AFTER INSERT ON radio_song_request_votes
    FOR EACH ROW
    EXECUTE FUNCTION trg_radio_request_vote_count();

    DROP TRIGGER IF EXISTS trg_radio_request_votes_del
    ON radio_song_request_votes;

    CREATE TRIGGER trg_radio_request_votes_del
    AFTER DELETE ON radio_song_request_votes
    FOR EACH ROW
    EXECUTE FUNCTION trg_radio_request_vote_count();

    ------------------------------------------------------------------
    -- QUEUE
    ------------------------------------------------------------------

    CREATE TABLE IF NOT EXISTS radio_queue_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        broadcast_id UUID NOT NULL REFERENCES radio_broadcasts(id) ON DELETE CASCADE,

        song_id UUID NOT NULL REFERENCES radio_songs(id) ON DELETE CASCADE,

        added_by UUID REFERENCES users(id),
        requested_by UUID REFERENCES users(id),

        request_id UUID REFERENCES radio_song_requests(id)
        ON DELETE SET NULL,

        position INT NOT NULL DEFAULT 0,

        status VARCHAR(20) NOT NULL DEFAULT 'queued'
            CHECK(status IN ('queued','playing','played','skipped')),

        added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        played_at TIMESTAMPTZ
    );

    DO $$
    BEGIN
      IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname='fk_radio_song_requests_queue_item'
      ) THEN
          ALTER TABLE radio_song_requests
          ADD CONSTRAINT fk_radio_song_requests_queue_item
          FOREIGN KEY(queue_item_id)
          REFERENCES radio_queue_items(id)
          ON DELETE SET NULL;
      END IF;
    END $$;

    CREATE TABLE IF NOT EXISTS radio_current_playback (
        broadcast_id UUID PRIMARY KEY REFERENCES radio_broadcasts(id) ON DELETE CASCADE,
        queue_item_id UUID REFERENCES radio_queue_items(id) ON DELETE SET NULL,
        song_id UUID REFERENCES radio_songs(id),
        started_at TIMESTAMPTZ,
        position_seconds INT NOT NULL DEFAULT 0,
        is_paused BOOLEAN NOT NULL DEFAULT FALSE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ------------------------------------------------------------------
    -- PROVIDER CACHE
    ------------------------------------------------------------------

    CREATE TABLE IF NOT EXISTS music_provider_cache (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        provider VARCHAR(40) NOT NULL,
        external_track_id VARCHAR(150) NOT NULL,

        title VARCHAR(200) NOT NULL,
        artist VARCHAR(200),
        album VARCHAR(200),
        genre VARCHAR(80),

        duration_seconds INT NOT NULL DEFAULT 0,

        stream_url TEXT,
        preview_url TEXT,
        cover_url TEXT,

        raw_metadata JSONB,

        cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ,

        UNIQUE(provider,external_track_id)
    );

    ------------------------------------------------------------------
    -- ANALYTICS
    ------------------------------------------------------------------

    CREATE TABLE IF NOT EXISTS radio_listener_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        broadcast_id UUID NOT NULL REFERENCES radio_broadcasts(id) ON DELETE CASCADE,

        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

        joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        left_at TIMESTAMPTZ,

        seconds_listened INT NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS radio_analytics_daily (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        station_id UUID NOT NULL REFERENCES radio_stations(id) ON DELETE CASCADE,

        log_date DATE NOT NULL,

        total_listeners INT NOT NULL DEFAULT 0,
        peak_concurrent INT NOT NULL DEFAULT 0,
        total_broadcasts INT NOT NULL DEFAULT 0,
        total_song_requests INT NOT NULL DEFAULT 0,
        total_gift_coins BIGINT NOT NULL DEFAULT 0,
        total_chat_messages INT NOT NULL DEFAULT 0,
        new_followers INT NOT NULL DEFAULT 0,

        UNIQUE(station_id,log_date)
    );

    ------------------------------------------------------------------
    -- INDEXES
    ------------------------------------------------------------------

    CREATE INDEX IF NOT EXISTS idx_radio_songs_uploader
    ON radio_songs(uploader_id);

    CREATE INDEX IF NOT EXISTS idx_radio_songs_station
    ON radio_songs(station_id);

    CREATE INDEX IF NOT EXISTS idx_radio_songs_status
    ON radio_songs(status);

    CREATE INDEX IF NOT EXISTS idx_radio_playlists_host
    ON radio_playlists(host_id);

    CREATE INDEX IF NOT EXISTS idx_radio_playlist_songs_playlist
    ON radio_playlist_songs(playlist_id,sort_order);

    CREATE INDEX IF NOT EXISTS idx_radio_queue_broadcast
    ON radio_queue_items(broadcast_id,position);

    CREATE INDEX IF NOT EXISTS idx_radio_queue_status
    ON radio_queue_items(broadcast_id,status);

    CREATE INDEX IF NOT EXISTS idx_radio_song_requests_song_id
    ON radio_song_requests(song_id);

    CREATE INDEX IF NOT EXISTS idx_radio_listener_history_broadcast
    ON radio_listener_history(broadcast_id);

    CREATE INDEX IF NOT EXISTS idx_radio_listener_history_user
    ON radio_listener_history(user_id);

    CREATE INDEX IF NOT EXISTS idx_radio_analytics_daily_station
    ON radio_analytics_daily(station_id,log_date);

    CREATE INDEX IF NOT EXISTS idx_music_provider_cache_search
    ON music_provider_cache
    USING GIN(to_tsvector(
        'english',
        title || ' ' || coalesce(artist,'')
    ));

    CREATE INDEX IF NOT EXISTS idx_radio_songs_search
    ON radio_songs
    USING GIN(to_tsvector(
        'english',
        title || ' ' || coalesce(artist,'') || ' ' || coalesce(album,'')
    ));

    ------------------------------------------------------------------
    -- UPDATED_AT TRIGGERS
    ------------------------------------------------------------------

    DROP TRIGGER IF EXISTS trg_radio_songs_updated
    ON radio_songs;

    CREATE TRIGGER trg_radio_songs_updated
    BEFORE UPDATE ON radio_songs
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

    DROP TRIGGER IF EXISTS trg_radio_playlists_updated
    ON radio_playlists;

    CREATE TRIGGER trg_radio_playlists_updated
    BEFORE UPDATE ON radio_playlists
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
    `);

    await db.query("COMMIT");

    console.log("====================================");
    console.log("✅ Radio Phase 3 migration complete");
    console.log("====================================");

    process.exit(0);

  } catch (err) {
    await db.query("ROLLBACK");

    console.error("❌ Radio Phase 3 migration failed");
    console.error(err);

    process.exit(1);
  }
}

migrateRadioPhase3();