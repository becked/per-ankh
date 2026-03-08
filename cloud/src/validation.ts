// Schema validation for shared game data payloads.
//
// Validates the decompressed JSON before storing in R2.
// Bounds are calibrated from real Old World game data (200-turn games,
// 4-8 players, various map sizes).

export interface ValidationResult {
	valid: boolean;
	error?: string;
}

// Known schema versions that this Worker accepts.
// When the desktop app adds a new version, deploy a Worker update
// that adds the new version here BEFORE releasing the app update.
const KNOWN_VERSIONS = new Set([1]);

// Array length upper bounds — generous enough for extreme games,
// tight enough to reject abuse.
const MAX_PLAYERS = 20;
const MAX_YIELD_ENTRIES = 300; // 20 players × 15 yield types
const MAX_EVENT_LOGS = 50_000;
const MAX_MAP_TILES = 50_000;
const MAX_HISTORY_ENTRIES = 20; // per-player arrays
const MAX_TECHS = 5_000;
const MAX_UNITS = 5_000;
const MAX_CITIES = 200;
const MAX_IMPROVEMENTS = 50_000;
const MAX_LAWS = 1_000;
const MAX_TOTAL_TURNS = 1_500;

const REQUIRED_TOP_LEVEL_FIELDS = [
	"version",
	"created_at",
	"app_version",
	"game_details",
	"player_history",
	"yield_history",
	"event_logs",
	"law_adoption_history",
	"current_laws",
	"tech_discovery_history",
	"completed_techs",
	"units_produced",
	"city_statistics",
	"improvement_data",
	"map_tiles",
	"game_religions",
	"player_wonders",
] as const;

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateSharePayload(data: unknown): ValidationResult {
	// 1. Top-level must be an object
	if (!isObject(data)) {
		return { valid: false, error: "Payload must be a JSON object" };
	}

	// 2. All required fields present
	for (const field of REQUIRED_TOP_LEVEL_FIELDS) {
		if (!(field in data)) {
			return { valid: false, error: `Missing required field: ${field}` };
		}
	}

	// 3. Version check — accept known versions only
	if (typeof data.version !== "number" || !KNOWN_VERSIONS.has(data.version)) {
		return {
			valid: false,
			error: `Unsupported version: ${data.version}. Known versions: ${[...KNOWN_VERSIONS].join(", ")}`,
		};
	}

	// 4. Basic type checks on metadata fields
	if (typeof data.created_at !== "string" || data.created_at.length === 0) {
		return { valid: false, error: "created_at must be a non-empty string" };
	}
	if (typeof data.app_version !== "string" || data.app_version.length === 0) {
		return { valid: false, error: "app_version must be a non-empty string" };
	}

	// 5. game_details validation
	if (!isObject(data.game_details)) {
		return { valid: false, error: "game_details must be an object" };
	}
	const gd = data.game_details;
	if (typeof gd.match_id !== "number" || gd.match_id <= 0) {
		return {
			valid: false,
			error: "game_details.match_id must be a positive number",
		};
	}
	if (
		typeof gd.total_turns !== "number" ||
		gd.total_turns < 0 ||
		gd.total_turns > MAX_TOTAL_TURNS
	) {
		return {
			valid: false,
			error: `game_details.total_turns must be 0-${MAX_TOTAL_TURNS}`,
		};
	}

	// 6. Array field validation — check type and length bounds
	const arrayChecks: Array<{
		field: string;
		maxLength: number;
	}> = [
		{ field: "player_history", maxLength: MAX_PLAYERS },
		{ field: "yield_history", maxLength: MAX_YIELD_ENTRIES },
		{ field: "event_logs", maxLength: MAX_EVENT_LOGS },
		{ field: "law_adoption_history", maxLength: MAX_HISTORY_ENTRIES },
		{ field: "current_laws", maxLength: MAX_LAWS },
		{ field: "tech_discovery_history", maxLength: MAX_HISTORY_ENTRIES },
		{ field: "completed_techs", maxLength: MAX_TECHS },
		{ field: "units_produced", maxLength: MAX_UNITS },
		{ field: "map_tiles", maxLength: MAX_MAP_TILES },
		{ field: "game_religions", maxLength: MAX_PLAYERS },
		{ field: "player_wonders", maxLength: MAX_CITIES },
	];

	for (const { field, maxLength } of arrayChecks) {
		const value = data[field];
		if (!Array.isArray(value)) {
			return { valid: false, error: `${field} must be an array` };
		}
		if (value.length > maxLength) {
			return {
				valid: false,
				error: `${field} exceeds maximum length (${value.length} > ${maxLength})`,
			};
		}
	}

	// 7. city_statistics validation (object with cities array)
	if (!isObject(data.city_statistics)) {
		return { valid: false, error: "city_statistics must be an object" };
	}
	const cs = data.city_statistics as Record<string, unknown>;
	if (!Array.isArray(cs.cities)) {
		return { valid: false, error: "city_statistics.cities must be an array" };
	}
	if (cs.cities.length > MAX_CITIES) {
		return {
			valid: false,
			error: `city_statistics.cities exceeds maximum length (${cs.cities.length} > ${MAX_CITIES})`,
		};
	}

	// 8. improvement_data validation (object with improvements array)
	if (!isObject(data.improvement_data)) {
		return { valid: false, error: "improvement_data must be an object" };
	}
	const id = data.improvement_data as Record<string, unknown>;
	if (!Array.isArray(id.improvements)) {
		return {
			valid: false,
			error: "improvement_data.improvements must be an array",
		};
	}
	if (id.improvements.length > MAX_IMPROVEMENTS) {
		return {
			valid: false,
			error: `improvement_data.improvements exceeds maximum length (${id.improvements.length} > ${MAX_IMPROVEMENTS})`,
		};
	}

	return { valid: true };
}

// Extract metadata from a validated payload for the D1 shares index
export function extractMetadata(data: Record<string, unknown>): {
	game_name: string | null;
	total_turns: number | null;
	player_nation: string | null;
	map_size: string | null;
} {
	const gd = data.game_details as Record<string, unknown>;

	// Find human player's nation from the players array
	let playerNation: string | null = null;
	if (Array.isArray(gd.players)) {
		const humanPlayer = gd.players.find(
			(p: unknown) => isObject(p) && p.is_human === true,
		);
		if (isObject(humanPlayer) && typeof humanPlayer.nation === "string") {
			playerNation = humanPlayer.nation;
		}
	}

	return {
		game_name:
			typeof gd.game_name === "string" ? gd.game_name : null,
		total_turns:
			typeof gd.total_turns === "number" ? gd.total_turns : null,
		player_nation: playerNation,
		map_size:
			typeof gd.map_size === "string" ? gd.map_size : null,
	};
}
