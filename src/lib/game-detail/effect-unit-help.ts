// The game's own help text for one effect unit a general confers, ported from
// `HelpText.buildEffectUnitHelp` (HelpText.Unit.cs:747).
//
// `buildMakeGeneralLine` (HelpText.cs:4579) calls that function once per
// trait-direct effect unit with `bSkipIcons: true` and `bRightJustify` left
// false, so this port is of that call and not of the function in general:
//
//   bSkipIcons      drops the five leading blocks (strength, attack, defense,
//                   critical, movement), because the line folds those columns
//                   into its own totals instead — `unit-general.ts` does that
//                   half. So this module renders no bare stat row.
//   bRightJustify   false, which is what picks the `<false>` branch of every
//                   `<true_N>Label: {value}<false>{value} Label<end>` template.
//   bLine           true on `LEADER_GENERAL_EFFECTUNIT` alone, which suppresses
//                   the immune-list clause — the only entry in the closure that
//                   carries `aeEffectUnitImmune`. There is no clause for it here.
//   bEncyclopedia   false: no unit roster, no eligibility list.
//
// `bIncludeIndirect` keeps its default true, which is why an adjacency aura
// shows up as its parent's `[Adjacent Units] <name>` row rather than as rows of
// its own.
//
// WHAT THE CLAUSES ARE. One per `effectUnit.xml` column that the closure
// actually carries, and `scripts/bake-effect-units.ts` throws on a column no
// clause here covers — so this list is complete for what the baked table can
// hold, and a game patch that pays a general through some new column fails the
// bake rather than rendering nothing.
//
// TWO DEGRADATIONS, both where they are visible rather than in a caveat:
//
//   link(CONCEPT_X)  flattens to the concept's own name. There is no concept
//                    encyclopedia here to link to, and the name has to be the
//                    game's: CONCEPT_ZOC is "ZOC" where formatEnum gives "Zoc".
//   HUD glyphs       `buildAttackValueLinkVariable` and its siblings
//                    (HelpText.Game.cs:383, :674, HelpText.Unit.cs:114,
//                    HelpText.Game.cs:1756) print a signed value beside an
//                    inline `HUDIconTypes` glyph — ATTACK, DEFENSE,
//                    ATTACKDEFENSE, RANGE — and `SPRITE_MANIFEST` carries none
//                    of the four. For the first three the value prints alone,
//                    because the clause around it already names what it
//                    modifies. RANGE has no such clause — the glyph IS the
//                    word — so there the concept's name takes the glyph's
//                    place. The yield glyph in the kill-yield clause IS in the
//                    manifest, which is why that one clause yields a sprite
//                    segment.

import type { SpriteCategory } from "./helpers";
import {
	EFFECT_UNIT_CONCEPT_NAMES,
	EFFECT_UNIT_HELP_TEXT,
	type GeneralEffectUnit,
} from "$lib/generated/effect-units";

/**
 * A piece of one rendered line. The game's `TextVariable` is a tree of text
 * and inline icons, so a line is a sequence rather than a string — a sprite
 * can't be spelled inside one.
 */
export type HelpSegment =
	| { readonly kind: "text"; readonly text: string }
	| {
			readonly kind: "sprite";
			readonly category: SpriteCategory;
			readonly value: string;
			/** The game's name for the thing, for the glyph's accessible name. */
			readonly alt: string;
	  };

/** One line of help text — one `builder.Add` in the C#. */
export type HelpLine = readonly HelpSegment[];

/**
 * A template argument. The object form carries both the rendered segments and
 * the number behind them, because `{singular_N:One:Many}` asks a value that
 * `{N_value}` has already rendered how big it is.
 */
type HelpArg =
	| boolean
	| number
	| string
	| { readonly segments: HelpLine; readonly count?: number };

/**
 * `bRightJustify`, which `buildMakeGeneralLine` leaves false. Named because it
 * is a real argument of every tile and modifier clause, not a constant of
 * convenience: flipping it swaps "Label: +10%" for "+10% Label".
 */
const RIGHT_JUSTIFY = false;

// ─── The template renderer ───────────────────────────────────────────────

function truthy(arg: HelpArg | undefined): boolean {
	if (arg == null) return false;
	if (typeof arg === "boolean") return arg;
	if (typeof arg === "number") return arg !== 0;
	if (typeof arg === "string") return arg !== "";
	return arg.count != null ? arg.count !== 0 : arg.segments.length > 0;
}

/** The number behind an argument, for `{singular_N:…}`. NaN when it has none. */
function countOf(arg: HelpArg | undefined): number {
	if (typeof arg === "number") return arg;
	if (arg != null && typeof arg === "object") return arg.count ?? Number.NaN;
	return Number.NaN;
}

