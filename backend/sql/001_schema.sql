-- ==========================================================
-- vConnect Database Schema (PostgreSQL)
-- ==========================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------
-- USERS
-- ---------------------------------------------------------
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username        VARCHAR(50) UNIQUE NOT NULL,
    email           VARCHAR(255) UNIQUE NOT NULL,
    password_hash   VARCHAR(255),               -- NULL when user signs up via OAuth only
    display_name    VARCHAR(100),
    avatar_url      TEXT,
    bio             TEXT,
    gender          VARCHAR(20),
    date_of_birth   DATE,
    country         VARCHAR(100),
    interests       TEXT[],                     -- used for friend matching/discovery
    coin_balance    BIGINT NOT NULL DEFAULT 0,   -- coins available to spend
    earnings_balance BIGINT NOT NULL DEFAULT 0,  -- coins earned from received gifts (withdrawable)
    is_verified     BOOLEAN NOT NULL DEFAULT FALSE,
    verification_doc_url TEXT,
    role            VARCHAR(20) NOT NULL DEFAULT 'user', -- user | streamer | moderator | admin
    status          VARCHAR(20) NOT NULL DEFAULT 'active', -- active | suspended | banned
    last_seen_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- OAuth identities (Google / Facebook) linked to a user
CREATE TABLE oauth_accounts (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider        VARCHAR(20) NOT NULL,        -- google | facebook
    provider_user_id VARCHAR(255) NOT NULL,
    access_token    TEXT,
    refresh_token   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provider, provider_user_id)
);



CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    refresh_token TEXT NOT NULL,

    device_name VARCHAR(255),

    ip_address VARCHAR(100),

    expires_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT now()
);

-- ---------------------------------------------------------
-- FRIENDS / SOCIAL GRAPH
-- ---------------------------------------------------------
CREATE TABLE friend_requests (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sender_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status          VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | accepted | declined
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    responded_at    TIMESTAMPTZ,
    UNIQUE (sender_id, receiver_id)
);



CREATE TABLE friendships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    user_id_a UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    user_id_b UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE(user_id_a,user_id_b),

    CHECK(user_id_a <> user_id_b)
);




CREATE TABLE blocks (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    blocker_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (blocker_id, blocked_id)
);

-- ---------------------------------------------------------
-- MESSAGING (Private Chats)
-- ---------------------------------------------------------
CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    is_group BOOLEAN NOT NULL DEFAULT FALSE,
    title VARCHAR(150),
    created_by UUID REFERENCES users(id),
    last_message_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);



CREATE TABLE conversation_participants (
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_read_at    TIMESTAMPTZ,
    PRIMARY KEY (conversation_id, user_id)
);



CREATE TABLE typing_status (
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,

    user_id UUID REFERENCES users(id) ON DELETE CASCADE,

    is_typing BOOLEAN DEFAULT FALSE,

    updated_at TIMESTAMPTZ DEFAULT now(),

    PRIMARY KEY(conversation_id,user_id)
);



CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,

    sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    body TEXT,

    attachment_url TEXT,

    attachment_type VARCHAR(50),

    message_type VARCHAR(20) NOT NULL DEFAULT 'text',

    gift_id UUID,

    delivered_at TIMESTAMPTZ,

    read_at TIMESTAMPTZ,

    edited_at TIMESTAMPTZ,

    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);

-- ---------------------------------------------------------
-- CALLS (Voice / Video, 1:1)
-- ---------------------------------------------------------
CREATE TABLE calls (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    caller_id       UUID NOT NULL REFERENCES users(id),
    callee_id       UUID NOT NULL REFERENCES users(id),
    call_type       VARCHAR(10) NOT NULL,        -- voice | video
    status          VARCHAR(20) NOT NULL DEFAULT 'initiated', -- initiated|ringing|accepted|rejected|missed|ended
    started_at      TIMESTAMPTZ,
    ended_at        TIMESTAMPTZ,
    duration_seconds INT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------
-- LIVE STREAMING ROOMS
-- ---------------------------------------------------------
CREATE TABLE live_rooms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    host_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    title VARCHAR(150) NOT NULL,

    description TEXT,

    cover_image_url TEXT,

    channel_name VARCHAR(255),

    stream_key VARCHAR(255),

    agora_app_id VARCHAR(255),

    status VARCHAR(20) NOT NULL DEFAULT 'live',

    viewer_count INT NOT NULL DEFAULT 0,

    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    ended_at TIMESTAMPTZ,

    total_coins_earned BIGINT NOT NULL DEFAULT 0
);


CREATE TABLE live_room_viewers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    room_id UUID NOT NULL REFERENCES live_rooms(id) ON DELETE CASCADE,

    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    left_at TIMESTAMPTZ
);



