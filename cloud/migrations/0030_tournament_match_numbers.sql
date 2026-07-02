-- Persisted global "Match N" numbering (server-assigned).
--
-- The number is a stable public handle — admins paste "Match 12" into Discord
-- threads — so it must never change once assigned. A client-derived numbering
-- (sort + count at render) can't guarantee that: divisions advance
-- independently (a later-generated Division B round sorts BEFORE Division A's
-- newer round and shifts everything after it), and a retro-edit flipping a
-- match to 'bye' would drop it out of a derived sequence. Persisting the
-- number at round-generation time makes append-only true by construction.
--
-- Byes are never numbered (auto-resolved, never played, hidden from the
-- matches surfaces): match_number stays NULL for them.
ALTER TABLE tournament_matches ADD COLUMN match_number INTEGER;

-- Backfill existing real matches per tournament, replicating the order the
-- (previous, client-side) numbering displayed: phase (swiss, championship),
-- then round, then division (A, B), then within-round position — so any number
-- an admin has already shared keeps pointing at the same match.
UPDATE tournament_matches
SET match_number = (
	SELECT numbered.n
	FROM (
		SELECT
			m.match_id AS mid,
			ROW_NUMBER() OVER (
				PARTITION BY r.tournament_id
				ORDER BY
					CASE r.phase WHEN 'swiss' THEN 0 ELSE 1 END,
					r.round_number,
					CASE r.division WHEN 'A' THEN 0 WHEN 'B' THEN 1 ELSE 2 END,
					m.match_index,
					m.created_at
			) AS n
		FROM tournament_matches m
		JOIN tournament_rounds r ON r.round_id = m.round_id
		WHERE m.status != 'bye'
	) AS numbered
	WHERE numbered.mid = tournament_matches.match_id
)
WHERE status != 'bye';
