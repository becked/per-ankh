// Minimum-valid upload fixture for /v1/games tests.
//
// `buildUploadFormData` constructs a FormData body that passes
// `FullGameDataSchema` (cloud/src/schemas/game.ts) plus the gates
// `handleGameUpload` enforces (game_over=true, two-human roster,
// non-empty parts). Tournament tests need exactly two humans and a
// recorded winner so the tournament-link block can derive a slot
// winner from the save.
//
// The "ZIP" part is unparsed by the worker — only its bytes are
// hashed for dedup. To avoid collisions across tests, every fixture
// gets a unique `nonce` mixed into the placeholder ZIP bytes.

import { nanoid } from "nanoid";

const PARSER_VERSION = "2.4.0";

// Nation per roster index. Every seat gets a distinct nation so that anything
// keyed on nation rather than player index — derivePlayerSummary's
// `cities_total`, the per-nation stats rows — attributes to the seat that owns
// it. The first three are load-bearing: tests that predate the wider roster
// assume player 0 is Egypt, player 1 Rome, and the `aiPlayer` seat Greece.
// A roster larger than this list is a fixture-authoring error.
const NATIONS = [
	"NATION_EGYPT",
	"NATION_ROME",
	"NATION_GREECE",
	"NATION_PERSIA",
	"NATION_ASSYRIA",
	"NATION_BABYLONIA",
	"NATION_CARTHAGE",
	"NATION_KUSH",
	"NATION_AKSUM",
	"NATION_HITTITE",
	"NATION_MAURYA",
	"NATION_TAMIL",
	"NATION_YUEZHI",
] as const;

// The yield series a share blob carries, mirroring SHARE_YIELD_TYPES in
// src/lib/parser/derive/yield-history.ts. Cloud keeps its own copies of
// frontend-derived data rather than importing across the package boundary.
// Order is load-bearing: a series' position offsets its values, so no two of
// the sixteen curves in a bundle carry the same numbers and a chart wired to
// the wrong column fails loudly.
const YIELD_TYPES = [
	"YIELD_SCIENCE",
	"YIELD_CIVICS",
	"YIELD_TRAINING",
	"YIELD_GROWTH",
	"YIELD_CULTURE",
	"YIELD_HAPPINESS",
	"YIELD_ORDERS",
	"YIELD_FOOD",
	"YIELD_MONEY",
	"YIELD_DISCONTENT",
	"YIELD_IRON",
	"YIELD_STONE",
	"YIELD_WOOD",
	"YIELD_MAINTENANCE",
] as const;

// The two stock series (military_power, legitimacy) come from player_history
// rather than yield_history. These keep their values clear of the yields' range
// and of each other, for the same reason the yield offsets exist.
const MILITARY_POWER_OFFSET = 100;
const LEGITIMACY_OFFSET = 200;

// Character xml_ids for seeded rulers, one per player index. Clear of the
// city_id range so a mis-keyed lookup can't land on a real row.
const RULER_XML_ID_BASE = 1000;

// games.save_date when a fixture doesn't ask for one.
const DEFAULT_SAVE_DATE = "2026-01-01";

