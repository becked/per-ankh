// The challenge scorer is a frontend module (src/lib/challenges/scoring.ts)
// with no test runner of its own; the Worker scores the authoritative verdict
// through its generated mirror (./scoring — mirror.test.ts pins it to the
// source), so the behavioural tests live here on the unit project.

import { describe, expect, it } from "vitest";
import {
	asScorable,
	checkIdentity,
	extractSetup,
	scoreChallenge,
	validateChallengeMap,
	type ScorableBlob,
} from "./scoring";
import {
	STANDARD_CRITERIA,
	type ChallengeRules,
	type Objective,
} from "./types";

// A minimal map: one human (Rome, seat 0), no AI, turn 1.
function mapBlob(overrides: Partial<ScorableBlob> = {}): ScorableBlob {
	return asScorable({
		match_metadata: {
			xml_game_id: "GAME-1",
			total_turns: 1,
			game_over: false,
			winner: null,
			map_size: "MAPSIZE_SMALL",
			map_class: "MAPCLASS_INLAND_SEA",
			map_aspect_ratio: null,
			map_width: 40,
			map_height: 30,
			difficulty: "DIFFICULTY_THE_GOOD",
			opponent_level: null,
			game_options: null,
			disabled_improvements: null,
			game_version: "1.0.77",
			enabled_dlc: null,
		},
		game_details: {
			players: [
				{
					player_id: 0,
					player_name: "Runner",
					nation: "NATION_ROME",
					is_human: true,
					state_religion: null,
					leader_character_xml_id: 100,
				},
			],
		},
		player_roster: [{ player_index: 0, is_human: true, nation: "NATION_ROME" }],
		characters: [
			{
				xml_id: 100,
				first_name: "Romulus",
				player_xml_id: 0,
				cognomen: null,
				became_leader_turn: 0,
			},
		],
		character_traits: [
			{
				character_xml_id: 100,
				trait_name: "TRAIT_COMMANDER_ARCHETYPE",
				acquired_turn: 0,
			},
		],
		...overrides,
	});
}

// The same map, played on to `turn`.
function runBlob(
	turn: number,
	overrides: Partial<ScorableBlob> = {},
): ScorableBlob {
	const base = mapBlob();
	return {
		...base,
		match_metadata: { ...base.match_metadata, total_turns: turn },
		...overrides,
	};
}

function rules(
	objectives: Objective[],
	extra: Partial<ChallengeRules> = {},
): ChallengeRules {
	return {
		setup: extractSetup(mapBlob()),
		objectives,
		criteria: [],
		...extra,
	};
}

describe("asScorable", () => {
	it("defaults missing sections to empty lists", () => {
		const b = asScorable({ match_metadata: { total_turns: 5 } });
		expect(b.completed_techs).toEqual([]);
		expect(b.city_statistics.cities).toEqual([]);
		expect(b.improvement_data.improvements).toEqual([]);
		expect(b.game_details.players).toEqual([]);
	});
});

describe("validateChallengeMap", () => {
	it("accepts a turn-1 single-human save", () => {
		expect(validateChallengeMap(mapBlob())).toEqual([]);
	});
	it("names every problem", () => {
		const bad = mapBlob({
			match_metadata: {
				...mapBlob().match_metadata,
				total_turns: 40,
				game_over: true,
			},
			player_roster: [
				{ player_index: 0, is_human: true, nation: "NATION_ROME" },
				{ player_index: 1, is_human: true, nation: "NATION_GREECE" },
				{ player_index: 2, is_human: false, nation: "NATION_EGYPT" },
				{ player_index: 3, is_human: false, nation: "NATION_BABYLONIA" },
			],
		});
		const problems = validateChallengeMap(bad);
		expect(problems).toHaveLength(4);
		expect(problems.join(" ")).toMatch(/turn 40/);
	});
});

describe("extractSetup", () => {
	it("records the seat, leader and starting traits", () => {
		const setup = extractSetup(mapBlob());
		expect(setup.player_index).toBe(0);
		expect(setup.nation).toBe("NATION_ROME");
		expect(setup.leader_name).toBe("Romulus");
		expect(setup.leader_traits).toEqual(["TRAIT_COMMANDER_ARCHETYPE"]);
		expect(setup.leader_is_custom).toBe(false);
		expect(setup.ai_count).toBe(0);
		expect(setup.wonders.length).toBeGreaterThan(10);
	});
	it("flags a custom leader from the game option", () => {
		const setup = extractSetup(
			mapBlob({
				match_metadata: {
					...mapBlob().match_metadata,
					game_options: { GAMEOPTION_CUSTOM_LEADER: true },
				},
			}),
		);
		expect(setup.leader_is_custom).toBe(true);
	});
});

