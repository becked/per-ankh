-- Baseline: legacy share Worker schema.
--
-- Production D1 already has these tables (created via the old `schema.sql`
-- one-shot setup). This migration is therefore a no-op against prod thanks
-- to IF NOT EXISTS, but it ensures a fresh local D1 (`wrangler dev --local`)
-- gets the same starting point.

-- Share index: one row per shared game (legacy desktop-app share feature)
CREATE TABLE IF NOT EXISTS shares (
    share_id TEXT PRIMARY KEY,
    app_key TEXT NOT NULL,
    created_at TEXT NOT NULL,
    blob_version INTEGER NOT NULL,
    game_name TEXT,
    total_turns INTEGER,
    player_nation TEXT,
    map_size TEXT,
    blob_size_bytes INTEGER NOT NULL,
    delete_token TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shares_app_key ON shares(app_key);
CREATE INDEX IF NOT EXISTS idx_shares_created_at ON shares(created_at);

-- Event log: upload/delete events for auditing + rate limiting
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    share_id TEXT NOT NULL,
    app_key TEXT,
    ip_address TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_share_id ON events(share_id);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_events_app_key_type_created
    ON events(app_key, event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_events_ip_type_created
    ON events(ip_address, event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_events_type_created
    ON events(event_type, created_at);

-- Blocklists for abuse prevention
CREATE TABLE IF NOT EXISTS blocked_keys (
    app_key TEXT PRIMARY KEY,
    reason TEXT,
    blocked_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS blocked_ips (
    ip_address TEXT PRIMARY KEY,
    reason TEXT,
    blocked_at TEXT NOT NULL DEFAULT (datetime('now'))
);
