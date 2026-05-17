-- Rename match status 'reported' → 'complete'. The original name described
-- the action ("a report was filed via /report") and made sense when that was
-- the only way to reach the state. Admin retro-edit can now set the same
-- state without anyone reporting anything, so the name actively misleads.
-- 'complete' aligns with sibling status vocabularies (tournament_rounds and
-- tournaments both use 'complete' as a terminal state).
--
-- Whether a save was uploaded is already answered by game_id IS NOT NULL —
-- no need for the status field to carry that signal.

UPDATE tournament_matches SET status = 'complete' WHERE status = 'reported';
