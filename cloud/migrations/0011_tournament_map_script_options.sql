-- Per-script map options for tournaments.
--
-- JSON object keyed by MAPCLASS_* (a subset of tournaments.allowed_map_scripts),
-- with each value being a per-script options object keyed by MAP_OPTIONS_*
-- option zType. Values are either a string (one of the option's <Choices>)
-- or a boolean (for MAP_OPTIONS_SINGLE_* toggles). Missing keys mean "use
-- the in-game XML <Default>" at render time.
--
-- Defaults to '{}' so existing tournaments keep behaving exactly as before
-- (every match uses XML defaults until an admin opens the options panel).

ALTER TABLE tournaments
    ADD COLUMN map_script_options TEXT NOT NULL DEFAULT '{}';