// A pick-later map: custom leader on, no nation and no leader until the
// player builds one on turn 1 — the run is the only place the leader exists.
function pickLaterMap(): ScorableBlob {
	const base = mapBlob();
	return mapBlob({
		match_metadata: {
			...base.match_metadata,
			game_options: { GAMEOPTION_CUSTOM_LEADER: true },
		},
		game_details: {
			players: [
				{
					...base.game_details.players[0],
					nation: null,
					leader_character_xml_id: null,
				},
			],
		},
		player_roster: [{ player_index: 0, is_human: true, nation: null }],
		characters: [],
		character_traits: [],
	});
}

describe("leader criterion on a pick-later map", () => {
	const setup = extractSetup(pickLaterMap());
	const runWith = (traits: string[]) =>
		runBlob(30, {
			characters: [
				{
					xml_id: 7,
					first_name: "Bilistiche",
					player_xml_id: 0,
					cognomen: null,
					became_leader_turn: 1,
				},
			],
			character_traits: traits.map((trait_name) => ({
				character_xml_id: 7,
				trait_name,
				acquired_turn: 1,
			})),
		});
	it("reads the map's leader as absent", () => {
		expect(setup.leader_character_xml_id).toBeNull();
		expect(setup.leader_traits).toEqual([]);
		expect(setup.leader_is_custom).toBe(true);
	});
	it("judges the leader the run built on turn 1", () => {
		const criteria = [
			{
				kind: "leader" as const,
				standard_traits_only: true,
				required_traits: ["TRAIT_SCHOLAR_ARCHETYPE"],
			},
		];
		const ok = scoreChallenge(
			{ setup, objectives: [{ kind: "victory" }], criteria },
			runWith(["TRAIT_SCHOLAR_ARCHETYPE", "TRAIT_INTELLIGENT"]),
		);
		expect(ok.criteria[0].met).toBe(true);
		// TRAIT_AMBITIOUS is Suppiluliuma's dynasty trait.
		const dynasty = scoreChallenge(
			{ setup, objectives: [{ kind: "victory" }], criteria },
			runWith(["TRAIT_SCHOLAR_ARCHETYPE", "TRAIT_AMBITIOUS"]),
		);
		expect(dynasty.criteria[0].met).toBe(false);
		expect(dynasty.criteria[0].detail).toMatch(/TRAIT_AMBITIOUS/);
		const other = scoreChallenge(
			{ setup, objectives: [{ kind: "victory" }], criteria },
			runWith(["TRAIT_COMMANDER_ARCHETYPE"]),
		);
		expect(other.criteria[0].met).toBe(false);
		expect(other.criteria[0].detail).toMatch(/TRAIT_SCHOLAR_ARCHETYPE/);
	});
	it("names no unique unit when the map leaves the nation open", () => {
		expect(setup.nation).toBeNull();
		const run = runWith([]);
		run.units = [
			{
				unit_type: "UNIT_HOPLITE",
				player_xml_id: 0,
				original_player_xml_id: 0,
			},
		];
		expect(
			scoreChallenge(
				{
					setup,
					objectives: [{ kind: "army", count: 1, unique_only: true }],
					criteria: [],
				},
				run,
			).met,
		).toBe(false);
	});
});

describe("checkIdentity", () => {
	const setup = extractSetup(mapBlob());
	it("accepts a run of the map", () => {
		expect(checkIdentity(setup, runBlob(30)).ok).toBe(true);
	});
	it("refuses a different GameId", () => {
		const other = runBlob(30);
		other.match_metadata = { ...other.match_metadata, xml_game_id: "GAME-2" };
		expect(checkIdentity(setup, other).reason).toMatch(/GameId/);
	});
	it("refuses a different difficulty or map size", () => {
		const harder = runBlob(30);
		harder.match_metadata = {
			...harder.match_metadata,
			difficulty: "DIFFICULTY_THE_GREAT",
		};
		expect(checkIdentity(setup, harder).reason).toMatch(/difficulty/);
		const bigger = runBlob(30);
		bigger.match_metadata = {
			...bigger.match_metadata,
			map_size: "MAPSIZE_LARGE",
		};
		expect(checkIdentity(setup, bigger).reason).toMatch(/map size/);
	});
	it("refuses an added AI", () => {
		const other = runBlob(30, {
			player_roster: [
				{ player_index: 0, is_human: true, nation: "NATION_ROME" },
				{ player_index: 1, is_human: false, nation: "NATION_EGYPT" },
			],
		});
		expect(checkIdentity(setup, other).reason).toMatch(/AI/);
	});
});

