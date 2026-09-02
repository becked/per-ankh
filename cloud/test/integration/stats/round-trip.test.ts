// Fixture → ChartBundle round-trip.
//
// A fixed corpus goes through the real upload path — so the blob → D1 indexing
// every loader reads is exercised end to end — and the whole bundle is pinned
// as a snapshot. That is what makes a change to the aggregator's internals
// provably output-identical (the disjoint-cohort rework) or provably scoped
// (bounding openingLaws changes chart output, and the diff says by how much).
//
// buildChartBundle is called directly rather than through
// GET /v1/users/:user_id/stats, because both focal modes matter: "humans"
// counts every human seat and is what a tournament — and a global — corpus
// runs on, and no user endpoint produces it.
//
// The snapshot is canonicalized (test/helpers/chart-bundle.ts): row order in
// the bundle's object arrays follows unordered D1 rows and is not part of its
// contract, and save_dates repeats per-run game ids. Everything the
// canonicalizer flattens that *is* a contract is asserted below instead.

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { WONDER_CULTURE_PREREQ } from "../../../src/generated/wonders";
import { buildChartBundle } from "../../../src/stats/aggregate";
import type {
	ChartBundle,
	ChartBundleCore,
	YieldCohort,
} from "../../../src/stats/types";
import { canonicalizeBundle } from "../../helpers/chart-bundle";
import { makeUser } from "../../helpers/builders";
import { postMultipart } from "../../helpers/requests";
import {
	buildUploadFormData,
	type UploadFixtureOpts,
} from "../../helpers/save-blob";

// Pinned rather than read from CURRENT_PARSER_VERSION: the version is a
// buildChartBundle argument, and a snapshot that tracked the constant would
// churn on every parser bump. 2.12.0 is the first version whose blob carries a
// wonder pool, which game A needs and game B deliberately does without.
const PARSER_VERSION = "2.12.0";

// Nations follow the roster seat (test/helpers/save-blob.ts): seat 0 is Egypt,
// seat 1 Rome. Named here because half the bundle is keyed by them.
const EGYPT = "NATION_EGYPT";
const ROME = "NATION_ROME";

const SAGES = "FAMILYCLASS_SAGES";
const TRADERS = "FAMILYCLASS_TRADERS";
const CHAMPIONS = "FAMILYCLASS_CHAMPIONS";
const LANDOWNERS = "FAMILYCLASS_LANDOWNERS";

// A succession law — a different kind of law from the civic ones, excluded
// from both law charts. Seeded so that exclusion is observable.
const SUCCESSION_LAW = "LAW_PRIMOGENITURE";

// The cross-nation aggregate key the law and tech fields carry alongside their
// per-nation rows. Spelled out rather than imported: it is module-private to
// the aggregator, and a test that reached for it would be asserting against
// the same symbol it is checking.
const ALL_NATIONS = "__all__";

// The wonder the pool tests use: the lowest culture prereq, so a CULTURE_WEAK
// city clears the eligibility gate.
const WONDER = "IMPROVEMENT_PYRAMIDS";

const WEAK = "CULTURE_WEAK";

// Everything but the wonder under test, so game A's pool has the shape of a
// real save — a subset enabled, the rest disabled — while keeping the bundle's
// wonder rows down to the one the fixture actually says something about.
const DISABLED_BUT_TEST_WONDER = Object.keys(WONDER_CULTURE_PREREQ).filter(
	(w) => w !== WONDER,
);