CREATE TABLE live_room_messages (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_id         UUID NOT NULL REFERENCES live_rooms(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body            TEXT,
    message_type    VARCHAR(20) NOT NULL DEFAULT 'comment', -- comment | reaction | gift | join | system
    gift_id         UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_live_room_messages_room ON live_room_messages(room_id, created_at);

-- ---------------------------------------------------------
-- VIRTUAL GIFTS CATALOG
-- ---------------------------------------------------------
CREATE TABLE gifts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    name VARCHAR(100) NOT NULL,

    emoji VARCHAR(10),

    icon_url TEXT,

    animation_url TEXT,

    sound_url TEXT,

    animation_duration INT,

    animation_type VARCHAR(50),

    price_coins INT NOT NULL CHECK (price_coins > 0),

    category VARCHAR(30) NOT NULL DEFAULT 'standard',

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    sort_order INT NOT NULL DEFAULT 0,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Record of every gift sent (1:1 chat, call, or live room)
CREATE TABLE gift_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    gift_id UUID NOT NULL REFERENCES gifts(id),

    sender_id UUID NOT NULL REFERENCES users(id),

    receiver_id UUID NOT NULL REFERENCES users(id),

    quantity INT NOT NULL DEFAULT 1,

    total_coins BIGINT NOT NULL,

    commission_rate NUMERIC(5,2) DEFAULT 0,

    streamer_earnings BIGINT DEFAULT 0,

    context_type VARCHAR(20) NOT NULL, -- chat | call | live_room

    context_id UUID,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CHECK(quantity > 0),

    CHECK(total_coins >= 0)
);
CREATE INDEX idx_gift_tx_receiver ON gift_transactions(receiver_id, created_at);

-- ---------------------------------------------------------
-- COINS: PACKAGES, PURCHASES, WALLET LEDGER, WITHDRAWALS
-- ---------------------------------------------------------
CREATE TABLE coin_packages (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(100) NOT NULL,
    coins           INT NOT NULL,
    bonus_coins     INT NOT NULL DEFAULT 0,
    price_amount    NUMERIC(12,2) NOT NULL,        -- real-world money amount
    currency        VARCHAR(10) NOT NULL DEFAULT 'NGN',
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order      INT NOT NULL DEFAULT 0
);

CREATE TABLE payment_transactions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id),
    coin_package_id UUID REFERENCES coin_packages(id),
    provider        VARCHAR(20) NOT NULL DEFAULT 'opay',
    provider_reference VARCHAR(150) UNIQUE,        -- OPay orderNo / reference
    amount          NUMERIC(12,2) NOT NULL,
    currency        VARCHAR(10) NOT NULL DEFAULT 'NGN',
    coins_credited  INT,
    status          VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending|success|failed|cancelled
    raw_response    JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Single source of truth for every coin movement (purchase, gift sent, gift received, withdrawal, admin adjustment)
CREATE TABLE wallet_ledger (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type            VARCHAR(30) NOT NULL,  -- purchase|gift_sent|gift_received|withdrawal|refund|admin_adjustment
    amount          BIGINT NOT NULL,       -- positive = credit, negative = debit
    balance_after   BIGINT NOT NULL,
    reference_type  VARCHAR(30),           -- payment_transactions|gift_transactions|withdrawals
    reference_id    UUID,
    description     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_wallet_ledger_user ON wallet_ledger(user_id, created_at);

CREATE TABLE withdrawal_requests (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id),
    coins_requested BIGINT NOT NULL,
    cash_amount     NUMERIC(12,2) NOT NULL,
    currency        VARCHAR(10) NOT NULL DEFAULT 'NGN',
    bank_account_name VARCHAR(150),
    bank_account_number VARCHAR(50),
    bank_name       VARCHAR(150),
    status          VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending|approved|rejected|paid
    admin_note      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at    TIMESTAMPTZ
);

-- ---------------------------------------------------------
-- REPORTS / MODERATION
-- ---------------------------------------------------------
CREATE TABLE reports (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reporter_id     UUID NOT NULL REFERENCES users(id),
    reported_user_id UUID REFERENCES users(id),
    context_type    VARCHAR(30),  -- message | live_room | profile | call
    context_id      UUID,
    reason          VARCHAR(100) NOT NULL,
    details         TEXT,
    status          VARCHAR(20) NOT NULL DEFAULT 'open', -- open|reviewed|dismissed
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);





-- ---------------------------------------------------------
--additional tables..
-- ---------------------------------------------------------


CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    user_id UUID REFERENCES users(id) ON DELETE CASCADE,

    type VARCHAR(50),

    title VARCHAR(255),

    body TEXT,

    reference_type VARCHAR(50),

    reference_id UUID,

    is_read BOOLEAN DEFAULT FALSE,

    read_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT now()
);





CREATE TABLE device_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    token TEXT NOT NULL,
    platform VARCHAR(20),
    created_at TIMESTAMPTZ DEFAULT now()
);





CREATE TABLE room_leaderboards (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    room_id UUID REFERENCES live_rooms(id) ON DELETE CASCADE,

    user_id UUID REFERENCES users(id) ON DELETE CASCADE,

    coins_sent BIGINT DEFAULT 0,

    UNIQUE(room_id, user_id)
);

CREATE TABLE message_reactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    reaction VARCHAR(20),
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(message_id,user_id,reaction)
);




CREATE TABLE stories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    media_url TEXT,
    caption TEXT,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);


