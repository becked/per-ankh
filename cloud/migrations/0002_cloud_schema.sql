-- Cloud rewrite schema: users, games, per-player summaries, per-turn series,
-- tech/law events. Plus extending the shared `events` table to cover both
-- legacy share events and the new cloud audit log (single source of truth,
-- since the share feature is being decommissioned with Tauri).
--
-- Spec reference: docs/cloud-rewrite-spec.md §3 (D1 Schema), §5 (auth users).

-- ============================================================
-- USERS
-- Discord OAuth identity. `email` and `email_verified` populated when the
-- `email` scope is granted (we do request it). Email is internal-only —
-- never returned in /v1/auth/me responses; used only for outbound contact
-- if/when needed.
-- ============================================================

CREATE TABLE users (
    user_id TEXT PRIMARY KEY,               -- nanoid(21)
    discord_id TEXT NOT NULL UNIQUE,        -- Discord snowflake ID
    display_name TEXT NOT NULL,             -- global_name, falling back to username
    avatar_hash TEXT,                       -- raw hash; URL built at read time
    email TEXT,                             -- from Discord, may be null
    email_verified BOOLEAN,                 -- Discord-side verification flag
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_login_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- GAMES
-- One row per imported game per user. dedup key = (user_id, file_hash).
-- ============================================================

CREATE TABLE games (
    game_id TEXT PRIMARY KEY,               -- nanoid(21), used in URLs
    user_id TEXT NOT NULL REFERENCES users(user_id),

    xml_game_id TEXT NOT NULL,
    total_turns INTEGER NOT NULL,
    file_hash TEXT NOT NULL,                -- SHA-256 of raw ZIP

    game_name TEXT,
    save_date TEXT,                         -- ISO 8601

    map_size TEXT,
    map_class TEXT,
    game_mode TEXT,
    difficulty TEXT,
    opponent_level TEXT,

    winner_nation TEXT,
    winner_name TEXT,
    victory_type TEXT,

    user_nation TEXT,
    user_won BOOLEAN,

    is_public BOOLEAN NOT NULL DEFAULT FALSE,

    blob_version INTEGER NOT NULL DEFAULT 2,
    blob_size_bytes INTEGER,
    parser_version TEXT NOT NULL,

    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),

    UNIQUE (user_id, file_hash)
);

CREATE INDEX idx_games_user ON games(user_id);
CREATE INDEX idx_games_public ON games(is_public) WHERE is_public = TRUE;

-- ============================================================
-- PLAYER SUMMARIES
-- ============================================================

CREATE TABLE player_summaries (
    game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
    player_index INTEGER NOT NULL,

    player_name TEXT NOT NULL,
    nation TEXT,
    family_classes TEXT,                    -- JSON array
    pick_order INTEGER,
    is_human BOOLEAN NOT NULL,
    is_uploader BOOLEAN NOT NULL,           -- Selected by uploader; many TRUE allowed

    starting_ruler_archetype TEXT,
    starting_ruler_traits TEXT,             -- JSON array
    starting_ruler_reign_turns INTEGER,
    succession_count INTEGER,

    final_points INTEGER,
    final_military_power INTEGER,
    final_legitimacy INTEGER,
    cities_total INTEGER,
    cities_founded INTEGER,
    techs_completed INTEGER,
    laws_count INTEGER,

    fifth_city_turn INTEGER,
    tenth_city_turn INTEGER,
    fourth_law_turn INTEGER,
    seventh_law_turn INTEGER,

    is_winner BOOLEAN NOT NULL DEFAULT FALSE,
    vp_margin INTEGER,

    PRIMARY KEY (game_id, player_index)
);

CREATE INDEX idx_summaries_nation ON player_summaries(nation);
CREATE INDEX idx_summaries_archetype ON player_summaries(starting_ruler_archetype);

-- ============================================================
-- GAME PLAYER TURN — wide-format per-turn series
-- 14 yields × (per-turn + cumulative) + military_power + legitimacy.
-- ============================================================

