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
	COGNOMEN_LEGITIMACY,
	ORDERS_PER_LEGITIMACY,
	ORDERS_SOURCES,
} from "$lib/generated/orders-sources";
import { GOAL_NAMES } from "$lib/generated/goal-names";
import { formatEnum } from "$lib/utils/formatting";
import type {
	CharacterInfo,
	CharacterTraitInfo,
	PlayerGoalInfo,
} from "$lib/parser/types";
import type { PlayerLaw } from "$lib/types/PlayerLaw";

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

/** The player's rulers in reign order — the dynasty the legitimacy math walks. */
export function dynastyLeaders(
	characters: CharacterInfo[],
	playerId: number,
): CharacterInfo[] {
	return characters
		.filter((c) => c.player_xml_id === playerId && c.became_leader_turn != null)
		.sort((a, b) => (a.became_leader_turn ?? 0) - (b.became_leader_turn ?? 0));
}

// Same rendering rule as LeaderCard: names arrive as NAME_* tokens.
const characterLabel = (c: CharacterInfo): string => {
	const name = formatEnum(c.first_name ?? "", "NAME_") || `#${c.xml_id}`;
	return c.cognomen
		? `${name} the ${formatEnum(c.cognomen, "COGNOMEN_")}`
		: name;
};

// ─── Orders at end of game ────────────────────────────────────────────

export function ordersEndBreakdown(opts: {
	finalOrdersRate: number;
	finalLegitimacy: number | null;
	difficulty: string | null;
	/** The player's active laws at end (PlayerLaw.law, nulls skipped). */
	laws: PlayerLaw[];
	/** The final ruler, for the trait-granted orders. */
	ruler: CharacterInfo | null;
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
				label: `Difficulty (${formatEnum(opts.difficulty, "DIFFICULTY_")})`,
				value: v,
			});
		}
	}
	for (const l of opts.laws) {
		if (l.law == null) continue;
		const v = ORDERS_SOURCES[l.law];
		if (v != null) {
			rows.push({ label: formatEnum(l.law, "LAW_"), value: v });
		}
	}
	if (opts.ruler != null) {
		for (const t of opts.characterTraits) {
			if (t.character_xml_id !== opts.ruler.xml_id) continue;
			if (t.removed_turn != null) continue;
			const v = ORDERS_SOURCES[t.trait_name];
			if (v != null) {
				rows.push({
					label: `${formatEnum(t.trait_name, "TRAIT_")} (${characterLabel(opts.ruler)})`,
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

export function legitimacyEndBreakdown(opts: {
	finalLegitimacy: number;
	leaders: CharacterInfo[];
	/** The player's goals; completed ones price at AMBITION_LEGITIMACY. */
	goals: PlayerGoalInfo[];
}): EndBreakdown {
	const rows: SourceRow[] = [];

	// Dynasty cognomens: each ruler's cognomen divided by reign recency —
	// the current ruler counts in full, their predecessor at half, and so
	// on (integer division, exactly as Character.getLegitimacy does it).
	const n = opts.leaders.length;
	opts.leaders.forEach((c, i) => {
		if (!c.cognomen) return;
		const worth = COGNOMEN_LEGITIMACY[c.cognomen];
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
		rows.push({
			label: `Ambitions finished (${completed.length})`,
			value: completed.length * AMBITION_LEGITIMACY,
			detail: completed
				.map((g) => GOAL_NAMES[g.goal_type] ?? formatEnum(g.goal_type, "GOAL_"))
				.join(" · "),
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
