-- A player's timezone, stored as an IANA zone id on the account and on the
-- tournament slot, plus the per-tournament switch that asks for it at signup.
--
-- Why: the scheduling DM an admin pastes into Discord ends "<player> is <their
-- timezone>", and the only source it has ever had is `tournament_slots.
-- signup_answer` (0023) — free text, answering whatever question the admin
-- configured. Two things are wrong with that. A typed label is not
-- DST-correct ("EST" typed in March is wrong in July), and an answer stored on
-- the seat is a snapshot: substituting a slot's occupant (handlePatchSlot)
-- leaves the departed player's answer behind, so the DM prints it under the new
-- player's name. `users.timezone` fixes the second by construction — the DM
-- reads it through `tournament_slots.user_id`, which follows whoever is in the
-- seat.
--
-- Three columns, because they answer three different questions:
--   users.timezone              — "what zone am I in", set once in Preferences
--                                 and read by every tournament the user plays.
--   tournament_slots.timezone   — "what zone was I in when I signed up for
--                                 THIS", for a registrant with no account zone
--                                 (the DM's second choice). Travels with the
--                                 occupant on a slot swap, like signup_answer.
--   tournaments.collect_timezone — whether the signup form asks at all.
--
-- All nullable / defaulted off, no backfill. A zone cannot be derived from a
-- free-text answer: "EST", "GMT+1 ish", "evenings UK" are the real corpus, and
-- guessing a zone from one of those would put a wrong offset in the DM under
-- the authority of a structured field. `signup_answer` keeps working unchanged
-- and stays the DM's last resort before "(timezone TBD)".
--
-- No index: both columns are read through a row already being fetched by
-- primary key — `users` by user_id on the slot loaders' LEFT JOIN,
-- `tournament_slots` by tournament_id — and neither is ever a predicate.
--
-- collect_timezone defaults to 0 so every existing tournament's signup form is
-- unchanged by this migration; an admin opts in from the Signups panel.

ALTER TABLE users ADD COLUMN timezone TEXT;
ALTER TABLE tournament_slots ADD COLUMN timezone TEXT;
ALTER TABLE tournaments ADD COLUMN collect_timezone INTEGER NOT NULL DEFAULT 0;
