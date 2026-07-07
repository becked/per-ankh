// Unit tests for the Plane A pure compute (computeCasterLeaderboard). The
// env-taking assembly (computeCompetitionStats) is exercised by the Miniflare
// integration suite; here we pin the parts-walking, grouping, and ordering.

import { describe, expect, it } from "vitest";
import type { MatchPart, MatchRow } from "./data";
import type { UserIdentity } from "./public";
import {
	computeCasterLeaderboard,
	computePlayerPicks,
	type PickSummary,
} from "./stats";

// Minimal MatchRow — computeCasterLeaderboard only reads `parts` (via
// parseParts), so the rest is dummy scaffolding to satisfy the type.
function mkMatch(parts: MatchPart[]): MatchRow {
	return {
		match_id: "m",
		round_id: "r",
		slot_a_id: "sa",
		slot_b_id: "sb",
		map_pool_id: null,
		map_script: null,
		pick_order_winner_slot_id: null,
		status: "complete",
		winner_slot_id: "sa",
		game_id: null,
		reported_by_user_id: null,
		reported_at: null,
		notes: null,
		slot_a_player_index: null,
		slot_b_player_index: null,
		match_index: 1,
		slot_a_username: null,
		slot_a_user_id: null,
		slot_b_username: null,
		slot_b_user_id: null,
		parts: JSON.stringify(parts),
		parts_rev: 1,
		match_number: 1,
		created_at: "2026-07-05T00:00:00Z",
	};
}

function part(
	id: string,
	casters: Array<{ user_id: string | null; name: string | null }>,
): MatchPart {
	return { id, scheduled_at: null, casters, streams: [] };
}

describe("computeCasterLeaderboard", () => {
	it("counts one appearance per part a caster is on, across matches", () => {
		const matches = [
			mkMatch([
				part("p1", [{ user_id: "u1", name: "alcaras" }]),
				part("p2", [{ user_id: "u1", name: "alcaras" }]),
			]),
			mkMatch([part("p1", [{ user_id: "u1", name: "alcaras" }])]),
		];
		const board = computeCasterLeaderboard(matches, new Map());
		expect(board).toHaveLength(1);
		expect(board[0].user_id).toBe("u1");
		expect(board[0].appearances).toBe(3);
	});

	it("groups by user_id when linked, and by name when free-text", () => {
		const matches = [
			mkMatch([
				part("p1", [
					{ user_id: "u1", name: "alcaras" },
					{ user_id: null, name: "GuestCaster" },
				]),
			]),
			mkMatch([
				part("p1", [
					// Same user, different stored name — still one entry (keyed on id).
					{ user_id: "u1", name: "alcaras-alt" },
					{ user_id: null, name: "GuestCaster" },
				]),
			]),
		];
		const board = computeCasterLeaderboard(matches, new Map());
		const linked = board.find((c) => c.user_id === "u1");
		const guest = board.find((c) => c.user_id === null);
		expect(linked?.appearances).toBe(2);
		expect(guest?.name).toBe("GuestCaster");
		expect(guest?.appearances).toBe(2);
		expect(board).toHaveLength(2);
	});

	it("enriches linked casters from the identity map; free-text fall back to name", () => {
		const identities = new Map<string, UserIdentity>([
			["u1", { display_name: "Alcaras", avatar_url: "https://cdn/av/1.png" }],
		]);
		const board = computeCasterLeaderboard(
			[
				mkMatch([
					part("p1", [
						{ user_id: "u1", name: "alcaras" },
						{ user_id: null, name: "GuestCaster" },
					]),
				]),
			],
			identities,
		);
		const linked = board.find((c) => c.user_id === "u1");
		const guest = board.find((c) => c.user_id === null);
		// Linked → current profile label + avatar.
		expect(linked?.display_name).toBe("Alcaras");
		expect(linked?.avatar_url).toBe("https://cdn/av/1.png");
		// Free-text → name as the label, no avatar.
		expect(guest?.display_name).toBe("GuestCaster");
		expect(guest?.avatar_url).toBeNull();
	});

	it("orders by appearances desc, then display label asc", () => {
		const matches = [
			mkMatch([
				part("p1", [
					{ user_id: null, name: "Bravo" },
					{ user_id: null, name: "Charlie" },
				]),
				part("p2", [{ user_id: null, name: "Charlie" }]),
			]),
			mkMatch([
				// Alpha and Bravo both end at 1 appearance → alphabetical tiebreak.
				part("p1", [{ user_id: null, name: "Alpha" }]),
			]),
		];
		const board = computeCasterLeaderboard(matches, new Map());
		expect(board.map((c) => c.display_name)).toEqual([
			"Charlie", // 2
			"Alpha", // 1 (A < B)
			"Bravo", // 1
		]);
	});

	it("returns an empty list when no match has casters", () => {
		const matches = [mkMatch([]), mkMatch([part("p1", [])])];
		expect(computeCasterLeaderboard(matches, new Map())).toEqual([]);
	});
});

