// Unit tests for the Plane A pure compute (computeCasterLeaderboard). The
// env-taking assembly (computeCompetitionStats) is exercised by the Miniflare
// integration suite; here we pin the parts-walking, grouping, and ordering.

import { describe, expect, it } from "vitest";
import type { MatchPart, MatchRow } from "./data";
import type { UserIdentity } from "./public";
import { computeCasterLeaderboard } from "./stats";

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
