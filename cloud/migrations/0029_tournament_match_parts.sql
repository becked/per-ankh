-- Split a match into scheduled "parts" (play sessions of the same single game).
--
-- Why: a tournament match is one game, but it's often played across several
-- sittings — Old World games are long, so players pause and resume days apart.
-- Organizers want to schedule each session separately and, after the fact,
-- attach several VOD links per session (each player's POV stream plus a cast).
-- The single per-match schedule from migration 0025 (scheduled_at, stream_url,
-- caster) can't express that: one time, one stream, one caster per match.
--
-- Model: an ordered JSON array of parts on the match, mirroring the map_pool
-- (0019) and links (0026) JSON-config columns. Each part is
--   { id, scheduled_at, casters: [{ user_id, name }], vods: [{ url, label }] }
-- where id is stable per-match (so edits/deletes target a part), scheduled_at
-- is a full ISO-8601 UTC instant (nullable = not yet scheduled), casters is an
-- ordered list (index 0 = the streamer, the rest co-casters) each mirroring the
-- 0025 occupant model (user_id links a Per-Ankh user, name is the canonical
-- handle when linked or free text otherwise), and vods is a list of
-- { url, label } where label is an optional human tag ("alcaras POV", "Cast").
-- NOT NULL DEFAULT '[]' so every existing row reads as "no parts yet". Validated
-- on write by PatchMatchPartsSchema; read leniently by parseParts.
--
-- The 0025 columns (scheduled_at, stream_url, caster_user_id, caster_name) are
-- superseded by parts and backfilled below into a single part per match. They
-- are then left dead rather than dropped: D1 migrations are forward-only and
-- rebuilding tournament_matches (a central table with several FKs and snapshot
-- columns) to drop four columns isn't worth the risk. Reads and writes move to
-- `parts`, which becomes the single source of truth. Forward-only.

ALTER TABLE tournament_matches ADD COLUMN parts TEXT NOT NULL DEFAULT '[]';

-- Optimistic-concurrency version for the parts blob. Every writer bumps it and
-- conditions its UPDATE on the value it read, so concurrent editors (admin
-- replace-all vs. another writer) conflict loudly instead of silently losing
-- one side's changes.
ALTER TABLE tournament_matches ADD COLUMN parts_rev INTEGER NOT NULL DEFAULT 0;

-- Backfill: every match that carried any 0025 schedule metadata becomes a
-- single part 'p1' (new parts created via the API get nanoid ids; 'p1' only has
-- to be unique within this match's array). The lone 0025 caster becomes that
-- part's sole caster; the lone stream_url, if any, becomes its first VOD with a
-- null label. json1 is bundled with D1/SQLite.
UPDATE tournament_matches
SET parts = json_array(
	json_object(
		'id', 'p1',
		'scheduled_at', scheduled_at,
		'casters', CASE
			WHEN caster_user_id IS NOT NULL OR caster_name IS NOT NULL
			THEN json_array(json_object('user_id', caster_user_id, 'name', caster_name))
			ELSE json_array()
		END,
		'vods', CASE
			WHEN stream_url IS NOT NULL
			THEN json_array(json_object('url', stream_url, 'label', NULL))
			ELSE json_array()
		END
	)
)
WHERE scheduled_at IS NOT NULL
	OR stream_url IS NOT NULL
	OR caster_user_id IS NOT NULL
	OR caster_name IS NOT NULL;