// Three games. Two decided in opposite directions, so no nation, archetype or
// family sits at a win rate of 0 or 1 by construction; one undecided, so the
// pooled cohort is provably wider than winners plus losers.
const CORPUS: readonly UploadFixtureOpts[] = [
	// A — Egypt takes it. Carries a wonder pool, five founded cities for the
	// uploader, and four civic laws a side behind one succession law.
	{
		winnerIndex: 0,
		parserVersion: PARSER_VERSION,
		saveDate: "2026-01-05",
		disabledImprovements: DISABLED_BUT_TEST_WONDER,
		turns: [
			{ player: 0, values: [10, 12, 14] },
			{ player: 1, values: [8, 9, 10] },
		],
		laws: [
			{ player: 0, law: SUCCESSION_LAW, turn: 1 },
			{ player: 0, law: "LAW_CENTRALIZATION", turn: 3 },
			{ player: 0, law: "LAW_AUTARKY", turn: 6 },
			{ player: 0, law: "LAW_COLONIES", turn: 9 },
			{ player: 0, law: "LAW_COIN_DEBASEMENT", turn: 12 },
			{ player: 1, law: "LAW_VASSALAGE", turn: 4 },
			{ player: 1, law: "LAW_TRADE_LEAGUE", turn: 7 },
			{ player: 1, law: "LAW_SERFDOM", turn: 10 },
			{ player: 1, law: "LAW_MONETARY_REFORM", turn: 13 },
		],
		techs: [
			// Turn 1 is the nation's starting grant, not a research choice — the
			// aggregator drops it, so the first tech here is Stonecutting.
			{ player: 0, tech: "TECH_IRONWORKING", turn: 1 },
			{ player: 0, tech: "TECH_STONECUTTING", turn: 5 },
			{ player: 0, tech: "TECH_TRAPPING", turn: 11 },
			{ player: 1, tech: "TECH_DIVINATION", turn: 6 },
			{ player: 1, tech: "TECH_ADMINISTRATION", turn: 12 },
		],
		rulers: [
			{
				player: 0,
				archetype: "TRAIT_SCHEMER_ARCHETYPE",
				traits: ["TRAIT_ELOQUENT"],
			},
			{
				player: 1,
				archetype: "TRAIT_COMMANDER_ARCHETYPE",
				traits: ["TRAIT_WARLIKE"],
			},
		],
		cities: [
			{
				owner: 0,
				familyClass: SAGES,
				foundedTurn: 5,
				isCapital: true,
				cultureLevel: WEAK,
			},
			{ owner: 0, familyClass: SAGES, foundedTurn: 9 },
			{ owner: 0, familyClass: TRADERS, foundedTurn: 14 },
			{ owner: 0, familyClass: TRADERS, foundedTurn: 20 },
			{ owner: 0, familyClass: CHAMPIONS, foundedTurn: 26 },
			{
				owner: 1,
				familyClass: LANDOWNERS,
				foundedTurn: 6,
				isCapital: true,
				cultureLevel: WEAK,
			},
			{ owner: 1, familyClass: CHAMPIONS, foundedTurn: 12 },
		],
		wonders: [{ player_id: 0, wonder: WONDER, completed_turn: 30 }],
	},
	// B — Rome takes it, and the blob carries no disabled-improvements list, so
	// the game supplies no wonder eligibility. Its build still counts, against
	// no denominator: the mixed corpus §8.3's one-population rule is about.
	{
		winnerIndex: 1,
		parserVersion: PARSER_VERSION,
		saveDate: "2026-01-05",
		turns: [
			{ player: 0, values: [6, 7, 8] },
			{ player: 1, values: [11, 13, 15] },
		],
		laws: [
			{ player: 0, law: "LAW_VASSALAGE", turn: 2 },
			{ player: 0, law: "LAW_TRADE_LEAGUE", turn: 5 },
			{ player: 0, law: "LAW_SERFDOM", turn: 8 },
			{ player: 0, law: "LAW_MONETARY_REFORM", turn: 11 },
			{ player: 1, law: SUCCESSION_LAW, turn: 1 },
			{ player: 1, law: "LAW_CENTRALIZATION", turn: 3 },
			{ player: 1, law: "LAW_AUTARKY", turn: 6 },
			{ player: 1, law: "LAW_COLONIES", turn: 9 },
			{ player: 1, law: "LAW_COIN_DEBASEMENT", turn: 12 },
		],
		techs: [
			{ player: 0, tech: "TECH_HUSBANDRY", turn: 4 },
			{ player: 0, tech: "TECH_STONECUTTING", turn: 9 },
			{ player: 1, tech: "TECH_STONECUTTING", turn: 7 },
			{ player: 1, tech: "TECH_TRAPPING", turn: 14 },
		],
		rulers: [
			{
				player: 0,
				archetype: "TRAIT_BUILDER_ARCHETYPE",
				traits: ["TRAIT_INTELLIGENT"],
			},
			{
				player: 1,
				archetype: "TRAIT_SCHEMER_ARCHETYPE",
				traits: ["TRAIT_ELOQUENT"],
			},
		],
		cities: [
			{
				owner: 0,
				familyClass: LANDOWNERS,
				foundedTurn: 7,
				isCapital: true,
				cultureLevel: WEAK,
			},
			{ owner: 0, familyClass: SAGES, foundedTurn: 15 },
			{ owner: 0, familyClass: SAGES, foundedTurn: 22 },
			{
				owner: 1,
				familyClass: TRADERS,
				foundedTurn: 4,
				isCapital: true,
				cultureLevel: WEAK,
			},
			{ owner: 1, familyClass: TRADERS, foundedTurn: 11 },
			{ owner: 1, familyClass: CHAMPIONS, foundedTurn: 19 },
			{ owner: 1, familyClass: LANDOWNERS, foundedTurn: 25 },
			{ owner: 1, familyClass: LANDOWNERS, foundedTurn: 31 },
		],
		wonders: [{ player_id: 1, wonder: WONDER, completed_turn: 44 }],
	},
	// C — no recorded winner. Its job is to be a game the outcome split cannot
	// place, so pooled exceeds winners plus losers. It carries rulers as well as
	// turn rows: summary.top_archetype is decided by a bare `count >` over an
	// unordered Map (topEntry in aggregate.ts), so a corpus whose leading
	// archetype ties has no stable answer to snapshot. A third Schemer settles
	// it — and the undecided game is the honest place to put one, since it moves
	// the count without moving any win rate.
	{
		winnerIndex: null,
		parserVersion: PARSER_VERSION,
		saveDate: "2026-01-07",
		turns: [
			{ player: 0, values: [5, 5, 5] },
			{ player: 1, values: [20, 20, 20] },
		],
		rulers: [
			{
				player: 0,
				archetype: "TRAIT_SCHEMER_ARCHETYPE",
				traits: ["TRAIT_ELOQUENT"],
			},
			{
				player: 1,
				archetype: "TRAIT_COMMANDER_ARCHETYPE",
				traits: ["TRAIT_WARLIKE"],
			},
		],
	},
];