function segmentsOf(arg: HelpArg | undefined): HelpLine {
	if (arg == null || typeof arg === "boolean") return [];
	if (typeof arg === "object") return arg.segments;
	return [{ kind: "text", text: String(arg) }];
}

/**
 * Expand `{<kind>_<index>:branch[:branch]}` in place. Brace-counted rather
 * than matched by regex, because a branch can hold another substitution —
 * `{true_1: at {0_percent}%}` is one of the templates in the table.
 */
function expandInline(
	body: string,
	kind: string,
	pick: (index: number, branches: readonly string[]) => string,
): string {
	const open = `{${kind}_`;
	let out = "";
	let cursor = 0;
	for (;;) {
		const start = body.indexOf(open, cursor);
		if (start === -1) {
			out += body.slice(cursor);
			return out;
		}
		const digitsStart = start + open.length;
		let colon = digitsStart;
		while (colon < body.length && body[colon] >= "0" && body[colon] <= "9") {
			colon += 1;
		}
		if (colon === digitsStart || body[colon] !== ":") {
			// Not this construct after all — e.g. `{true_x}`. Copy and move on.
			out += body.slice(cursor, digitsStart);
			cursor = digitsStart;
			continue;
		}
		const index = Number.parseInt(body.slice(digitsStart, colon), 10);
		// Scan to the matching close brace, splitting the top-level branches.
		const branches: string[] = [];
		let branch = "";
		let depth = 0;
		let at = colon + 1;
		let closed = false;
		for (; at < body.length; at += 1) {
			const char = body[at];
			if (char === "{") depth += 1;
			else if (char === "}") {
				if (depth === 0) {
					closed = true;
					break;
				}
				depth -= 1;
			} else if (char === ":" && depth === 0) {
				branches.push(branch);
				branch = "";
				continue;
			}
			branch += char;
		}
		if (!closed) {
			// Unbalanced template: leave it verbatim rather than guessing.
			out += body.slice(cursor);
			return out;
		}
		branches.push(branch);
		out += body.slice(cursor, start) + pick(index, branches);
		cursor = at + 1;
	}
}

/** Merge touching text, squeeze the gaps an empty branch leaves, trim. */
function normalise(segments: HelpLine): HelpLine {
	const merged: HelpSegment[] = [];
	for (const segment of segments) {
		const last = merged[merged.length - 1];
		if (segment.kind === "text" && last?.kind === "text") {
			merged[merged.length - 1] = {
				kind: "text",
				text: last.text + segment.text,
			};
		} else {
			merged.push(segment);
		}
	}
	const squeezed = merged.map((segment) =>
		segment.kind === "text"
			? // Plain spaces only: the NBSP the yield clause inserts is content.
				{ kind: "text" as const, text: segment.text.replace(/ {2,}/g, " ") }
			: segment,
	);
	const first = squeezed[0];
	if (first?.kind === "text") {
		squeezed[0] = { kind: "text", text: first.text.replace(/^ +/, "") };
	}
	const last = squeezed[squeezed.length - 1];
	if (last?.kind === "text") {
		squeezed[squeezed.length - 1] = {
			kind: "text",
			text: last.text.replace(/ +$/, ""),
		};
	}
	return squeezed.filter((s) => s.kind !== "text" || s.text !== "");
}

/** Render one `TEXT_*` template against its positional arguments. */
function render(key: string, ...args: HelpArg[]): HelpLine {
	const template = EFFECT_UNIT_HELP_TEXT[key];
	// A key the bake didn't emit can only mean the table and this module have
	// drifted apart; render nothing rather than the key.
	if (template == null) return [];

	let body = template.replace(
		/<true_(\d+)>([\s\S]*?)<false>([\s\S]*?)<end>/g,
		(_, index: string, then: string, otherwise: string) =>
			truthy(args[Number(index)]) ? then : otherwise,
	);
	body = expandInline(
		body,
		"true",
		(index, branches) =>
			(truthy(args[index]) ? branches[0] : branches[1]) ?? "",
	);
	body = expandInline(
		body,
		"singular",
		(index, branches) =>
			(Math.abs(countOf(args[index])) === 1 ? branches[0] : branches[1]) ?? "",
	);
	body = body.replace(
		/link\((CONCEPT_[A-Z0-9_]+)(?:,[^)]*)?\)/g,
		(whole, concept: string) => EFFECT_UNIT_CONCEPT_NAMES[concept] ?? whole,
	);
	// `<NBSP>` is content; every other Unity tag is presentation.
	body = body.replace(/<NBSP>/g, " ").replace(/<[^>]*>/g, "");
	body = body.replace(/\{gt\}/g, ">");

	const out: HelpSegment[] = [];
	let cursor = 0;
	for (const match of body.matchAll(/\{(\d+)(?:_[A-Za-z]+)?\}/g)) {
		const at = match.index;
		if (at > cursor) {
			out.push({ kind: "text", text: body.slice(cursor, at) });
		}
		out.push(...segmentsOf(args[Number(match[1])]));
		cursor = at + match[0].length;
	}
	if (cursor < body.length) {
		out.push({ kind: "text", text: body.slice(cursor) });
	}
	return normalise(out);
}

