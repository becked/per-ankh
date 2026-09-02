// What GDP is made of, and what a turn's basket is worth.
//
// Two callers price the same basket and must never disagree about it: the
// Economy tab's `gdpSeries` (economy.ts), which charts one game in the
// browser, and the Worker's D1 indexer (cloud/src/games.ts), which writes
// game_player_turn.gdp_per_turn at upload so the stats corpus can rank it. A
// second definition would show one number on a game page and a different one
// on that game's record.
//
// So the definition lives here, and this module is DELIBERATELY dependency-
// free — no `$lib` aliases, no SvelteKit-shaped imports — because cloud/ is a
// separate package bundled by wrangler/esbuild and can only reach across the
// package boundary for a module that drags nothing with it.

/**
 * The commodity yields the game runs a market in, so each has a money price
 * per turn to value it at. Orders are priced too but deliberately left out:
 * they're an action budget, not production, and at ~100 money a point they'd
 * swamp everything else.
 */
export const GDP_COMMODITIES = [
	"YIELD_FOOD",
	"YIELD_WOOD",
	"YIELD_STONE",
	"YIELD_IRON",
] as const;

/** Money is the numéraire — counted at face value, never priced. */
export const GDP_MONEY = "YIELD_MONEY";

/**
 * The save stores market prices as money ×10,000: yield.xml gives each
 * commodity `<iPrice>4</iPrice>` and the earliest recorded price in every game
 * is raw ~40,200, so 4 money is the base. yield.xml's `<iMinPrice>20</iMinPrice>`
 * / `<iMaxPrice>1000</iMaxPrice>` are NOT in the same units — they're tenths, so
 * the price is bounded to 2..100 money. Reading those two as whole money is
 * what makes ×1,000 look right; it isn't.
 */
export const PRICE_SCALE = 10_000;

/**
 * One `yield_price_history` entry. Structurally identical to the parser's
 * `YieldPriceEntry` and declared again here rather than imported, because
 * importing it would pull `$lib/parser/types` — and with it the alias
 * resolution this module exists to avoid — into the Worker bundle. Callers on
 * the frontend pass their `YieldPriceEntry[]` straight in; the Worker uses
 * this one.
 */
export interface PricePoint {
	turn: number;
	yield_type: string;
	price: number;
}

/**
 * Per-turn market price of each commodity, in money, indexed by turn.
 *
 * `yield_price_history` only records turns where a price moved, so each series
 * is forward-filled; turns before its first entry take that first price, which
 * costs nothing because turn 1 carries no yield rate to value.
 */
export function pricesByTurn(
	prices: readonly PricePoint[],
	finalTurn: number,
): Map<string, number[]> {
	const out = new Map<string, number[]>();
	for (const commodity of GDP_COMMODITIES) {
		const observed = prices
			.filter((p) => p.yield_type === commodity)
			.sort((a, b) => a.turn - b.turn);
		if (observed.length === 0) continue;
		const curve = new Array<number>(finalTurn + 1);
		let latest = observed[0].price / PRICE_SCALE;
		let next = 0;
		for (let t = 0; t <= finalTurn; t++) {
			while (next < observed.length && observed[next].turn <= t) {
				latest = observed[next].price / PRICE_SCALE;
				next += 1;
			}
			curve[t] = latest;
		}
		out.set(commodity, curve);
	}
	return out;
}

/** One basket item's contribution to a turn's GDP. */
export interface GdpComponent {
	yieldType: string;
	/** The income itself, in yield units — what the player actually earned. */
	amount: number;
	/** What that income is worth in money. Money's own row is worth its face. */
	value: number;
	/** Market price that turn; null for money, which is the numéraire. */
	price: number | null;
}

/**
 * What one turn's basket paid, richest commodity first with money last —
 * money is the unit the rows above it were converted into.
 *
 * An income measure, not a stockpile: a player sitting on 500 stone they never
 * spend scores the same as one who spends it the turn it lands. A commodity
 * with no rate or no price that turn contributes nothing rather than being
 * interpolated, so the curve starts where the save's history does. A zero row
 * is dropped — it is not a contribution to explain.
 *
 * Maintenance is NOT a term: yield.xml files YIELD_MAINTENANCE with
 * `<SubtractFromYield>YIELD_MONEY</SubtractFromYield>`, so the money rate read
 * here is already net of it. Subtracting it would charge the bill twice.
 */
export function gdpComponents(
	turn: number,
	rateOf: (yieldType: string) => number | undefined,
	priceCurves: ReadonlyMap<string, number[]>,
): GdpComponent[] {
	const commodities: GdpComponent[] = [];
	for (const commodity of GDP_COMMODITIES) {
		const amount = rateOf(commodity);
		const price = priceCurves.get(commodity)?.[turn];
		if (amount == null || price == null || amount === 0) continue;
		commodities.push({
			yieldType: commodity,
			amount,
			value: amount * price,
			price,
		});
	}
	commodities.sort((a, b) => b.value - a.value);

	const money = rateOf(GDP_MONEY) ?? 0;
	if (money === 0) return commodities;
	return [
		...commodities,
		{ yieldType: GDP_MONEY, amount: money, value: money, price: null },
	];
}

/**
 * One turn's GDP. The sum of `gdpComponents`, so the number a game page charts
 * and the number the indexer writes can't drift from the breakdown that
 * explains them — there is one arithmetic path, not three.
 */
export function gdpForTurn(
	turn: number,
	rateOf: (yieldType: string) => number | undefined,
	priceCurves: ReadonlyMap<string, number[]>,
): number {
	let total = 0;
	for (const c of gdpComponents(turn, rateOf, priceCurves)) total += c.value;
	return total;
}
