// Valibot schemas for the cloud-rewrite /v1/games endpoints.
//
// Validation philosophy: validate the top-level envelope shape,
// the array bounds, and any field
// the upload pipeline reads server-side. Don't redefine every nested entity
// — the parser is the source of truth, and we trust its output. The bounds
// here just cap pathological inputs (zip bombs after decompression, abuse
// payloads).

import * as v from "valibot";

// ----- Bounds -----

export const MAX_PLAYERS = 20;
export const MAX_YIELD_ENTRIES = 300;
export const MAX_EVENT_LOGS = 50_000;
export const MAX_MAP_TILES = 50_000;
export const MAX_HISTORY_ENTRIES = 20;
export const MAX_TECHS = 5_000;
export const MAX_UNITS = 5_000;
export const MAX_CITIES = 200;
export const MAX_IMPROVEMENTS = 50_000;
export const MAX_LAWS = 1_000;
export const MAX_TOTAL_TURNS = 1_500;
export const MAX_CHARACTERS = 5_000;
export const MAX_FAMILIES = 50;
export const MAX_TILE_OWNERSHIP_ENTRIES = 200_000;
// The whole disabled list, not just its wonders: Reference/XML names 159
// IMPROVEMENT_* zTypes, so a base save can already fill four-fifths of a
// 200-wide cap and a mod that adds improvements would blow it — rejecting the
// entire upload over a field only the wonder charts read.
export const MAX_DISABLED_IMPROVEMENTS = 1_000;

