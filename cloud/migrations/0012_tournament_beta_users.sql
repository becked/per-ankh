-- Tournament beta allowlist.
--
-- During the private beta the tournament product (public reads, player
-- endpoints, admin endpoints, the tournament-link branch of game upload)
-- is gated on membership in this table. Non-members get 404
-- (TOURNAMENT_NOT_FOUND) so the feature's existence is hidden.
--
-- Operator-managed only — `./per-ankh admin tournament beta-grant|revoke|list`.
-- No self-service path.
--
-- Claim flow mirrors tournament_slots:
--   1. Operator inserts a row keyed on discord_id (immutable across
--      Discord renames). user_id starts NULL.
--   2. User logs in → handleDiscordCallback runs UPDATE …
--      SET user_id = ? WHERE discord_id = ? AND user_id IS NULL,
--      so subsequent gate checks can use the fast user_id PK lookup.
--   3. Operator-issued grants for an already-signed-up user can set
--      user_id immediately at grant time (CLI looks it up).
--
-- granted_by_user_id is NULL for CLI grants (no session at the wrangler
-- shell). Out-of-band attribution (who ran wrangler) is sufficient given
-- the tiny operator pool.

CREATE TABLE tournament_beta_users (
    discord_id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(user_id),
    granted_at TEXT NOT NULL DEFAULT (datetime('now')),
    granted_by_user_id TEXT REFERENCES users(user_id),
    note TEXT
);

CREATE INDEX idx_tournament_beta_users_user ON tournament_beta_users(user_id);
