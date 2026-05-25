-- Per-turn victory points (score) for game_player_turn.
--
-- Why: the home-page game-card sparkline and the tournament MatchPopover
-- sparkline were both plotting `legitimacy` under a "VP" label. Legitimacy
-- and victory points are different stats in Old World. The save already
-- carries real per-turn VP (PointsHistory → PlayerHistoryPoint.points in the
-- parsed blob), but the ingest only persisted military_power + legitimacy, so
-- the D1-sourced home sparkline had no VP series to draw from.
--
-- Nullable, no default — absence means "this game predates the points ingest
-- and hasn't been reindexed yet". The home query treats NULL points as
-- no-data (hides the sparkline) rather than zero. Backfill is via the admin
-- reindex control (/admin/reindex), which re-runs the D1 pivot from each
-- game's existing R2 blob. Forward-only.

ALTER TABLE game_player_turn ADD COLUMN points INTEGER;
