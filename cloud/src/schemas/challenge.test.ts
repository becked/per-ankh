import * as v from "valibot";
import { describe, expect, it } from "vitest";
import { PatchChallengeSchema } from "./challenge";

// The rules vocabulary is the scorer's; these pin the cross-field rules a
// plain shape can't express — an objective the editor could otherwise
// author and the scorer could never honour.

function objectives(list: unknown[]) {
	return v.safeParse(PatchChallengeSchema, { objectives: list }).success;
}

describe("build objective deadlines", () => {
	it.each<[unknown, string]>([
		[{ kind: "build", target: "ANY_WONDER", by_turn: 40 }, "any wonder"],
		[
			{ kind: "build", target: "IMPROVEMENT_PYRAMIDS", by_turn: 40 },
			"a wonder",
		],
		[{ kind: "build", target: "IMPROVEMENT_LIBRARY_1" }, "an undated build"],
	])("accepts %j — %s", (o) => {
		expect(objectives([o])).toBe(true);
	});
	it.each<[unknown, string]>([
		[
			{ kind: "build", target: "IMPROVEMENT_LIBRARY_1", by_turn: 40 },
			"the save never records when a tile was improved",
		],
		[
			{ kind: "build", target: "ANY_WONDER", state: "started", by_turn: 40 },
			"a start is never dated",
		],
	])("refuses %j — %s", (o) => {
		expect(objectives([o])).toBe(false);
	});
});

describe("army objective", () => {
	it("needs min_types before min_per_type means anything", () => {
		expect(objectives([{ kind: "army", count: 4, min_per_type: 2 }])).toBe(
			false,
		);
		expect(
			objectives([{ kind: "army", count: 4, min_types: 2, min_per_type: 2 }]),
		).toBe(true);
	});
});