// Versions accepted by /v1/games. Update before releasing a frontend that
// produces a new PARSER_VERSION (Worker first, frontend second — see
// spec §10 "Deploy Ordering").
//
// 2.0.0 — initial cloud-rewrite blob
// 2.1.0 — added player_nations sidecar (Phase 1 prep)
// 2.2.0 — added player_roster sidecar (Phase 2 picker + summaries)
// 2.3.0 — added city_statistics.cities[].first_owner_player_xml_id
//         (powers cities_founded / fifth_city_turn / tenth_city_turn
//         milestones in player_summaries)
// 2.3.1 — completed_techs deduped by (player_id, tech), earliest turn wins
//         (Old World grants same tech twice via free-tech events; the
//         cloud tech_events PK can't accept duplicates)
// 2.4.0 — winner detection for legacy <WinnerTeam>/<WinnerVictory> XML
//         format (older OW versions); adds `match_metadata.game_over`.
// 2.4.1 — game_details.difficulty sourced from root <Root @_Difficulty>
//         (was always null because the save-owner detection pass that
//         the previous per-player source depended on doesn't exist).
// 2.5.0 — game_details.difficulty + per-player PlayerInfo.difficulty
//         sourced from <Difficulty>/<PlayerDifficulty> positional array;
//         isSaveOwner correctly set from <?ActivePlayer?> PI (with
//         single-human-roster fallback).
// 2.5.1 — legacy <WinnerVictory> resolved against the global victory info-list
//         ordering (baked from Reference victory.xml) instead of the per-save
//         <VictoryEnabled> subset; fixes dropped winners when an earlier
//         victory type is disabled (e.g. MP with DOUBLE/AMBITION off).
// 2.6.0 — per-player ids retained where previously only nation was kept:
//         game_details.players[].player_id, city_statistics.cities[]
//         .owner_player_xml_id, game_religions[].founder_player_xml_id,
//         improvement_data.improvements[].owner_player_xml_id. Lets the
//         detail view distinguish same-nation players in mirror matches.
// 2.6.1 — map_tiles[].river_w/sw/se parse correctly. The flags were compared
//         against "true", so they were always false. The tag value is actually
//         a RotationType flow-direction enum (0/1) — presence means a river,
//         an absent tag means none — so we now test presence. Powers river
//         rendering on the map.
// 2.7.0 — game_details.map_aspect_ratio (root @_MapAspectRatio) + map_options
//         (chosen <MapOptionsMulti>/<MapOptionsSingle> as a zType→value map).
//         Powers the game-detail Map Settings panel (size/aspect/non-defaults).
// 2.8.0 — character leader fields fixed (became_leader_turn from <LeaderTurn>,
//         is_royal from <Royal/>, abdicated_turn from <AbdicateTurn>,
//         nation_joined_turn from <NationTurn>, archetype from the *_ARCHETYPE
//         trait) + new wisdom/charisma/courage/discipline ratings on characters.
//         Powers the game-detail Leaders tab.
// 2.9.0 — character suffix (regnal numeral N from <Suffix>N</Suffix>; absent
//         means 1). Powers leader-name numerals ("Meera II the Fountainhead").
// 2.9.1 — law-adoption history resolves each LAW_ADOPTED event's class via the
//         static LAW_TO_CLASS table instead of the save's active laws, so a law
//         later switched away from (e.g. Epics → Exploration) no longer drops
//         from the "Law Adoption Over Time" chart or mis-dates its class.
//         Succession laws (LAWCLASS_ORDER, e.g. Primogeniture) are excluded
//         from current_laws + law_adoption_history (and so from law_events /
//         laws_count) — they're realm defaults, not civic adoptions.
// 2.10.0 — city_statistics.cities[].player_families (each owning player →
//         their family, from <PlayerFamily>) + map_tiles[].owner_player_xml_id
//         (per-turn owning player). Lets the map's turn slider show a captured
//         city's founder family before the capture instead of the conqueror's.
// 2.11.0 — game_details.game_options + match_metadata.game_options (set
//         <GameOptions> flags as zType→true) and game_details.players[]
//         .leader_character_xml_id (last id of <Leaders>, the reigning
//         leader). Together they let the Techs tab price the leader's court
//         science exactly: GAMEOPTION_COMPETITIVE_MODE selects the rating
//         curve and grants a flat science stipend. A blob without
//         game_options means "unknown", not "no options set".
// 2.12.0 — game_details.disabled_improvements (the game-level
//         <ImprovementDisabled> list). Old World enables only a subset of the
//         wonders per game — a base save disables 15 of 28 — so this is what
//         lets the wonder charts count "could have built it" rather than
//         assuming every wonder was on the board. Absent or null = unknown;
//         an empty list means the save disabled nothing.
//         Also changes what player_wonders means: the builder is now the
//         player who owned the wonder's tile on the turn it completed, read
//         from the ownership history, rather than whoever holds the tile at
//         the end. Blobs below 2.12.0 credit a captured wonder to its captor.
// 2.13.0 — projects_produced, the Player node's ProjectsProduced map
//         (every project completed, whole-game counts). Purely additive;
//         older blobs simply lack the field and the Economy tab hides the
//         panel.
// 2.14.0 — story_events ships the game's whole history instead of the newest
//         100, and every row carries player_xml_id, the owning player's
//         xml_id. The cap came from the DuckDB query that fed the desktop
//         "recent events" table; its consumers now attribute per (player,
//         turn), and the window covered only the last 12-22 turns. The id is
//         what those consumers join on: rows previously carried only
//         player_name, and single-player saves leave that empty for every
//         player, so the name join handed each of them every realm's events.
//         The array also gains the character- and city-scoped events the save
//         records — the parser read them off `player`, and the save writes
//         `Player`, so every one of them was dropped — which populates
//         primary_character_name and city_name for the first time. Blobs
//         below 2.14.0 fall back to the name, and leave expedition markers,
//         science-spike sources and legitimacy event rows missing at every
//         earlier turn.
//         event_logs gains the same attribution key for the same reason,
//         as player_xml_ids — a list, not a scalar, because a row there is a
//         dedup group over (turn, log_type, description) and can hold several
//         realms' copies of one event. The old shape put two meanings in
//         player_name: null for a multi-row group, which consumers read as
//         "game-wide", and a name for a single-row one, which in single-player
//         is empty and so matches every player. The Economy tab's calamity
//         rail showed every realm's droughts and plagues on every band as a
//         result. The set says which realms actually logged the event, so a
//         genuinely global plague carries them all and still lands
//         everywhere. player_name is unchanged, and is what blobs below
//         2.14.0 still join on.
// 2.15.0 — per-city religion presence, project counts, governor xml_id,
//         happiness_level, damage and assimilate_turns on
//         city_statistics.cities, plus theologies on game_religions — the
//         Techs tab's science-source breakdown reads all seven. The last
//         three are the terms of City.calculateTotalYieldModifier the
//         breakdown could not price: discontent, damage and assimilation
//         are all negative percent modifiers science does not opt out of.
//         Purely additive; older blobs lack the fields and the new
//         breakdown rows are omitted.
// 2.16.0 — tech_choices, the Player node's TechPathHistory: for every tech a
//         player CHOSE, the cards passed over in the same draw. A tech they
//         hold with no row here was never drafted — a nation starting tech, a
//         Sages seat's random tech, an event reward — which is the only signal
//         the save gives for a free tech. No turn is recorded against a
//         choice; row order is draw order. Purely additive, and empty for
//         saves from Old World builds before it started recording the
//         history, so the Techs tab hides the card rather than showing a
//         half-answer.
// 2.17.0 — map_tiles[].improvement_turns_left, and improvement_pillaged now
//         parses at all. Both tags were read under names the game never
//         writes: it writes `<Pillaged />` as an empty element (presence is
//         the test, as with `<Road />`) and `<ImprovementBuildTurnsLeft>`,
//         so the flag was always false and the turns always null. The third
//         name, `<ImprovementDisabled>`, is a GAME-level list of globally
//         disabled improvements — already parsed as such into
//         game_details.disabled_improvements — never a tile flag, so the
//         tile-level field is gone rather than renamed. Together they are
//         the game's `getActiveImprovement`: a pillaged or still-building
//         improvement pays no yield and grants no adjacency bonus, which
//         the Techs tab's science-source breakdown now honours. The added
//         field costs the largest blob in the corpus +248 KiB uncompressed
//         and +1.8 KiB gzipped — it is null on almost every tile.
// 2.18.0 — yield_history[].cumulative_is_game_total, saying which quantity a
//         series' `cumulative` holds: the game's own lifetime total for the
//         yield, or our running sum of the per-turn rate. The two were mixed
//         and indistinguishable before. It is a property of the save and of
//         the yield, not of the series' rows — the game totals every yield
//         but Discontent and Maintenance, which subtract from another yield
//         and are credited to it instead, and a save's totals are complete
//         only when it recorded them from the start. A game begun before
//         Old World 1.0.81366 and continued on a later build starts its
//         totals at the upgrade turn, from zero, and every one of its series
//         falls back to the running sum. Series that do hold the game's
//         total now read 0 before their first row, as the game does, where
//         the old shape emitted null. Reparsed games carry those 0s into
//         game_player_turn.*_cumulative, whose writer skips nulls today.
// 2.19.0 — player_wonders[].player_id/player_name/nation, reattributed by a
//         corrected reading of tile_ownership_history. The save does not key
//         an ownership entry to the turn the tile changed hands: `updateHistory`
//         (`Tile.cs:10889`) records the owner under `game().getTurn()` from
//         `Tile.doTurn`, which `incrementTurn` (`Game.cs:3180`) reaches only
//         after `setTurn(getTurn() + 1)`, so a change during turn N is written
//         under key N+1. Every reader now goes through `ownershipChangeTurn`
//         (`src/lib/parser/types.ts`), this derivation included, so a wonder
//         finishing on the turn its tile changed hands is credited to the
//         player who actually held it. Measured over `test-data/saves/`
//         (12 saves, 69 wonders with a resolvable tile): the correction
//         reattributes 0 of them — a wonder completing on exactly the turn its
//         tile turned over does not occur in the corpus — so the bump's
//         practical effect is to orphan the stats caches, not to move a value
//         anyone has seen. The same correction is applied at read time to the
//         map turn slider and the Economy tab's territory curve, which need no
//         reparse.
// 2.20.0 — build_turns_left and city_xml_id on improvement_data.improvements
//         (a tile carries its improvement from the turn work starts, so a
//         half-built wonder was indistinguishable from a built one),
//         original_tribe on units (a hired mercenary vs a trained unit) and
//         tile_xml_id on city_statistics.cities (dates a capture through
//         tile_ownership_history). Read by the challenge scorer; purely
//         additive.
// 2.21.0 — free specialists are derived at parse time and materialised onto
//         map_tiles[].specialist and
//         improvement_data.improvements[].specialist. No new field: the game
//         draws no distinction between a free specialist and a placed one
//         (Tile.getSpecialist returns either), so the rows don't say which
//         kind they hold. The save records nothing for a free one: the Jerwan
//         Aqueduct gives one to each adjacent farm, and Tile.writeGameXML
//         guards its <Specialist> element on the STORED specialist, so a tile
//         holding only the free one writes no element at all while the game
//         still counts it. Measured across test-data/saves: 4 of 13 have a
//         built aqueduct, and in 3 of them all 14 adjacent farms carried no
//         <Specialist>; the fourth already stores a Farmer on all 5 of its
//         farms, where a stored specialist shadows the free one and the
//         derivation adds none. VALUE-CHANGING for the affected games'
//         specialist counts, rural coverage, specialist science and a
//         challenge run's city.specialists objective — a bump rather than a
//         silent correction, since existing blobs keep the old values until
//         reparsed.
// 2.22.0 — damage on units, from the <Damage> the game writes only when it is
//         non-zero (`Unit.writeGameXML`, Unit.cs:1002-1005), so the parser
//         reads an absent element as 0. Health is its complement —
//         `Unit.getHP` (Unit.cs:2422) is `getHPMax() - getDamage()`, over the
//         `<iHPMax>` that is 20 for all 91 UNIT_ entries of unit.xml.
//         276 of 2179 tile-nested
//         units across test-data/saves carry the element (12.7%), values
//         1-18. Purely additive.
// 2.23.0 — general_xml_id on units, the <Character> id of the general leading
//         the unit. `Unit.writeGameXML` (Unit.cs:996) writes <GeneralID> only
//         when `hasGeneral()` holds — `getGeneralID() != -1` (Unit.cs:2278) —
//         so the sentinel is never written and an absent element means a unit
//         nobody leads. The unit is the only side of the link the save
//         records: `Character.writeGameXML` writes no unit id, and a
//         character's own miUnitID is reconstructed at load by
//         `Unit.setGeneralID`. 203 of 2179 tile-nested units across
//         test-data/saves carry it (9.3%), in 15 of the 16 saves, ids 10-679;
//         all 203 are military by `classifyUnit`, every id resolves to a
//         <Character> owned by the unit's own player with no <DeathTurn>, and
//         no character leads two units. Purely additive.
// 2.24.0 — the inputs to a character's opinion of their own leader, which
//         the save stores no value for at all: `Character.writeGameXML`
//         (Character.cs:832) never writes `maiOpinionRate`, and the game
//         rebuilds every character's rate after the read (`Game.postStart`,
//         Game.cs:12107 -> `updateCharacterOpinionAll`, `:12152`). They are:
//         game_details.players[].chosen_heir_xml_id and .succession_gender
//         (<ChosenHeirID>/<SuccessionGender>, 48 elements each in 16 of 16
//         test-data/saves), the new top-level player_councils array
//         (<CouncilCharacter>, 86 filled seats in 13 of 16 — already parsed by
//         `parsePlayerCouncil`, previously unwired), father_xml_id /
//         mother_xml_id on characters, and head_character_xml_id on
//         game_religions. The parent pair is the SOCIAL parents the game's own
//         `Character.getAncestorLevel` (Character.cs:1567) walks; 17 of 3,458
//         corpus characters carry a social parent the birth columns don't, so
//         the birth ids are the wrong pair for `isChildOf`. The religion head
//         (<ReligionHeadID>, also already parsed and unwired) doubles both
//         religion terms, and 12 of the corpus's 203 unit generals head a
//         religion. Purely additive; absent means UNKNOWN on each, not absent.
// 2.25.0 — the three channels of a unit's effect-unit dictionary the blob
//         could not answer, which is what makes the unit card's attack and
//         defense the game's own numbers rather than a floor. `<PlayerFamily>`
//         and `<BonusEffectUnits>` arrive as the new top-level unit_families
//         and unit_effects arrays — both already parsed by `parseUnitFamilies`
//         / `parseUnitEffects` and previously unwired — and the game-wide AI
//         advantage as match_metadata.advantage. Across test-data/saves:
//         1,827 of 2,179 tile-nested units resolve to a family of their own
//         player's and 1,633 of those sit on a non-neutral opinion band
//         (−20% to +10% strength); 255 units carry a bonus effect unit (284
//         rows, 9 distinct effects, of which EFFECTUNIT_GUARD1 on 4 units pays
//         +10% defense); and 6 of the 16 saves set a non-NONE advantage, all
//         of them bonus tiers that confer no effect unit — only the
//         ADVANTAGE_PENALTY_* tiers do, and the corpus has none. Additive on
//         all three; absent means UNKNOWN on each, not absent.
//
//         NOT additive on one: this is the first version whose map_tiles[]
//         carry no `religions`. The parser wrote that array and nothing read
//         it once the map's religion overlay went, so the derive dropped it
//         one commit earlier, under 2.24.0 — this is the version that first
//         ships the shorter tile. MINOR rather than MAJOR per §10 because no
//         reader loses anything: a 2.24.0-or-older blob still carries the
//         field and no code path consults it, so the removal breaks no
//         consumer. A field a reader DID consult would be MAJOR, and MAJOR
//         is not free here — `PARSER_VERSION`'s major mirrors
//         `FullGameData.version: 2` (src/lib/parser/types.ts), so it moves
//         with the envelope or not at all.
// 2.26.0 — what the save records about a city nobody holds, so the map can
//         draw one the way the game does instead of as bare terrain. A
//         capture hands the city to nobody and names the captor beside it
//         (`Unit.doCityCapture`, Unit.cs:2004), so `owner_player_xml_id`
//         alone cannot tell a captured city from a tribe's own.
//         city_statistics.cities[] gains tribe, capture_player_xml_id and
//         capture_tribe, read under the names `City.writeGameXML` writes
//         (<Tribe>, <CapturePlayer>, <CaptureTribe>; City.cs:1263, :1251,
//         :1255). Across test-data/saves: 6 of 326 city rows are frozen
//         mid-capture, in 6 of the 16 saves, every one of them Player="-1",
//         Family="NONE" and TRIBE_ANARCHY with CapturePlayer set and
//         CaptureTurns absent on 2. Additive on all three; absent means
//         UNKNOWN on each, not "not being captured".
//
//         <CaptureTurns> is deliberately NOT parsed: it has no denominator
//         in the save, because `City.getCaptureThreshold` (City.cs:2118)
//         computes one at runtime from per-team culture.
// 2.27.0 — player_roster[].is_save_owner, the flag the parser has resolved
//         from `<?ActivePlayer?>` since 2.5.0 and then spent on the headline
//         difficulty alone. It says which seat the save was written from, so
//         the upload picker can pre-select a seat on a first upload — before
//         user_online_ids holds anything to match against. Purely additive;
//         older blobs lack it and the picker falls back to the known-id match.
// 2.27.1 — match_metadata.save_date falls back to the timestamp Old World
//         writes into the save's ZIP entry name, for a save whose root
//         `SaveDate` attribute is absent (#274) — `Game.getEndAutoSavePath`
//         (Game.cs:16348) names the file off the same `DateTime.Now` that
//         `Game.writeGameXML` (Game.cs:1203) formats into the attribute.
//         Value-only, and only for those saves: where the attribute exists it
//         still wins.
export const KNOWN_PARSER_VERSIONS = new Set([
	"2.0.0",
	"2.1.0",
	"2.2.0",
	"2.3.0",
	"2.3.1",
	"2.4.0",
	"2.4.1",
	"2.5.0",
	"2.5.1",
	"2.6.0",
	"2.6.1",
	"2.7.0",
	"2.8.0",
	"2.9.0",
	"2.9.1",
	"2.10.0",
	"2.11.0",
	"2.12.0",
	"2.13.0",
	"2.14.0",
	"2.15.0",
	"2.16.0",
	"2.17.0",
	"2.18.0",
	"2.19.0",
	"2.20.0",
	"2.21.0",
	"2.22.0",
	"2.23.0",
	"2.24.0",
	"2.25.0",
	"2.26.0",
	"2.27.0",
	"2.27.1",
]);

