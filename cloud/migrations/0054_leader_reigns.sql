-- One row per leader who held a seat's throne, with the turns they held it.
--
-- player_summaries records the STARTING ruler and nothing after them
-- (starting_ruler_archetype, starting_ruler_reign_turns), plus a
-- succession_count that says how often the throne changed hands without saying
-- to whom. Across the local 116-save corpus that leaves most of the game
-- undescribed: 528 of 742 human-seat reigns (71.2%) are successors, and the
-- starting ruler holds 8,578 of 18,055 leader-turns (47.5%). An archetype
-- distribution read off the starting ruler alone therefore reads as a portrait
-- of the whole game while describing its first half.
--
-- The succession chain has to land in D1 because the stats aggregator
-- (cloud/src/stats/aggregate.ts) runs SQL over games × player_summaries and
-- never reads R2, so the blob's characters[] is out of its reach. Shape
-- precedent: player_family_cities (migration 0038) — a small child table
-- derived from the blob at index time.
--
-- Every seat in the roster gets rows, human or not, like player_summaries;
-- readers filter on is_human through the join (loadLeaderReigns in
-- stats/aggregate.ts).
--
-- `end_turn` is the turn the NEXT leader acceded, falling back to this
-- leader's death turn and then to the game's last turn. Not the leader's own
-- death: measured over the corpus, 87 of 528 successions have the predecessor
-- dying AFTER the successor acceded, so death would double-count those turns.
-- Abdication needs no term of its own — 117 of the 119 reigns carrying an
-- <AbdicateTurn> abdicate exactly on the next accession turn, and the 2 that
-- don't account for 39 of 18,055 leader-turns.
--
-- Turns held is `end_turn - start_turn`, so the interval is half-open: the
-- successor holds `end_turn`. 16 of 742 reigns are zero-length under that rule
-- (7 of them two accessions on one turn) and contribute no throne-time, which
-- is the right answer rather than a row to drop.
--
-- No secondary index: the only reader selects by game_id, which the primary
-- key's leading column already serves.
CREATE TABLE leader_reigns (
    game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
    player_index INTEGER NOT NULL,
    character_xml_id INTEGER NOT NULL,
    -- NULL for a leader whose archetype the save doesn't record: a child ruler
    -- (Character.doArchetype refuses below ADULT_AGE, Character.cs:7758), and
    -- every leader in a save old enough to write <Trait> instead of
    -- <TraitTurn>, which archetypeFromTraits cannot read. 92 of 742 corpus
    -- reigns, 12-14% of throne-time per band.
    archetype TEXT,
    start_turn INTEGER NOT NULL,
    end_turn INTEGER NOT NULL,
    PRIMARY KEY (game_id, player_index, character_xml_id)
);
