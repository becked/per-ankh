-- Optional freeform signup question.
--
-- Why: admins want to collect one freeform answer at signup time (e.g. "what
-- timezone / time of day do you want to play?"). The prompt is configured per
-- tournament from the settings form (PatchTournamentSchema.signup_question) and
-- shown on the signup form; the player's answer is optional and stored on their
-- slot. Admins read the answers in the roster.
--
-- Both nullable, no default — NULL question means "no question asked"; NULL
-- answer means "player didn't answer" (or signed up before a question existed).
-- Forward-only; no backfill.

ALTER TABLE tournaments ADD COLUMN signup_question TEXT;
ALTER TABLE tournament_slots ADD COLUMN signup_answer TEXT;
