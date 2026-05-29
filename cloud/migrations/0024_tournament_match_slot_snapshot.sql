-- Per-match snapshot of slot occupant at the moment of report.
--
-- Why: substitution via PATCH /v1/tournaments/:id/slots/:slot_id updates
-- tournament_slots.discord_username in place and NULLs user_id/discord_id.
-- Match rendering dereferences slot_id → current discord_username (and
-- avatar via the joined users row), so a substitution retroactively
-- rewrites the displayed name and drops avatars on every match the slot
-- ever played. The intended model is soccer-sub: the substitute takes
-- the seat going forward, and historical matches keep showing whoever
-- actually played them.
--
-- These four columns capture (discord_username, user_id) for slot_a and
-- slot_b at the moment a match transitions out of 'pending' (or at INSERT
-- for byes). The render layer prefers the snapshot for non-pending matches
-- and falls through to the live slot for pending matches (so a substitute
-- paired into an upcoming round shows up immediately under the new name).
--
-- *_user_id columns are TEXT, no FK. The participant-check FK on
-- tournament_slots.user_id is enough; making the snapshot a FK would
-- block `./per-ankh admin nuke-user` for any user who ever played a
-- tournament match. Storing the id as text preserves avatar lookup via
-- LEFT JOIN at read time and degrades gracefully to the placeholder if
-- the user is later deleted.

ALTER TABLE tournament_matches ADD COLUMN slot_a_username TEXT;
ALTER TABLE tournament_matches ADD COLUMN slot_a_user_id TEXT;
ALTER TABLE tournament_matches ADD COLUMN slot_b_username TEXT;
ALTER TABLE tournament_matches ADD COLUMN slot_b_user_id TEXT;

-- Backfill: for every already-reported match, copy the current slot
-- identity into the snapshot. Correct for any tournament that has not
-- had a substitution yet (live name == name at report time). For the
-- single existing tournament where a substitution has already happened,
-- one match is left displaying the substitute's name on a game the
-- previous occupant actually played — restored separately via a one-off
-- UPDATE keyed off the tournament_slot_substituted event row.
--
-- Correlated subqueries return NULL safely for byes (slot_b_id IS NULL
-- → no matching slot row → scalar NULL).
UPDATE tournament_matches
   SET slot_a_username = (SELECT discord_username FROM tournament_slots WHERE slot_id = tournament_matches.slot_a_id),
       slot_a_user_id  = (SELECT user_id          FROM tournament_slots WHERE slot_id = tournament_matches.slot_a_id),
       slot_b_username = (SELECT discord_username FROM tournament_slots WHERE slot_id = tournament_matches.slot_b_id),
       slot_b_user_id  = (SELECT user_id          FROM tournament_slots WHERE slot_id = tournament_matches.slot_b_id)
 WHERE status != 'pending';
