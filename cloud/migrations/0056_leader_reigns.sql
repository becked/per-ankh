-- One row per leader who held a seat's throne, and the turn they took it.
--
-- player_summaries records the STARTING ruler and nothing after them
-- (starting_ruler_archetype, starting_ruler_reign_turns), plus a
-- succession_count that says how often the throne changed hands without saying
-- to whom. Across the local 116-save corpus that leaves most of the game
-- undescribed: 528 of 742 human-seat reigns are successors, so an archetype
-- distribution read off the starting ruler alone describes 214 leaders and
-- reads as a portrait of all 742.
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
-- start_turn is <LeaderTurn>, and the only turn the table carries: the reader
-- counts leaders in the band their accession falls in, so a reign needs no end
-- and nothing is weighted by how long it ran. Measured over the corpus, all
-- 1,219 <LeaderTurn> values are 1 or more (335 of them exactly 1), so the
-- 1-40 / 41-70 / 71+ bands partition every accession exactly once.
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
    -- <TraitTurn>, which archetypeFromTraits cannot read. 92 of the corpus's
    -- 742 human-seat reigns — 47, 25 and 20 across the three bands.
    archetype TEXT,
    start_turn INTEGER NOT NULL,
    PRIMARY KEY (game_id, player_index, character_xml_id)
);