// A match with its two occupant snapshots + roster indices set — the fields
// computePlayerPicks reads (over mkMatch's full-row scaffolding).
type Side = { pi: number | null; uid: string | null; name: string | null };
function pickMatch(o: {
	game_id: string | null;
	status?: MatchRow["status"];
	slot_a_id?: string;
	slot_b_id?: string;
	a?: Side;
	b?: Side;
}): MatchRow {
	const a = o.a ?? { pi: 0, uid: null, name: "A" };
	const b = o.b ?? { pi: 1, uid: null, name: "B" };
	return {
		...mkMatch([]),
		status: o.status ?? "complete",
		game_id: o.game_id,
		slot_a_id: o.slot_a_id ?? "sa",
		slot_b_id: o.slot_b_id ?? "sb",
		slot_a_player_index: a.pi,
		slot_b_player_index: b.pi,
		slot_a_user_id: a.uid,
		slot_a_username: a.name,
		slot_b_user_id: b.uid,
		slot_b_username: b.name,
	};
}

// [game_id, player_index, nation, is_winner] → the summary lookup map.
function summaries(
	rows: Array<[string, number, string | null, number]>,
): Map<string, PickSummary> {
	return new Map(
		rows.map(([g, pi, nation, is_winner]) => [
			`${g}|${pi}`,
			{ nation, is_winner },
		]),
	);
}

