-- Collapse allowed_map_scripts + map_script_options into a single map_pool
-- column. map_pool is a JSON array of instances { id, script, options },
-- so the same map script can appear multiple times with different options
-- (e.g. Continent @ Duel and Continent @ Tiny — previously impossible because
-- both columns keyed config by MAPCLASS string).
--
-- Matches reference the chosen instance via tournament_matches.map_pool_id.
-- map_script is kept as a denormalized label (the played MAPCLASS). Map config
-- is locked once a tournament leaves 'setup' (and matches are only generated
-- at/after that transition), so a match's instance reference is effectively
-- frozen for the match's lifetime — no per-match options snapshot is needed.

ALTER TABLE tournaments ADD COLUMN map_pool TEXT NOT NULL DEFAULT '[]';
ALTER TABLE tournament_matches ADD COLUMN map_pool_id TEXT;

-- Backfill one instance per existing allowed script, carrying its current
-- options block (or {} when none). Instance ids are opaque random hex —
-- they only need to be unique within a tournament's pool.
UPDATE tournaments SET map_pool = COALESCE((
    SELECT json_group_array(json_object(
        'id', lower(hex(randomblob(8))),
        'script', je.value,
        'options', COALESCE(
            json_extract(map_script_options, '$.' || json_quote(je.value)),
            json('{}')
        )
    ))
    FROM json_each(allowed_map_scripts) je
), '[]');

-- Link each non-bye match to the (unambiguous, pre-migration there is exactly
-- one instance per script) same-script instance in its tournament's pool.
UPDATE tournament_matches SET map_pool_id = (
    SELECT json_extract(inst.value, '$.id')
    FROM tournament_rounds r
    JOIN tournaments t ON t.tournament_id = r.tournament_id,
         json_each(t.map_pool) inst
    WHERE r.round_id = tournament_matches.round_id
      AND json_extract(inst.value, '$.script') = tournament_matches.map_script
    LIMIT 1
)
WHERE tournament_matches.map_script IS NOT NULL;

ALTER TABLE tournaments DROP COLUMN allowed_map_scripts;
ALTER TABLE tournaments DROP COLUMN map_script_options;