CREATE TABLE story_views (
    story_id UUID REFERENCES stories(id) ON DELETE CASCADE,

    viewer_id UUID REFERENCES users(id) ON DELETE CASCADE,

    viewed_at TIMESTAMPTZ DEFAULT now(),

    PRIMARY KEY(story_id, viewer_id)
);



CREATE TABLE call_recordings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    call_id UUID REFERENCES calls(id) ON DELETE CASCADE,

    recording_url TEXT,

    created_at TIMESTAMPTZ DEFAULT now()
);




CREATE TABLE profile_visits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    visitor_id UUID REFERENCES users(id),
    profile_owner_id UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT now()
);



CREATE TABLE room_battles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_a UUID REFERENCES live_rooms(id),
    room_b UUID REFERENCES live_rooms(id),
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    winner_room UUID
);



CREATE TABLE verification_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    document_url TEXT,
    status VARCHAR(20) DEFAULT 'pending',
    admin_note TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    reviewed_at TIMESTAMPTZ
);



CREATE TABLE admin_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    admin_id UUID REFERENCES users(id),
    action VARCHAR(100),
    target_type VARCHAR(50),
    target_id UUID,
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);



CREATE TABLE system_settings (
    setting_key VARCHAR(100) PRIMARY KEY,
    setting_value TEXT,
    updated_at TIMESTAMPTZ DEFAULT now()
);



CREATE TABLE stream_recordings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_id UUID REFERENCES live_rooms(id),
    recording_url TEXT,
    duration_seconds INT,
    created_at TIMESTAMPTZ DEFAULT now()
);



CREATE TABLE user_presence (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    socket_id VARCHAR(255),
    is_online BOOLEAN DEFAULT FALSE,
    current_room_id UUID,
    last_seen_at TIMESTAMPTZ DEFAULT now()
);


CREATE TABLE call_signals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    call_id UUID REFERENCES calls(id) ON DELETE CASCADE,
    sender_id UUID REFERENCES users(id),
    signal_type VARCHAR(20),
    signal_data JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);




CREATE TABLE room_moderators (
    room_id UUID REFERENCES live_rooms(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY(room_id,user_id)
);


CREATE TABLE room_bans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_id UUID REFERENCES live_rooms(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    banned_by UUID REFERENCES users(id),
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);


CREATE TABLE room_members (
    room_id UUID REFERENCES live_rooms(id) ON DELETE CASCADE,

    user_id UUID REFERENCES users(id) ON DELETE CASCADE,

    role VARCHAR(20) DEFAULT 'viewer',

    joined_at TIMESTAMPTZ DEFAULT now(),

    PRIMARY KEY(room_id,user_id)
);



CREATE TABLE battle_scores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    battle_id UUID REFERENCES room_battles(id) ON DELETE CASCADE,
    room_id UUID REFERENCES live_rooms(id) ON DELETE CASCADE,
    coins BIGINT DEFAULT 0
);



CREATE TABLE user_levels (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    experience_points BIGINT DEFAULT 0,
    level INT DEFAULT 1,
    vip_level INT DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT now()
);



CREATE TABLE daily_rewards (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    reward_date DATE NOT NULL,
    coins_awarded INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id,reward_date)
);



CREATE TABLE user_gift_rankings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    sender_id UUID REFERENCES users(id) ON DELETE CASCADE,

    receiver_id UUID REFERENCES users(id) ON DELETE CASCADE,

    total_coins BIGINT DEFAULT 0,

    updated_at TIMESTAMPTZ DEFAULT now(),

    UNIQUE(sender_id, receiver_id)
);


CREATE TABLE followers (
    follower_id UUID REFERENCES users(id) ON DELETE CASCADE,

    following_id UUID REFERENCES users(id) ON DELETE CASCADE,

    created_at TIMESTAMPTZ DEFAULT now(),

    PRIMARY KEY(follower_id, following_id),

    CHECK(follower_id <> following_id)
);




ALTER TABLE stories
ADD COLUMN IF NOT EXISTS media_type VARCHAR(20) DEFAULT 'image';




-- ---------------------------------------------------------
-- TRIGGERS: keep updated_at fresh
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_payment_tx_updated_at BEFORE UPDATE ON payment_transactions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();



CREATE INDEX idx_users_username
ON users(username);

CREATE INDEX idx_users_email
ON users(email);

CREATE INDEX idx_friend_requests_receiver
ON friend_requests(receiver_id);

CREATE INDEX idx_calls_callee
ON calls(callee_id);

CREATE INDEX idx_calls_caller
ON calls(caller_id);

CREATE INDEX idx_live_rooms_host
ON live_rooms(host_id);

CREATE INDEX idx_payment_user
ON payment_transactions(user_id);



CREATE INDEX idx_messages_sender
ON messages(sender_id);

CREATE INDEX idx_gift_sender
ON gift_transactions(sender_id);

CREATE INDEX idx_gift_context
ON gift_transactions(context_type, context_id);

CREATE INDEX idx_notifications_user
ON notifications(user_id);

CREATE INDEX idx_story_user
ON stories(user_id);

CREATE INDEX idx_room_viewers_room
ON live_room_viewers(room_id);

CREATE INDEX idx_room_messages_user
ON live_room_messages(user_id);