// Valibot schemas for the cloud-rewrite /v1/games endpoints.
//
// Validation philosophy mirrors the legacy `cloud/src/validation.ts`:
// validate the top-level envelope shape, the array bounds, and any field
// the upload pipeline reads server-side. Don't redefine every nested entity
// — the parser is the source of truth, and we trust its output. The bounds
// here just cap pathological inputs (zip bombs after decompression, abuse
// payloads).
//
// Bounds match `cloud/src/validation.ts:19-29` for parity with the legacy
// share validator.

import * as v from "valibot";

// ----- Bounds (match legacy validation.ts) -----

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
export const KNOWN_PARSER_VERSIONS = new Set([
	"2.0.0",
	"2.1.0",
	"2.2.0",
	"2.3.0",
	"2.3.1",
]);

// ----- Reusable atoms -----

const PlayerRosterEntrySchema = v.object({
	player_index: v.pipe(v.number(), v.integer(), v.minValue(0)),
	player_name: v.string(),
	nation: v.nullable(v.string()),
	is_human: v.boolean(),
	online_id: v.nullable(v.string()),
});

const PlayerInfoSchema = v.object({
	player_name: v.string(),
	nation: v.nullable(v.string()),
	is_human: v.boolean(),
	legitimacy: v.nullable(v.number()),
	state_religion: v.nullable(v.string()),
});

const GameDetailsSchema = v.object({
	match_id: v.number(),
	game_name: v.nullable(v.string()),
	save_date: v.nullable(v.string()),
	total_turns: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(MAX_TOTAL_TURNS)),
	map_size: v.nullable(v.string()),
	map_class: v.nullable(v.string()),
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
	game_mode: v.nullable(v.string()),
	difficulty: v.nullable(v.string()),
	opponent_level: v.nullable(v.string()),
	victory_conditions: v.nullable(v.string()),
	enabled_mods: v.nullable(v.string()),
	enabled_dlc: v.nullable(v.string()),
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
		v.check(
			(s) => KNOWN_PARSER_VERSIONS.has(s),
			"Unknown parser_version",
		),
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

export type UploaderPlayerIndex = v.InferOutput<typeof UploaderPlayerIndexSchema>;

// ----- PATCH /v1/games/:id body -----

export const GamePatchSchema = v.object({
	is_public: v.boolean(),
});

export type GamePatch = v.InferOutput<typeof GamePatchSchema>;
