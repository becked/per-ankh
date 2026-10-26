import { describe, expect, it } from "vitest";
import {
	buildSummaryGameContext,
	derivePlayerSummary,
} from "./derive-player-summary";
import type { FullGameData, PlayerRosterEntry } from "./schemas/game";

// A minimal blob carrying only what the derivations under test read. The real
// FullGameData is far wider (the Valibot schema treats most entries as
// unknown), so the fixture is cast the same way the module narrows its input.
function blobWith(over: {
	characters?: Array<Record<string, unknown>>;
	character_traits?: Array<Record<string, unknown>>;
	city_statistics?: { cities: Array<Record<string, unknown>> };
	player_history?: Array<Record<string, unknown>>;
	map_tiles?: Array<Record<string, unknown>>;
	completed_techs?: Array<Record<string, unknown>>;
	match_metadata?: Record<string, unknown>;
}): FullGameData {
	return {
		parser_version: "2.29.0",
		// A game that can be won on points, which is what gates `final_points`.
		match_metadata: {
			total_turns: 60,
			victory_conditions: "VICTORY_POINTS+VICTORY_AMBITION",
		},
		player_history: [],
		city_statistics: { cities: [] },
		map_tiles: [],
		families: [],
		characters: [],
		character_traits: [],
		completed_techs: [],
		law_adoption_history: [],
		...over,
	} as unknown as FullGameData;
}

const PLAYER = {
	player_index: 0,
	nation: "NATION_ROME",
} as unknown as PlayerRosterEntry;

function derive(blob: FullGameData) {
	return derivePlayerSummary(blob, PLAYER, buildSummaryGameContext(blob));
}

// One leader for player 0, crowned on turn 1 (a starting leader is born
// pre-game — birth_turn is negative — and takes the throne on the first turn).
const LEADER = {
	xml_id: 7,
	player_xml_id: 0,
	is_royal: true,
	became_leader_turn: 1,
	death_turn: null,
	archetype: "TRAIT_SCHOLAR_ARCHETYPE",
};

describe("derivePlayerSummary — starting leader", () => {
	it("captures the traits the leader starts with, stamped on turn 1", () => {
		const blob = blobWith({
			characters: [LEADER],
			character_traits: [
				{
					character_xml_id: 7,
					trait_name: "TRAIT_SCHOLAR_ARCHETYPE",
					acquired_turn: 1,
				},
				{
					character_xml_id: 7,
					trait_name: "TRAIT_INTELLIGENT",
					acquired_turn: 1,
				},
			],
		});

		const summary = derive(blob);

		expect(summary.starting_ruler_archetype).toBe("TRAIT_SCHOLAR_ARCHETYPE");
		// Both the archetype trait and the personality trait land here; splitting
		// the two is the stats aggregator's job, not the derivation's.
		expect(JSON.parse(summary.starting_ruler_traits ?? "[]")).toEqual([
			"TRAIT_SCHOLAR_ARCHETYPE",
			"TRAIT_INTELLIGENT",
		]);
	});

	it("excludes traits acquired after the game began", () => {
		const blob = blobWith({
			characters: [LEADER],
			character_traits: [
				{
					character_xml_id: 7,
					trait_name: "TRAIT_INTELLIGENT",
					acquired_turn: 1,
				},
				// Won through an event mid-game — not part of the starting roll.
				{ character_xml_id: 7, trait_name: "TRAIT_WARLIKE", acquired_turn: 26 },
			],
		});

		expect(JSON.parse(derive(blob).starting_ruler_traits ?? "[]")).toEqual([
			"TRAIT_INTELLIGENT",
		]);
	});

	it("ignores other players' leaders", () => {
		const blob = blobWith({
			characters: [
				LEADER,
				{
					...LEADER,
					xml_id: 9,
					player_xml_id: 1,
					archetype: "TRAIT_ZEALOT_ARCHETYPE",
				},
			],
			character_traits: [
				{ character_xml_id: 9, trait_name: "TRAIT_ROMANTIC", acquired_turn: 1 },
			],
		});

		const summary = derive(blob);
		expect(summary.starting_ruler_archetype).toBe("TRAIT_SCHOLAR_ARCHETYPE");
		expect(summary.starting_ruler_traits).toBeNull();
	});

	it("takes the earliest crowned leader when a succession happened", () => {
		const blob = blobWith({
			characters: [
				{
					...LEADER,
					xml_id: 11,
					became_leader_turn: 34,
					archetype: "TRAIT_HERO_ARCHETYPE",
				},
				LEADER,
			],
			character_traits: [
				{ character_xml_id: 11, trait_name: "TRAIT_BOLD", acquired_turn: 34 },
			],
		});

		const summary = derive(blob);
		expect(summary.starting_ruler_archetype).toBe("TRAIT_SCHOLAR_ARCHETYPE");
		expect(summary.succession_count).toBe(2);
		// The successor's own trait, acquired on the turn they took the throne,
		// must not land in the starting leader's list.
		expect(summary.starting_ruler_traits).toBeNull();
	});
});

