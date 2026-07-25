-- Index a player's cast appearances: one row per (match, part, caster).
--
-- Why: casters live in the `parts` JSON blob (migration 0029) as
-- `casters: [{ user_id, name }]`, and "which matches did this user cast?" is a
-- nested fan-out — every part × every caster — over the whole
-- tournament_matches table. No index can cover that: a generated column can
-- index a FIXED JSON path (migration 0033's backfill relies on
-- `$[0].casters[0].user_id`), but not an arbitrary-length walk across all parts
-- and all casters. So the query has no index-only fallback at all.
--
-- That matters because two readers need it: the profile's Tournaments tab
-- (a caster's appearance list) and — the load-bearing one — the participation
-- flag on GET /v1/users/:user_id, the site's hottest public read, which every
-- SSR profile view hits. Modelling the appearance as a row makes both indexed
-- lookups. Casting is already a first-class, publicly-credited role here (the
-- caster leaderboard on the tournament stats page), so this isn't premature.
--
-- LINKED casters only. `user_id` is null for free-text (unlinked) casters and
-- only a linked caster can be attributed to a profile, so an unlinked one would
-- be a row with no reader. This deliberately does NOT retire
-- computeCasterLeaderboard's in-JS walk, which counts free-text casters too.
--
-- No caster-ordering column: the streamer-vs-co-caster distinction is rendered
-- from the blob via serializeMatch. This table only answers "which matches and
-- parts does this user appear on".
--
-- The blob stays the source of truth; this is a derived index. Both `parts`
-- writers re-derive a match's rows from the stored blob after their
-- parts_rev CAS succeeds (syncMatchCasters in cloud/src/tournament/data.ts) —
-- never from an in-memory diff, so the sync is idempotent and self-healing.
CREATE TABLE tournament_match_casters (
	match_id TEXT NOT NULL REFERENCES tournament_matches(match_id) ON DELETE CASCADE,
	-- Unique only WITHIN a match (the 0029 backfill mints 'p1' per migrated
	-- match), which the composite primary key accounts for.
	part_id  TEXT NOT NULL,
	user_id  TEXT NOT NULL REFERENCES users(user_id),
	PRIMARY KEY (match_id, part_id, user_id)
);

-- ON DELETE CASCADE above follows 0006's convention and covers the one deletion
-- path that exists: DELETE FROM tournaments cascades rounds → matches → these.
-- users rows are never deleted anywhere in the Worker, so user_id needs no
-- cascade, matching tournament_slots.user_id.

CREATE INDEX idx_match_casters_user ON tournament_match_casters(user_id);

-- Backfill: the same INSERT ... SELECT syncMatchCasters runs, minus the
-- per-match filter — a one-time full walk of tournament_matches. Joining
-- `users` both drops null caster user_ids and guarantees the FK, so a
-- hand-edited blob naming an unknown user can't fail the migration. OR IGNORE
-- absorbs a blob that lists the same user twice on one part.
INSERT OR IGNORE INTO tournament_match_casters (match_id, part_id, user_id)
SELECT m.match_id, json_extract(p.value, '$.id'), u.user_id
FROM tournament_matches m,
     json_each(m.parts) AS p,
     json_each(p.value, '$.casters') AS c,
     users u
WHERE json_valid(m.parts)
  AND json_extract(p.value, '$.id') IS NOT NULL
  AND u.user_id = json_extract(c.value, '$.user_id');