CREATE TABLE game_player_turn (
    game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
    player_index INTEGER NOT NULL,
    turn INTEGER NOT NULL,

    food_per_turn INTEGER,           food_cumulative INTEGER,
    growth_per_turn INTEGER,         growth_cumulative INTEGER,
    science_per_turn INTEGER,        science_cumulative INTEGER,
    culture_per_turn INTEGER,        culture_cumulative INTEGER,
    civics_per_turn INTEGER,         civics_cumulative INTEGER,
    training_per_turn INTEGER,       training_cumulative INTEGER,
    money_per_turn INTEGER,          money_cumulative INTEGER,
    orders_per_turn INTEGER,         orders_cumulative INTEGER,
    happiness_per_turn INTEGER,      happiness_cumulative INTEGER,
    discontent_per_turn INTEGER,     discontent_cumulative INTEGER,
    iron_per_turn INTEGER,           iron_cumulative INTEGER,
    stone_per_turn INTEGER,          stone_cumulative INTEGER,
    wood_per_turn INTEGER,           wood_cumulative INTEGER,
    maintenance_per_turn INTEGER,    maintenance_cumulative INTEGER,

    military_power INTEGER,
    legitimacy INTEGER,

    PRIMARY KEY (game_id, player_index, turn)
);

CREATE INDEX idx_gpt_game ON game_player_turn(game_id);

-- ============================================================
-- TECH EVENTS / LAW EVENTS
-- A law may be repealed and re-adopted, hence (game,player,law,turn) PK.
-- ============================================================

CREATE TABLE tech_events (
    game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
    player_index INTEGER NOT NULL,
    tech TEXT NOT NULL,
    turn INTEGER NOT NULL,
    PRIMARY KEY (game_id, player_index, tech)
);

CREATE INDEX idx_tech_events_tech ON tech_events(tech);

CREATE TABLE law_events (
    game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
    player_index INTEGER NOT NULL,
    law TEXT NOT NULL,
    turn INTEGER NOT NULL,
    PRIMARY KEY (game_id, player_index, law, turn)
);

CREATE INDEX idx_law_events_law ON law_events(law);

-- ============================================================
-- EVENTS — extend the legacy table.
--
-- Legacy schema has share_id TEXT NOT NULL + app_key. New cloud events
-- (uploads, deletes, logins) need game_id + user_id and don't have a
-- share_id. SQLite/D1 can't drop a NOT NULL constraint via ALTER COLUMN,
-- so we use the standard rename-and-copy pattern.
--
-- Resulting shape: a single audit log usable by both legacy share endpoints
-- (writing share_id + app_key) and the new cloud endpoints (writing
-- game_id + user_id). All four columns are nullable; event_type
-- distinguishes the row's origin.
-- ============================================================

CREATE TABLE events_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,               -- 'upload', 'delete', 'login', etc.
    share_id TEXT,                          -- legacy share rows
    app_key TEXT,                           -- legacy share rows
    game_id TEXT,                           -- new cloud rows
    user_id TEXT,                           -- new cloud rows
    ip_address TEXT,
    metadata TEXT,                          -- JSON
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO events_new (id, event_type, share_id, app_key, ip_address, metadata, created_at)
SELECT id, event_type, share_id, app_key, ip_address, metadata, created_at
FROM events;

DROP TABLE events;
ALTER TABLE events_new RENAME TO events;

-- Recreate legacy indexes (DROP TABLE drops associated indexes)
CREATE INDEX idx_events_share_id ON events(share_id);
CREATE INDEX idx_events_created_at ON events(created_at);
CREATE INDEX idx_events_app_key_type_created
    ON events(app_key, event_type, created_at);
CREATE INDEX idx_events_ip_type_created
    ON events(ip_address, event_type, created_at);
CREATE INDEX idx_events_type_created
    ON events(event_type, created_at);

-- New index for cloud-side per-user rate limits and audit lookups
CREATE INDEX idx_events_user_type_created
    ON events(user_id, event_type, created_at);
