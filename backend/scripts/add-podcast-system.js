require("dotenv").config();

const db = require("../src/config/db");

async function installPodcastSystem() {

    try {

        console.log("======================================");
        console.log("🎙 INSTALLING PODCAST SYSTEM");
        console.log("======================================");

        await db.query("BEGIN");

        /* ===========================================================
           UUID EXTENSION
        =========================================================== */

        await db.query(`
            CREATE EXTENSION IF NOT EXISTS pgcrypto;
        `);

        console.log("✅ UUID extension ready");

        /* ===========================================================
           PODCAST SHOWS
        =========================================================== */

        await db.query(`

        CREATE TABLE IF NOT EXISTS podcast_shows (

            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

            host_id UUID NOT NULL
                REFERENCES users(id)
                ON DELETE CASCADE,

            title VARCHAR(255) NOT NULL,

            description TEXT DEFAULT '',

            category VARCHAR(120),

            cover_url TEXT,

           language VARCHAR(40) DEFAULT 'English',

          explicit BOOLEAN DEFAULT FALSE,

          follower_count INTEGER NOT NULL DEFAULT 0,

           episode_count INTEGER NOT NULL DEFAULT 0,

            created_at TIMESTAMP DEFAULT NOW(),

            updated_at TIMESTAMP DEFAULT NOW()

        );

        `);

        console.log("✅ podcast_shows");


        /* ===========================================================
           PODCAST EPISODES
        =========================================================== */

        await db.query(`

        CREATE TABLE IF NOT EXISTS podcast_episodes (

            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

           show_id UUID NOT NULL
    REFERENCES podcast_shows(id)
    ON DELETE CASCADE,
            host_id UUID NOT NULL
                REFERENCES users(id)
                ON DELETE CASCADE,

            title VARCHAR(255) NOT NULL,

            description TEXT DEFAULT '',

            audio_url TEXT NOT NULL,

            cover_url TEXT,

            duration_seconds INTEGER DEFAULT 0,

            season_number INTEGER DEFAULT 1,

            episode_number INTEGER NOT NULL,

            listen_count INTEGER DEFAULT 0,

            like_count INTEGER DEFAULT 0,

            comment_count INTEGER DEFAULT 0,

            published_at TIMESTAMP DEFAULT NOW(),

            created_at TIMESTAMP DEFAULT NOW(),

            updated_at TIMESTAMP DEFAULT NOW(),

          CONSTRAINT chk_duration
CHECK(duration_seconds >= 0),

CONSTRAINT chk_season
CHECK(season_number >= 1),

CONSTRAINT chk_episode
CHECK(episode_number >= 1)

        );

        `);

        console.log("✅ podcast_episodes");


        /* ===========================================================
           PODCAST COMMENTS
        =========================================================== */

        await db.query(`

        CREATE TABLE IF NOT EXISTS podcast_comments (

            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

            episode_id UUID NOT NULL
                REFERENCES podcast_episodes(id)
                ON DELETE CASCADE,

            user_id UUID NOT NULL
                REFERENCES users(id)
                ON DELETE CASCADE,

            parent_id UUID
                REFERENCES podcast_comments(id)
                ON DELETE CASCADE,

            body TEXT NOT NULL,

            created_at TIMESTAMP DEFAULT NOW()

        );

        `);

        console.log("✅ podcast_comments");


        /* ===========================================================
           PODCAST FOLLOWS
        =========================================================== */

        await db.query(`

        CREATE TABLE IF NOT EXISTS podcast_follows (

            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

            show_id UUID NOT NULL
                REFERENCES podcast_shows(id)
                ON DELETE CASCADE,

            user_id UUID NOT NULL
                REFERENCES users(id)
                ON DELETE CASCADE,

            created_at TIMESTAMP DEFAULT NOW(),

            UNIQUE(show_id,user_id)

        );

        `);

        console.log("✅ podcast_follows");


        /* ===========================================================
           PODCAST LIKES
        =========================================================== */

        await db.query(`

        CREATE TABLE IF NOT EXISTS podcast_likes (

            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

            episode_id UUID NOT NULL
                REFERENCES podcast_episodes(id)
                ON DELETE CASCADE,

            user_id UUID NOT NULL
                REFERENCES users(id)
                ON DELETE CASCADE,

            created_at TIMESTAMP DEFAULT NOW(),

            UNIQUE(episode_id,user_id)

        );

        `);

        console.log("✅ podcast_likes");


        /* ===========================================================
           PODCAST LISTENS
        =========================================================== */

        await db.query(`

        CREATE TABLE IF NOT EXISTS podcast_listens (

            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

            episode_id UUID NOT NULL
                REFERENCES podcast_episodes(id)
                ON DELETE CASCADE,

            user_id UUID
                REFERENCES users(id)
                ON DELETE SET NULL,

            seconds_listened INTEGER DEFAULT 0,

            completed BOOLEAN DEFAULT FALSE,

            created_at TIMESTAMP DEFAULT NOW(),

            CONSTRAINT chk_seconds
            CHECK(seconds_listened >= 0)

        );

        `);

        console.log("✅ podcast_listens");


        /* ===========================================================
           PODCAST CHAPTERS
        =========================================================== */

        await db.query(`

        CREATE TABLE IF NOT EXISTS podcast_chapters (

            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

            episode_id UUID NOT NULL
                REFERENCES podcast_episodes(id)
                ON DELETE CASCADE,

            title VARCHAR(255) NOT NULL,

            start_seconds INTEGER NOT NULL,

           created_at TIMESTAMP DEFAULT NOW(),

CONSTRAINT chk_start
CHECK(start_seconds >= 0),

UNIQUE(episode_id, start_seconds)

);

        `);

        console.log("✅ podcast_chapters");

    /* ===========================================================
   INDEXES
=========================================================== */

console.log("Creating indexes...");

await db.query(`

CREATE INDEX IF NOT EXISTS idx_podcast_show_host
ON podcast_shows(host_id);

CREATE INDEX IF NOT EXISTS idx_podcast_episode_show
ON podcast_episodes(show_id);

CREATE INDEX IF NOT EXISTS idx_podcast_episode_host
ON podcast_episodes(host_id);

CREATE INDEX IF NOT EXISTS idx_podcast_episode_published
ON podcast_episodes(published_at DESC);

CREATE INDEX IF NOT EXISTS idx_podcast_comment_episode
ON podcast_comments(episode_id);

CREATE INDEX IF NOT EXISTS idx_podcast_comment_user
ON podcast_comments(user_id);

CREATE INDEX IF NOT EXISTS idx_podcast_follow_show
ON podcast_follows(show_id);

CREATE INDEX IF NOT EXISTS idx_podcast_follow_user
ON podcast_follows(user_id);

CREATE INDEX IF NOT EXISTS idx_podcast_like_episode
ON podcast_likes(episode_id);

CREATE INDEX IF NOT EXISTS idx_podcast_like_user
ON podcast_likes(user_id);

CREATE INDEX IF NOT EXISTS idx_podcast_listen_episode
ON podcast_listens(episode_id);

CREATE INDEX IF NOT EXISTS idx_podcast_listen_user
ON podcast_listens(user_id);

CREATE INDEX IF NOT EXISTS idx_podcast_chapter_episode
ON podcast_chapters(episode_id);

CREATE INDEX IF NOT EXISTS idx_podcast_show_created
ON podcast_shows(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_podcast_episode_created
ON podcast_episodes(created_at DESC);


CREATE INDEX IF NOT EXISTS idx_podcast_listen_user
ON podcast_listens(user_id);

CREATE INDEX IF NOT EXISTS idx_podcast_chapter_episode
ON podcast_chapters(episode_id);

CREATE INDEX IF NOT EXISTS idx_podcast_show_created
ON podcast_shows(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_podcast_episode_created
ON podcast_episodes(created_at DESC);

`);

console.log("✅ Indexes created");


/* ===========================================================
   UPDATE SHOW COUNTERS
=========================================================== */

await db.query(`

CREATE OR REPLACE FUNCTION update_podcast_show_counts()
RETURNS TRIGGER
LANGUAGE plpgsql
AS
$$

BEGIN

UPDATE podcast_shows
SET

follower_count =(
SELECT COUNT(*)
FROM podcast_follows
WHERE show_id = COALESCE(NEW.show_id,OLD.show_id)
),

episode_count = (
SELECT COUNT(*)
FROM podcast_episodes
WHERE show_id = COALESCE(NEW.show_id,OLD.show_id)
)

WHERE id = COALESCE(NEW.show_id,OLD.show_id);

RETURN NULL;

END;

$$;

`);

console.log("✅ Show counter function");


/* ===========================================================
   UPDATE EPISODE COUNTERS
=========================================================== */

await db.query(`

CREATE OR REPLACE FUNCTION update_episode_counts()
RETURNS TRIGGER
LANGUAGE plpgsql
AS
$$

BEGIN

UPDATE podcast_episodes
SET

comment_count = (
SELECT COUNT(*)
FROM podcast_comments
WHERE episode_id = COALESCE(NEW.episode_id,OLD.episode_id)
),

like_count = (
SELECT COUNT(*)
FROM podcast_likes
WHERE episode_id = COALESCE(NEW.episode_id,OLD.episode_id)
),

listen_count = (
SELECT COUNT(*)
FROM podcast_listens
WHERE episode_id = COALESCE(NEW.episode_id,OLD.episode_id)
)

WHERE id = COALESCE(NEW.episode_id,OLD.episode_id);

RETURN NULL;

END;

$$;

`);

console.log("✅ Episode counter function");



/* ===========================================================
   TRIGGERS
=========================================================== */

await db.query(`

DROP TRIGGER IF EXISTS trg_show_followers
ON podcast_follows;

CREATE TRIGGER trg_show_followers
AFTER INSERT OR DELETE
ON podcast_follows
FOR EACH ROW
EXECUTE FUNCTION update_podcast_show_counts();


DROP TRIGGER IF EXISTS trg_show_episodes
ON podcast_episodes;

CREATE TRIGGER trg_show_episodes
AFTER INSERT OR DELETE
ON podcast_episodes
FOR EACH ROW
EXECUTE FUNCTION update_podcast_show_counts();


DROP TRIGGER IF EXISTS trg_episode_comments
ON podcast_comments;

CREATE TRIGGER trg_episode_comments
AFTER INSERT OR DELETE
ON podcast_comments
FOR EACH ROW
EXECUTE FUNCTION update_episode_counts();


DROP TRIGGER IF EXISTS trg_episode_likes
ON podcast_likes;

CREATE TRIGGER trg_episode_likes
AFTER INSERT OR DELETE
ON podcast_likes
FOR EACH ROW
EXECUTE FUNCTION update_episode_counts();


DROP TRIGGER IF EXISTS trg_episode_listens
ON podcast_listens;

CREATE TRIGGER trg_episode_listens
AFTER INSERT OR DELETE
ON podcast_listens
FOR EACH ROW
EXECUTE FUNCTION update_episode_counts();

`);

console.log("✅ Triggers installed");


/* ===========================================================
   VERIFY
=========================================================== */

const verify = await db.query(`

SELECT table_name
FROM information_schema.tables
WHERE table_schema='public'
AND table_name LIKE 'podcast_%'
ORDER BY table_name;

`);

console.log("");
console.log("==================================");
console.log("PODCAST TABLES");
console.log("==================================");

console.table(verify.rows);

await db.query("COMMIT");

console.log("");
console.log("==================================");
console.log("🎉 PODCAST SYSTEM INSTALLED");
console.log("==================================");

process.exit(0);

} catch(err){

await db.query("ROLLBACK");

console.error("");
console.error("==================================");
console.error("INSTALL FAILED");
console.error("==================================");

console.error(err);

process.exit(1);

}

}

installPodcastSystem();