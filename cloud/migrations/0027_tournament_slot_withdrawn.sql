-- Admin-initiated mid-tournament withdrawal of a slot.
--
-- Why: there is no in-tournament "drop" concept today. A player who stops
-- showing up after losing round 1 stays 'active' (status is derived purely
-- from match results) and keeps getting paired — a wave of dropouts clusters
-- in the same record bucket and pairs against each other, producing rounds
-- full of no-show matches. This column lets an admin remove a player from all
-- future pairing: the pure pairing engine excludes withdrawn slots from the
-- active pool, and the championship qualifier filter skips them.
--
-- Nullable TEXT timestamp (ISO-8601, set when an admin withdraws the slot;
-- cleared on reinstate), mirroring the existing nullable-timestamp pattern of
-- claim_banner_dismissed_at on this same table. NULL = not withdrawn, so
-- existing rows read correctly without a backfill. Withdrawal is admin-only
-- (no self-serve endpoint) and applies only after the tournament has started;
-- in 'setup' a slot is hard-deleted instead. Forward-only.

ALTER TABLE tournament_slots ADD COLUMN withdrawn_at TEXT;