// Turns seeded per player above. The bundle's turn axis is derived from the
// rows, so this is the length every cohort array must have.
const SEEDED_TURNS = 3;

let gameIds: string[] = [];
// Per-run game ids → stable placeholders, the one redaction the bundle needs.
let redactions: Record<string, string> = {};

async function bundleFor(focal: "uploader"): Promise<ChartBundle>;
async function bundleFor(focal: "humans"): Promise<ChartBundleCore>;
async function bundleFor(
	focal: "uploader" | "humans",
): Promise<ChartBundleCore> {
	return focal === "uploader"
		? buildChartBundle(env, { gameIds }, PARSER_VERSION, "uploader")
		: buildChartBundle(env, { gameIds }, PARSER_VERSION, "humans");
}

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
	const user = await makeUser();
	for (const opts of CORPUS) {
		const res = await postMultipart({
			path: "/v1/games",
			form: await buildUploadFormData(opts),
			as: user,
		});
		expect(res.status).toBe(201);
		const { game_id } = await res.json<{ game_id: string }>();
		gameIds.push(game_id);
	}
	redactions = Object.fromEntries(
		gameIds.map((id, i) => [id, `game#${i}`] as const),
	);
});

describe("chart bundle round-trip", () => {
	it("builds the user bundle from the fixture corpus", async () => {
		const bundle = await bundleFor("uploader");
		expect(canonicalizeBundle(bundle, redactions)).toMatchSnapshot();
	});

	it("builds the all-humans bundle from the same corpus", async () => {
		const bundle = await bundleFor("humans");
		expect(canonicalizeBundle(bundle, redactions)).toMatchSnapshot();
	});

	// Guards the snapshots against going vacuous: every one of these is empty
	// unless the fixture seeds the blob arrays behind it, and an empty field
	// snapshots just as happily as a populated one.
	it("populates every chart field the corpus has data for", async () => {
		for (const focal of ["uploader", "humans"] as const) {
			// Branch the call, not the argument: bundleFor is overloaded on the
			// literal, and every field below is one both bundles carry.
			const b: ChartBundleCore =
				focal === "uploader"
					? await bundleFor("uploader")
					: await bundleFor("humans");
			expect(b.yieldCurves.turns, focal).toHaveLength(SEEDED_TURNS);
			expect(b.yieldCurves.outcome, focal).not.toBeNull();
			// 17: the 14 yields, the two stock levels, and GDP. GDP's band is
			// present but all-null here — the fixture blobs carry no
			// yield_price_history, so there is nothing to price — which is the
			// ordinary state the Yields panel drops a card for rather than
			// drawing an empty axis.
			expect(Object.keys(b.yieldCurves.series), focal).toHaveLength(17);
			for (const field of [
				"nations",
				"nationWinRate",
				"nationAvgPoints",
				"startingArchetypeWinRate",
				"startingTraitWinRate",
				"wonderStats",
				"capitalFamilyWinRate",
				"familyByNation",
				"lawTiming",
				"openingLaws",
				"expansionWinRate",
				"techFirst",
				"techTiming",
			] as const) {
				expect(b[field], `${focal}.${field}`).not.toHaveLength(0);
			}
		}
	});

	// save_dates is the one populated field that is *not* in the loop above,
	// because it is not in the core: it belongs to the user-only extension, so
	// the two bundles are asserted to differ rather than to agree. Stating both
	// halves is the point — dropping it from the core saves the payload only if
	// the humans path also stops loading it, and an assertion that it is merely
	// absent would pass just as well if it were being loaded and discarded.
	it("carries save_dates on the user bundle only", async () => {
		const user = await bundleFor("uploader");
		expect(user.save_dates.length).toBeGreaterThan(0);

		const humans: ChartBundleCore = await bundleFor("humans");
		expect("save_dates" in humans).toBe(false);
	});
});

