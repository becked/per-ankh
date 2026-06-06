import { describe, expect, it } from "vitest";
import {
	csvField,
	csvRow,
	buildMatchesCsv,
	type MatchWithRound,
} from "./export";
import type { MatchRow, RoundRow } from "./data";

describe("csvField", () => {
	it("passes plain values through unquoted", () => {
		expect(csvField("alice")).toBe("alice");
		expect(csvField(42)).toBe("42");
	});

	it("renders null as an empty cell", () => {
		expect(csvField(null)).toBe("");
	});

	it("quotes and escapes commas, quotes, and newlines", () => {
		expect(csvField("a,b")).toBe('"a,b"');
		expect(csvField('she said "hi"')).toBe('"she said ""hi"""');
		expect(csvField("line1\nline2")).toBe('"line1\nline2"');
	});
});

describe("csvRow", () => {
	it("joins escaped fields with commas", () => {
		expect(csvRow(["a", 1, null, "x,y"])).toBe('a,1,,"x,y"');
	});
});

// Minimal row factories — only the fields buildMatchesCsv reads.
function round(over: Partial<RoundRow> = {}): RoundRow {
	return {
		round_id: "r1",
		tournament_id: "t1",
		phase: "swiss",
		division: "A",
		round_number: 1,
		status: "complete",
		generated_at: null,
		started_at: null,
		completed_at: null,
		...over,
	};
}

function match(over: Partial<MatchRow> = {}): MatchRow {
	return {
		match_id: "m1",
		round_id: "r1",
		slot_a_id: "sa",
		slot_b_id: "sb",
		map_pool_id: null,
		map_script: null,
		pick_order_winner_slot_id: null,
		status: "complete",
		winner_slot_id: null,
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
		scheduled_at: null,
		stream_url: null,
		caster_user_id: null,
		caster_name: null,
		created_at: "2026-01-01",
		...over,
	};
}

// Parse a built CSV (minus BOM + header) into data rows of cells.
function dataRows(csv: string): string[][] {
	const lines = csv.replace(/^﻿/, "").trimEnd().split("\r\n");
	return lines.slice(1).map((l) => l.split(","));
}

describe("buildMatchesCsv", () => {
	const slotNames = new Map<string, string | null>([
		["sa", "alice"],
		["sb", "bob"],
	]);

	it("prefers the report-time snapshot, falls back to current slot name", () => {
		// Completed match: snapshot names win (historical, post-substitution).
		const completed: MatchWithRound = {
			round: round(),
			match: match({
				slot_a_username: "alice_old",
				slot_b_username: "bob_old",
				winner_slot_id: "sa",
				map_script: "MAPCLASS_CONTINENTS",
			}),
		};
		// Pending match: no snapshot → current slot names.
		const pending: MatchWithRound = {
			round: round(),
			match: match({ match_id: "m2", status: "pending", match_index: 2 }),
		};
		const rows = dataRows(
			buildMatchesCsv([completed, pending], slotNames, new Map(), new Map()),
		);
		// columns: phase,division,round,match_index,player_a,player_b,map,status,winner,reported_at,notes,game_id
		expect(rows[0][4]).toBe("alice_old");
		expect(rows[0][5]).toBe("bob_old");
		expect(rows[0][6]).toBe("MAPCLASS_CONTINENTS");
		expect(rows[0][8]).toBe("alice_old"); // winner = snapshot name
		expect(rows[1][4]).toBe("alice");
		expect(rows[1][5]).toBe("bob");
		expect(rows[1][7]).toBe("pending");
		expect(rows[1][8]).toBe(""); // no winner yet
	});

	it("handles byes: empty player_b, empty winner name source", () => {
		const bye: MatchWithRound = {
			round: round(),
			match: match({
				slot_b_id: null,
				status: "bye",
				winner_slot_id: "sa",
			}),
		};
		const rows = dataRows(
			buildMatchesCsv([bye], slotNames, new Map(), new Map()),
		);
		expect(rows[0][5]).toBe(""); // player_b empty
		expect(rows[0][7]).toBe("bye");
		expect(rows[0][8]).toBe("alice"); // winner resolved from current slot
	});

	it("resolves the map label from the pool when map_script is null", () => {
		const m: MatchWithRound = {
			round: round(),
			match: match({ map_pool_id: "pool1", map_script: null }),
		};
		const labels = new Map([["pool1", "MAPCLASS_SEASIDE"]]);
		const rows = dataRows(buildMatchesCsv([m], slotNames, labels, new Map()));
		expect(rows[0][6]).toBe("MAPCLASS_SEASIDE");
	});

	it("renders snapshot occupants by current display name, keeping the username snapshot for never-claimed players", () => {
		const completed: MatchWithRound = {
			round: round(),
			match: match({
				// Slot A's occupant claimed an account → label is their current
				// display name, not the handle snapshot. Slot B never claimed →
				// the report-time username snapshot stands.
				slot_a_username: "alice_handle",
				slot_a_user_id: "ua",
				slot_b_username: "bob_handle",
				slot_b_user_id: null,
				winner_slot_id: "sa",
			}),
		};
		const identities = new Map([
			["ua", { avatar_url: null, display_name: "Alice Display" }],
		]);
		const rows = dataRows(
			buildMatchesCsv([completed], slotNames, new Map(), identities),
		);
		expect(rows[0][4]).toBe("Alice Display");
		expect(rows[0][5]).toBe("bob_handle");
		expect(rows[0][8]).toBe("Alice Display"); // winner uses the same label
	});
});
