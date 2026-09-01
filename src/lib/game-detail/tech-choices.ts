// Pure derivation for the Techs tab's "Tech choices" card: how each tech a
// player holds came to them.
//
// Old World deals a hand of techs and the player takes one; the rest go back
// in the deck. The save records those draws in `Player.TechPathHistory`
// (blob `tech_choices`, parser 2.16.0+), one row per tech CHOSEN carrying the
// cards passed over with it.
//
// A tech a player holds with no row there was never drafted, and that split
// is the whole point of the card — but "not drafted" covers two different
// things, so it is reported as two:
//
//   starting  every Carthage player begins with Trapping, Divination and
//             Aristocracy (baked NATION_STARTING_TECHS). Says nothing about
//             how anyone played.
//   granted   everything else that arrived without a draw — a Sages family
//             seat's random tech, an event reward. This is the interesting
//             one, and the reason the card distinguishes them at all.
//
// The save records no TURN against a choice, so rows are dated by joining the
// player's completed techs; a tech with no completion turn sorts last in draw
// order. That join is also why an undrafted tech appears at all: the choice
// history alone would never mention it.

import { NATION_STARTING_TECHS } from "$lib/generated/starting-techs";
import type { PlayerTech } from "$lib/types/PlayerTech";
import type { TechChoiceInfo } from "$lib/parser/types";

/** How a player came to hold one tech. */
type TechOrigin = "drafted" | "starting" | "granted";

export type TechChoiceRow = {
	tech: string;
	origin: TechOrigin;
	// The cards passed over in the same draw — empty unless `drafted`.
	alternates: string[];
	// The turn the tech completed, when the blob knows it.
	turn: number | null;
};

/**
 * One player's techs, newest draw last, each with the hand it was picked
 * from. `choices` and `techs` should already be narrowed to this player.
 *
 * Returns an empty row list when the blob carries no choice history at all —
 * a save from an Old World build before it recorded one. Callers hide the
 * card in that case rather than showing every tech as "granted", which is
 * what an empty history would otherwise imply.
 */
export function techChoiceRows(
	choices: TechChoiceInfo[],
	techs: PlayerTech[],
	nation: string | null,
): TechChoiceRow[] {
	if (choices.length === 0) return [];
	const turnOf = new Map<string, number>();
	for (const t of techs) turnOf.set(t.tech, t.completed_turn);
	const starting = new Set(
		nation != null ? (NATION_STARTING_TECHS[nation] ?? []) : [],
	);

	const rows: TechChoiceRow[] = [];
	const drafted = new Set<string>();
	// Draw order first, so a tech with no completion turn keeps its place.
	for (const c of choices) {
		drafted.add(c.tech);
		rows.push({
			tech: c.tech,
			origin: "drafted",
			alternates: c.alternates,
			turn: turnOf.get(c.tech) ?? null,
		});
	}
	for (const t of techs) {
		if (drafted.has(t.tech)) continue;
		rows.push({
			tech: t.tech,
			origin: starting.has(t.tech) ? "starting" : "granted",
			alternates: [],
			turn: t.completed_turn,
		});
	}
	// Dated rows in turn order, undated ones after, each keeping draw order.
	return rows
		.map((row, i) => ({ row, i }))
		.sort((a, b) => {
			if (a.row.turn == null || b.row.turn == null) {
				if (a.row.turn !== b.row.turn) return a.row.turn == null ? 1 : -1;
				return a.i - b.i;
			}
			return a.row.turn - b.row.turn || a.i - b.i;
		})
		.map(({ row }) => row);
}
