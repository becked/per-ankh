-- Cached Glicko-2 rating per registered user.
--
-- Rebuilt in bulk by the nightly cron (and an admin trigger) from every
-- decisive 1v1 duel reconstructable from D1 — tournament matches, plus casual
-- games where both roster slots resolve to a registered user (0043 +
-- cloud/src/ratings/duels.ts). A rebuild fully replaces the table; nothing here
-- is a source of truth, it is all derivable from games and tournament results.
--
-- The rating is never shown to anyone. It exists to answer one question — who
-- would give this player a close game — and the only thing that leaves the
-- Worker is the resulting list of names (user_recommended_opponents, 0045). No
-- endpoint selects from this table, and none should: see docs/api-reference.md
-- and the note on 0045.
--
-- Columns are what the recommender reads, and no more. A Glicko-2 rating is the
-- triple (r, RD, sigma), so all three are stored even though the recommender
-- only converts r and RD to the internal scale — a snapshot missing sigma is
-- not a rating. `games` and `last_played` feed the "new here" badge and the
-- activity filter respectively. Win/loss tallies and the conservative rating
-- (r - 2*RD) are deliberately absent: nothing reads them today.
CREATE TABLE user_ratings (
    user_id     TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
    glicko_r    REAL NOT NULL,
    glicko_rd   REAL NOT NULL,
    glicko_vol  REAL NOT NULL,
    games       INTEGER NOT NULL,   -- rated duels the player has fought
    last_played TEXT,               -- date of their most recent rated duel
    computed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