// A city at the given culture level, owned by player 0 unless stated. `held`
// defaults to the sole owner — pass it to describe a city that changed hands.
// `family` is the class running it; `capital()` wraps the capital case.
function city(
	culture: string | null,
	owner = 0,
	held = [owner],
	family: string | null = "FAMILYCLASS_TRADERS",
) {
	return {
		city_id: 1,
		owner_nation: "NATION_ROME",
		owner_player_xml_id: owner,
		first_owner_player_xml_id: held[0],
		player_families: held.map((player_xml_id) => ({ player_xml_id })),
		founded_turn: 3,
		culture_level: culture,
		is_capital: false,
		family_class: family,
	};
}

// The capital — the one city the capital-family derivation keys on. Culture is
// irrelevant to those assertions, so it rides at null.
function capital(owner = 0, family: string | null = "FAMILYCLASS_TRADERS") {
	return { ...city(null, owner, [owner], family), is_capital: true };
}

// best_culture_level is what makes a wonder's eligibility answerable: a wonder
// can only be built in a city that has reached its <CulturePrereq>.
describe("derivePlayerSummary — best culture level", () => {
	it("takes the highest level across the player's cities", () => {
		const summary = derive(
			blobWith({
				city_statistics: {
					cities: [
						city("CULTURE_WEAK"),
						city("CULTURE_STRONG"),
						city("CULTURE_DEVELOPING"),
					],
				},
			}),
		);
		expect(summary.best_culture_level).toBe("CULTURE_STRONG");
	});

	it("ignores cities owned by someone else", () => {
		const summary = derive(
			blobWith({
				city_statistics: {
					cities: [city("CULTURE_WEAK"), city("CULTURE_LEGENDARY", 1)],
				},
			}),
		);
		expect(summary.best_culture_level).toBe("CULTURE_WEAK");
	});

	it("is null when the player holds no cities with a known level", () => {
		expect(derive(blobWith({})).best_culture_level).toBeNull();
		expect(
			derive(blobWith({ city_statistics: { cities: [city(null)] } }))
				.best_culture_level,
		).toBeNull();
	});

	// A player conquered out of the game owns nothing at the end. Reading the
	// end-state owner would give them no culture level and so no eligibility
	// for any wonder, dropping them out of every build-rate denominator.
	it("counts a city the player held and then lost", () => {
		const summary = derive(
			blobWith({
				city_statistics: {
					cities: [city("CULTURE_LEGENDARY", 1, [0, 1])],
				},
			}),
		);
		expect(summary.best_culture_level).toBe("CULTURE_LEGENDARY");
	});

	it("still ignores a city the player never held", () => {
		const summary = derive(
			blobWith({
				city_statistics: {
					cities: [city("CULTURE_WEAK"), city("CULTURE_LEGENDARY", 1, [1, 2])],
				},
			}),
		);
		expect(summary.best_culture_level).toBe("CULTURE_WEAK");
	});

	// player_families arrived in parser 2.10.0; older blobs have only the
	// end-state owner to go on.
	it("falls back to the end-state owner when player_families is absent", () => {
		const legacy = { ...city("CULTURE_STRONG"), player_families: undefined };
		expect(
			derive(blobWith({ city_statistics: { cities: [legacy] } }))
				.best_culture_level,
		).toBe("CULTURE_STRONG");
	});
});