// The latest accepted version. Echoed back on stats responses and
// embedded in stats cache keys so a parser bump (after the matching
// extraction code lands) naturally orphans every old entry. Bump in
// lockstep with the `KNOWN_PARSER_VERSIONS` addition above.
export const CURRENT_PARSER_VERSION = "2.27.1";

// ----- Reusable atoms -----

const PlayerRosterEntrySchema = v.object({
	player_index: v.pipe(v.number(), v.integer(), v.minValue(0)),
	player_name: v.string(),
	nation: v.nullable(v.string()),
	is_human: v.boolean(),
	online_id: v.nullable(v.string()),
	// Which seat the save was written from (2.27.0+). `v.optional` tolerates
	// the deploy gap where the Worker is updated but the frontend still emits
	// ≤2.26.0 blobs, and keeps older R2 blobs passing if they're re-validated.
	is_save_owner: v.optional(v.boolean()),
});

const PlayerInfoSchema = v.object({
	// Added in PARSER_VERSION 2.6.0 — the player's xml_id, used by the detail
	// view to key/join players (nation collides in mirror matches). `v.optional`
	// tolerates the deploy gap and keeps older R2 blobs passing if re-validated.
	player_id: v.optional(v.number()),
	player_name: v.string(),
	nation: v.nullable(v.string()),
	is_human: v.boolean(),
	legitimacy: v.nullable(v.number()),
	state_religion: v.nullable(v.string()),
	// Added in PARSER_VERSION 2.5.0. `v.optional` (rather than required)
	// tolerates the deploy gap where the Worker is updated but the frontend
	// still emits ≤2.4.1 blobs, and keeps older R2 blobs passing if they're
	// ever re-validated.
	difficulty: v.optional(v.nullable(v.string())),
	// Added in PARSER_VERSION 2.11.0 — the player's reigning leader, joined to
	// characters[].xml_id to price their court science. `v.optional` for the
	// same deploy-gap reason as the fields above.
	leader_character_xml_id: v.optional(v.nullable(v.number())),
	// Added in PARSER_VERSION 2.24.0 — the nominated heir and the succession
	// gender rule that decides whether they are eligible, the two inputs to
	// the Heir term of a character's opinion of their leader. `v.optional` for
	// the same deploy-gap reason as the fields above.
	chosen_heir_xml_id: v.optional(v.nullable(v.number())),
	succession_gender: v.optional(v.nullable(v.string())),
});