export interface UploadFixtureOpts {
	// player_index of the winning human. Restricted to the first two seats,
	// which is every seat in the default two-human shape; a wider or narrower
	// roster is `humans` below. Pass null for a save that records completion
	// with no winner — very old saves do, and handleGameUpload gates only on
	// game_over. Every player_summaries.is_winner is then 0, which is what the
	// aggregator reads as an undecided game.
	readonly winnerIndex: 0 | 1 | null;
	// Salt mixed into the ZIP placeholder so two fixtures produce
	// distinct file_hash values; defaults to a fresh nanoid.
	readonly nonce?: string;
	// Defaults to "0" (player_index of the first human). Pass null
	// to send the observer-mode sentinel. Pass a number to override.
	readonly uploaderIndex?: number | null;
	// Override the blob's parser_version. Defaults to PARSER_VERSION
	// below. Must be in KNOWN_PARSER_VERSIONS (cloud/src/schemas/game.ts)
	// — bump those when adding a new value. Used by reimport tests that
	// need to produce a newer version than an earlier upload.
	readonly parserVersion?: string;
	// Number of humans in the roster, seated at indexes 0..humans-1. Defaults
	// to 2 (the standard tournament-match shape). Pass 1 to build a single-human
	// save — used by the bye-upload test, which checks the worker rejects a
	// one-human save against a bye match with WRONG_HUMAN_COUNT; with humans=1
	// the only valid winnerIndex is 0. Larger values model a multiplayer save,
	// where the per-seat derived rows multiply (see the family-stats param-cap
	// test). Capped at NATIONS.length.
	readonly humans?: number;
	// Wonder-stats inputs (see cloud/test/integration/games/wonder-stats.test.ts).
	// `wonders` seeds player_wonders — a null nation marks a build whose builder
	// the parser couldn't resolve. `disabledImprovements` seeds the game-level
	// list parser 2.12.0 captures; omit it to model an older blob, which carries
	// no wonder pool at all.
	readonly wonders?: ReadonlyArray<{
		player_id: number;
		wonder: string;
		completed_turn: number;
		nation?: string | null;
	}>;
	// Cities seeded into city_statistics — one seed feeding both the culture
	// levels that gate wonder eligibility (wonder-stats tests) and the family
	// city footprint (family-stats tests). Defaults mark the city as founded by
	// its owner on turn 5; pass `capturedFrom` to model a city taken from
	// another player (which keeps its original founding turn).
	readonly cities?: ReadonlyArray<{
		owner: number;
		cultureLevel?: string;
		familyClass?: string | null;
		foundedTurn?: number;
		isCapital?: boolean;
		capturedFrom?: number;
	}>;
	readonly disabledImprovements?: readonly string[];
	// Per-turn series → game_player_turn rows, via yield_history +
	// player_history. Omitted, a fixture produces no turn rows at all: the
	// bundle's yieldCurves comes back empty and nationAvgPoints has no
	// final_points to read.
	readonly turns?: ReadonlyArray<{
		readonly player: number;
		// One value per turn, from turn 1. Each yield's rate is the value plus
		// that yield's index in YIELD_TYPES and its cumulative the running sum;
		// points takes the value as-is, military_power and legitimacy take it
		// offset clear of the yields.
		readonly values: readonly number[];
	}>;
	// Law adoptions → law_events, behind both lawTiming and openingLaws.
	// Succession laws are accepted and worth passing: the aggregator drops them
	// from both charts, which is only observable if a fixture supplies one.
	readonly laws?: ReadonlyArray<{
		readonly player: number;
		readonly law: string;
		readonly turn: number;
	}>;
	// Completed techs → tech_events (techFirst, techTiming). A turn-1 tech is
	// the nation's starting grant rather than a research choice and the
	// aggregator excludes it, so a fixture that wants a first-tech row
	// researches past turn 1.
	readonly techs?: ReadonlyArray<{
		readonly player: number;
		readonly tech: string;
		readonly turn: number;
	}>;
	// The player's starting ruler → player_summaries.starting_ruler_archetype
	// and .starting_ruler_traits. An archetype is itself a trait — the game
	// records it as a self-named TRAIT_*_ARCHETYPE — so it is stamped on the
	// character and repeated in its trait list the way a real save carries it,
	// and the leader charts split the two apart again.
	readonly rulers?: ReadonlyArray<{
		readonly player: number;
		readonly archetype: string;
		readonly traits?: readonly string[];
	}>;
	// games.save_date, which the calendar heatmap and favorite_day_of_week read.
	// Defaults to DEFAULT_SAVE_DATE, so a fixture wanting two weekdays asks.
	readonly saveDate?: string;
	// Append a non-human player after the humans (index 2 in the default
	// two-human shape). The wonder stats count only human builders, so an AI
	// build has to be visible to the eligibility gate — a wonder it finished is
	// off the board for the humans in that game.
	readonly aiPlayer?: boolean;
	// The save's identity and progress, for challenge-map tests: a map is a
	// turn-1 save that isn't over, and a run of it carries the map's
	// xml_game_id at a later turn. Defaults model a finished 100-turn match
	// with a fresh GameId per fixture.
	readonly match?: {
		readonly xmlGameId?: string;
		readonly totalTurns?: number;
		readonly gameOver?: boolean;
	};
}

export async function buildUploadFormData(
	opts: UploadFixtureOpts,
): Promise<FormData> {
	const nonce = opts.nonce ?? nanoid(16);

	const blob = buildMinimalGameBlob(
		opts.winnerIndex,
		opts.parserVersion,
		opts.humans ?? 2,
		opts,
	);
	const jsonBytes = new TextEncoder().encode(JSON.stringify(blob));
	const gzippedJson = await gzip(jsonBytes);

	// The ZIP is just a unique-bytes placeholder; the worker hashes
	// it but never parses it. Padding to a few hundred bytes keeps
	// the size check (zero-byte parts are rejected) trivially
	// satisfied even if the nonce shortens.
	const zipBytes = new TextEncoder().encode(
		`per-ankh-test-zip:${nonce}:${"x".repeat(256)}`,
	);

	const form = new FormData();
	form.set(
		"data",
		new Blob([gzippedJson], { type: "application/octet-stream" }),
		"data.json.gz",
	);
	form.set(
		"save",
		new Blob([zipBytes], { type: "application/zip" }),
		"save.zip",
	);
	const uploaderIndex =
		opts.uploaderIndex === undefined ? 0 : opts.uploaderIndex;
	form.set("uploader_player_index", JSON.stringify(uploaderIndex));
	return form;
}