describe("law and tech focal restriction", () => {
	// All four nation-keyed law/tech fields draw from the focal seats, so over
	// the uploader corpus none of them can name the opponent's nation. Stated
	// here rather than left to the snapshot because two of them reached this
	// late: lawTiming and techTiming aggregated every seat in the corpus's
	// games, which put the opponent's laws and techs in the uploader's own
	// charts and, under the global nation facet, the Greek's in a Rome bundle.
	it("names only the focal nation over the uploader corpus", async () => {
		const b = await bundleFor("uploader");
		for (const [field, rows] of [
			["lawTiming", b.lawTiming],
			["openingLaws", b.openingLaws],
			["techFirst", b.techFirst],
			["techTiming", b.techTiming],
		] as const) {
			const nations = new Set(rows.map((r) => r.nation));
			expect(nations.size, `${field} is populated`).toBeGreaterThan(0);
			nations.delete(ALL_NATIONS);
			expect([...nations], field).toEqual([EGYPT]);
		}
	});

	// The counterpart reading: over the same corpus every seat is human, so the
	// all-humans bundle keeps both nations. Together the two say the fields
	// follow the focal set rather than simply having been narrowed to one row.
	it("keeps both nations over the all-humans corpus", async () => {
		const b = await bundleFor("humans");
		for (const [field, rows] of [
			["lawTiming", b.lawTiming],
			["openingLaws", b.openingLaws],
			["techFirst", b.techFirst],
			["techTiming", b.techTiming],
		] as const) {
			const nations = new Set(rows.map((r) => r.nation));
			nations.delete(ALL_NATIONS);
			expect([...nations].sort(), field).toEqual([EGYPT, ROME].sort());
		}
	});
});

