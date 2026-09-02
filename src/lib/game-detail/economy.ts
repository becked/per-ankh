// Pure aggregation for the Economy tab.
//
// Two kinds of thing live here. The **ledger** prices a player's standing
// improvements in worker-turns: in Old World a worker parked on a tile adds one
// turn of progress per turn, so an improvement's build time IS what it cost the
// workforce. The baked IMPROVEMENT_BUILDS table supplies the price; an
// improvement absent from it was never worker-built (a captured tribal
// settlement, an event grant) and is counted separately as free.
//
// The **series** are the three empire curves the headline chart switches
// between. All three are end-state reconstructions — the save carries no
// per-turn improvement history — so each one's blind spot is documented at its
// builder rather than papered over.
//
// Everything here is a final-turn snapshot of the save, deliberately kept out
// of the component so the shapes stay testable.

import { IMPROVEMENT_BUILDS } from "$lib/generated/improvement-builds";
import {
	type GdpComponent,
	GDP_COMMODITIES,
	GDP_MONEY,
	gdpComponents,
	pricesByTurn,
} from "./gdp-basket";
import type { CityInfo } from "$lib/types/CityInfo";
import type { EventLog } from "$lib/types/EventLog";
import type { ImprovementInfo } from "$lib/types/ImprovementInfo";
import type { YieldHistory } from "$lib/types/YieldHistory";
import type {
	PlayerResourceInfo,
	TileOwnershipEntry,
	UnitInfo,
	YieldPriceEntry,
} from "$lib/parser/types";
import { stripMarkup } from "$lib/utils/formatting";
import { type DetailPlayer, ownedByPlayer } from "./helpers";

export const WORKER_UNIT = "UNIT_WORKER";

export type BuildKind = "rural" | "urban" | "wonder";

/** Worker-turns spent inside one family's cities. */
export interface FamilySpend {
	/** FAMILYCLASS_* zType; null for work outside any city's territory. */
	familyClass: string | null;
	turns: number;
	count: number;
}

/** One player's worker-turn ledger, as a final-turn snapshot. */
export interface PlayerEconomy {
	player: DetailPlayer;
	/** Standing improvements a worker built. */
	builtCount: number;
	/** Standing improvements nobody worked for (captured sites, event grants). */
	freeCount: number;
	/** Σ base build turns over `builtCount`. */
	workerTurns: number;
	/** Worker-turns split rural / urban / wonder. */
	byKind: Record<BuildKind, number>;
	/** Improvements built, split the same way. */
	countByKind: Record<BuildKind, number>;
	/** Descending by turns. */
	byFamily: FamilySpend[];
	/** Workers this player built that survived to the final turn. */
	workersBuilt: number;
	/** Workers taken off someone else and still held at the end. */
	workersCaptured: number;
}

/**
 * Price every player's standing improvements in worker-turns, split rural /
 * urban / wonder by both cost and count.
 *
 * There is deliberately no utilization ratio here. Setting this against the
 * workforce's turns alive compares two different populations — work by workers
 * that later died counts in the numerator while their time doesn't count in
 * the denominator, and captured improvements count for a workforce that never
 * built them — which is why real games came out over 100%.
 */
