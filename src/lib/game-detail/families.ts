// Pure aggregation for the Families tab.
//
// Old World's families are a political system with an economic price tag: a
// family's opinion of its player sets an upkeep modifier on every city it
// holds, from +50% when furious to −20% when friendly. What lives here is the
// opinion series itself, the band an opinion falls in, and the tallies that
// turn a game's worth of opinions into "how well was this managed, and what
// did it cost".
//
// Kept out of the components so the shapes stay testable, and separate from
// economy.ts because the two tabs are separate.

import { FAMILY_OPINION_BANDS } from "$lib/generated/family-opinion";
import type { FamilyOpinionEntry } from "$lib/parser/types";
import { opinionBand, type DetailPlayer } from "./helpers";

/** One family's standing with its player, turn by turn. */
export interface FamilyOpinionSeries {
	playerId: number;
	/** FAMILY_* zType. */
	family: string;
	/** Sparse: only turns the save recorded, as [turn, opinion] pairs. */
	points: [number, number][];
}

/**
 * Each family's opinion of its player over the game.
 *
 * Paired with the upkeep view because the two are the same question from
 * either side: a family's improvements are what the empire pays to run, and
 * its opinion is what that footprint buys you politically. The save does
 * record this per turn, unlike the maintenance split itself — upkeep is a
 * single player-level number, and `iPerImprovement` alone reproduces barely a
 * fifth of it, so there is no honest way to divide the bill between families.
 */
export function familyOpinionSeries(
	history: FamilyOpinionEntry[],
	players: DetailPlayer[],
	finalTurn: number,
): FamilyOpinionSeries[] {
	const byKey = new Map<string, FamilyOpinionSeries>();
	const known = new Set(players.map((p) => p.playerId));
	for (const row of history) {
		if (!known.has(row.player_xml_id)) continue;
		if (row.turn < 0 || row.turn > finalTurn) continue;
		const key = `${row.player_xml_id}|${row.family_name}`;
		const series = byKey.get(key) ?? {
			playerId: row.player_xml_id,
			family: row.family_name,
			points: [],
		};
		series.points.push([row.turn, row.opinion]);
		byKey.set(key, series);
	}
	for (const series of byKey.values()) {
		series.points.sort((a, b) => a[0] - b[0]);
	}
	// Player order first (so a legend reads nation by nation), then family.
	const order = new Map(players.map((p, i) => [p.playerId, i]));
	return [...byKey.values()].sort(
		(a, b) =>
			(order.get(a.playerId) ?? 0) - (order.get(b.playerId) ?? 0) ||
			a.family.localeCompare(b.family),
	);
}

/** How a nation's — or one of its families' — turns fell across the bands. */
export interface OpinionBandTally {
	player: DetailPlayer;
	/** null on the nation's own row; the FAMILY_* zType on its family rows. */
	family: string | null;
	/** Band zType → turns spent there. */
	counts: Map<string, number>;
	/** Σ turns counted. On a nation row this sums its families. */
	familyTurns: number;
	/**
	 * Mean upkeep modifier across those turns, in percent — how expensive this
	 * family (or this nation's family management) made the empire. Negative is
	 * money saved.
	 */
	avgMaintenanceModifier: number;
	/**
	 * First turn the family appears, which is when its first city was founded.
	 * Families join at different times, so their rows are legitimately
	 * different lengths — a late family simply had fewer turns to spend.
	 */
	firstTurn: number | null;
}

function tally(
	player: DetailPlayer,
	family: string | null,
	points: [number, number][],
): OpinionBandTally {
	const counts = new Map<string, number>();
	let modifierSum = 0;
	for (const [, opinion] of points) {
		const band = opinionBand(opinion, FAMILY_OPINION_BANDS);
		counts.set(band.type, (counts.get(band.type) ?? 0) + 1);
		modifierSum += band.maintenanceModifier;
	}
	return {
		player,
		family,
		counts,
		familyTurns: points.length,
		avgMaintenanceModifier: points.length > 0 ? modifierSum / points.length : 0,
		firstTurn: points.length > 0 ? points[0][0] : null,
	};
}

/**
 * Tally turns by opinion band: one row per nation, followed by one per family
 * in the order the families entered play.
 *
 * A nation's row counts family-turns — one family on one turn — so three
 * families over 100 turns contribute ~300. That's the point: it measures how
 * much of the game a player kept their families out of trouble rather than
 * whether they ever dipped, and weighting by each band's upkeep modifier turns
 * the distribution into the cost it carried. The per-family rows underneath
 * show which family drove it.
 */
export function opinionBandTallies(
	series: FamilyOpinionSeries[],
	players: DetailPlayer[],
): OpinionBandTally[] {
	return players.flatMap((player) => {
		const mine = series.filter((s) => s.playerId === player.playerId);
		if (mine.length === 0) return [];
		const families = mine
			.map((s) => tally(player, s.family, s.points))
			// Founding order — the turn each family's first city landed.
			.sort((a, b) => (a.firstTurn ?? 0) - (b.firstTurn ?? 0));
		const nation = tally(
			player,
			null,
			mine.flatMap((s) => s.points),
		);
		// The nation row's firstTurn is its earliest family's, not a flattened
		// sort artefact.
		nation.firstTurn = families[0]?.firstTurn ?? null;
		return [nation, ...families];
	});
}
