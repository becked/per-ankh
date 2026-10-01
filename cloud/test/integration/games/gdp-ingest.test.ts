// Integration tests for the GDP column the indexer derives at upload.
//
// GDP is the one game_player_turn column the save does not report — it is
// priced from yield_price_history against the money and commodity rates, so
// unlike its neighbours it can be wrong rather than merely missing. It also
// has to agree with what the Economy tab charts for the same game, which it
// does by construction: both go through src/lib/game-detail/gdp-basket.ts.
// What is worth pinning here is the wiring around that shared arithmetic — the
// basket's membership, the forward-fill, the running total, and the NULL that
// a priceless save must produce rather than a zero.

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { makeUser, type TestUser } from "../../helpers/builders";
import { postMultipart } from "../../helpers/requests";
import { buildUploadFormData } from "../../helpers/save-blob";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

// save-blob's yield_history gives series i the rate `value + i`, and
// YIELD_TYPES orders them SCIENCE, CIVICS, TRAINING, GROWTH, CULTURE,
// HAPPINESS, ORDERS, FOOD, MONEY, DISCONTENT, IRON, STONE, WOOD, MAINTENANCE.
// So for a fixture turn of `v`, the four basket commodities and money are:
const FOOD = 7;
const MONEY = 8;
const IRON = 10;
const STONE = 11;
const WOOD = 12;
const rateOf = (v: number, seriesIdx: number) => v + seriesIdx;

// Raw price units: the save stores money ×10,000.
const RAW = 10_000;
const price = (turn: number, yieldType: string, money: number) => ({
	turn,
	yieldType,
	price: money * RAW,
});

// A price for every commodity, so the whole basket is valued.
const allAt = (turn: number, money: number) => [
	price(turn, "YIELD_FOOD", money),
	price(turn, "YIELD_WOOD", money),
	price(turn, "YIELD_STONE", money),
	price(turn, "YIELD_IRON", money),
];

async function uploadAndRead(
	user: TestUser,
	opts: Parameters<typeof buildUploadFormData>[0],
): Promise<Array<{ turn: number; gdp: number | null; cum: number | null }>> {
	const res = await postMultipart({
		path: "/v1/games",
		form: await buildUploadFormData(opts),
		as: user,
	});
	expect(res.status).toBe(201);
	const { game_id } = await res.json<{ game_id: string }>();
	const rows = await env.SHARE_DB.prepare(
		`SELECT turn, gdp_per_turn, gdp_cumulative FROM game_player_turn
		 WHERE game_id = ? AND player_index = 0 ORDER BY turn`,
	)
		.bind(game_id)
		.all<{
			turn: number;
			gdp_per_turn: number | null;
			gdp_cumulative: number | null;
		}>();
	return (rows.results ?? []).map((r) => ({
		turn: r.turn,
		gdp: r.gdp_per_turn,
		cum: r.gdp_cumulative,
	}));
}

describe("GDP at index time", () => {
	it("values the basket at the turn's market price and adds money at face", async () => {
		const user = await makeUser();
		const v = 10;
		const rows = await uploadAndRead(user, {
			winnerIndex: 0,
			turns: [{ player: 0, values: [v] }],
			prices: allAt(1, 4),
		});
		// (food + wood + stone + iron) × 4, plus money at face — and nothing
		// else. The equality is exact, which is what pins the basket's
		// membership: orders is priced by the game but deliberately excluded
		// (an action budget, and at ~100 money a point it would swamp the
		// rest), and maintenance is excluded because yield.xml files it with
		// <SubtractFromYield>YIELD_MONEY</SubtractFromYield>, so the money rate
		// above is already net of it. Include either and this fails.
		const commodities =
			rateOf(v, FOOD) + rateOf(v, WOOD) + rateOf(v, STONE) + rateOf(v, IRON);
		expect(rows[0].gdp).toBeCloseTo(commodities * 4 + rateOf(v, MONEY), 6);
	});

	it("forward-fills a price across the turns that did not move it", async () => {
		const user = await makeUser();
		const rows = await uploadAndRead(user, {
			// Same rate every turn, so any change in GDP is the price moving.
			winnerIndex: 0,
			turns: [{ player: 0, values: [10, 10, 10] }],
			prices: [...allAt(1, 4), ...allAt(3, 10)],
		});
		expect(rows[0].gdp).toBeCloseTo(rows[1].gdp!, 6);
		expect(rows[2].gdp!).toBeGreaterThan(rows[1].gdp!);
	});

	it("carries a price backwards to turns before it was first recorded", async () => {
		// A save whose first price entry is turn 3 still values turns 1-2 —
		// at that first price, since there is no earlier one to use.
		const user = await makeUser();
		const rows = await uploadAndRead(user, {
			winnerIndex: 0,
			turns: [{ player: 0, values: [10, 10, 10] }],
			prices: allAt(3, 4),
		});
		expect(rows[0].gdp).not.toBeNull();
		expect(rows[0].gdp).toBeCloseTo(rows[2].gdp!, 6);
	});

	it("accumulates the rate — GDP is a flow, so its total is lifetime output", async () => {
		const user = await makeUser();
		const rows = await uploadAndRead(user, {
			winnerIndex: 0,
			turns: [{ player: 0, values: [10, 20, 30] }],
			prices: allAt(1, 4),
		});
		let running = 0;
		for (const row of rows) {
			running += row.gdp!;
			expect(row.cum).toBeCloseTo(running, 6);
		}
		// And it is strictly a sum of the rates, never the game's own total of
		// anything: no *_cumulative column feeds it.
		expect(rows.at(-1)!.cum).toBeCloseTo(
			rows.reduce((sum, r) => sum + r.gdp!, 0),
			6,
		);
	});

	it("writes NULL for a save that recorded no prices, not zero", async () => {
		// The distinction matters: zero is a claim about the game's economy,
		// and a save with no price history is not making it. Every reader has
		// to be able to tell "no GDP recorded" from "no GDP earned".
		const user = await makeUser();
		const rows = await uploadAndRead(user, {
			winnerIndex: 0,
			turns: [{ player: 0, values: [10, 20] }],
		});
		expect(rows).toHaveLength(2);
		for (const row of rows) {
			expect(row.gdp).toBeNull();
			expect(row.cum).toBeNull();
		}
	});

	it("runs the total per player rather than across the game", async () => {
		const user = await makeUser();
		const res = await postMultipart({
			path: "/v1/games",
			form: await buildUploadFormData({
				winnerIndex: 0,
				turns: [
					{ player: 0, values: [10, 10] },
					{ player: 1, values: [10, 10] },
				],
				prices: allAt(1, 4),
			}),
			as: user,
		});
		expect(res.status).toBe(201);
		const { game_id } = await res.json<{ game_id: string }>();
		const rows = await env.SHARE_DB.prepare(
			`SELECT player_index, turn, gdp_per_turn, gdp_cumulative
			 FROM game_player_turn WHERE game_id = ? ORDER BY player_index, turn`,
		)
			.bind(game_id)
			.all<{
				player_index: number;
				turn: number;
				gdp_per_turn: number;
				gdp_cumulative: number;
			}>();
		const results = rows.results ?? [];
		// Each player's turn-1 total is that player's turn-1 rate — one seat's
		// running sum must not have picked up the other's.
		for (const seat of [0, 1]) {
			const first = results.find(
				(r) => r.player_index === seat && r.turn === 1,
			);
			expect(first!.gdp_cumulative).toBeCloseTo(first!.gdp_per_turn, 6);
		}
	});
});