export function playerEconomies(
	players: DetailPlayer[],
	improvements: ImprovementInfo[],
	cities: CityInfo[],
	units: UnitInfo[],
): PlayerEconomy[] {
	// A city's family class attributes the work done inside its territory. The
	// current owner's family is the right one: we only price improvements the
	// player still holds, so the city holding them is theirs too.
	const familyByCity = new Map(
		cities.map((c) => [c.city_name, c.family_class]),
	);

	return players.map((player) => {
		const owned = ownedByPlayer(
			improvements,
			player,
			(imp) => imp.owner_player_xml_id,
			(imp) => imp.nation,
		);

		const byKind: Record<BuildKind, number> = { rural: 0, urban: 0, wonder: 0 };
		const countByKind: Record<BuildKind, number> = {
			rural: 0,
			urban: 0,
			wonder: 0,
		};
		const families = new Map<string | null, FamilySpend>();
		let builtCount = 0;
		let freeCount = 0;
		let workerTurns = 0;

		for (const imp of owned) {
			const build = IMPROVEMENT_BUILDS[imp.improvement];
			if (build == null) {
				freeCount += 1;
				continue;
			}
			const turns = build.turns;
			builtCount += 1;
			workerTurns += turns;
			byKind[build.kind] += turns;
			countByKind[build.kind] += 1;

			// city_name is null for improvements outside any city's territory
			// (border forts, roads to nowhere) — a real bucket, kept as null.
			const familyClass =
				imp.city_name != null
					? (familyByCity.get(imp.city_name) ?? null)
					: null;
			const fam = families.get(familyClass) ?? {
				familyClass,
				turns: 0,
				count: 0,
			};
			fam.turns += turns;
			fam.count += 1;
			families.set(familyClass, fam);
		}

		// The ending roster only holds live units, so these counts are what
		// survived — see `workerSeries` for the same caveat on the curve.
		const workers = units.filter(
			(u) => u.unit_type === WORKER_UNIT && u.player_xml_id === player.playerId,
		);
		const own = workers.filter(
			(u) =>
				u.original_player_xml_id == null ||
				u.original_player_xml_id === player.playerId,
		);

		return {
			player,
			builtCount,
			freeCount,
			workerTurns,
			byKind,
			countByKind,
			byFamily: [...families.values()].sort((a, b) => b.turns - a.turns),
			workersBuilt: own.length,
			workersCaptured: workers.length - own.length,
		};
	});
}

// ─── Calamities ───────────────────────────────────────────────────────

/** A plague, flood, wildfire — an occurrence that hit someone's economy. */
export interface Calamity {
	turn: number;
	/** OCCURRENCE_* zType. */
	occurrence: string;
	/**
	 * xml_ids of every realm that logged the occurrence — a plague the whole
	 * world caught carries them all. Absent below PARSER_VERSION 2.14.0.
	 */
	playerXmlIds?: number[];
	/**
	 * The save's player_name: the legacy attribution key, kept for blobs below
	 * 2.14.0. Null once the log row grouped more than one realm's copy.
	 */
	playerName: string | null;
	/** The log line, markup stripped. */
	description: string;
}

// The occurrence's zType only survives in the log line's help link — the
// event log carries no typed field for it. Character events share the
// OCCURRENCE log type and have no such link, which is what filters them out.
const OCCURRENCE_LINK = /HELP_OCCURRENCE,(OCCURRENCE_\w+)/;

/**
 * Calamities from the event log. Old World files these under the OCCURRENCE
 * log type alongside unrelated character notices, so the help link is the
 * discriminator as well as the type source.
 */
export function calamities(logs: EventLog[]): Calamity[] {
	const out: Calamity[] = [];
	for (const log of logs) {
		if (log.log_type !== "OCCURRENCE") continue;
		const match = OCCURRENCE_LINK.exec(log.description ?? "");
		if (match == null) continue;
		out.push({
			turn: log.turn,
			occurrence: match[1],
			playerXmlIds: log.player_xml_ids,
			playerName: log.player_name,
			description: stripMarkup(log.description),
		});
	}
	return out.sort((a, b) => a.turn - b.turn);
}

/** One player's step curve: cumulative value at each turn, 0..finalTurn. */
export interface EmpireSeries {
	playerId: number;
	/** Index is the turn, so `data[t]` is the value on turn t. */
	data: number[];
}

// ─── GDP ──────────────────────────────────────────────────────────────
//
// What the basket IS, what a price means, and what a turn is worth all live in
// gdp-basket.ts, because the Worker's D1 indexer prices the same basket when
// it writes game_player_turn.gdp_per_turn and the two must not drift. What
// stays here is the charting: per-player curves and the breakdown the tooltip
// reads.

/**
 * Upkeep. NOT a GDP term: yield.xml files YIELD_MAINTENANCE with
 * `<SubtractFromYield>YIELD_MONEY</SubtractFromYield>`, so the money rate GDP
 * already reads is net of it. Charting it separately shows the bill; taking it
 * off GDP would charge it twice.
 */
export const YIELD_MAINTENANCE = "YIELD_MAINTENANCE";

/**
 * One turn of one player's GDP: the total, and what each basket item paid.
 * Commodities come first, richest first, with money last — money is the unit
 * everything else is converted into, so it reads as the final line.
 */
export interface GdpBreakdown {
	total: number;
	components: GdpComponent[];
}

