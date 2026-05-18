-- Drop the per-tournament championship-cutoff column.
--
-- Previously, `swiss_advance_count` defined how many top-ranked players
-- per division would advance from Swiss into the championship bracket.
-- When more players reached `swiss_wins_to_advance` than the cutoff
-- allowed, the tiebreaker cascade (Median-Buchholz → Solkoff) would cut
-- the excess — including, in practice, the 3-0 player in favor of a 3-2
-- player with a tougher schedule (see Sion's tournament, May 2026).
--
-- The new model: anyone who reaches `swiss_wins_to_advance` qualifies for
-- the championship. Bracket size is variable, computed from the qualifier
-- count; non-power-of-2 counts use byes for top seeds. Tiebreakers only
-- determine bracket seeding now, never qualification.
--
-- Existing rows: column drop is safe for `setup`, `swiss`, and
-- `championship` phases. `complete` tournaments (e.g. Sion's) never read
-- the column again. The new transition handler ignores it entirely.

ALTER TABLE tournaments DROP COLUMN swiss_advance_count;