describe("yield cohorts", () => {
	// The invariant the disjoint-cohort rework has to preserve: the pooled
	// cohort is every focal row, and the outcome split is the decided subset of
	// exactly those rows. Stating it here means a later rework is measured
	// against the claim and not only against the snapshot's bytes.
	it("indexes every cohort against the shared turn axis", async () => {
		const { turns, counts, series, outcome } = (await bundleFor("humans"))
			.yieldCurves;
		expect(counts).toHaveLength(turns.length);
		const cohorts: YieldCohort[] = [
			{ counts, series },
			outcome!.winners,
			outcome!.losers,
		];
		for (const cohort of cohorts) {
			expect(cohort.counts).toHaveLength(turns.length);
			for (const [key, { rate, cumulative }] of Object.entries(cohort.series)) {
				for (const band of [rate, cumulative]) {
					expect(band.p25, key).toHaveLength(turns.length);
					expect(band.p50, key).toHaveLength(turns.length);
					expect(band.p75, key).toHaveLength(turns.length);
				}
			}
		}
	});

	it("pools the undecided game that the outcome split cannot place", async () => {
		const all = (await bundleFor("humans")).yieldCurves;
		// Both seats of the undecided game are focal, and neither is a winner or
		// a loser — so the pooled count runs exactly two ahead at every turn.
		const undecidedRows = 2;
		for (let i = 0; i < all.turns.length; i++) {
			expect(all.counts[i]).toBe(
				all.outcome!.winners.counts[i] +
					all.outcome!.losers.counts[i] +
					undecidedRows,
			);
		}
	});

	it("splits a wholly decided corpus with nothing left over", async () => {
		const decidedOnly = await buildChartBundle(
			env,
			{ gameIds: gameIds.slice(0, 2) },
			PARSER_VERSION,
			"humans",
		);
		const { turns, counts, outcome } = decidedOnly.yieldCurves;
		expect(turns).toHaveLength(SEEDED_TURNS);
		for (let i = 0; i < turns.length; i++) {
			expect(counts[i]).toBe(
				outcome!.winners.counts[i] + outcome!.losers.counts[i],
			);
		}
	});
});

describe("orderings the canonicalizer flattens", () => {
	// `nations` is the one array the aggregator sorts itself, so the snapshot
	// can't be what defends it.
	it("ranks nations by games played, descending", async () => {
		const { nations } = await bundleFor("humans");
		const counts = nations.map((n) => n.games_played);
		expect(counts).toEqual([...counts].sort((a, b) => b - a));
	});
});

describe("focal widening", () => {
	it("counts one seat per game as the uploader and both as humans", async () => {
		const mine = await bundleFor("uploader");
		const everyone = await bundleFor("humans");

		// Per-game facts are the corpus's, so they don't move with the focal set.
		expect(mine.meta.game_count).toBe(CORPUS.length);
		expect(everyone.meta.game_count).toBe(mine.meta.game_count);
		expect(everyone.summary.total_games).toBe(mine.summary.total_games);

		// Per-player facts do. The uploader holds seat 0 in all three games, so
		// the user bundle sees only Egypt; widening adds Rome's three seats.
		expect(mine.nations).toEqual([
			{ nation: EGYPT, games_played: CORPUS.length },
		]);
		expect(
			[...everyone.nations].sort((a, b) => a.nation.localeCompare(b.nation)),
		).toEqual([
			{ nation: EGYPT, games_played: CORPUS.length },
			{ nation: ROME, games_played: CORPUS.length },
		]);
	});
});
