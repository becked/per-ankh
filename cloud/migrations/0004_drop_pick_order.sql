-- Drop player_summaries.pick_order. The column was reserved for "0-based
-- family pick slot" but the XML doesn't surface pick order anywhere — only
-- which families a player ended up with. Per spec discussion: rather than
-- back-fill a heuristic (e.g. seat-city founded_turn) that would mislead
-- downstream dashboards, we drop the column outright. Any future need for
-- pick mechanics can land as a clean, additive migration.
--
-- Safe: column has been NULL since creation (Worker never wrote to it).
-- D1's SQLite (>=3.35) supports DROP COLUMN directly.

ALTER TABLE player_summaries DROP COLUMN pick_order;
