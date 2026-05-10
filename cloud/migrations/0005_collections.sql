-- Collections: per-user named buckets for organizing games. Mirrors the
-- desktop app's `collections` table (single global "Personal" default in
-- DuckDB) but scoped per-user since the cloud is multi-tenant.
--
-- Each user gets a "Personal" collection seeded on first Discord login
-- (handled in cloud/src/auth.ts on the upsert path; this migration seeds
-- existing users and backfills their games into it). New uploads default
-- to the user's is_default=1 collection.
--
-- ON DELETE SET NULL on games.collection_id: if a future "delete
-- collection" feature lands, orphaned games stay valid with collection_id
-- = NULL. NULL is a valid state for the games row even though current UX
-- always assigns one (it's a forward-compat hedge).

CREATE TABLE collections (
    collection_id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, name)
);
CREATE INDEX idx_collections_user ON collections(user_id);

ALTER TABLE games ADD COLUMN collection_id INTEGER
    REFERENCES collections(collection_id) ON DELETE SET NULL;
CREATE INDEX idx_games_collection ON games(collection_id);

-- Backfill: seed one Personal default per existing user, move all their
-- games into it. Idempotent on re-run via the (user_id, name) UNIQUE
-- constraint, but D1 migrations are one-shot anyway.
INSERT INTO collections (user_id, name, is_default)
SELECT user_id, 'Personal', 1 FROM users;

UPDATE games SET collection_id = (
    SELECT c.collection_id FROM collections c
    WHERE c.user_id = games.user_id AND c.is_default = 1
);
