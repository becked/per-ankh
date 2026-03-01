-- D1 Schema for Per-Ankh Share Index
--
-- Tracks all shared games and logs upload/delete events.
-- Used by the Cloudflare Worker for rate limiting, metadata lookups,
-- and future gallery functionality.

-- Share index: one row per shared game
CREATE TABLE IF NOT EXISTS shares (
    share_id TEXT PRIMARY KEY,              -- 21-char nanoid
    app_key TEXT NOT NULL,                  -- UUID from desktop app installation
    created_at TEXT NOT NULL,               -- ISO 8601 timestamp
    blob_version INTEGER NOT NULL,          -- SharedGameData.version field
    game_name TEXT,                         -- For admin visibility / future gallery
    total_turns INTEGER,                    -- For admin visibility / future gallery
    player_nation TEXT,                     -- Human player's nation
    map_size TEXT,                          -- Map size enum value
    blob_size_bytes INTEGER NOT NULL,       -- Compressed blob size in R2
    delete_token TEXT NOT NULL              -- Secret token for authenticated deletion
);

CREATE INDEX IF NOT EXISTS idx_shares_app_key ON shares(app_key);
CREATE INDEX IF NOT EXISTS idx_shares_created_at ON shares(created_at);

-- Event log: records upload and delete events for auditing
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,               -- 'upload' | 'delete'
    share_id TEXT NOT NULL,
    app_key TEXT,
    ip_address TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    metadata TEXT                            -- JSON blob for extra context
);

CREATE INDEX IF NOT EXISTS idx_events_share_id ON events(share_id);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
