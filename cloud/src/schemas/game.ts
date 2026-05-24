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
// 2.4.0 — winner detection for legacy <WinnerTeam>/<WinnerVictory> XML
//         format (older OW versions); adds `match_metadata.game_over`.
// 2.4.1 — game_details.difficulty sourced from root <Root @_Difficulty>
//         (was always null because the save-owner detection pass that
//         the previous per-player source depended on doesn't exist).
// 2.5.0 — game_details.difficulty + per-player PlayerInfo.difficulty
//         sourced from <Difficulty>/<PlayerDifficulty> positional array;
//         isSaveOwner correctly set from <?ActivePlayer?> PI (with
//         single-human-roster fallback).
export const KNOWN_PARSER_VERSIONS = new Set([
	"2.0.0",
	"2.1.0",
	"2.2.0",
	"2.3.0",
	"2.3.1",
	"2.4.0",
	"2.4.1",
	"2.5.0",
]);

// The latest accepted version. Echoed back on stats responses and
// embedded in stats cache keys so a parser bump (after the matching
// extraction code lands) naturally orphans every old entry. Bump in
// lockstep with the `KNOWN_PARSER_VERSIONS` addition above.
export const CURRENT_PARSER_VERSION = "2.5.0";

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
	// Added in PARSER_VERSION 2.5.0. `v.optional` (rather than required)
	// tolerates the deploy gap where the Worker is updated but the frontend
	// still emits ≤2.4.1 blobs, and keeps older R2 blobs passing if they're
	// ever re-validated.
	difficulty: v.optional(v.nullable(v.string())),
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
