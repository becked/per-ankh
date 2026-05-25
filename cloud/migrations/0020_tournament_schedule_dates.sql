-- Scheduled-start and completion timestamps for tournaments.
--
-- Why: the tournament detail header needs two dates it couldn't show before.
--   * starts_at  — an admin-announced start time, surfaced as "Starts <date>"
--     while the tournament is in setup / accepting sign-ups. Editable from the
--     settings form (PatchTournamentSchema). Stored as a full ISO-8601 instant
--     (datetime); the UI displays date-only. NULL until an admin sets it.
--   * completed_at — stamped exactly once, on the championship-final report
--     that flips status → 'complete' (handleReportMatch's auto-complete
--     branch). Surfaced as "Ended <date>". NULL for any non-complete
--     tournament. updated_at was the only prior proxy, but it bumps on every
--     mutation, so it can't stand in for "when the tournament ended".
--
-- Both nullable, no default — absence is the meaningful "not set / not ended"
-- state. Forward-only; no backfill (existing complete tournaments simply have
-- no recorded end date).

ALTER TABLE tournaments ADD COLUMN starts_at TEXT;
ALTER TABLE tournaments ADD COLUMN completed_at TEXT;