describe("computePlayerPicks", () => {
	it("attributes each side to its participant, tallying nation + wins", () => {
		const matches = [
			pickMatch({
				game_id: "g1",
				a: { pi: 0, uid: "u1", name: "Alcaras" },
				b: { pi: 1, uid: "u2", name: "Bob" },
			}),
		];
		const summary = summaries([
			["g1", 0, "NATION_ROME", 1],
			["g1", 1, "NATION_PERSIA", 0],
		]);
		const picks = computePlayerPicks(matches, summary, new Map(), new Map());
		expect(picks).toHaveLength(2);
		const u1 = picks.find((p) => p.user_id === "u1");
		expect(u1?.picks).toEqual([{ nation: "NATION_ROME", games: 1, wins: 1 }]);
		expect(u1?.total_games).toBe(1);
		expect(u1?.total_wins).toBe(1);
		const u2 = picks.find((p) => p.user_id === "u2");
		expect(u2?.picks).toEqual([{ nation: "NATION_PERSIA", games: 1, wins: 0 }]);
		expect(u2?.total_wins).toBe(0);
	});

	it("groups a participant across matches, most-fielded nation first", () => {
		const matches = [
			pickMatch({ game_id: "g1", a: { pi: 0, uid: "u1", name: "A" } }),
			pickMatch({ game_id: "g2", a: { pi: 0, uid: "u1", name: "A" } }),
			pickMatch({ game_id: "g3", a: { pi: 0, uid: "u1", name: "A" } }),
		];
		const summary = summaries([
			["g1", 0, "NATION_ROME", 1],
			["g1", 1, "NATION_EGYPT", 0],
			["g2", 0, "NATION_ROME", 0],
			["g2", 1, "NATION_KUSH", 1],
			["g3", 0, "NATION_GREECE", 1],
			["g3", 1, "NATION_KUSH", 0],
		]);
		const u1 = computePlayerPicks(matches, summary, new Map(), new Map()).find(
			(p) => p.user_id === "u1",
		);
		// Rome ×2 (1 win) ranks before Greece ×1 — more games first.
		expect(u1?.picks).toEqual([
			{ nation: "NATION_ROME", games: 2, wins: 1 },
			{ nation: "NATION_GREECE", games: 1, wins: 1 },
		]);
		expect(u1?.total_games).toBe(3);
		expect(u1?.total_wins).toBe(2);
	});

	it("excludes byes/game-less and forfeit matches", () => {
		const matches = [
			pickMatch({ game_id: null, a: { pi: 0, uid: "u1", name: "A" } }),
			pickMatch({
				game_id: "gf",
				status: "forfeit",
				a: { pi: 0, uid: "u1", name: "A" },
			}),
		];
		const summary = summaries([
			["gf", 0, "NATION_ROME", 1],
			["gf", 1, "NATION_PERSIA", 0],
		]);
		expect(computePlayerPicks(matches, summary, new Map(), new Map())).toEqual(
			[],
		);
	});

	it("orders rows by standings rank, unranked last", () => {
		const matches = [
			pickMatch({
				game_id: "g1",
				slot_a_id: "sHigh",
				slot_b_id: "sLow",
				a: { pi: 0, uid: "hi", name: "Hi" },
				b: { pi: 1, uid: "lo", name: "Lo" },
			}),
			pickMatch({
				game_id: "g2",
				slot_a_id: "sUnranked",
				slot_b_id: "sLow",
				a: { pi: 0, uid: "un", name: "Un" },
				b: { pi: 1, uid: "lo", name: "Lo" },
			}),
		];
		const summary = summaries([
			["g1", 0, "NATION_ROME", 1],
			["g1", 1, "NATION_PERSIA", 0],
			["g2", 0, "NATION_EGYPT", 1],
			["g2", 1, "NATION_KUSH", 0],
		]);
		const rank = new Map([
			["sHigh", 1],
			["sLow", 2],
		]);
		const picks = computePlayerPicks(matches, summary, new Map(), rank);
		expect(picks.map((p) => p.user_id)).toEqual(["hi", "lo", "un"]);
	});

	it("keys by user_id when claimed, else the frozen snapshot username", () => {
		const matches = [
			pickMatch({
				game_id: "g1",
				a: { pi: 0, uid: "u1", name: "alcaras" },
				b: { pi: 1, uid: null, name: "Guest" },
			}),
			pickMatch({
				game_id: "g2",
				// Same user, different stored name — still one row (keyed on id).
				a: { pi: 0, uid: "u1", name: "alcaras-alt" },
				b: { pi: 1, uid: null, name: "Guest" },
			}),
		];
		const summary = summaries([
			["g1", 0, "NATION_ROME", 1],
			["g1", 1, "NATION_PERSIA", 0],
			["g2", 0, "NATION_GREECE", 1],
			["g2", 1, "NATION_KUSH", 0],
		]);
		const picks = computePlayerPicks(matches, summary, new Map(), new Map());
		expect(picks).toHaveLength(2);
		expect(picks.find((p) => p.user_id === "u1")?.total_games).toBe(2);
		const guest = picks.find((p) => p.user_id === null);
		expect(guest?.name).toBe("Guest");
		expect(guest?.total_games).toBe(2);
	});

	it("enriches linked players from the identity map; skips sides with no index or summary", () => {
		const identities = new Map<string, UserIdentity>([
			["u2", { display_name: "Bob", avatar_url: "https://cdn/av/2.png" }],
		]);
		const matches = [
			pickMatch({
				game_id: "g1",
				// side A has no roster index → skipped; side B is enriched.
				a: { pi: null, uid: "u1", name: "A" },
				b: { pi: 1, uid: "u2", name: "bob" },
			}),
		];
		const summary = summaries([["g1", 1, "NATION_PERSIA", 1]]);
		const picks = computePlayerPicks(matches, summary, identities, new Map());
		expect(picks).toHaveLength(1);
		expect(picks[0].user_id).toBe("u2");
		expect(picks[0].display_name).toBe("Bob");
		expect(picks[0].avatar_url).toBe("https://cdn/av/2.png");
	});
});
