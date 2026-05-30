-- Per-match scheduling metadata: when the match is played, where it's
-- streamed, and who's casting it.
--
-- Why: organizers and players coordinate match times, stream links, and
-- casters in Discord today, with nothing surfaced in-app. These columns let
-- a tournament admin OR either participant attach that metadata to a pending
-- match, which the match popover edits and a tournament-wide "Schedule" view
-- aggregates into one list of upcoming games.
--
-- scheduled_at is a full ISO-8601 instant (UTC); the UI enters/displays UTC
-- with hour/minute precision (localization deferred). stream_url is a
-- youtube/twitch link, validated host-side by PatchMatchScheduleSchema.
--
-- Caster is a single person, modeled like a slot occupant: caster_user_id
-- links to a Per-Ankh user when picked from the autocomplete, and caster_name
-- holds the canonical username in that case or free text when no account is
-- linked. caster_user_id is TEXT with no FK, mirroring the migration-0024
-- snapshot columns: an FK would block `./per-ankh admin nuke-user` for anyone
-- who ever cast a match, and avatar lookup degrades gracefully via LEFT JOIN.

ALTER TABLE tournament_matches ADD COLUMN scheduled_at TEXT;
ALTER TABLE tournament_matches ADD COLUMN stream_url TEXT;
ALTER TABLE tournament_matches ADD COLUMN caster_user_id TEXT;
ALTER TABLE tournament_matches ADD COLUMN caster_name TEXT;
