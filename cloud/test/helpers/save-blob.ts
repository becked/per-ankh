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

export interface UploadFixtureOpts {
	// player_index of the winning human (must be 0 or 1 — fixture
	// always builds exactly two humans at indexes 0 and 1).
	readonly winnerIndex: 0 | 1;
	// Salt mixed into the ZIP placeholder so two fixtures produce
	// distinct file_hash values; defaults to a fresh nanoid.
	readonly nonce?: string;
	// Defaults to "0" (player_index of the first human). Pass null
	// to send the observer-mode sentinel. Pass a number to override.
	readonly uploaderIndex?: number | null;
}

export async function buildUploadFormData(
	opts: UploadFixtureOpts,
): Promise<FormData> {
	const nonce = opts.nonce ?? nanoid(16);

	const blob = buildMinimalGameBlob(opts.winnerIndex);
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

function buildMinimalGameBlob(winnerIndex: 0 | 1): Record<string, unknown> {
	return {
		version: 2,
		parser_version: PARSER_VERSION,
		created_at: new Date().toISOString(),
		match_metadata: {
			xml_game_id: nanoid(12),
			total_turns: 100,
			game_name: "Test Match",
			save_date: "2026-01-01",
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
			game_over: true,
			winner: {
				winner_player_xml_id: winnerIndex,
				winner_team_id: null,
				victory_type: "VICTORY_AMBITION",
			},
		},
		game_details: {
			match_id: 1,
			game_name: "Test Match",
			save_date: "2026-01-01",
			total_turns: 100,
			map_size: "MAPSIZE_DUEL",
			map_class: "MAPCLASS_OPEN",
			game_mode: "GAMEMODE_NORMAL",
			difficulty: "LEVEL_THE_GREAT",
			opponent_level: "LEVEL_THE_GREAT",
			winner_player_id: winnerIndex,
			winner_name: "Player " + winnerIndex,
			winner_civilization: "NATION_EGYPT",
			winner_victory_type: "VICTORY_AMBITION",
			players: [
				{
					player_name: "Player 0",
					nation: "NATION_EGYPT",
					is_human: true,
					legitimacy: 50,
					state_religion: null,
				},
				{
					player_name: "Player 1",
					nation: "NATION_ROME",
					is_human: true,
					legitimacy: 50,
					state_religion: null,
				},
			],
		},
		player_history: [],
		yield_history: [],
		event_logs: [],
		law_adoption_history: [],
		current_laws: [],
		tech_discovery_history: [],
		completed_techs: [],
		units_produced: [],
		city_statistics: { cities: [] },
		improvement_data: {},
		map_tiles: [],
		game_religions: [],
		player_wonders: [],
		tile_ownership_history: [],
		player_nations: [],
		// Read by derivePlayerSummary (cloud/src/derive-player-summary.ts).
		// FullGameDataSchema accepts these as looseObject pass-through, but
		// summary derivation iterates them unconditionally — empty arrays
		// keep the derivation happy without seeding meaningful per-player
		// data (which isn't relevant to tournament-link tests).
		families: [],
		characters: [],
		character_traits: [],
		player_roster: [
			{
				player_index: 0,
				player_name: "Player 0",
				nation: "NATION_EGYPT",
				is_human: true,
				online_id: "steam:000000000000001",
			},
			{
				player_index: 1,
				player_name: "Player 1",
				nation: "NATION_ROME",
				is_human: true,
				online_id: "steam:000000000000002",
			},
		],
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
