-- Per-turn momentum (P(this player wins), 0..1) for finished duels — the
-- fitted win-probability model scored at derive time (upload + reindex).
-- NULL for FFA games, unknown winners, and rows written before the model
-- landed; the reindex sweep backfills those from the blob.
ALTER TABLE game_player_turn ADD COLUMN momentum REAL;
