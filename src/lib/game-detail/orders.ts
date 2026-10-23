// Orders & legitimacy itemization — the Orders tab's arithmetic, anchored on
// the game's own calculation and priced entirely from blob state plus the
// baked constants in $lib/generated/orders-sources.
//
// Orders/turn (Player.calculateNonCityYield): among its terms are
// `getLegitimacy() × ORDERS_PER_LEGITIMACY` — the coupling that makes
// legitimacy the game's action currency — and every active effectPlayer's
// flat orders rate, granted by the player's difficulty handicap, active laws,
// and the ruler's traits (ORDERS_SOURCES). What the blob can't reconstruct —
// council and court ratings, agents, trade, unit tolls (fortifying/improving
// units), events — lands in a SIGNED remainder against the save's true rate,
// so the row can go negative and never silently lies.
//
// Legitimacy (Player.getLegitimacy): an accumulated base — each finished
// ambition awards AMBITION_LEGITIMACY (legacy ambitions the smaller value,
// indistinguishable in the blob; the remainder absorbs the difference) —
// plus every past-and-present ruler's cognomen worth divided by reign
// recency (Character.getLegitimacy: miLegitimacy / (numLeaders − index),
// integer division). Events, bonuses, and the rare effect-granted
// legitimacy land in the remainder.

import {
	AMBITION_LEGITIMACY,
	ORDERS_PER_LEGITIMACY,
	ORDERS_SOURCES,
} from "$lib/generated/orders-sources";
import { COGNOMENS } from "$lib/generated/cognomens";
import { GOAL_NAMES } from "$lib/generated/goal-names";
import { prosperityName } from "$lib/map-settings";
import { rulerCognomen, rulerName, storyEventType } from "./helpers";
import { formatEnum, traitName } from "$lib/utils/formatting";
import type {
	CharacterInfo,
	CharacterTraitInfo,
	PlayerGoalInfo,
} from "$lib/parser/types";
import type { PlayerLaw } from "$lib/types/PlayerLaw";
import type { StoryEvent } from "$lib/types/StoryEvent";

export interface SourceRow {
	label: string;
	value: number;
	/** Optional secondary line under the label (e.g. an ambition's turn). */
	detail?: string;
}

export interface EndBreakdown {
	rows: SourceRow[];
	/** Signed remainder vs the true total — can be negative. */
	other: number;
	total: number;
}

// The dynasty's own label form: the ruler as the Leaders tab titles them,
// "Name the Cognomen" — an itemization row names a ruler in one line, where
// LeaderCard has two elements to style. The xml_id stands in for a ruler the
// save left unnamed, so the row still points at someone.
const characterLabel = (c: CharacterInfo): string => {
	const name = rulerName(c) ?? `#${c.xml_id}`;
	const cognomen = rulerCognomen(c);
	return cognomen ? `${name} ${cognomen}` : name;
};

// ─── Orders at end of game ────────────────────────────────────────────

export function ordersEndBreakdown(opts: {
	finalOrdersRate: number;
	finalLegitimacy: number | null;
	difficulty: string | null;
	/** The player's active laws at end of game. */
	laws: PlayerLaw[];
	/** The reigning ruler, for the trait-granted orders. */
	ruler: CharacterInfo | null;
	/**
	 * Every character's traits — the ruler's are picked out here. The save
	 * records acquisition but not removal, so a trait the ruler later lost is
	 * still priced; the signed remainder absorbs it.
	 */
	characterTraits: CharacterTraitInfo[];
}): EndBreakdown {
	const rows: SourceRow[] = [];

	if (opts.finalLegitimacy != null) {
		rows.push({
			label: "Legitimacy",
			value: opts.finalLegitimacy * ORDERS_PER_LEGITIMACY,
			detail: `${opts.finalLegitimacy} × ${ORDERS_PER_LEGITIMACY}`,
		});
	}
	if (opts.difficulty != null) {
		const v = ORDERS_SOURCES[opts.difficulty];
		if (v != null) {
			rows.push({
				label: `Prosperity (${prosperityName(opts.difficulty)})`,
				value: v,
			});
		}
	}
	for (const l of opts.laws) {
		const v = ORDERS_SOURCES[l.law];
		if (v != null) {
			rows.push({ label: formatEnum(l.law, "LAW_"), value: v });
		}
	}
	if (opts.ruler != null) {
		for (const t of opts.characterTraits) {
			if (t.character_xml_id !== opts.ruler.xml_id) continue;
			const v = ORDERS_SOURCES[t.trait_name];
			if (v != null) {
				rows.push({
					label: `${traitName(t.trait_name)} (${characterLabel(opts.ruler)})`,
					value: v,
				});
			}
		}
	}

	const itemized = rows.reduce((s, r) => s + r.value, 0);
	rows.sort((a, b) => b.value - a.value);
	return {
		rows,
		other: opts.finalOrdersRate - itemized,
		total: opts.finalOrdersRate,
	};
}

