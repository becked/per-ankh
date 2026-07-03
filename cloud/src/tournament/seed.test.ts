import { describe, expect, it } from "vitest";
import { planSeededTournament, type SeedPlan } from "./seed";

// Deterministic 21-char id factory (nanoid alphabet subset) so we can assert
// the planner threads makeId everywhere and emits no hardcoded ids.
function idFactory(): () => string {
	let n = 0;
	return () => {
		n++;
		return ("seed" + "0".repeat(21) + n).slice(-21);
	};
}

const ID_RE = /^[A-Za-z0-9_-]{21}$/;

function champSeedBySlot(plan: SeedPlan): Map<string, number> {
	const m = new Map<string, number>();
	for (const s of plan.slots) {
		if (s.phase === "championship") m.set(s.slot_id, s.championship_seed!);
	}
	return m;
}

function matchesOfPhase(plan: SeedPlan, phase: "swiss" | "championship") {
	const roundIds = new Set(
		plan.rounds.filter((r) => r.phase === phase).map((r) => r.round_id),
	);
	return plan.matches.filter((m) => roundIds.has(m.round_id));
}

describe("planSeededTournament", () => {
	it("ids are all unique, 21-char, and from the makeId factory", () => {
		const plan = planSeededTournament(
			{ slug: "t", qualifiers: 6, playersPerDivision: 8 },
			idFactory(),
		);
		const ids = [
			plan.tournament.tournament_id,
			...plan.tournament.map_pool.map((m) => m.id),
			...plan.slots.map((s) => s.slot_id),
			...plan.rounds.map((r) => r.round_id),
			...plan.matches.map((m) => m.match_id),
		];
		for (const id of ids) expect(id).toMatch(ID_RE);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("mid-championship with 6 qualifiers yields an 8-bracket with 2 byes", () => {
		const plan = planSeededTournament(
			{
				slug: "bye",
				qualifiers: 6,
				playersPerDivision: 8,
				fill: "mid-championship",
			},
			idFactory(),
		);

		expect(plan.summary.bracketSize).toBe(8);
		expect(plan.summary.byeCount).toBe(2);
		expect(plan.tournament.status).toBe("championship");
		expect(plan.tournament.completed).toBe(false);

		// 16 swiss slots, 6 championship slots seeded 1..6.
		expect(plan.slots.filter((s) => s.phase === "swiss")).toHaveLength(16);
		const champSlots = plan.slots.filter((s) => s.phase === "championship");
		expect(champSlots).toHaveLength(6);
		expect(
			champSlots.map((s) => s.championship_seed).sort((a, b) => a! - b!),
		).toEqual([1, 2, 3, 4, 5, 6]);

		// Championship R1: 4 matches, 2 byes (top seeds 1 & 2), 2 real complete.
		const r1Id = plan.rounds.find(
			(r) => r.phase === "championship" && r.round_number === 1,
		)!.round_id;
		const r1 = plan.matches
			.filter((m) => m.round_id === r1Id)
			.sort((a, b) => a.match_index - b.match_index);
		expect(r1).toHaveLength(4);

		const seedOf = champSeedBySlot(plan);
		const byes = r1.filter((m) => m.status === "bye");
		expect(byes).toHaveLength(2);
		for (const b of byes) {
			expect(b.slot_b_id).toBeNull();
			expect(b.winner_slot_id).toBe(b.slot_a_id); // bye auto-advances slot_a
			expect(b.slot_a_username).toBeTruthy(); // snapshot set on byes
			expect(b.slot_b_username).toBeNull();
			expect(b.map_pool_id).toBeNull();
			expect(b.pick_order_winner_slot_id).toBeNull();
		}
		// The two byes go to the top two seeds.
		expect(byes.map((b) => seedOf.get(b.slot_a_id)).sort()).toEqual([1, 2]);

		// Real R1 matches: complete, better (lower) seed wins, both snapshotted.
		const real = r1.filter((m) => m.status === "complete");
		expect(real).toHaveLength(2);
		for (const m of real) {
			expect(m.slot_b_id).not.toBeNull();
			expect(m.slot_a_username).toBeTruthy();
			expect(m.slot_b_username).toBeTruthy();
			expect(m.map_pool_id).toBeTruthy();
			expect(m.pick_order_winner_slot_id).toBe(m.slot_b_id);
			const sa = seedOf.get(m.slot_a_id)!;
			const sb = seedOf.get(m.slot_b_id!)!;
			const expected = sa <= sb ? m.slot_a_id : m.slot_b_id;
			expect(m.winner_slot_id).toBe(expected);
		}

		// Semifinal round exists, is in_progress, and has exactly one pending match.
		const r2 = plan.rounds.find(
			(r) => r.phase === "championship" && r.round_number === 2,
		)!;
		expect(r2.status).toBe("in_progress");
		const r2Matches = plan.matches.filter((m) => m.round_id === r2.round_id);
		expect(r2Matches).toHaveLength(2);
		expect(r2Matches.filter((m) => m.status === "pending")).toHaveLength(1);
		expect(r2Matches.filter((m) => m.status === "complete")).toHaveLength(1);

		// The final is NOT materialized — the frontend synthesizes it.
		expect(
			plan.rounds.find(
				(r) => r.phase === "championship" && r.round_number === 3,
			),
		).toBeUndefined();

		// Pending matches carry no snapshot/winner; decided ones do.
		for (const m of plan.matches) {
			if (m.status === "pending") {
				expect(m.winner_slot_id).toBeNull();
				expect(m.slot_a_username).toBeNull();
				expect(m.slot_b_username).toBeNull();
			} else {
				expect(m.winner_slot_id).not.toBeNull();
			}
		}
	});

	it("complete fill plays the bracket to a champion with no pending matches", () => {
		const plan = planSeededTournament(
			{ slug: "done", qualifiers: 4, playersPerDivision: 4, fill: "complete" },
			idFactory(),
		);
		expect(plan.tournament.status).toBe("complete");
		expect(plan.tournament.completed).toBe(true);
		expect(plan.matches.every((m) => m.status !== "pending")).toBe(true);

		// Final round: a single, complete match with a winner (the champion).
		const champRounds = plan.rounds
			.filter((r) => r.phase === "championship")
			.sort((a, b) => a.round_number - b.round_number);
		const final = champRounds[champRounds.length - 1];
		expect(final.status).toBe("complete");
		const finalMatches = plan.matches.filter(
			(m) => m.round_id === final.round_id,
		);
		expect(finalMatches).toHaveLength(1);
		expect(finalMatches[0].winner_slot_id).not.toBeNull();
	});

	it("swiss-done stops before the championship with all rounds complete", () => {
		const plan = planSeededTournament(
			{ slug: "swiss", playersPerDivision: 6, fill: "swiss-done" },
			idFactory(),
		);
		expect(plan.tournament.status).toBe("swiss");
		expect(plan.slots.some((s) => s.phase === "championship")).toBe(false);
		expect(plan.rounds.some((r) => r.phase === "championship")).toBe(false);
		expect(
			matchesOfPhase(plan, "swiss").some((m) => m.status === "pending"),
		).toBe(false);
		expect(plan.rounds.every((r) => r.status === "complete")).toBe(true);
	});

	it("mid-swiss leaves a current round in progress with pending matches", () => {
		const plan = planSeededTournament(
			{ slug: "mid", playersPerDivision: 8, fill: "mid-swiss" },
			idFactory(),
		);
		expect(plan.tournament.status).toBe("swiss");
		const inProgress = plan.rounds.filter((r) => r.status === "in_progress");
		expect(inProgress.length).toBeGreaterThan(0);
		const pending = matchesOfPhase(plan, "swiss").filter(
			(m) => m.status === "pending",
		);
		expect(pending.length).toBeGreaterThan(0);
	});

	it("numbers matches densely in canonical order, byes unnumbered, swiss before championship", () => {
		const plan = planSeededTournament(
			{
				slug: "num",
				qualifiers: 6,
				playersPerDivision: 8,
				fill: "mid-championship",
			},
			idFactory(),
		);
		const roundById = new Map(plan.rounds.map((r) => [r.round_id, r]));

		// Byes are never numbered; every non-bye match (pending included) is.
		for (const m of plan.matches) {
			if (m.status === "bye") expect(m.match_number).toBeNull();
			else expect(m.match_number).not.toBeNull();
		}

		// Dense 1..N over the numbered matches — no gaps, no duplicates.
		const numbered = plan.matches.filter((m) => m.match_number !== null);
		const nums = numbered.map((m) => m.match_number!).sort((a, b) => a - b);
		expect(nums).toEqual(numbered.map((_, i) => i + 1));

		// Numbering follows phase → round → division → within-round index: sorting
		// the numbered matches by that key must recover ascending match_numbers.
		const rank = (m: (typeof numbered)[number]): number[] => {
			const r = roundById.get(m.round_id)!;
			return [
				r.phase === "swiss" ? 0 : 1,
				r.round_number,
				r.division === "A" ? 0 : r.division === "B" ? 1 : 2,
				m.match_index,
			];
		};
		const canonical = [...numbered].sort((a, b) => {
			const ra = rank(a);
			const rb = rank(b);
			for (let i = 0; i < ra.length; i++) {
				if (ra[i] !== rb[i]) return ra[i] - rb[i];
			}
			return 0;
		});
		expect(canonical.map((m) => m.match_number)).toEqual(
			canonical.map((_, i) => i + 1),
		);

		// Append-only across phases: every swiss number precedes every
		// championship number.
		const numsOfPhase = (phase: "swiss" | "championship") =>
			numbered
				.filter((m) => roundById.get(m.round_id)!.phase === phase)
				.map((m) => m.match_number!);
		expect(Math.max(...numsOfPhase("swiss"))).toBeLessThan(
			Math.min(...numsOfPhase("championship")),
		);
	});
});
