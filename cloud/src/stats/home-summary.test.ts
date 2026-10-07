import { describe, expect, it } from "vitest";
import { HOME_ARCHETYPE_MIN_GAMES, homeSummaryFrom } from "./handlers";
import type { ChartBundleCore } from "./types";

// A bundle carrying one row in each of the fields home reads, and something in
// every field it doesn't — the fields it doesn't read are the whole point of
// the trim, so they have to be non-empty for a missing-field assertion to mean
// anything.
function bundle(over: Partial<ChartBundleCore> = {}): ChartBundleCore {
	return {
		meta: { game_count: 603, parser_version: "2.15.0" },
		// Rome's pool is four, so chance alone fields a class 75% of the time —
		// the row's baseline, not zero. Skip counters are non-zero for the same
		// reason the rest of this fixture is.
		familyKeeps: {
			overall: {
				rows: [
					{
						family_class: "FAMILYCLASS_CHAMPIONS",
						eligible: 180,
						kept: 150,
						kept_pct: 83.333,
						baseline_pct: 75,
						delta: 8.333,
						z: 2.582,
						significant: true,
					},
				],
				player_games: 180,
				skipped_incomplete: 4,
				skipped_forced_pool: 2,
				skipped_unknown_pool: 0,
			},
			byNation: [
				{
					nation: "NATION_ROME",
					rows: [
						{
							family_class: "FAMILYCLASS_CHAMPIONS",
							eligible: 180,
							kept: 150,
							kept_pct: 83.333,
							baseline_pct: 75,
							delta: 8.333,
							z: 2.582,
							significant: true,
						},
					],
					player_games: 180,
					skipped_incomplete: 4,
					skipped_forced_pool: 2,
					skipped_unknown_pool: 0,
				},
			],
		},
		summary: { total_games: 603, avg_total_turns: 73.7 },
		turnLength: {
			games: 603,
			min: 4,
			p25: 56,
			median: 73,
			mean: 73.7,
			p75: 90,
			max: 180,
			bucket_turns: 20,
			histogram: [
				{ start: 0, count: 7 },
				{ start: 20, count: 40 },
				{ start: 40, count: 129 },
				{ start: 60, count: 197 },
				{ start: 80, count: 139 },
				{ start: 100, count: 62 },
				{ start: 120, count: 23 },
				{ start: 140, count: 5 },
				{ start: 160, count: 0 },
				{ start: 180, count: 1 },
			],
		},
		nations: [{ nation: "NATION_ROME", games_played: 200 }],
		nationWinRate: [
			{ nation: "NATION_ROME", games: 200, wins: 110, rate: 0.55 },
		],
		nationAvgPoints: [{ nation: "NATION_ROME", games: 200, avg_points: 340 }],
		startingArchetypeWinRate: [
			{
				archetype: "ARCHETYPE_COMMANDER",
				games: 400,
				wins: 210,
				rate: 0.525,
			},
		],
		startingTraitWinRate: [
			{ trait: "TRAIT_INTELLIGENT", games: 90, wins: 50, rate: 0.556 },
		],
		wonderStats: [
			{
				wonder: "IMPROVEMENT_PYRAMIDS",
				culture_prereq: null,
				eligible: 300,
				built: 40,
				rate: 0.133,
				wins: 25,
				win_rate: 0.625,
				median_turn: 60,
				p25_turn: 50,
				p75_turn: 70,
			},
		],
		capitalFamilyWinRate: [
			{
				family_class: "FAMILYCLASS_CHAMPIONS",
				games: 180,
				wins: 95,
				rate: 0.528,
			},
		],
		familyByNation: [
			{
				nation: "NATION_ROME",
				class: "FAMILYCLASS_CHAMPIONS",
				count: 60,
				wins: 33,
				avg_share: 0.4,
				share_samples: 55,
				slot_counts: [30, 20, 10],
			},
		],
		yieldCurves: {
			turns: [1, 2],
			counts: [603, 600],
			series: {},
			outcome: null,
		},
		lawTiming: [
			{
				nation: "__all__",
				law: "LAW_TYRANNY",
				median_turn: 30,
				p25_turn: 22,
				p75_turn: 41,
				count: 200,
			},
		],
		openingLaws: [{ nation: "__all__", laws: ["LAW_TYRANNY"], count: 120 }],
		expansionWinRate: [
			{ bucket: "≤25", games: 40, wins: 26, rate: 0.65 },
			{ bucket: "never", games: 90, wins: 28, rate: 0.311 },
		],
		techFirst: [{ nation: "__all__", tech: "TECH_TRAPPING", count: 150 }],
		techTiming: [
			{ nation: "__all__", tech: "TECH_TRAPPING", median_turn: 8, count: 150 },
		],
		...over,
	};
}

describe("the home summary trim", () => {
	it("carries exactly the fields home reads and nothing else", () => {
		// The point of a dedicated endpoint rather than opening /v1/stats: home
		// is the page most likely to be a visitor's first byte, and the full
		// bundle's bulk is fields it never renders. Asserted as the whole key
		// set, so a field home stops drawing has to leave the payload too — and
		// so `meta` can't drift back in without a consumer asking for it.
		expect(Object.keys(homeSummaryFrom(bundle())).sort()).toEqual([
			"capitalFamilyWinRate",
			"nationWinRate",
			"startingArchetypeWinRate",
		]);
	});

	it("passes the unfloored fields through whole", () => {
		// The row caps are the frontend's — the payload ships every nation and
		// every class, so the cap moves without a Worker deploy.
		const b = bundle();
		const summary = homeSummaryFrom(b);
		expect(summary.nationWinRate).toEqual(b.nationWinRate);
		expect(summary.capitalFamilyWinRate).toEqual(b.capitalFamilyWinRate);
	});
});

describe("the archetype floor", () => {
	it("drops an archetype below the floor and keeps one at it", () => {
		// The row this exists to cut: a headline win rate off a sample too thin
		// to mean anything. `>=` at the boundary, so the floor is the smallest
		// sample that ships rather than the largest that doesn't.
		const summary = homeSummaryFrom(
			bundle({
				startingArchetypeWinRate: [
					{
						archetype: "ARCHETYPE_DIPLOMAT",
						games: HOME_ARCHETYPE_MIN_GAMES - 1,
						wins: 8,
						rate: 0.727,
					},
					{
						archetype: "ARCHETYPE_COMMANDER",
						games: HOME_ARCHETYPE_MIN_GAMES,
						wins: 26,
						rate: 0.52,
					},
				],
			}),
		);
		expect(summary.startingArchetypeWinRate.map((r) => r.archetype)).toEqual([
			"ARCHETYPE_COMMANDER",
		]);
	});

	it("floors nothing else", () => {
		// Deliberately archetype-only. A nation or a family class with a thin
		// sample still names something a reader recognises; an archetype's rate
		// IS the row, so a thin one reads as a finding.
		const thin = bundle({
			nationWinRate: [
				{ nation: "NATION_CARTHAGE", games: 3, wins: 3, rate: 1 },
			],
			capitalFamilyWinRate: [
				{ family_class: "FAMILYCLASS_ARTISANS", games: 2, wins: 2, rate: 1 },
			],
		});
		const summary = homeSummaryFrom(thin);
		expect(summary.nationWinRate).toEqual(thin.nationWinRate);
		expect(summary.capitalFamilyWinRate).toEqual(thin.capitalFamilyWinRate);
	});
});