// ─── The value variables the clauses pass ────────────────────────────────

/** `buildSignedTextVariable` (HelpText.cs:1352). */
function signed(value: number, percent = false): HelpArg {
	return {
		segments: render("TEXT_HELPTEXT_SIGNED_VALUE", value >= 0, value, percent),
		count: value,
	};
}

/**
 * The strength / attack / defense value variables, which all print
 * `buildSignedTextVariable(iValue, true)` beside a HUD glyph the manifest does
 * not carry — so the percent alone.
 */
function statValue(value: number): HelpArg {
	return signed(value, true);
}

/** `buildYieldValueIconLinkVariable` (HelpText.Game.cs:2661), `bRate: true`. */
function yieldValue(yieldType: string, name: string, value: number): HelpArg {
	return {
		segments: render("TEXT_HELPTEXT_CONCAT_SPACE_TWO_NBSP", signed(value), {
			segments: [
				{ kind: "sprite", category: "yields", value: yieldType, alt: name },
			],
		}),
		count: value,
	};
}

/** `buildTurnScaleName(pGame, iCount)` with no game (HelpText.Game.cs:22). */
function turnScale(count: number): HelpArg {
	return { segments: render("TEXT_HELPTEXT_TURN", count), count };
}

/** A concept link the clause passes as an argument rather than as template text. */
function conceptLink(concept: string): HelpArg {
	return EFFECT_UNIT_CONCEPT_NAMES[concept] ?? concept;
}

/** A comma list, the shape `CommaListVariableGenerator(ListType.NONE)` prints. */
function commaList(names: readonly string[]): HelpArg {
	return names.join(", ");
}

// ─── The clauses ─────────────────────────────────────────────────────────

/**
 * Every line `buildEffectUnitHelp` would print for `effect` at the general
 * line's call site, in the function's own order.
 *
 * Call it only for an entry whose `direct` is true: the game calls
 * `buildEffectUnitHelp` on the trait's own effect unit, never on one reached
 * through `AdjacentEffectUnit`, whose contribution is its parent's
 * `[Adjacent Units]` row.
 */
