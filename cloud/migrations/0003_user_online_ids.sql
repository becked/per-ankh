-- OnlineID-to-user linking. Populated implicitly: when a user uploads a
-- save and selects which human player(s) belong to them via the upload
-- modal's picker, we capture those players' `online_id`s here. Subsequent
-- uploads use this table to pre-check the picker for any human matching a
-- known id.
--
-- Composite PK is (user_id, online_id):
--   - one user can link many ids (Steam + GOG + Epic + multiple Steam accts)
--   - one id can belong to many users (rare but possible — shared family
--     account, Discord-account-rebuild, etc.); doesn't break the pre-check
--     because we filter by user_id in queries.

CREATE TABLE user_online_ids (
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    online_id TEXT NOT NULL,
    first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, online_id)
);

CREATE INDEX idx_user_online_ids_online ON user_online_ids(online_id);