const GameDetailsSchema = v.object({
	match_id: v.number(),
	game_name: v.nullable(v.string()),
	save_date: v.nullable(v.string()),
	total_turns: v.pipe(
		v.number(),
		v.integer(),
		v.minValue(0),
		v.maxValue(MAX_TOTAL_TURNS),
	),
	map_size: v.nullable(v.string()),
	map_class: v.nullable(v.string()),
	// Added in parser_version 2.7.0. `optional` tolerates the deploy gap where
	// the Worker is updated but the frontend still emits ≤2.6.1 blobs, and keeps
	// older R2 blobs passing if they're ever re-validated.
	map_aspect_ratio: v.optional(v.nullable(v.string())),
	map_options: v.optional(
		v.nullable(v.record(v.string(), v.union([v.string(), v.boolean()]))),
	),
	// Added in parser_version 2.11.0; `optional` for the same reason. The value
	// is always `true` — the save encodes a set option as an empty element, so
	// presence IS the value and an unset option is simply absent.
	game_options: v.optional(v.nullable(v.record(v.string(), v.literal(true)))),
	// Improvement zTypes disabled for this game (2.12.0+). Absent or null means
	// "unknown" — an older blob, or a save carrying no <ImprovementDisabled>
	// block — not "everything was enabled". An empty array is that other claim.
	disabled_improvements: v.optional(
		v.nullable(
			v.pipe(v.array(v.string()), v.maxLength(MAX_DISABLED_IMPROVEMENTS)),
		),
	),
	game_mode: v.nullable(v.string()),
	difficulty: v.nullable(v.string()),
	opponent_level: v.nullable(v.string()),
	winner_player_id: v.nullable(v.number()),
	winner_name: v.nullable(v.string()),
	winner_civilization: v.nullable(v.string()),
	winner_victory_type: v.nullable(v.string()),
	players: v.pipe(v.array(PlayerInfoSchema), v.maxLength(MAX_PLAYERS)),
	// Schema-tolerant on the rest — the parser owns these and the cloud
	// detail view consumes them as-is. Any "extra" fields below are passed
	// through unvalidated by virtue of valibot's default object behavior
	// (extra keys are preserved).
});