// ─── Legitimacy at end of game ────────────────────────────────────────

// Story-event names worth attributing a legitimacy jump to. Terminal
// bookkeeping events fire on the final turn of every game and explain
// nothing.
const EVENT_IGNORE = /VICTORY|GAME_LOSS|GAME_WIN/;

export function legitimacyEndBreakdown(opts: {
	finalLegitimacy: number;
	leaders: CharacterInfo[];
	/** The player's goals; completed ones price at AMBITION_LEGITIMACY. */
	goals: PlayerGoalInfo[];
	/** Per-turn legitimacy, for jump attribution. */
	series: { turn: number; legitimacy: number | null }[];
	/** The player's story events, matched to jumps by turn. */
	storyEvents: StoryEvent[];
}): EndBreakdown {
	const rows: SourceRow[] = [];

	// Dynasty cognomens: each ruler's cognomen divided by reign recency —
	// the current ruler counts in full, their predecessor at half, and so
	// on (integer division, exactly as Character.getLegitimacy does it).
	const n = opts.leaders.length;
	opts.leaders.forEach((c, i) => {
		if (!c.cognomen) return;
		const worth = COGNOMENS[c.cognomen]?.legitimacy;
		if (worth == null) return;
		const divisor = Math.max(1, n - i);
		const value = Math.trunc(worth / divisor);
		if (value === 0) return;
		rows.push({
			label: characterLabel(c),
			value,
			detail:
				divisor > 1 ? `${worth} ÷ ${divisor} (reigned earlier)` : `${worth}`,
		});
	});

	const completed = opts.goals.filter((g) => g.completed_turn != null);
	if (completed.length > 0) {
		// Constant label (count in the detail line), so the duel face-off
		// table merges both players' ambition rows even at different counts.
		rows.push({
			label: "Ambitions finished",
			value: completed.length * AMBITION_LEGITIMACY,
			detail: `${completed.length} × ${AMBITION_LEGITIMACY}: ${completed
				.map((g) => GOAL_NAMES[g.goal_type] ?? formatEnum(g.goal_type, "GOAL_"))
				.join(" · ")}`,
		});
	}

	// Event attribution: a legitimacy jump on a turn a story event fired for
	// this player is credited to the event by name — timing-based, so it's
	// labelled with its turn rather than presented as an exact price.
	// Succession turns are skipped (the dynasty term reshuffles and would
	// mislabel the reshuffle as an event), as are sub-2 jumps (noise).
	//
	// A jump is NOT netted against that turn's ambition completions: the save
	// records no completion turn, so a finished goal's `completed_turn` is its
	// START turn (a documented placeholder — see parsePlayerGoals in
	// parsers/player-data.ts). Subtracting there would deduct the award on the
	// turn the ambition was taken up, suppressing genuine event rows; an event
	// sharing a turn with a real completion over-claims by the award instead,
	// which the signed remainder nets out.
	const successionTurns = new Set(
		opts.leaders.map((c) => c.became_leader_turn),
	);
	const eventsByTurn = new Map<number, Set<string>>();
	for (const e of opts.storyEvents) {
		const name = storyEventType(e.event_type);
		if (name == null || EVENT_IGNORE.test(name)) continue;
		const set = eventsByTurn.get(e.occurred_turn) ?? new Set<string>();
		set.add(formatEnum(name, "EVENTSTORY_"));
		eventsByTurn.set(e.occurred_turn, set);
	}
	// An event can be credited on several turns, and a row per turn would
	// share its label with the others — a duplicate `{#each}` key, and a
	// silent merge in the duel face-off table, which collapses by label. One
	// row per event instead: the jumps summed, every turn named.
	const byLabel = new Map<string, { value: number; turns: number[] }>();
	const pts = opts.series.filter((d) => d.legitimacy != null);
	for (let i = 1; i < pts.length; i++) {
		const turn = pts[i].turn;
		if (successionTurns.has(turn)) continue;
		const jump = pts[i].legitimacy! - pts[i - 1].legitimacy!;
		const names = eventsByTurn.get(turn);
		if (jump < 2 || !names || names.size === 0) continue;
		const list = [...names];
		const label =
			list.length > 2
				? `${list.slice(0, 2).join(" + ")} +${list.length - 2} more`
				: list.join(" + ");
		const prev = byLabel.get(label);
		if (prev) {
			prev.value += jump;
			prev.turns.push(turn);
		} else {
			byLabel.set(label, { value: jump, turns: [turn] });
		}
	}
	for (const [label, e] of byLabel) {
		rows.push({
			label,
			value: e.value,
			detail:
				e.turns.length > 1
					? `events on turns ${e.turns.join(", ")}`
					: `event on turn ${e.turns[0]}`,
		});
	}

	const itemized = rows.reduce((s, r) => s + r.value, 0);
	rows.sort((a, b) => b.value - a.value);
	return {
		rows,
		other: opts.finalLegitimacy - itemized,
		total: opts.finalLegitimacy,
	};
}