export interface GdpSeries extends EmpireSeries {
	/** Index-aligned to `data` — `breakdown[t]` explains `data[t]`. */
	breakdown: GdpBreakdown[];
}

/**
 * Gross domestic product: money income plus each commodity's income valued at
 * that turn's market price. One number for the whole economy — the thing all
 * the yield charts are separately about.
 *
 * It is an income measure, not a stockpile: a player sitting on 500 stone they
 * never spend shows the same GDP as one who spends it the turn it lands.
 * Turns with no recorded rate contribute nothing rather than being
 * interpolated, so the curve starts where the save's history does.
 */
export function gdpSeries(
	allYields: YieldHistory[],
	prices: YieldPriceEntry[],
	players: DetailPlayer[],
	finalTurn: number,
): GdpSeries[] {
	const priceCurves = pricesByTurn(prices, finalTurn);

	return players.map((player) => {
		// yield type → turn → rate, for the basket only.
		const rates = new Map<string, Map<number, number>>();
		for (const series of allYields) {
			if (series.player_id !== player.playerId) continue;
			if (
				series.yield_type !== GDP_MONEY &&
				!GDP_COMMODITIES.some((c) => c === series.yield_type)
			) {
				continue;
			}
			const byTurn = new Map<number, number>();
			for (const point of series.data) {
				if (point.rate != null) byTurn.set(point.turn, point.rate);
			}
			rates.set(series.yield_type, byTurn);
		}

		const data = new Array<number>(finalTurn + 1).fill(0);
		const breakdown: GdpBreakdown[] = [];
		for (let t = 0; t <= finalTurn; t++) {
			const components = gdpComponents(
				t,
				(y) => rates.get(y)?.get(t),
				priceCurves,
			);
			const total = components.reduce((sum, c) => sum + c.value, 0);
			data[t] = total;
			breakdown.push({ total, components });
		}
		return { playerId: player.playerId, data, breakdown };
	});
}

/**
 * One yield's per-turn rate as a curve, for the views that plot a single
 * yield rather than the GDP basket (maintenance, so far).
 */
export function yieldRateSeries(
	allYields: YieldHistory[],
	yieldType: string,
	players: DetailPlayer[],
	finalTurn: number,
): EmpireSeries[] {
	return players.map((player) => {
		const data = new Array<number>(finalTurn + 1).fill(0);
		for (const series of allYields) {
			if (series.player_id !== player.playerId) continue;
			if (series.yield_type !== yieldType) continue;
			for (const point of series.data) {
				if (point.rate == null) continue;
				if (point.turn < 0 || point.turn > finalTurn) continue;
				data[point.turn] = point.rate;
			}
		}
		return { playerId: player.playerId, data };
	});
}

// ─── National wealth ──────────────────────────────────────────────────

// Stockpiles are stored at the same ×10 fixed point as every other yield
// quantity in the save.
const STOCKPILE_SCALE = 10;

/** What one player was sitting on at the final turn, priced. */
export interface NationalWealth {
	player: DetailPlayer;
	/** Same shape as a GDP turn, so the two read alike. */
	components: GdpComponent[];
	total: number;
}

/**
 * End-of-game wealth: the stockpiles themselves, valued at the final turn's
 * market price — the counterpart to GDP's income view.
 *
 * A snapshot, not a curve: the save records `YieldStockpile` only for the
 * final turn (there is no YieldStockpileHistory), so wealth over time simply
 * isn't recoverable. Restricted to the GDP basket — civics, training and
 * science stockpile too, but the game runs no market in them, so there's no
 * money figure to put against them.
 */
export function nationalWealth(
	resources: PlayerResourceInfo[],
	prices: YieldPriceEntry[],
	players: DetailPlayer[],
	finalTurn: number,
): NationalWealth[] {
	const priceCurves = pricesByTurn(prices, finalTurn);

	return players.map((player) => {
		const held = new Map<string, number>();
		for (const row of resources) {
			if (row.player_xml_id !== player.playerId) continue;
			held.set(row.yield_type, row.amount / STOCKPILE_SCALE);
		}

		// The same basket, priced the same way — what differs is only what is
		// being priced: a stockpile held at the final turn rather than a turn's
		// income. Pricing it here a second time is how the two would drift.
		const components = gdpComponents(
			finalTurn,
			(y) => held.get(y),
			priceCurves,
		);
		const total = components.reduce((sum, c) => sum + c.value, 0);
		return { player, components, total };
	});
}