const WinnerInfoSchema = v.object({
	winner_player_xml_id: v.number(),
	winner_team_id: v.nullable(v.number()),
	victory_type: v.string(),
});

const MatchMetadataSchema = v.object({
	xml_game_id: v.string(),
	total_turns: v.pipe(
		v.number(),
		v.integer(),
		v.minValue(0),
		v.maxValue(MAX_TOTAL_TURNS),
	),
	game_name: v.nullable(v.string()),
	save_date: v.nullable(v.string()),
	game_version: v.nullable(v.string()),
	map_width: v.nullable(v.number()),
	map_height: v.nullable(v.number()),
	map_size: v.nullable(v.string()),
	map_class: v.nullable(v.string()),
	// Added in parser_version 2.7.0; `optional` for the same deploy-gap reason
	// as in GameDetailsSchema above.
	map_aspect_ratio: v.optional(v.nullable(v.string())),
	map_options: v.optional(
		v.nullable(v.record(v.string(), v.union([v.string(), v.boolean()]))),
	),
	// Added in parser_version 2.11.0; `optional` for the same deploy-gap reason
	// as in GameDetailsSchema above.
	game_options: v.optional(v.nullable(v.record(v.string(), v.literal(true)))),
	// Improvement zTypes disabled for this game (2.12.0+). Absent or null means
	// "unknown" — an older blob, or a save carrying no <ImprovementDisabled>
	// block — not "everything was enabled". An empty array is that other claim.
	disabled_improvements: v.optional(
		v.nullable(
			v.pipe(v.array(v.string()), v.maxLength(MAX_DISABLED_IMPROVEMENTS)),
		),
	),
	game_mode: v.nullable(v.string()),
	difficulty: v.nullable(v.string()),
	opponent_level: v.nullable(v.string()),
	// The game's AI-advantage setting (2.25.0+); `optional` for the same
	// deploy-gap reason as in GameDetailsSchema above. Absent means "unknown"
	// — an older blob — rather than ADVANTAGE_NONE, which is what null says.
	// Only here: `deriveGameDetails` does not copy it, so there is no
	// game_details.advantage for a schema entry to guard.
	advantage: v.optional(v.nullable(v.string())),
	victory_conditions: v.nullable(v.string()),
	enabled_mods: v.nullable(v.string()),
	enabled_dlc: v.nullable(v.string()),
	// `game_over` was added in parser_version 2.4.0. `v.optional` (rather
	// than required) tolerates the deploy gap where the Worker has been
	// updated but the frontend still emits 2.3.1 blobs.
	game_over: v.optional(v.boolean()),
	winner: v.nullable(WinnerInfoSchema),
});

