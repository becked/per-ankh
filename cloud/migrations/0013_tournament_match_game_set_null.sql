-- Allow `DELETE FROM games WHERE game_id = ?` to succeed even when one or
-- more tournament_matches rows still reference that game. Without this,
-- the unscoped FK on tournament_matches.game_id (no ON DELETE clause →
-- defaults to NO ACTION) aborts the DELETE, and the user-facing
-- handleGameDelete path leaves R2 blobs stripped but the games row in
-- place.
--
-- Implemented as a BEFORE DELETE trigger rather than a CREATE TABLE
-- migration changing the FK to ON DELETE SET NULL, matching the precedent
-- set by 0009_swiss_seed_not_null.sql (triggers > create-new-table dance
-- for changes to tournament_matches).
--
-- Pairs with the user-facing 409 LINKED_TO_ACTIVE_TOURNAMENT guard added
-- to handleGameDelete (cloud/src/games.ts). Together: active tournament →
-- clean 409 from the worker; post-completion delete → trigger nulls the
-- match's game_id and the DELETE proceeds, preserving winner/status.

CREATE TRIGGER tournament_match_game_set_null_on_game_delete
BEFORE DELETE ON games
BEGIN
    UPDATE tournament_matches SET game_id = NULL WHERE game_id = OLD.game_id;
END;