describe("scoreChallenge", () => {
	it("scores a tech objective against its deadline", () => {
		const run = runBlob(30, {
			completed_techs: [
				{ player_id: 0, tech: "TECH_IRONWORKING", completed_turn: 22 },
			],
		});
		const ok = scoreChallenge(
			rules([{ kind: "tech", target: "TECH_IRONWORKING", by_turn: 25 }]),
			run,
		);
		expect(ok.met).toBe(true);
		expect(ok.score_turn).toBe(30);
		expect(ok.earliest_turn).toBe(22);
		const late = scoreChallenge(
			rules([{ kind: "tech", target: "TECH_IRONWORKING", by_turn: 20 }]),
			run,
		);
		expect(late.met).toBe(false);
		expect(late.objectives[0].observed).toMatch(/after the turn-20 deadline/);
	});

	it("matches tiered improvements at or above the target tier", () => {
		const run = runBlob(30, {
			improvement_data: {
				improvements: [
					{
						owner_player_xml_id: 0,
						city_xml_id: 1,
						improvement: "IMPROVEMENT_LIBRARY_3",
						specialist: null,
					},
					{
						owner_player_xml_id: 0,
						city_xml_id: 1,
						improvement: "IMPROVEMENT_LIBRARY_1",
						specialist: null,
						build_turns_left: 3,
					},
				],
			},
		});
		expect(
			scoreChallenge(
				rules([{ kind: "build", target: "IMPROVEMENT_LIBRARY_2" }]),
				run,
			).met,
		).toBe(true);
		expect(
			scoreChallenge(
				rules([{ kind: "build", target: "IMPROVEMENT_LIBRARY_1", count: 2 }]),
				run,
			).met,
		).toBe(false);
		expect(
			scoreChallenge(
				rules([
					{
						kind: "build",
						target: "IMPROVEMENT_LIBRARY_1",
						count: 2,
						state: "started",
					},
				]),
				run,
			).met,
		).toBe(true);
	});

	it("holds an undatable build to the save's turn", () => {
		const library = {
			improvement_data: {
				improvements: [
					{
						owner_player_xml_id: 0,
						city_xml_id: 1,
						improvement: "IMPROVEMENT_LIBRARY_1",
						specialist: null,
					},
				],
			},
		};
		const objective: Objective = {
			kind: "build",
			target: "IMPROVEMENT_LIBRARY_1",
			by_turn: 20,
		};
		expect(scoreChallenge(rules([objective]), runBlob(20, library)).met).toBe(
			true,
		);
		const late = scoreChallenge(rules([objective]), runBlob(30, library));
		expect(late.met).toBe(false);
		expect(late.objectives[0].observed).toMatch(/turn-20 deadline/);
	});

	it("counts any captured city unless the objective asks for capitals", () => {
		const city = (
			city_id: number,
			founded_turn: number,
			is_capital: boolean,
		) => ({
			city_id,
			owner_player_xml_id: 0,
			first_owner_player_xml_id: 1,
			founded_turn,
			is_capital,
			culture_level: "CULTURE_WEAK",
		});
		const run = runBlob(50, {
			city_statistics: {
				cities: [city(1, 1, true), city(2, 9, false), city(3, 12, false)],
			},
		});
		const any = scoreChallenge(rules([{ kind: "capture", count: 3 }]), run);
		expect(any.met).toBe(true);
		expect(any.objectives[0].observed).toMatch(/^3 of 3 cities captured/);
		const capitals = scoreChallenge(
			rules([{ kind: "capture", count: 2, capital: true }]),
			run,
		);
		expect(capitals.met).toBe(false);
		expect(capitals.objectives[0].observed).toBe("1 of 2 capitals captured");
	});

	it("never lets an unrecorded happiness satisfy a floor", () => {
		const run = runBlob(50, {
			city_statistics: {
				cities: [
					{
						city_id: 1,
						owner_player_xml_id: 0,
						first_owner_player_xml_id: 0,
						founded_turn: 1,
						is_capital: true,
						culture_level: "CULTURE_WEAK",
						happiness_level: null,
					},
				],
			},
		});
		expect(
			scoreChallenge(rules([{ kind: "city", min_happiness: 0 }]), run).met,
		).toBe(false);
		expect(scoreChallenge(rules([{ kind: "city" }]), run).met).toBe(true);
	});

	it("takes a wonder's turn from the activity log", () => {
		const run = runBlob(60, {
			improvement_data: {
				improvements: [
					{
						owner_player_xml_id: 0,
						city_xml_id: 1,
						improvement: "IMPROVEMENT_PYRAMIDS",
						specialist: null,
					},
				],
			},
			player_wonders: [
				{ player_id: 0, wonder: "IMPROVEMENT_PYRAMIDS", completed_turn: 41 },
			],
		});
		const v = scoreChallenge(
			rules([{ kind: "build", target: "ANY_WONDER", by_turn: 45 }]),
			run,
		);
		expect(v.met).toBe(true);
		expect(v.objectives[0].met_turn).toBe(41);
	});

	it("scores the metric peak within the deadline", () => {
		const run = runBlob(40, {
			yield_history: [
				{
					player_id: 0,
					yield_type: "YIELD_SCIENCE",
					data: [
						{ turn: 10, rate: 20, cumulative: 100 },
						{ turn: 20, rate: 55, cumulative: 500 },
						{ turn: 30, rate: 40, cumulative: 900 },
					],
				},
			],
		});
		const v = scoreChallenge(
			rules([
				{
					kind: "metric",
					metric: "YIELD_SCIENCE",
					measure: "rate",
					value: 50,
					by_turn: 25,
				},
			]),
			run,
		);
		expect(v.met).toBe(true);
		expect(v.objectives[0].met_turn).toBe(20);
		const miss = scoreChallenge(
			rules([
				{
					kind: "metric",
					metric: "YIELD_SCIENCE",
					measure: "rate",
					value: 50,
					by_turn: 15,
				},
			]),
			run,
		);
		expect(miss.met).toBe(false);
	});

	it("counts only the army objective's listed unit types", () => {
		const unit = (unit_type: string) => ({
			unit_type,
			player_xml_id: 0,
			original_player_xml_id: 0,
		});
		const run = runBlob(50, {
			units: [
				...Array.from({ length: 6 }, () => unit("UNIT_CATAPHRACT")),
				unit("UNIT_WARRIOR"),
				unit("UNIT_WARRIOR"),
			],
		});
		const v = scoreChallenge(
			rules([{ kind: "army", count: 6, types: ["UNIT_CATAPHRACT"] }]),
			run,
		);
		expect(v.met).toBe(true);
		expect(v.objectives[0].observed).toBe("6 of 6 units");
		const more = scoreChallenge(
			rules([{ kind: "army", count: 7, types: ["UNIT_CATAPHRACT"] }]),
			run,
		);
		expect(more.met).toBe(false);
		expect(more.objectives[0].observed).toBe("6 of 7 units");
		// Without the filter every living unit counts.
		expect(scoreChallenge(rules([{ kind: "army", count: 8 }]), run).met).toBe(
			true,
		);
	});

	it("applies the standard criteria", () => {
		const run = runBlob(40, {
			city_statistics: {
				cities: [
					{
						city_id: 1,
						owner_player_xml_id: 0,
						first_owner_player_xml_id: 0,
						founded_turn: 1,
						is_capital: true,
						culture_level: "CULTURE_WEAK",
						damage: 3,
					},
					{
						city_id: 2,
						owner_player_xml_id: 0,
						first_owner_player_xml_id: 1,
						founded_turn: 5,
						is_capital: false,
						culture_level: "CULTURE_WEAK",
					},
				],
			},
			families: [
				{ player_xml_id: 0, family_name: "FAMILY_JULII", seat_city_xml_id: 1 },
			],
			family_opinion_history: [
				{
					player_xml_id: 0,
					family_name: "FAMILY_JULII",
					turn: 40,
					opinion: -120,
				},
			],
		});
		const v = scoreChallenge(
			rules([{ kind: "city", count: 1 }], { criteria: [...STANDARD_CRITERIA] }),
			run,
		);
		expect(v.met).toBe(false);
		const failed = v.criteria.filter((c) => !c.met).map((c) => c.kind);
		expect(failed).toEqual(["families", "cities"]);
		expect(v.criteria[1].detail).toBe("1 of 1 cities damaged");
	});

	it("refuses a run whose identity fails, whatever the objectives say", () => {
		const run = runBlob(30);
		run.match_metadata = { ...run.match_metadata, xml_game_id: "GAME-2" };
		const v = scoreChallenge(rules([{ kind: "victory" }]), run);
		expect(v.identity.ok).toBe(false);
		expect(v.met).toBe(false);
		expect(v.score_turn).toBeNull();
	});
});
