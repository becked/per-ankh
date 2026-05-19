-- Owner-editable display title for a save.
--
-- Why: games.game_name comes from the save file (Old World writes "Game{N}"
-- when the user never picked a custom name). Users want to rename their
-- uploads to something meaningful ("MP vs. Joe", "Tamil ironworking rush")
-- without losing the save's original name. A separate column keeps the
-- original around for forensics + re-upload dedupe, and means clearing the
-- rename (SET display_name = NULL) restores the original derivation.
--
-- Backfill: none. NULL means "never renamed" — formatGameTitle on the
-- client falls back through game_name → nation/turns derivation as before.
-- Empty string is rejected at the API layer; NULL is the only "clear"
-- sentinel.

ALTER TABLE games ADD COLUMN display_name TEXT;
