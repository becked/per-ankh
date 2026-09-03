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
// 2.16.0 — build_turns_left and city_xml_id on improvement_data.improvements
//         (a tile carries its improvement from the turn work starts, so a
//         half-built wonder was indistinguishable from a built one) and
//         original_tribe on units (a hired mercenary vs a trained unit) and
//         tile_xml_id on city_statistics.cities (dates a capture through
//         tile_ownership_history). Read by the challenge scorer; purely
//         additive.
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
]);

// The latest accepted version. Echoed back on stats responses and
// embedded in stats cache keys so a parser bump (after the matching
// extraction code lands) naturally orphans every old entry. Bump in
// lockstep with the `KNOWN_PARSER_VERSIONS` addition above.
export const CURRENT_PARSER_VERSION = "2.16.0";

// ----- Reusable atoms -----

const PlayerRosterEntrySchema = v.object({
	player_index: v.pipe(v.number(), v.integer(), v.minValue(0)),
	player_name: v.string(),
	nation: v.nullable(v.string()),
	is_human: v.boolean(),
	online_id: v.nullable(v.string()),
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
	}),
	v.check(
		(o) =>
			o.is_public !== undefined ||
			o.collection_id !== undefined ||
			o.display_name !== undefined,
		"At least one of is_public, collection_id, display_name required",
	),
);

export type GamePatch = v.InferOutput<typeof GamePatchSchema>;
