-- Explicit tournament-creator column.
--
-- Why: the creator (owner) needs to be authoritatively identifiable for two new
-- powers — deleting a non-completed tournament from the app, and being protected
-- from removal in the in-app admin list. Until now "creator" was only inferred
-- at read time as the earliest tournament_admins row (public.ts derives `owner`
-- that way). Inferring authz from row order is fragile, so we pin it explicitly.
--
-- handleCreateTournament now stamps this at create time. Existing tournaments
-- predate the column, so backfill from the same earliest-granted_at admin the
-- read path already treats as owner (user_id ASC breaks the same-second tie
-- deterministically). Nullable, forward-only.

ALTER TABLE tournaments ADD COLUMN created_by_user_id TEXT;

UPDATE tournaments
SET created_by_user_id = (
	SELECT ta.user_id
	FROM tournament_admins ta
	WHERE ta.tournament_id = tournaments.tournament_id
	ORDER BY ta.granted_at ASC, ta.user_id ASC
	LIMIT 1
)
WHERE created_by_user_id IS NULL;