describe("derivePlayerSummary — capital family class", () => {
	it("reads the family class off the player's capital", () => {
		const summary = derive(
			blobWith({
				city_statistics: {
					cities: [
						city(null, 0, [0], "FAMILYCLASS_SAGES"),
						capital(0, "FAMILYCLASS_LANDOWNERS"),
					],
				},
			}),
		);
		expect(summary.capital_family_class).toBe("FAMILYCLASS_LANDOWNERS");
	});

	it("ignores another player's capital", () => {
		const summary = derive(
			blobWith({
				city_statistics: { cities: [capital(1, "FAMILYCLASS_CLERICS")] },
			}),
		);
		expect(summary.capital_family_class).toBeNull();
	});

	it("is null when the player has no capital, or it carries no family", () => {
		expect(derive(blobWith({})).capital_family_class).toBeNull();
		expect(
			derive(blobWith({ city_statistics: { cities: [capital(0, null)] } }))
				.capital_family_class,
		).toBeNull();
	});
});

// `final_points` is `Player.countVP` over the save's end state, not the last
// entry of `<PointsHistory>` — which the game samples at the top of each
// seat's own turn, so it misses everything that turn did (#340).
describe("derivePlayerSummary — final points", () => {
	// Two seats, each with a recorded point, so the game counts as one played
	// for points at all.
	const history = [
		{ player_id: 0, history: [{ turn: 60, points: 3 }] },
		{ player_id: 1, history: [{ turn: 60, points: 9 }] },
	];

	it("recomputes past the recorded value, and measures the margin against it", () => {
		const summary = derive(
			blobWith({
				player_history: history,
				city_statistics: {
					cities: [city("CULTURE_LEGENDARY"), city("CULTURE_STRONG")],
				},
			}),
		);
		// 4 + 3 against a series that stopped at 3, and a second seat the same
		// recomputation drops to 0 — so the leader's margin is the whole 7.
		expect(summary.final_points).toBe(7);
		expect(summary.vp_margin).toBe(7);
	});

	it("drops a conquered seat to what its techs still pay", () => {
		const summary = derive(
			blobWith({
				player_history: history,
				// Every city is player 1's; player 0 holds one VP tech.
				city_statistics: { cities: [city("CULTURE_STRONG", 1)] },
				completed_techs: [{ player_id: 0, tech: "TECH_MILITARY_PRESTIGE" }],
			}),
		);
		expect(summary.final_points).toBe(1);
	});

	it("keeps the recorded value on a blob too old to recompute from", () => {
		const blob = blobWith({
			player_history: history,
			city_statistics: {
				cities: [city("CULTURE_LEGENDARY"), city("CULTURE_STRONG")],
			},
		});
		const summary = derivePlayerSummary(
			{ ...blob, parser_version: "2.16.0" },
			PLAYER,
			buildSummaryGameContext({ ...blob, parser_version: "2.16.0" }),
		);
		expect(summary.final_points).toBe(3);
	});

	it("does not recompute for a game that cannot be won on points", () => {
		// Same fallback as a blob below the floor: the recorded series, which on
		// a real save of this shape is empty — 0 of the 116 saves in
		// test-data/saves record points with no points victory enabled — so the
		// stored value is NULL there rather than the 3 this fixture carries.
		const summary = derive(
			blobWith({
				player_history: history,
				city_statistics: { cities: [city("CULTURE_LEGENDARY")] },
				match_metadata: {
					total_turns: 60,
					victory_conditions: "VICTORY_AMBITION+VICTORY_CONQUEST",
				},
			}),
		);
		expect(summary.final_points).toBe(3);
	});

	it("answers a points game whose series recorded nothing", () => {
		// An empty `<PointsHistory>` is an old build or a game too short to
		// have written one, so the victory settings decide, not the series.
		const summary = derive(
			blobWith({
				player_history: [
					{ player_id: 0, history: [{ turn: 60, points: null }] },
					{ player_id: 1, history: [{ turn: 60, points: null }] },
				],
				city_statistics: { cities: [city("CULTURE_LEGENDARY")] },
			}),
		);
		expect(summary.final_points).toBe(4);
	});
});