// ----- Main envelope -----
//
// `looseObject` (vs `object`) preserves extra keys — important because new
// PARSER_VERSIONs may introduce additive fields the Worker doesn't yet
// validate; we still want them to round-trip into R2 without rejection.

export const FullGameDataSchema = v.looseObject({
	version: v.literal(2),
	parser_version: v.pipe(
		v.string(),
		v.check((s) => KNOWN_PARSER_VERSIONS.has(s), "Unknown parser_version"),
	),
	created_at: v.string(),
	match_metadata: MatchMetadataSchema,
	game_details: GameDetailsSchema,

	// Array bounds only — element-level validation is the parser's job.
	player_history: v.pipe(v.array(v.unknown()), v.maxLength(MAX_PLAYERS)),
	yield_history: v.pipe(v.array(v.unknown()), v.maxLength(MAX_YIELD_ENTRIES)),
	event_logs: v.pipe(v.array(v.unknown()), v.maxLength(MAX_EVENT_LOGS)),
	law_adoption_history: v.pipe(
		v.array(v.unknown()),
		v.maxLength(MAX_HISTORY_ENTRIES),
	),
	current_laws: v.pipe(v.array(v.unknown()), v.maxLength(MAX_LAWS)),
	tech_discovery_history: v.pipe(
		v.array(v.unknown()),
		v.maxLength(MAX_HISTORY_ENTRIES),
	),
	completed_techs: v.pipe(v.array(v.unknown()), v.maxLength(MAX_TECHS)),
	// One row per tech chosen, so the tech bound covers it.
	tech_choices: v.optional(
		v.pipe(v.array(v.unknown()), v.maxLength(MAX_TECHS)),
	),
	units_produced: v.pipe(v.array(v.unknown()), v.maxLength(MAX_UNITS)),
	city_statistics: v.unknown(),
	improvement_data: v.unknown(),
	map_tiles: v.pipe(v.array(v.unknown()), v.maxLength(MAX_MAP_TILES)),
	game_religions: v.pipe(v.array(v.unknown()), v.maxLength(MAX_PLAYERS)),
	player_wonders: v.pipe(v.array(v.unknown()), v.maxLength(MAX_CITIES)),

	tile_ownership_history: v.pipe(
		v.array(v.unknown()),
		v.maxLength(MAX_TILE_OWNERSHIP_ENTRIES),
	),
	player_nations: v.pipe(v.array(v.unknown()), v.maxLength(MAX_PLAYERS)),
	player_roster: v.pipe(
		v.array(PlayerRosterEntrySchema),
		v.maxLength(MAX_PLAYERS),
	),

	// The remaining new entity arrays (characters, families, units, etc.)
	// are accepted via looseObject without per-field bounds. They're only
	// rendered, not searched/aggregated server-side.
});