export function effectUnitHelpLines(effect: GeneralEffectUnit): HelpLine[] {
	const lines: HelpLine[] = [];
	const add = (line: HelpLine): void => {
		if (line.length > 0) lines.push(line);
	};

	if (effect.fatigueExtra != null) {
		add(
			render(
				"TEXT_HELPTEXT_EFFECT_UNIT_HELP_FATIGUE_LIMIT",
				signed(effect.fatigueExtra),
				RIGHT_JUSTIFY,
			),
		);
	}
	if (effect.visionExtra != null) {
		add(
			render(
				"TEXT_HELPTEXT_EFFECT_UNIT_HELP_VISION",
				signed(effect.visionExtra),
				RIGHT_JUSTIFY,
			),
		);
	}
	if (effect.revealExtra != null) {
		add(
			render(
				"TEXT_HELPTEXT_EFFECT_UNIT_HELP_REVEAL",
				signed(effect.revealExtra),
				RIGHT_JUSTIFY,
			),
		);
	}
	if (effect.rangeExtra != null) {
		// `buildRangeLinkVariable` (HelpText.Game.cs:1756) concatenates the
		// signed value — NOT a percent, unlike the modifier clauses — with the
		// RANGE HUD glyph through `TEXT_HELPTEXT_CONCAT_SPACE_TWO`. That glyph
		// is where the game says the word "range", and `SPRITE_MANIFEST`
		// carries none of the HUD icons, so the concept's own name stands in
		// for it: the same degradation `link(CONCEPT_X)` takes, and without it
		// the row is a bare "+1" that names nothing.
		add(
			render(
				"TEXT_HELPTEXT_CONCAT_SPACE_TWO",
				signed(effect.rangeExtra),
				conceptLink("CONCEPT_RANGE"),
			),
		);
	}
	if (effect.actionsExtra != null) {
		add(
			render(
				"TEXT_HELPTEXT_UNIT_FREE_ACTIONS",
				signed(effect.actionsExtra),
				RIGHT_JUSTIFY,
			),
		);
	}
	if (effect.homeModifier != null) {
		add(
			render(
				"TEXT_HELPTEXT_EFFECT_UNIT_HELP_HOME_MODIFIER",
				statValue(effect.homeModifier),
				RIGHT_JUSTIFY,
			),
		);
	}
	if (effect.connectedAttackModifier != null) {
		add(
			render(
				"TEXT_HELPTEXT_EFFECT_UNIT_HELP_ATTACK_INTO",
				// `buildConnectedLinkVariable` (HelpText.Game.cs:473) is its own
				// template rather than a concept: a glyph the manifest lacks, then
				// the word, which `bText` keeps.
				{ segments: render("TEXT_HELPTEXT_LINK_CONNECTED", "", true) },
				statValue(effect.connectedAttackModifier),
				RIGHT_JUSTIFY,
			),
		);
	}
	if (effect.urbanAttackModifier != null) {
		add(
			render(
				"TEXT_HELPTEXT_EFFECT_UNIT_HELP_ATTACK_INTO",
				conceptLink("CONCEPT_URBAN"),
				statValue(effect.urbanAttackModifier),
				RIGHT_JUSTIFY,
			),
		);
	}
	if (effect.damagedUsModifier != null) {
		add(
			render(
				"TEXT_HELPTEXT_EFFECT_UNIT_HELP_IF_DAMAGED",
				statValue(effect.damagedUsModifier),
				RIGHT_JUSTIFY,
			),
		);
	}
	if (effect.damagedThemModifier != null) {
		add(
			render(
				"TEXT_HELPTEXT_EFFECT_UNIT_HELP_VS_DAMAGED",
				statValue(effect.damagedThemModifier),
				RIGHT_JUSTIFY,
			),
		);
	}
	if (effect.vsGeneralModifier != null) {
		add(
			render(
				"TEXT_HELPTEXT_EFFECT_UNIT_HELP_VS_GENERAL",
				statValue(effect.vsGeneralModifier),
				RIGHT_JUSTIFY,
			),
		);
	}
	if (effect.flankingAttackModifier != null) {
		add(
			render(
				"TEXT_HELPTEXT_EFFECT_UNIT_HELP_FLANKING_ATTACK",
				statValue(effect.flankingAttackModifier),
				RIGHT_JUSTIFY,
			),
		);
	}
	if (effect.adjacentSameModifier != null) {
		add(
			render(
				"TEXT_HELPTEXT_EFFECT_UNIT_HELP_SAME_UNIT_ADJACENT",
				statValue(effect.adjacentSameModifier),
				RIGHT_JUSTIFY,
			),
		);
	}
	if (effect.healExtra != null) {
		add(
			render(
				"TEXT_HELPTEXT_EFFECT_UNIT_HELP_HEAL_EXTRA",
				signed(effect.healExtra),
				RIGHT_JUSTIFY,
			),
		);
	}
	if (effect.zoc) {
		add(render("TEXT_HELPTEXT_UNIT_TYPE_HAS_ZOC", conceptLink("CONCEPT_ZOC")));
	}
	if (effect.rout) add(render("TEXT_HELPTEXT_EFFECT_UNIT_HELP_CAN_ROUT"));
	if (effect.stun) add(render("TEXT_HELPTEXT_EFFECT_UNIT_HELP_STUN"));
	if (effect.lastStand) {
		add(render("TEXT_HELPTEXT_EFFECT_UNIT_HELP_LAST_STAND"));
	}
	if (effect.meleeCounterPercent != null) {
		// The percent is only spoken when it isn't 100 — a full counterattack
		// reads as the plain sentence.
		add(
			render(
				"TEXT_HELPTEXT_EFFECT_UNIT_HELP_MELEE_COUNTER",
				effect.meleeCounterPercent,
				effect.meleeCounterPercent !== 100,
			),
		);
	}
	if (effect.criticalImmune) {
		add(render("TEXT_HELPTEXT_EFFECT_UNIT_HELP_CRITICAL_IMMUNE"));
	}
	if (effect.healKill) {
		add(render("TEXT_HELPTEXT_EFFECT_UNIT_HELP_HEAL_KILL"));
	}
	if (effect.healNeutral) {
		add(render("TEXT_HELPTEXT_EFFECT_UNIT_HELP_HEAL_NEUTRAL"));
	}
	if (effect.launchOffensive) {
		add(
			render("TEXT_HELPTEXT_EFFECT_UNIT_HELP_LAUNCH_OFFENSIVE", {
				segments: render("TEXT_HELPTEXT_LINK_LAUNCH_OFFENSIVE"),
			}),
		);
	}
	if (effect.generalHopping) {
		add(render("TEXT_HELPTEXT_EFFECT_UNIT_HELP_GENERAL_HOPPING"));
	}
	if (effect.buildRoad) {
		add(render("TEXT_HELPTEXT_EFFECT_UNIT_HELP_BUILD_ROAD"));
	}
	for (const group of effect.fightFrom ?? []) {
		add(
			render(
				"TEXT_HELPTEXT_EFFECT_UNIT_HELP_FIGHT_FROM",
				commaList(group.names),
				statValue(group.value),
				RIGHT_JUSTIFY,
			),
		);
	}
	for (const group of effect.vsUnitTrait ?? []) {
		// All three columns share one template; the value variable is what
		// differs, and only the strength one is a unit-strength percent.
		add(
			render(
				"TEXT_HELPTEXT_EFFECT_UNIT_HELP_VS_UNIT_TRAIT",
				commaList(group.names),
				statValue(group.value),
				RIGHT_JUSTIFY,
			),
		);
	}
	for (const paid of effect.militaryKillYield ?? []) {
		add(
			render(
				"TEXT_HELPTEXT_EFFECT_UNIT_HELP_UNIT_MILITARY_KILL_YIELD",
				yieldValue(paid.yieldType, paid.name, paid.value),
				// `TEXTVAR(false)`: the "(in nearest City)" tail belongs to the
				// nation- and tribe-kill clauses, not this one.
				false,
			),
		);
	}
	if (effect.hiddenIn != null) {
		add(
			render(
				"TEXT_HELPTEXT_EFFECT_UNIT_HELP_HIDDEN_IN",
				commaList(effect.hiddenIn),
			),
		);
	}
	if (effect.adjacentEffectUnit != null) {
		add(render("TEXT_HELPTEXT_ADJACENT_UNITS", effect.adjacentEffectUnit));
	}
	if (effect.attackApply != null) {
		const apply = effect.attackApply;
		// The `_NUM` variants take the duration between the payload and the
		// adjacency flag; the others take the flag second.
		add(
			apply.template.endsWith("_NUM")
				? render(
						apply.template,
						apply.effectUnit,
						apply.turns,
						turnScale(apply.turns),
						apply.adjacentOnly,
					)
				: render(apply.template, apply.effectUnit, apply.adjacentOnly),
		);
	}
	if (effect.selfApply != null) {
		add(
			render(
				"TEXT_HELPTEXT_EFFECT_UNIT_HELP_SELF_APPLY_EFFECT",
				effect.selfApply,
			),
		);
	}

	return lines;
}