/** Accumulate per-turn deltas into a cumulative curve indexed by turn. */
function cumulative(deltas: number[], finalTurn: number): number[] {
	const out = new Array<number>(finalTurn + 1).fill(0);
	for (let t = 0; t <= finalTurn; t++) {
		out[t] = (t > 0 ? out[t - 1] : 0) + (deltas[t] ?? 0);
	}
	return out;
}

/**
 * Tiles held, turn by turn. `tile_ownership_history` records every change of
 * ownership, so a tile counts for its owner from the turn they took it until
 * the turn someone else does — losses included, unlike the other two curves.
 */
export function territorySeries(
	history: TileOwnershipEntry[],
	players: DetailPlayer[],
	finalTurn: number,
): EmpireSeries[] {
	// Per tile, its ownership changes in turn order, so each stretch of
	// ownership is one entry to the next.
	const byTile = new Map<number, TileOwnershipEntry[]>();
	for (const entry of history) {
		const rows = byTile.get(entry.tile_xml_id) ?? [];
		rows.push(entry);
		byTile.set(entry.tile_xml_id, rows);
	}

	const deltas = new Map<number, number[]>(
		players.map((p) => [p.playerId, new Array<number>(finalTurn + 2).fill(0)]),
	);
	for (const rows of byTile.values()) {
		rows.sort((a, b) => a.turn - b.turn);
		for (let i = 0; i < rows.length; i++) {
			const owner = rows[i].owner_player_xml_id;
			if (owner == null) continue;
			const d = deltas.get(owner);
			if (d == null) continue;
			const from = Math.max(0, Math.min(rows[i].turn, finalTurn + 1));
			// Held until the next change, or to the end of the game.
			const until = Math.min(rows[i + 1]?.turn ?? finalTurn + 1, finalTurn + 1);
			d[from] += 1;
			if (until <= finalTurn) d[until] -= 1;
		}
	}

	return players.map((p) => ({
		playerId: p.playerId,
		data: cumulative(deltas.get(p.playerId) ?? [], finalTurn),
	}));
}

/**
 * Cities founded, turn by turn. Attributed to the founder and never
 * transferred: the save timestamps a city's founding but not its captures, so
 * this is "cities this player put on the map", not cities held.
 */
export function citiesFoundedSeries(
	cities: CityInfo[],
	players: DetailPlayer[],
	finalTurn: number,
): EmpireSeries[] {
	const deltas = new Map<number, number[]>(
		players.map((p) => [p.playerId, new Array<number>(finalTurn + 2).fill(0)]),
	);
	for (const city of cities) {
		if (city.first_owner_player_xml_id == null) continue;
		const d = deltas.get(city.first_owner_player_xml_id);
		if (d == null) continue;
		d[Math.max(0, Math.min(city.founded_turn, finalTurn))] += 1;
	}
	return players.map((p) => ({
		playerId: p.playerId,
		data: cumulative(deltas.get(p.playerId) ?? [], finalTurn),
	}));
}

/**
 * Workers built, turn by turn, counting only workers the player built
 * themselves (a captured worker is the other side's training spend).
 *
 * The save's unit roster is the living army, so a worker killed or captured
 * mid-game leaves no trace: the curve is what survived, plotted at its birth
 * turn, and so never dips. `unitsProduced` carries the true build count — the
 * tab shows both when they disagree rather than implying this curve is
 * complete.
 */
export function workerSeries(
	units: UnitInfo[],
	players: DetailPlayer[],
	finalTurn: number,
): EmpireSeries[] {
	const deltas = new Map<number, number[]>(
		players.map((p) => [p.playerId, new Array<number>(finalTurn + 2).fill(0)]),
	);
	for (const unit of units) {
		if (unit.unit_type !== WORKER_UNIT) continue;
		if (unit.create_turn == null) continue;
		const builder = unit.original_player_xml_id ?? unit.player_xml_id;
		if (builder == null) continue;
		const d = deltas.get(builder);
		if (d == null) continue;
		d[Math.max(0, Math.min(unit.create_turn, finalTurn))] += 1;
	}
	return players.map((p) => ({
		playerId: p.playerId,
		data: cumulative(deltas.get(p.playerId) ?? [], finalTurn),
	}));
}