export type FullGameData = v.InferOutput<typeof FullGameDataSchema>;
export type PlayerRosterEntry = v.InferOutput<typeof PlayerRosterEntrySchema>;

// ----- Upload form metadata -----
//
// `uploader_player_index` is sent as a JSON string in the multipart form
// (form fields are strings) — either a non-negative integer naming a human
// player from `player_roster`, or `null` for "observer mode" (uploading on
// someone else's behalf, e.g. a tournament admin or archival upload).
//
// The invariant is: an uploader is at most one human. Earlier drafts
// allowed an array of indexes, but a single user can't legitimately *be*
// multiple players, and the multi-pick interpretation made games.user_nation
// (derived from the first picked nation) ambiguous.

export const UploaderPlayerIndexSchema = v.nullable(
	v.pipe(v.number(), v.integer(), v.minValue(0)),
);

export type UploaderPlayerIndex = v.InferOutput<
	typeof UploaderPlayerIndexSchema
>;

// ----- PATCH /v1/games/:id body -----
//
// All fields are optional but at least one is required.
//   - is_public toggles the public-share flag (rate-limited 60/hr/user via
//     the visibility_change audit event).
//   - collection_id moves the game between user-owned collections (or null
//     to leave it uncategorized — currently unused by the UI but the shape
//     is permissive for forward-compat).
//   - display_name is the owner's renamed title for the save. Pass a string
//     to set, or null to clear and fall back to the save's original
//     game_name. Empty / whitespace-only strings are rejected (use null).
//   - uploader_player_index corrects which player the owner was, for a save
//     uploaded under the wrong pick. Same shape as the upload form field
//     above (a human's player_index, or null for observer), and the handler
//     re-derives games.user_nation / user_won and player_summaries.is_uploader
//     from it. Refused on a tournament-linked save, where the slot mapping
//     already records the pick.

export const GAME_DISPLAY_NAME_MAX = 120;

export const GamePatchSchema = v.pipe(
	v.object({
		is_public: v.optional(v.boolean()),
		collection_id: v.optional(
			v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1))),
		),
		display_name: v.optional(
			v.nullable(
				v.pipe(
					v.string(),
					v.trim(),
					v.minLength(1, "Name cannot be empty"),
					v.maxLength(GAME_DISPLAY_NAME_MAX, "Name too long"),
				),
			),
		),
		uploader_player_index: v.optional(UploaderPlayerIndexSchema),
	}),
	v.check(
		(o) =>
			o.is_public !== undefined ||
			o.collection_id !== undefined ||
			o.display_name !== undefined ||
			o.uploader_player_index !== undefined,
		"At least one of is_public, collection_id, display_name, uploader_player_index required",
	),
);

export type GamePatch = v.InferOutput<typeof GamePatchSchema>;