/** One trait's worth of help lines, for the pill the card groups them under. */
export interface EffectUnitHelpGroup {
	readonly trait: string;
	/** The game's name for the trait. */
	readonly name: string;
	readonly lines: readonly HelpLine[];
}

/**
 * The conferred effect units turned into renderable groups, one per trait that
 * actually says something, in the general's own trait order.
 *
 * Three kinds of conferral drop out here, each for its own reason:
 *
 *   `LEADER_GENERAL_EFFECTUNIT`  has no trait to sit under — it is the global
 *                                every reigning leader confers.
 *   an indirect entry            is an adjacency aura, whose contribution is
 *                                its parent's `[Adjacent Units]` row.
 *   an entry with no clause      pays only numbers, which the general line's
 *                                own rows carry. Swift is +1 movement and
 *                                nothing else, so it earns no pill.
 */
export function effectUnitHelpGroups(
	conferrals: readonly {
		readonly trait: string | null;
		readonly traitName: string | null;
		readonly effect: GeneralEffectUnit;
	}[],
): EffectUnitHelpGroup[] {
	// Built mutably, then handed back behind the readonly shape. A trait with
	// both a general and a leader effect unit — the four archetypes — is one
	// pill with both its lines, which is why an existing group is extended
	// rather than a second one pushed.
	const groups: { trait: string; name: string; lines: HelpLine[] }[] = [];
	for (const conferral of conferrals) {
		if (conferral.trait == null || !conferral.effect.direct) continue;
		const lines = effectUnitHelpLines(conferral.effect);
		if (lines.length === 0) continue;
		const existing = groups.find((group) => group.trait === conferral.trait);
		if (existing == null) {
			groups.push({
				trait: conferral.trait,
				name: conferral.traitName ?? conferral.effect.name,
				lines,
			});
		} else {
			existing.lines.push(...lines);
		}
	}
	return groups;
}
