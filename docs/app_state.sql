-- App State Schema
--
-- Tables for app-level state that survives database resets.
-- NOT in schema.sql — drop_all_schema_objects() only drops tables
-- defined in schema.sql, so these tables persist across resets.
--
-- These tables ARE lost when the .db file is deleted (crash recovery),
-- which is acceptable — cloud shares still work, the API key is
-- regenerated on next launch.

-- Key-value store for app-level settings (API key, etc.)
CREATE TABLE IF NOT EXISTS app_state (
    key VARCHAR NOT NULL PRIMARY KEY,
    value VARCHAR NOT NULL
);

-- Tracks locally-shared games for UX and cloud resource management
-- (delete tokens, share URLs, shared-at timestamps)
CREATE TABLE IF NOT EXISTS shared_games (
    match_id BIGINT NOT NULL PRIMARY KEY,
    share_id VARCHAR(21) NOT NULL UNIQUE,
    share_url VARCHAR NOT NULL,
    delete_token VARCHAR NOT NULL,
    shared_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
