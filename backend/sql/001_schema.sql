-- ============================================================
-- vConnect — FULL CONSOLIDATED DATABASE SCHEMA
-- ------------------------------------------------------------
-- This single file merges:
--   1. Base schema (users, messaging, calls, live rooms, gifts,
--      coins/wallet, reports, social graph, misc tables)
--   2. Migration 002 (revenue sharing, Host Academy, anti-fraud)
--   3. Marketplace schema + seller applications
--   4. Tables required by the controllers/services you pasted
--      but missing from the original schema (posts, podcast
--      shows/episodes, and a couple of column additions)
--   5. Seed data (gift catalog, coin packages)
--   6. One default admin account
--
-- Safe to run top-to-bottom on a FRESH database. Every
-- CREATE TABLE uses IF NOT EXISTS and every ALTER uses
-- IF NOT EXISTS, so it is also safe to re-run against a DB that
-- already has some of these objects (idempotent migration).
--
-- Run with, e.g.:
--   psql "$DATABASE_URL" -f schema.sql
-- or wire it into your own migration runner script.
-- ============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. USERS & AUTH
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username             VARCHAR(50) UNIQUE NOT NULL,
    email                VARCHAR(255) UNIQUE NOT NULL,
    password_hash        VARCHAR(255),               -- NULL when user signs up via OAuth only
    display_name         VARCHAR(100),
    avatar_url           TEXT,
    cover_url            TEXT,                        -- used by userController.updateMe
    bio                  TEXT,
    gender               VARCHAR(20),
    date_of_birth        DATE,
    country              VARCHAR(100),
    interests            TEXT[],                      -- used for friend matching/discovery
    coin_balance         BIGINT NOT NULL DEFAULT 0,    -- coins available to spend
    earnings_balance     BIGINT NOT NULL DEFAULT 0,    -- coins earned from received gifts (withdrawable)
    is_verified          BOOLEAN NOT NULL DEFAULT FALSE,
    verification_doc_url TEXT,
    is_approved_seller   BOOLEAN NOT NULL DEFAULT FALSE, -- marketplace seller flag
    role                 VARCHAR(20) NOT NULL DEFAULT 'user', -- user | streamer | qualified_host | moderator | admin
    status               VARCHAR(20) NOT NULL DEFAULT 'active', -- active | suspended | banned
    last_seen_at         TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Backfill columns for anyone running this against an existing table
ALTER TABLE users ADD COLUMN IF NOT EXISTS cover_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_approved_seller BOOLEAN NOT NULL DEFAULT FALSE;

-- OAuth identities (Google / Facebook) linked to a user
CREATE TABLE IF NOT EXISTS oauth_accounts (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider         VARCHAR(20) NOT NULL,        -- google | facebook
    provider_user_id VARCHAR(255) NOT NULL,
    access_token     TEXT,
    refresh_token    TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provider, provider_user_id)
);

CREATE TABLE IF NOT EXISTS user_sessions (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token TEXT NOT NULL,
    device_name   VARCHAR(255),
    ip_address    VARCHAR(100),
    expires_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 2. FRIENDS / SOCIAL GRAPH
-- ============================================================

CREATE TABLE IF NOT EXISTS friend_requests (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sender_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status       VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | accepted | declined
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    responded_at TIMESTAMPTZ,
    UNIQUE (sender_id, receiver_id)
);

CREATE TABLE IF NOT EXISTS friendships (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id_a  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_id_b  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id_a, user_id_b),
    CHECK (user_id_a <> user_id_b)
);

