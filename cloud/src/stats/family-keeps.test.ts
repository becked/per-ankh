import { describe, expect, it } from "vitest";
import {
	buildFamilyKeeps,
	buildFamilyKeepTable,
	type FamilyKeepInput,
} from "./family-keeps";
import { NATION_FAMILY_POOLS } from "../generated/family-pools";

const ROME = NATION_FAMILY_POOLS["NATION_ROME"];
const MAURYA = NATION_FAMILY_POOLS["NATION_MAURYA"];

// One player-game: this nation, these three families.
function game(nation: string, fielded: readonly string[]): FamilyKeepInput {
	return { nation, family_classes: fielded };
}

// Rome's pool, minus one — the shape of every four-family player-game.
function romeCutting(family: string): FamilyKeepInput {
	return game(
		"NATION_ROME",
		ROME.filter((f) => f !== family),
	);
}

describe("buildFamilyKeepTable", () => {
	it("reads indifference as a baseline, not as a preference", () => {
		// Each of Rome's four cut exactly once across four games: nobody is
		// avoiding anything, and every class should land on its baseline.
		const table = buildFamilyKeepTable(ROME.map(romeCutting));

		expect(table.player_games).toBe(4);
		for (const row of table.rows) {
			expect(row.kept_pct).toBeCloseTo(75, 6);
			expect(row.baseline_pct).toBeCloseTo(75, 6);
			expect(row.delta).toBeCloseTo(0, 6);
			expect(row.significant).toBe(false);
		}
	});

	it("accumulates the baseline per game when pools differ in size", () => {
		// Maurya fields three of six, so half its pool is cut every game — a
		// flat 25% baseline would report every Maurya class as shunned.
		const table = buildFamilyKeepTable([
			game("NATION_MAURYA", MAURYA.slice(0, 3)),
			game("NATION_MAURYA", MAURYA.slice(3, 6)),
		]);

		for (const row of table.rows) {
			expect(row.baseline_pct).toBeCloseTo(50, 6);
			expect(row.delta).toBeCloseTo(0, 6);
		}
	});

	it("counts eligibility by pool membership, not by nation", () => {
		// Champions is in Rome's pool and Babylonia's isn't, so Babylonia's
		// games must not enter the Champions denominator.
		const babylonia = NATION_FAMILY_POOLS["NATION_BABYLONIA"];
		expect(babylonia).not.toContain("FAMILYCLASS_CHAMPIONS");

		const table = buildFamilyKeepTable([
			romeCutting("FAMILYCLASS_CHAMPIONS"),
			game("NATION_BABYLONIA", babylonia.slice(0, 3)),
		]);
		const champions = table.rows.find(
			(r) => r.family_class === "FAMILYCLASS_CHAMPIONS",
		)!;
		expect(champions.eligible).toBe(1);
		expect(champions.kept).toBe(0);
	});

	it("finds a family that is genuinely refused", () => {
		// Patrons left out of every one of forty Rome games.
		const table = buildFamilyKeepTable(
			Array.from({ length: 40 }, () => romeCutting("FAMILYCLASS_PATRONS")),
		);
		const patrons = table.rows.find(
			(r) => r.family_class === "FAMILYCLASS_PATRONS",
		)!;

		expect(patrons.kept_pct).toBe(0);
		expect(patrons.baseline_pct).toBeCloseTo(75, 6);
		// Signed on keeps, so a refused family is strongly negative.
		expect(patrons.z).toBeLessThan(-5);
		expect(patrons.significant).toBe(true);
		// And it sits last, the table being sorted most-kept first.
		expect(table.rows[table.rows.length - 1].family_class).toBe(
			"FAMILYCLASS_PATRONS",
		);
	});

	it("skips a roster that cannot say what was chosen, and says how many", () => {
		// A conquered player loses families from the end-of-game roster; a
		// conqueror can gain one. Neither can be read as a setup decision.
		const table = buildFamilyKeepTable([
			romeCutting("FAMILYCLASS_PATRONS"),
			game("NATION_ROME", ROME.slice(0, 2)),
			game("NATION_ROME", ROME),
		]);
		expect(table.player_games).toBe(1);
		expect(table.skipped_incomplete).toBe(2);
	});

	it("excludes a nation that fields its whole pool", () => {
		const tamil = NATION_FAMILY_POOLS["NATION_TAMIL"];
		expect(tamil).toHaveLength(3);

		const table = buildFamilyKeepTable([game("NATION_TAMIL", tamil)]);
		expect(table.player_games).toBe(0);
		expect(table.skipped_forced_pool).toBe(1);
		// It must not appear as a permanent 0%-cut row.
		expect(table.rows).toEqual([]);
	});

	it("skips a roster naming a class outside the nation's pool", () => {
		// A stale pool table mislabels, which is worse than missing.
		const table = buildFamilyKeepTable([
			game("NATION_ROME", [
				ROME[0],
				ROME[1],
				"FAMILYCLASS_HUNTERS_THAT_ROME_DOES_NOT_HAVE",
			]),
			{ nation: "NATION_MADE_UP", family_classes: ROME.slice(0, 3) },
		]);
		expect(table.player_games).toBe(0);
		expect(table.skipped_unknown_pool).toBe(2);
	});

	it("holds the false-discovery rate across the classes it tests", () => {
		// Indifference over many games: nothing is being refused, so nothing
		// should be flagged however many classes are on trial.
		const table = buildFamilyKeepTable(
			Array.from({ length: 200 }, (_, i) => romeCutting(ROME[i % ROME.length])),
		);
		expect(table.rows.every((r) => !r.significant)).toBe(true);
	});
});

describe("buildFamilyKeeps", () => {
	it("gives each nation its own table and leaves out the empty ones", () => {
		const babylonia = NATION_FAMILY_POOLS["NATION_BABYLONIA"];
		const keeps = buildFamilyKeeps([
			romeCutting("FAMILYCLASS_PATRONS"),
			romeCutting("FAMILYCLASS_PATRONS"),
			game("NATION_BABYLONIA", babylonia.slice(0, 3)),
			// Tamil fields its whole pool, so it has no table to offer.
			game("NATION_TAMIL", NATION_FAMILY_POOLS["NATION_TAMIL"]),
		]);

		expect(keeps.overall.player_games).toBe(3);
		expect(keeps.byNation.map((n) => n.nation)).toEqual([
			"NATION_ROME",
			"NATION_BABYLONIA",
		]);

		// A nation's table sees only its own games, and only its own classes.
		const rome = keeps.byNation.find((n) => n.nation === "NATION_ROME")!;
		expect(rome.player_games).toBe(2);
		expect(rome.rows.map((r) => r.family_class).sort()).toEqual(
			[...ROME].sort(),
		);
		expect(
			rome.rows.find((r) => r.family_class === "FAMILYCLASS_PATRONS")!.kept_pct,
		).toBe(0);
	});
});