function buildMinimalGameBlob(
	winnerIndex: 0 | 1 | null,
	parserVersion: string | undefined,
	humans: number,
	opts: UploadFixtureOpts,
): Record<string, unknown> {
	// One seat per human at indexes 0..humans-1, then the optional AI seat
	// immediately after them. A single-human save (a bye) has just Player 0.
	const seats = Array.from({ length: humans }, (_, i) => ({
		index: i,
		isHuman: true,
	})).concat(opts.aiPlayer ? [{ index: humans, isHuman: false }] : []);
	const players = seats.map((s) => ({
		player_name: `Player ${s.index}`,
		nation: NATIONS[s.index],
		is_human: s.isHuman,
		legitimacy: 50,
		state_religion: null,
	}));
	const playerRoster = seats.map((s) => ({
		player_index: s.index,
		player_name: `Player ${s.index}`,
		nation: NATIONS[s.index],
		is_human: s.isHuman,
		// Only humans carry an OnlineID; the worker links the uploader's.
		online_id: s.isHuman
			? `steam:${String(s.index + 1).padStart(15, "0")}`
			: null,
	}));
	// yield_history / player_history — the indexer pivots these back into one
	// game_player_turn row per (player, turn).
	const turnSeries = opts.turns ?? [];
	const yieldHistory = turnSeries.flatMap((t) =>
		YIELD_TYPES.map((yieldType, seriesIdx) => {
			let running = 0;
			return {
				player_id: t.player,
				yield_type: yieldType,
				data: t.values.map((v, turnIdx) => {
					const rate = v + seriesIdx;
					running += rate;
					return { turn: turnIdx + 1, rate, cumulative: running };
				}),
			};
		}),
	);
	const playerHistory = turnSeries.map((t) => ({
		player_id: t.player,
		history: t.values.map((v, turnIdx) => ({
			turn: turnIdx + 1,
			points: v,
			military_power: v + MILITARY_POWER_OFFSET,
			legitimacy: v + LEGITIMACY_OFFSET,
		})),
	}));

	// law_adoption_history is grouped per player, and its synthetic start/end
	// points carry a null law_name — only named adoptions become law_events.
	const laws = opts.laws ?? [];
	const lawAdoptionHistory = [...new Set(laws.map((l) => l.player))].map(
		(player) => ({
			player_id: player,
			data: laws
				.filter((l) => l.player === player)
				.map((l) => ({ turn: l.turn, law_count: 1, law_name: l.law })),
		}),
	);

	// One royal per seeded ruler, on the throne from turn 0. derivePlayerSummary
	// takes the earliest became_leader_turn as the starting ruler, then the
	// traits stamped on it by turn 1.
	const rulers = opts.rulers ?? [];

	const saveDate = opts.saveDate ?? DEFAULT_SAVE_DATE;
	const xmlGameId = opts.match?.xmlGameId ?? nanoid(12);
	const totalTurns = opts.match?.totalTurns ?? 100;
	const gameOver = opts.match?.gameOver ?? true;

	return {
		version: 2,
		parser_version: parserVersion ?? PARSER_VERSION,
		created_at: new Date().toISOString(),
		match_metadata: {
			xml_game_id: xmlGameId,
			total_turns: totalTurns,
			game_name: "Test Match",
			save_date: saveDate,
			game_version: "1.0.0",
			map_width: 80,
			map_height: 52,
			map_size: "MAPSIZE_DUEL",
			map_class: "MAPCLASS_OPEN",
			game_mode: "GAMEMODE_NORMAL",
			difficulty: "LEVEL_THE_GREAT",
			opponent_level: "LEVEL_THE_GREAT",
			victory_conditions: null,
			enabled_mods: null,
			enabled_dlc: null,
			game_over: gameOver,
			winner:
				winnerIndex === null
					? null
					: {
							winner_player_xml_id: winnerIndex,
							winner_team_id: null,
							victory_type: "VICTORY_AMBITION",
						},
		},
		game_details: {
			match_id: 1,
			game_name: "Test Match",
			save_date: saveDate,
			total_turns: totalTurns,
			map_size: "MAPSIZE_DUEL",
			map_class: "MAPCLASS_OPEN",
			game_mode: "GAMEMODE_NORMAL",
			difficulty: "LEVEL_THE_GREAT",
			opponent_level: "LEVEL_THE_GREAT",
			winner_player_id: winnerIndex,
			winner_name: winnerIndex === null ? null : "Player " + winnerIndex,
			winner_civilization: winnerIndex === null ? null : NATIONS[winnerIndex],
			winner_victory_type: winnerIndex === null ? null : "VICTORY_AMBITION",
			// Only a 2.12.0+ blob carries this; omitting it models an older save,
			// which leaves the game out of the wonder-eligibility denominator.
			...(opts.disabledImprovements
				? { disabled_improvements: [...opts.disabledImprovements] }
				: {}),
			players,
		},
		player_history: playerHistory,
		yield_history: yieldHistory,
		event_logs: [],
		law_adoption_history: lawAdoptionHistory,
		current_laws: [],
		tech_discovery_history: [],
		completed_techs: (opts.techs ?? []).map((t) => ({
			player_id: t.player,
			player_name: `Player ${t.player}`,
			nation: NATIONS[t.player],
			tech: t.tech,
			completed_turn: t.turn,
		})),
		units_produced: [],
		city_statistics: {
			cities: (opts.cities ?? []).map((c, i) => ({
				city_id: i + 1,
				city_name: `CITYNAME_TEST_${i}`,
				// The current owner's nation, not a fixed one — a real save can't
				// have a city flying a nation nobody at that index plays.
				owner_nation: NATIONS[c.owner],
				owner_player_xml_id: c.owner,
				first_owner_player_xml_id: c.capturedFrom ?? c.owner,
				founded_turn: c.foundedTurn ?? 5,
				culture_level: c.cultureLevel ?? null,
				is_capital: c.isCapital ?? false,
				family_class: c.familyClass ?? null,
			})),
		},
		improvement_data: {},
		map_tiles: [],
		game_religions: [],
		player_wonders: (opts.wonders ?? []).map((w) => ({
			player_id: w.player_id,
			player_name: `Player ${w.player_id}`,
			// The parser leaves nation null when it can't resolve the builder.
			nation: w.nation === undefined ? "NATION_EGYPT" : w.nation,
			wonder: w.wonder,
			completed_turn: w.completed_turn,
		})),
		tile_ownership_history: [],
		player_nations: [],
		// Read by derivePlayerSummary (cloud/src/derive-player-summary.ts).
		// FullGameDataSchema accepts these as looseObject pass-through, but
		// summary derivation iterates them unconditionally — empty arrays
		// keep the derivation happy without seeding meaningful per-player
		// data (which isn't relevant to tournament-link tests).
		// The player's families, mirrored from the seeded cities: a class the
		// player holds a city of is a class they run. player_summaries
		// .family_classes (and so familyByNation) is derived from this list, not
		// from the cities themselves. A captured city doesn't add a family.
		families: [
			...new Map(
				(opts.cities ?? [])
					.filter((c) => c.familyClass && c.capturedFrom === undefined)
					.map((c) => [
						`${c.owner}|${c.familyClass}`,
						{
							family_name: `FAMILY_TEST_${c.familyClass}`,
							family_class: c.familyClass,
							player_xml_id: c.owner,
						},
					]),
			).values(),
		],
		characters: rulers.map((r) => ({
			xml_id: RULER_XML_ID_BASE + r.player,
			player_xml_id: r.player,
			is_royal: true,
			became_leader_turn: 0,
			death_turn: null,
			archetype: r.archetype,
		})),
		character_traits: rulers.flatMap((r) =>
			[r.archetype, ...(r.traits ?? [])].map((trait) => ({
				character_xml_id: RULER_XML_ID_BASE + r.player,
				trait_name: trait,
				acquired_turn: 1,
			})),
		),
		player_roster: playerRoster,
	};
}

async function gzip(data: Uint8Array): Promise<Uint8Array> {
	const cs = new CompressionStream("gzip");
	const writer = cs.writable.getWriter();
	writer.write(data);
	writer.close();
	const reader = cs.readable.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		total += value.byteLength;
	}
	const out = new Uint8Array(total);
	let offset = 0;
	for (const c of chunks) {
		out.set(c, offset);
		offset += c.byteLength;
	}
	return out;
}