CREATE TABLE IF NOT EXISTS blocks (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS followers (
    follower_id  UUID REFERENCES users(id) ON DELETE CASCADE,
    following_id UUID REFERENCES users(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (follower_id, following_id),
    CHECK (follower_id <> following_id)
);

CREATE TABLE IF NOT EXISTS profile_visits (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    visitor_id       UUID REFERENCES users(id),
    profile_owner_id UUID REFERENCES users(id),
    created_at       TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 3. MESSAGING (private chats)
-- ============================================================

CREATE TABLE IF NOT EXISTS conversations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    is_group        BOOLEAN NOT NULL DEFAULT FALSE,
    title           VARCHAR(150),
    created_by      UUID REFERENCES users(id),
    last_message_id UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversation_participants (
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_read_at    TIMESTAMPTZ,
    PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS typing_status (
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    is_typing       BOOLEAN DEFAULT FALSE,
    updated_at      TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body            TEXT,
    attachment_url  TEXT,
    attachment_type VARCHAR(50),
    message_type    VARCHAR(20) NOT NULL DEFAULT 'text',
    gift_id         UUID,
    delivered_at    TIMESTAMPTZ,
    read_at         TIMESTAMPTZ,
    edited_at       TIMESTAMPTZ,
    is_deleted      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS message_reactions (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    message_id  UUID REFERENCES messages(id) ON DELETE CASCADE,
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    reaction    VARCHAR(20),
    created_at  TIMESTAMPTZ DEFAULT now(),
    UNIQUE (message_id, user_id, reaction)
);

-- ============================================================
-- 4. CALLS (voice / video, 1:1)
-- ============================================================

CREATE TABLE IF NOT EXISTS calls (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    caller_id        UUID NOT NULL REFERENCES users(id),
    callee_id        UUID NOT NULL REFERENCES users(id),
    call_type        VARCHAR(10) NOT NULL,        -- voice | video
    status           VARCHAR(20) NOT NULL DEFAULT 'initiated', -- initiated|ringing|accepted|rejected|missed|ended
    started_at       TIMESTAMPTZ,
    ended_at         TIMESTAMPTZ,
    duration_seconds INT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS call_recordings (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    call_id       UUID REFERENCES calls(id) ON DELETE CASCADE,
    recording_url TEXT,
    created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS call_signals (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    call_id     UUID REFERENCES calls(id) ON DELETE CASCADE,
    sender_id   UUID REFERENCES users(id),
    signal_type VARCHAR(20),
    signal_data JSONB,
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 5. LIVE STREAMING ROOMS
-- ============================================================

CREATE TABLE IF NOT EXISTS live_rooms (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    host_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title              VARCHAR(150) NOT NULL,
    description        TEXT,
    cover_image_url    TEXT,
    channel_name       VARCHAR(255),
    stream_key         VARCHAR(255),
    agora_app_id       VARCHAR(255),
    status             VARCHAR(20) NOT NULL DEFAULT 'live',
    viewer_count       INT NOT NULL DEFAULT 0,
    started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at           TIMESTAMPTZ,
    total_coins_earned BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS live_room_viewers (
    id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_id  UUID NOT NULL REFERENCES live_rooms(id) ON DELETE CASCADE,
    user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    left_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS live_room_messages (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_id      UUID NOT NULL REFERENCES live_rooms(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body         TEXT,
    message_type VARCHAR(20) NOT NULL DEFAULT 'comment', -- comment | reaction | gift | join | system
    gift_id      UUID,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS room_members (
    room_id   UUID REFERENCES live_rooms(id) ON DELETE CASCADE,
    user_id   UUID REFERENCES users(id) ON DELETE CASCADE,
    role      VARCHAR(20) DEFAULT 'viewer',
    joined_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (room_id, user_id)
);

CREATE TABLE IF NOT EXISTS room_moderators (
    room_id    UUID REFERENCES live_rooms(id) ON DELETE CASCADE,
    user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (room_id, user_id)
);

CREATE TABLE IF NOT EXISTS room_bans (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_id    UUID REFERENCES live_rooms(id) ON DELETE CASCADE,
    user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
    banned_by  UUID REFERENCES users(id),
    reason     TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS room_leaderboards (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_id    UUID REFERENCES live_rooms(id) ON DELETE CASCADE,
    user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
    coins_sent BIGINT DEFAULT 0,
    UNIQUE (room_id, user_id)
);

CREATE TABLE IF NOT EXISTS room_battles (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_a     UUID REFERENCES live_rooms(id),
    room_b     UUID REFERENCES live_rooms(id),
    started_at TIMESTAMPTZ,
    ended_at   TIMESTAMPTZ,
    winner_room UUID
);

CREATE TABLE IF NOT EXISTS battle_scores (
    id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    battle_id UUID REFERENCES room_battles(id) ON DELETE CASCADE,
    room_id   UUID REFERENCES live_rooms(id) ON DELETE CASCADE,
    coins     BIGINT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stream_recordings (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_id          UUID REFERENCES live_rooms(id),
    recording_url    TEXT,
    duration_seconds INT,
    created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_presence (
    user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    socket_id       VARCHAR(255),
    is_online       BOOLEAN DEFAULT FALSE,
    current_room_id UUID,
    last_seen_at    TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 6. VIRTUAL GIFTS CATALOG + TRANSACTIONS (incl. migration 002)
-- ============================================================

CREATE TABLE IF NOT EXISTS gifts (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name               VARCHAR(100) NOT NULL,
    emoji              VARCHAR(10),
    icon_url           TEXT,
    animation_url      TEXT,
    sound_url          TEXT,
    animation_duration INT,
    animation_type     VARCHAR(50),
    price_coins        INT NOT NULL CHECK (price_coins > 0),
    category           VARCHAR(30) NOT NULL DEFAULT 'standard',
    is_active          BOOLEAN NOT NULL DEFAULT TRUE,
    is_golden_love     BOOLEAN NOT NULL DEFAULT FALSE, -- qualifies for Host Academy (migration 002)
    sort_order         INT NOT NULL DEFAULT 0,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE gifts ADD COLUMN IF NOT EXISTS is_golden_love BOOLEAN NOT NULL DEFAULT FALSE;

-- Record of every gift sent (1:1 chat, call, live room, podcast, profile)
CREATE TABLE IF NOT EXISTS gift_transactions (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    gift_id              UUID NOT NULL REFERENCES gifts(id),
    sender_id            UUID NOT NULL REFERENCES users(id),
    receiver_id          UUID NOT NULL REFERENCES users(id),
    quantity             INT NOT NULL DEFAULT 1,
    total_coins          BIGINT NOT NULL,
    commission_rate      NUMERIC(5,2) DEFAULT 0,
    streamer_earnings    BIGINT DEFAULT 0,
    host_share_coins     INTEGER NOT NULL DEFAULT 0,   -- migration 002: 70% split to receiver
    platform_share_coins INTEGER NOT NULL DEFAULT 0,   -- migration 002: 30% split to platform
    status               TEXT NOT NULL DEFAULT 'completed', -- completed | refunded
    is_golden_love       BOOLEAN NOT NULL DEFAULT FALSE,
    context_type         VARCHAR(20) NOT NULL, -- chat | call | live_room | podcast | profile
    context_id           UUID,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (quantity > 0),
    CHECK (total_coins >= 0)
);

ALTER TABLE gift_transactions
  ADD COLUMN IF NOT EXISTS host_share_coins     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS platform_share_coins INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status                TEXT NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS is_golden_love        BOOLEAN NOT NULL DEFAULT FALSE;

-- ============================================================
-- 7. COINS: PACKAGES, PURCHASES, WALLET LEDGER, WITHDRAWALS,
--    PLATFORM WALLET (migration 002)
-- ============================================================

CREATE TABLE IF NOT EXISTS coin_packages (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name         VARCHAR(100) NOT NULL,
    coins        INT NOT NULL,
    bonus_coins  INT NOT NULL DEFAULT 0,
    price_amount NUMERIC(12,2) NOT NULL,        -- real-world money amount
    currency     VARCHAR(10) NOT NULL DEFAULT 'NGN',
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order   INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS payment_transactions (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id            UUID NOT NULL REFERENCES users(id),
    coin_package_id    UUID REFERENCES coin_packages(id),
    provider           VARCHAR(20) NOT NULL DEFAULT 'opay', -- opay|stripe|flutterwave|paypal|cashapp|ipay|crypto
    provider_reference VARCHAR(150) UNIQUE,        -- e.g. OPay orderNo / Stripe session id / etc.
    amount             NUMERIC(12,2) NOT NULL,
    currency           VARCHAR(10) NOT NULL DEFAULT 'NGN',
    coins_credited     INT,
    status             VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending|success|failed|cancelled
    raw_response       JSONB,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Single source of truth for every coin movement (purchase, gift sent, gift received, withdrawal, admin adjustment)
CREATE TABLE IF NOT EXISTS wallet_ledger (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type           VARCHAR(30) NOT NULL,  -- purchase|gift_sent|gift_received|withdrawal|refund|admin_adjustment
    amount         BIGINT NOT NULL,       -- positive = credit, negative = debit
    balance_after  BIGINT NOT NULL,
    reference_type VARCHAR(30),           -- payment_transactions|gift_transactions|withdrawal_requests
    reference_id   UUID,
    description    TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS withdrawal_requests (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id              UUID NOT NULL REFERENCES users(id),
    coins_requested      BIGINT NOT NULL,
    cash_amount          NUMERIC(12,2) NOT NULL,
    currency             VARCHAR(10) NOT NULL DEFAULT 'NGN',
    bank_account_name    VARCHAR(150),
    bank_account_number  VARCHAR(50),
    bank_name            VARCHAR(150),
    status               VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending|approved|rejected|paid
    admin_note           TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at         TIMESTAMPTZ
);

-- Platform's running balance (its 30% cut of every gift) — migration 002
CREATE TABLE IF NOT EXISTS platform_wallet (
  id      SMALLINT PRIMARY KEY DEFAULT 1,
  balance BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT platform_wallet_single_row CHECK (id = 1)
);
INSERT INTO platform_wallet (id, balance) VALUES (1, 0)
  ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS platform_wallet_ledger (
  id             BIGSERIAL PRIMARY KEY,
  amount         INTEGER NOT NULL,
  balance_after  BIGINT NOT NULL,
  reference_type TEXT,
  reference_id UUID,
  description    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 8. REPORTS / MODERATION
-- ============================================================

CREATE TABLE IF NOT EXISTS reports (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reporter_id       UUID NOT NULL REFERENCES users(id),
    reported_user_id  UUID REFERENCES users(id),
    context_type      VARCHAR(30),  -- message | live_room | profile | call
    context_id        UUID,
    reason            VARCHAR(100) NOT NULL,
    details           TEXT,
    status            VARCHAR(20) NOT NULL DEFAULT 'open', -- open|reviewed|dismissed
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS verification_requests (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id       UUID REFERENCES users(id),
    document_url  TEXT,
    status        VARCHAR(20) DEFAULT 'pending',
    admin_note    TEXT,
    created_at    TIMESTAMPTZ DEFAULT now(),
    reviewed_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS admin_logs (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    admin_id    UUID REFERENCES users(id),
    action      VARCHAR(100),
    target_type VARCHAR(50),
    target_id   UUID,
    details     JSONB,
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 9. NOTIFICATIONS / DEVICE TOKENS
--    (columns cover both naming conventions used across
--    controllers: reference_id/reference_type AND ref_id/ref_type)
-- ============================================================

CREATE TABLE IF NOT EXISTS notifications (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id        UUID REFERENCES users(id) ON DELETE CASCADE,
    type           VARCHAR(50),
    title          VARCHAR(255),
    body           TEXT,
    reference_type VARCHAR(50),
    reference_id   UUID,
    ref_type       VARCHAR(50),
    ref_id         UUID,
    is_read        BOOLEAN DEFAULT FALSE,
    read_at        TIMESTAMPTZ,
    created_at     TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS ref_type VARCHAR(50);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS ref_id UUID;

CREATE TABLE IF NOT EXISTS device_tokens (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id    UUID REFERENCES users(id),
    token      TEXT NOT NULL,
    platform   VARCHAR(20),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 10. STORIES
-- ============================================================

CREATE TABLE IF NOT EXISTS stories (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id    UUID REFERENCES users(id),
    media_url  TEXT,
    media_type VARCHAR(20) DEFAULT 'image',
    caption    TEXT,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE stories ADD COLUMN IF NOT EXISTS media_type VARCHAR(20) DEFAULT 'image';

CREATE TABLE IF NOT EXISTS story_views (
    story_id  UUID REFERENCES stories(id) ON DELETE CASCADE,
    viewer_id UUID REFERENCES users(id) ON DELETE CASCADE,
    viewed_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (story_id, viewer_id)
);

-- ============================================================
-- 11. FEED POSTS (used by postController.js — not in original
--     schema, added here so createPost/getFeed/likes/comments work)
-- ============================================================

CREATE TABLE IF NOT EXISTS posts (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    caption     TEXT,
    media_urls  JSONB NOT NULL DEFAULT '[]',  -- [{ "url": "...", "type": "image"|"video" }, ...]
    media_type  VARCHAR(20) NOT NULL DEFAULT 'text', -- text | image | video | mixed
    tags        TEXT[] NOT NULL DEFAULT '{}',
    is_deleted  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS post_likes (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id    UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS post_comments (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id    UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 12. PODCASTS (used by podcastController.js /
--     podcastService.js — not in original schema)
-- ============================================================

CREATE TABLE IF NOT EXISTS podcast_shows (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    host_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title           VARCHAR(150) NOT NULL,
    description     TEXT,
    category        VARCHAR(60),
    cover_url       TEXT,
    language        VARCHAR(40) DEFAULT 'English',
    explicit        BOOLEAN DEFAULT FALSE,
    follower_count  INT NOT NULL DEFAULT 0,
    episode_count   INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS podcast_follows (
    show_id    UUID NOT NULL REFERENCES podcast_shows(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (show_id, user_id)
);

CREATE TABLE IF NOT EXISTS podcast_episodes (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    show_id          UUID REFERENCES podcast_shows(id) ON DELETE CASCADE,
    host_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title            VARCHAR(200) NOT NULL,
    description      TEXT,
    audio_url        TEXT NOT NULL,
    cover_url        TEXT,
    duration_seconds INT DEFAULT 0,
    season_number    INT DEFAULT 1,
    episode_number   INT DEFAULT 1,
    listen_count     INT NOT NULL DEFAULT 0,
    like_count       INT NOT NULL DEFAULT 0,
    comment_count    INT NOT NULL DEFAULT 0,
    published_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS podcast_likes (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    episode_id UUID NOT NULL REFERENCES podcast_episodes(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (episode_id, user_id)
);

CREATE TABLE IF NOT EXISTS podcast_listens (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    episode_id        UUID NOT NULL REFERENCES podcast_episodes(id) ON DELETE CASCADE,
    user_id           UUID REFERENCES users(id) ON DELETE SET NULL, -- nullable: guests can listen too
    seconds_listened  INT DEFAULT 0,
    completed         BOOLEAN DEFAULT FALSE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS podcast_comments (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    episode_id UUID NOT NULL REFERENCES podcast_episodes(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body       TEXT NOT NULL,
    parent_id  UUID REFERENCES podcast_comments(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS podcast_chapters (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    episode_id    UUID NOT NULL REFERENCES podcast_episodes(id) ON DELETE CASCADE,
    title         VARCHAR(150) NOT NULL,
    start_seconds INT NOT NULL,
    UNIQUE (episode_id, start_seconds)
);

-- Keep podcast_shows.follower_count / episode_count and
-- podcast_episodes.listen_count / like_count / comment_count in sync
-- automatically, since podcastService reads them directly.

CREATE OR REPLACE FUNCTION trg_podcast_follow_count() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE podcast_shows SET follower_count = follower_count + 1 WHERE id = NEW.show_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE podcast_shows SET follower_count = GREATEST(follower_count - 1, 0) WHERE id = OLD.show_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_podcast_follows_ins ON podcast_follows;
CREATE TRIGGER trg_podcast_follows_ins AFTER INSERT ON podcast_follows
  FOR EACH ROW EXECUTE FUNCTION trg_podcast_follow_count();

DROP TRIGGER IF EXISTS trg_podcast_follows_del ON podcast_follows;
CREATE TRIGGER trg_podcast_follows_del AFTER DELETE ON podcast_follows
  FOR EACH ROW EXECUTE FUNCTION trg_podcast_follow_count();

CREATE OR REPLACE FUNCTION trg_podcast_episode_count() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.show_id IS NOT NULL THEN
    UPDATE podcast_shows SET episode_count = episode_count + 1 WHERE id = NEW.show_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' AND OLD.show_id IS NOT NULL THEN
    UPDATE podcast_shows SET episode_count = GREATEST(episode_count - 1, 0) WHERE id = OLD.show_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_podcast_episodes_ins ON podcast_episodes;
CREATE TRIGGER trg_podcast_episodes_ins AFTER INSERT ON podcast_episodes
  FOR EACH ROW EXECUTE FUNCTION trg_podcast_episode_count();

DROP TRIGGER IF EXISTS trg_podcast_episodes_del ON podcast_episodes;
CREATE TRIGGER trg_podcast_episodes_del AFTER DELETE ON podcast_episodes
  FOR EACH ROW EXECUTE FUNCTION trg_podcast_episode_count();

CREATE OR REPLACE FUNCTION trg_podcast_like_count() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE podcast_episodes SET like_count = like_count + 1 WHERE id = NEW.episode_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE podcast_episodes SET like_count = GREATEST(like_count - 1, 0) WHERE id = OLD.episode_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_podcast_likes_ins ON podcast_likes;
CREATE TRIGGER trg_podcast_likes_ins AFTER INSERT ON podcast_likes
  FOR EACH ROW EXECUTE FUNCTION trg_podcast_like_count();

DROP TRIGGER IF EXISTS trg_podcast_likes_del ON podcast_likes;
CREATE TRIGGER trg_podcast_likes_del AFTER DELETE ON podcast_likes
  FOR EACH ROW EXECUTE FUNCTION trg_podcast_like_count();

CREATE OR REPLACE FUNCTION trg_podcast_listen_count() RETURNS TRIGGER AS $$
BEGIN
  UPDATE podcast_episodes SET listen_count = listen_count + 1 WHERE id = NEW.episode_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_podcast_listens_ins ON podcast_listens;
CREATE TRIGGER trg_podcast_listens_ins AFTER INSERT ON podcast_listens
  FOR EACH ROW EXECUTE FUNCTION trg_podcast_listen_count();

CREATE OR REPLACE FUNCTION trg_podcast_comment_count() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE podcast_episodes SET comment_count = comment_count + 1 WHERE id = NEW.episode_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE podcast_episodes SET comment_count = GREATEST(comment_count - 1, 0) WHERE id = OLD.episode_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_podcast_comments_ins ON podcast_comments;
CREATE TRIGGER trg_podcast_comments_ins AFTER INSERT ON podcast_comments
  FOR EACH ROW EXECUTE FUNCTION trg_podcast_comment_count();

DROP TRIGGER IF EXISTS trg_podcast_comments_del ON podcast_comments;
CREATE TRIGGER trg_podcast_comments_del AFTER DELETE ON podcast_comments
  FOR EACH ROW EXECUTE FUNCTION trg_podcast_comment_count();

-- ============================================================
-- 13. HOST ACADEMY + ANTI-FRAUD (migration 002)
-- ============================================================

CREATE TABLE IF NOT EXISTS host_academy_progress (
  user_id                    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  current_day                SMALLINT NOT NULL DEFAULT 1 CHECK (current_day BETWEEN 1 AND 7),
  consecutive_days_completed SMALLINT NOT NULL DEFAULT 0,
  last_qualifying_date       DATE,
  unlocked                   BOOLEAN NOT NULL DEFAULT FALSE,
  unlocked_at                TIMESTAMPTZ,
  badge_awarded              BOOLEAN NOT NULL DEFAULT FALSE,
  fraud_hold                 BOOLEAN NOT NULL DEFAULT FALSE,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- one row per user per calendar day — source of truth for "did they qualify today"
CREATE TABLE IF NOT EXISTS host_academy_daily_log (
  id                  BIGSERIAL PRIMARY KEY,
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_date            DATE NOT NULL,
  golden_love_count   SMALLINT NOT NULL DEFAULT 0,
  golden_love_senders UUID[] NOT NULL DEFAULT '{}',   -- distinct sender ids today
  tasks_completed     TEXT[] NOT NULL DEFAULT '{}',   -- e.g. {'active_30m','new_followers'}
  day_completed       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, log_date)
);

CREATE TABLE IF NOT EXISTS device_fingerprints (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_hash TEXT NOT NULL,
  ip_address  INET,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fraud_flags (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  reason     TEXT NOT NULL,     -- e.g. 'self_gift_attempt', 'device_duplication', 'gift_farming'
  details    JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 14. MARKETPLACE (listings, orders, seller applications)
-- ============================================================

CREATE TABLE IF NOT EXISTS marketplace_categories (
  key        VARCHAR(40) PRIMARY KEY,
  label      VARCHAR(80) NOT NULL,
  icon       VARCHAR(10),
  sort_order INT DEFAULT 0,
  is_active  BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS marketplace_listings (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  seller_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       VARCHAR(100) NOT NULL,
  description TEXT,
  category    VARCHAR(40) NOT NULL REFERENCES marketplace_categories(key),
  condition   VARCHAR(20) NOT NULL DEFAULT 'new'
              CHECK (condition IN ('new','like_new','good','fair','digital')),
  price_coins NUMERIC NOT NULL CHECK (price_coins > 0),
  quantity    INT NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  images      JSONB NOT NULL DEFAULT '[]',     -- [{ "url": "...", "type": "image" }, ...]
  status      VARCHAR(20) NOT NULL DEFAULT 'active'
              CHECK (status IN ('active','sold','removed','flagged')),
  views_count INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS marketplace_orders (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  listing_id          UUID NOT NULL REFERENCES marketplace_listings(id) ON DELETE RESTRICT,
  buyer_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seller_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quantity            INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_coins    NUMERIC NOT NULL,
  total_coins         NUMERIC NOT NULL,           -- unit_price_coins * quantity
  platform_fee_pct    NUMERIC NOT NULL DEFAULT 10, -- % kept by the platform
  platform_fee_coins  NUMERIC NOT NULL,
  seller_payout_coins NUMERIC NOT NULL,           -- total_coins - platform_fee_coins
  status              VARCHAR(20) NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','shipped','delivered','cancelled','refunded')),
  buyer_note          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS marketplace_order_events (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id    UUID NOT NULL REFERENCES marketplace_orders(id) ON DELETE CASCADE,
  from_status VARCHAR(20),
  to_status   VARCHAR(20) NOT NULL,
  actor_id    UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS seller_applications (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status            VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected')),
  business_name     VARCHAR(120),
  reason            TEXT,
  contact_info      TEXT,
  reviewed_by       UUID REFERENCES users(id),
  reviewed_at       TIMESTAMPTZ,
  rejection_reason  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one pending application per user at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_seller_apps_one_pending
  ON seller_applications(user_id) WHERE status = 'pending';

-- ============================================================
-- 15. SYSTEM SETTINGS
-- ============================================================

CREATE TABLE IF NOT EXISTS system_settings (
    setting_key   VARCHAR(100) PRIMARY KEY,
    setting_value TEXT,
    updated_at    TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 16. TRIGGERS: keep updated_at fresh
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_payment_tx_updated_at ON payment_transactions;
CREATE TRIGGER trg_payment_tx_updated_at BEFORE UPDATE ON payment_transactions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_mkt_listings_updated ON marketplace_listings;
CREATE TRIGGER trg_mkt_listings_updated BEFORE UPDATE ON marketplace_listings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_mkt_orders_updated ON marketplace_orders;
CREATE TRIGGER trg_mkt_orders_updated BEFORE UPDATE ON marketplace_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_seller_apps_updated ON seller_applications;
CREATE TRIGGER trg_seller_apps_updated BEFORE UPDATE ON seller_applications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_posts_updated ON posts;
CREATE TRIGGER trg_posts_updated BEFORE UPDATE ON posts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_podcast_shows_updated ON podcast_shows;
CREATE TRIGGER trg_podcast_shows_updated BEFORE UPDATE ON podcast_shows
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_podcast_episodes_updated ON podcast_episodes;
CREATE TRIGGER trg_podcast_episodes_updated BEFORE UPDATE ON podcast_episodes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 17. INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_users_username            ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email               ON users(email);
CREATE INDEX IF NOT EXISTS idx_friend_requests_receiver  ON friend_requests(receiver_id);
CREATE INDEX IF NOT EXISTS idx_calls_callee              ON calls(callee_id);
CREATE INDEX IF NOT EXISTS idx_calls_caller              ON calls(caller_id);
CREATE INDEX IF NOT EXISTS idx_live_rooms_host           ON live_rooms(host_id);
CREATE INDEX IF NOT EXISTS idx_payment_user              ON payment_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation     ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_sender           ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_gift_tx_receiver          ON gift_transactions(receiver_id, created_at);
CREATE INDEX IF NOT EXISTS idx_gift_sender               ON gift_transactions(sender_id);
CREATE INDEX IF NOT EXISTS idx_gift_context              ON gift_transactions(context_type, context_id);
CREATE INDEX IF NOT EXISTS idx_wallet_ledger_user        ON wallet_ledger(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user        ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_story_user                ON stories(user_id);
CREATE INDEX IF NOT EXISTS idx_room_viewers_room         ON live_room_viewers(room_id);
CREATE INDEX IF NOT EXISTS idx_room_messages_user        ON live_room_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_live_room_messages_room   ON live_room_messages(room_id, created_at);
CREATE INDEX IF NOT EXISTS idx_host_academy_daily_log_user_date
  ON host_academy_daily_log (user_id, log_date);
CREATE INDEX IF NOT EXISTS idx_device_fingerprints_hash  ON device_fingerprints (device_hash);
CREATE INDEX IF NOT EXISTS idx_device_fingerprints_ip    ON device_fingerprints (ip_address);

CREATE INDEX IF NOT EXISTS idx_mkt_listings_category ON marketplace_listings(category);
CREATE INDEX IF NOT EXISTS idx_mkt_listings_seller   ON marketplace_listings(seller_id);
CREATE INDEX IF NOT EXISTS idx_mkt_listings_status   ON marketplace_listings(status);
CREATE INDEX IF NOT EXISTS idx_mkt_listings_created  ON marketplace_listings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mkt_listings_search
  ON marketplace_listings USING GIN (to_tsvector('english', title || ' ' || coalesce(description,'')));
CREATE INDEX IF NOT EXISTS idx_mkt_orders_buyer   ON marketplace_orders(buyer_id);
CREATE INDEX IF NOT EXISTS idx_mkt_orders_seller  ON marketplace_orders(seller_id);
CREATE INDEX IF NOT EXISTS idx_mkt_orders_listing ON marketplace_orders(listing_id);
CREATE INDEX IF NOT EXISTS idx_mkt_orders_status  ON marketplace_orders(status);
CREATE INDEX IF NOT EXISTS idx_seller_apps_user   ON seller_applications(user_id);
CREATE INDEX IF NOT EXISTS idx_seller_apps_status ON seller_applications(status);

CREATE INDEX IF NOT EXISTS idx_posts_user            ON posts(user_id);
CREATE INDEX IF NOT EXISTS idx_posts_created         ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_likes_post       ON post_likes(post_id);
CREATE INDEX IF NOT EXISTS idx_post_comments_post     ON post_comments(post_id);

CREATE INDEX IF NOT EXISTS idx_podcast_shows_host          ON podcast_shows(host_id);
CREATE INDEX IF NOT EXISTS idx_podcast_episodes_show       ON podcast_episodes(show_id);
CREATE INDEX IF NOT EXISTS idx_podcast_episodes_host       ON podcast_episodes(host_id);
CREATE INDEX IF NOT EXISTS idx_podcast_episodes_published  ON podcast_episodes(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_podcast_comments_episode    ON podcast_comments(episode_id);
CREATE INDEX IF NOT EXISTS idx_podcast_listens_episode     ON podcast_listens(episode_id);

-- ============================================================
-- 18. SEED DATA — marketplace categories
-- ============================================================

INSERT INTO marketplace_categories (key, label, icon, sort_order) VALUES
  ('fashion',     'Fashion',             '👗', 1),
  ('beauty',      'Beauty',              '💄', 2),
  ('electronics', 'Electronics',         '📱', 3),
  ('home',        'Home & Living',       '🏠', 4),
  ('digital',     'Digital & Services',  '💻', 5),
  ('vouchers',    'Gift Cards',          '🎟️', 6),
  ('handmade',    'Art & Handmade',      '🎨', 7)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 19. SEED DATA — Virtual Gifts Catalog & Coin Packages
-- ============================================================

INSERT INTO gifts (name, emoji, price_coins, category, sort_order)
SELECT * FROM (VALUES
  ('Rose',           '🌹', 5,    'standard', 1),
  ('Heart',          '❤️', 10,   'standard', 2),
  ('Golden Love',    '💛', 25,   'standard', 3),
  ('Clap',           '👏', 15,   'standard', 4),
  ('Kiss',           '💋', 20,   'standard', 5),
  ('Teddy Bear',     '🧸', 50,   'premium',  6),
  ('Bouquet',        '💐', 75,   'premium',  7),
  ('Ring',           '💍', 150,  'premium',  8),
  ('Diamond',        '💎', 200,  'premium',  9),
  ('Crown',          '👑', 500,  'luxury',   10),
  ('Sports Car',     '🏎️', 1000, 'luxury',   11),
  ('Yacht',          '🛥️', 2500, 'luxury',   12),
  ('Private Jet',    '✈️', 5000, 'luxury',   13),
  ('Castle',         '🏰', 10000,'luxury',   14),
  ('Fireworks',      '🎆', 300,  'event',    15),
  ('Birthday Cake',  '🎂', 80,   'event',    16)
) AS v(name, emoji, price_coins, category, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM gifts WHERE gifts.name = v.name);

-- "Golden Love" is the gift that counts toward Host Academy qualification
UPDATE gifts SET is_golden_love = TRUE WHERE name = 'Golden Love';

INSERT INTO coin_packages (name, coins, bonus_coins, price_amount, currency, sort_order)
SELECT * FROM (VALUES
  ('Starter Pack',   100,   0,    500.00,   'NGN', 1),
  ('Popular Pack',   550,   50,   2500.00,  'NGN', 2),
  ('Value Pack',     1200,  150,  5000.00,  'NGN', 3),
  ('Pro Pack',       2600,  400,  10000.00, 'NGN', 4),
  ('VIP Pack',       7000,  1500, 25000.00, 'NGN', 5),
  ('Elite Pack',     15000, 4000, 50000.00, 'NGN', 6)
) AS v(name, coins, bonus_coins, price_amount, currency, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM coin_packages WHERE coin_packages.name = v.name);

-- ============================================================
-- 20. DEFAULT ADMIN ACCOUNT
-- ------------------------------------------------------------
--   email:    admin@vconnect.com
--   username: admin
--   password: Admin@12345   <-- CHANGE THIS IMMEDIATELY AFTER
--                                FIRST LOGIN. The hash below is
--                                bcrypt (cost 12) for this exact
--                                password, generated specifically
--                                for this seed file.
-- ============================================================

INSERT INTO users (
    username, email, password_hash, display_name,
    role, status, is_verified, coin_balance, earnings_balance
)
VALUES (
    'admin',
    'admin@vconnect.com',
    '$2b$12$i/5LPhAdDuqfoB1vbpL9WONfy2O6hW1JCsftD7qsbE1Z5CBY2UUKa',
    'vConnect Admin',
    'admin',
    'active',
    TRUE,
    0,
    0
)
ON CONFLICT (email) DO NOTHING;

COMMIT;

-- ============================================================
-- DONE.
-- Remember to:
--   1. Log in as admin@vconnect.com / Admin@12345 and change the
--      password immediately.
--   2. Set all provider env vars (OPay, Stripe, Flutterwave,
--      PayPal, Square/Cash App, NOWPayments, Appwrite, Google/FB
--      OAuth) before enabling those routes in production.
-- ============================================================