-- One row per seat per unit type trained, and how many of that type it built.
--
-- The ninth game-derived table, and the one issue #272's third acceptance
-- question needs: "who built the most ballistae in the tournament" has no
-- answer over the eight tables D1 already projects, because no indexer writes
-- the blob's `units_produced` anywhere. The data is not missing — it is parsed
-- on every upload and read by the challenge scorer (`scoreUnit`,
-- cloud/src/challenges/scoring.ts) — it is simply never projected, so a
-- question about it was a migration rather than a catalog entry.
--
-- `units_produced` is a required field in the upload schema
-- (cloud/src/schemas/game.ts — `v.pipe(v.array(v.unknown()), ...)`, not
-- `v.optional`), so every accepted blob carries it and nothing here waits on a
-- PARSER_VERSION bump. Existing rows arrive when the admin reindex sweep runs,
-- which rebuilds a game's derived children from the stored blob
-- (handleAdminReindex, cloud/src/games.ts).
--
-- Size, counted over the 116 saves in test-data/saves/: 3,996 rows across 339
-- seat blocks, 11.8 rows per seat, 72 distinct unit types. The 2026-11-15 D1
-- snapshot holds 3,059 player_summaries seats, which projects to roughly
-- 36,000 rows — between law_events (25,334) and tech_events (80,403) in the
-- same snapshot, with wonder_events at 4,919 and game_player_turn at 267,099.
-- It is not a per-turn-grain table.
--
-- Shape precedent: wonder_events (migration 0036) and its idx_wonder_events_
-- wonder. The seat's nation and in-save name are not here though
-- `deriveUnitsProduced` emits both: player_summaries already holds them and
-- joins on (game_id, player_index), which is the join the query catalog's
-- player dimensions already use.
--
-- The secondary index is on unit_type because that is the column a question
-- narrows by — "the ballistae" before "this game's units" — and the primary
-- key's leading game_id already serves a per-game read.
CREATE TABLE player_units_produced (
    game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
    player_index INTEGER NOT NULL,
    unit_type TEXT NOT NULL,
    count INTEGER NOT NULL,
    PRIMARY KEY (game_id, player_index, unit_type)
);

CREATE INDEX idx_player_units_produced_unit ON player_units_produced(unit_type);
