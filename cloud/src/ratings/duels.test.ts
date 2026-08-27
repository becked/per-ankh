import { describe, expect, it } from "vitest";
import { mergeDuels, type DuelExtraction, type ResolvedDuel } from "./duels";

function stats(): DuelExtraction["stats"] {
	return {
		tournament: 0,
		casual: 0,
		deduped: 0,
		casualGamesScanned: 0,
		unresolvedOpponent: 0,
		ambiguousOnlineId: 0,
	};
}

function duel(over: Partial<ResolvedDuel> = {}): ResolvedDuel {
	return {
		key: "game-1",
		date: "2026-08-01",
		p1: "a",
		p2: "b",
		winner: "a",
		source: "casual",
		script: null,
		...over,
	};
}

describe("mergeDuels", () => {
	it("keeps the tournament record when both sources have the game", () => {
		const s = stats();
		const merged = mergeDuels(
			[duel({ source: "tournament", winner: "a" })],
			[duel({ source: "casual", winner: "b" })],
			s,
		);
		expect(merged).toHaveLength(1);
		expect(merged[0].source).toBe("tournament");
		expect(merged[0].winner).toBe("a");
		expect(s.deduped).toBe(1);
	});

	it("takes the map from the save when the match row doesn't have one", () => {
		// Winning the key isn't winning every field: the official result comes
		// from the tournament row, but only the save knows the map.
		const merged = mergeDuels(
			[duel({ source: "tournament", script: null })],
			[duel({ source: "casual", script: "mapclass_donut" })],
			stats(),
		);
		expect(merged[0].source).toBe("tournament");
		expect(merged[0].script).toBe("mapclass_donut");
	});

	it("does not let the save overwrite a map the match row already names", () => {
		const merged = mergeDuels(
			[duel({ source: "tournament", script: "mapclass_donut" })],
			[duel({ source: "casual", script: "mapclass_wetlands" })],
			stats(),
		);
		expect(merged[0].script).toBe("mapclass_donut");
	});

	it("drops a duel with no date from either source", () => {
		const merged = mergeDuels(
			[duel({ key: "t", date: "", source: "tournament" })],
			[duel({ key: "c", date: "" })],
			stats(),
		);
		expect(merged).toEqual([]);
	});
});
