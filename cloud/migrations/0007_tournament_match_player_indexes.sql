-- Add the slot↔player_index mapping to tournament_matches.
--
-- Each tournament match links to exactly one Old World save (when reported).
-- Within that save's player_roster, two slots map to two human player
-- indexes — this records which roster position corresponds to slot_a and
-- slot_b for the linked game.
--
-- Filled at upload time:
--   * Participant uploads: derived from uploader_player_index +
--     by-elimination (the other human in the roster).
--   * Admin observer uploads: explicitly provided as form fields, both
--     required.
--
-- Winner is derived by matching match_metadata.winner.winner_player_xml_id
-- against these mappings. Nullable until a save is linked.
--
-- Persisting these (vs. re-deriving from player_roster) enables future
-- cross-match analytics that join slot_id → player_summaries row by
-- (game_id, player_index).

ALTER TABLE tournament_matches ADD COLUMN slot_a_player_index INTEGER;
ALTER TABLE tournament_matches ADD COLUMN slot_b_player_index INTEGER;
