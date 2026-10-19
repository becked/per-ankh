// What a general does to the unit they lead, as far as the blob can say.
//
// The line being mirrored is `HelpText.buildMakeGeneralLine`
// (HelpText.cs:4579) — the game's own one-line statement of what one general
// does to one unit. Every term in it is attributable to the general and
// derivable from the blob, which is what makes it the right target.
//
// It is NOT `Unit.modifiedAttack` (Unit.cs:6366), which is
// `modify(baseStrength(), baseStrengthModifier() + baseAttackModifier())`
// where both modifiers sum `getEffectUnits()` across all ten
// `SourceEffectUnitType` sources — promotion, trait, adjacency, applied,
// moves, occurrence, family, effect-player, unit. `Unit.writeGameXML` writes
// `<Promotions>` and `<CurrentFormation>` but no resolved effect-unit list
// (`Unit.cs:972`), so a total recomputed from that would be a different number
// from the game's.
//
// THREE SOURCES FEED THE LINE'S SIX TOTALS.
//
// 1. The general's standing with their own leader, which seeds the strength
//    total: `pUnit.player().characterOpinionOfUs(pCharacter,
//    pCharacter.getMakeGeneralExtraOpinion()).miStrengthModifier`. The extra
//    term is 0 for a general already in post — `getChangeJobExtraOpinion`
//    (Character.cs:5289) returns 0 when `getJob() == eNewJob`, and
//    `GENERAL_JOB` is the job `Character.getJob` (Character.cs:9364) answers
//    first for any unit's general — so the plain opinion
//    (`./character-opinion`) is the whole of it.
//
// 2. The effect units the general's traits confer, through
//    `Character.getGeneralEffectUnits` (Character.cs:10578), each gated by
//    the display gate and folded into the same totals as the ratings. Baked
//    into `$lib/generated/effect-units`; the text half of those effect units
//    is `./effect-unit-help`.
//
// 3. The four RATING-derived terms, each one character rating through one
//    coefficient. All four ratings are on the blob (`CharacterInfo.wisdom` /
//    `charisma` / `courage` / `discipline`), and `rating.xml` gives each unit
//    total exactly one non-zero coefficient, all of them 1:
//
//      attack %          ← Courage      `Unit.baseAttackModifier` (Unit.cs:6512)
//      defense %         ← Charisma     `Unit.baseDefenseModifier` (Unit.cs:6536)
//      critical chance % ← Wisdom       `Unit.criticalChance` (Unit.cs:6569)
//      XP per turn       ← Discipline   `Unit.doTurn` (Unit.cs:5808)
//
//    Each total is `Character.getRatingAttackModifierTotal` (Character.cs:5137)
//    and its three siblings (`:5152`, `:5167`, `:5197`), which loop every
//    rating and call the matching `InfoHelpers.getRating*` — so a rating with
//    a zero coefficient contributes nothing, EXCEPT on the attack penalty
//    below.
//
// The line then prints attack as `iAttackValue + iStrengthValue` and defense
// as `iDefenseValue + iStrengthValue`, which is why the opinion's strength
// percent lands INSIDE those two rows rather than beside them —
// `generalLineRows` is that branch.

import {
	GENERAL_EFFECT_UNITS,
	GENERAL_TRAITS,
	LEADER_GENERAL_EFFECT_UNIT,
	type GeneralEffectUnit,
} from "$lib/generated/effect-units";
import type { CharacterInfo } from "$lib/parser/types";
import { boostRating, modifyRating } from "./rating-curve";

/**
 * A unit's maximum HP. `Unit.getHPMax` (Unit.cs:3437) returns the unit type's
 * own `iHPMax` with nothing applied to it, and all 91 `unit.xml` units set it
 * to 20 — so the maximum holds for every unit whatever the blob says, which is
 * what lets health render as a complement of `damage` alone (`Unit.getHP`,
 * Unit.cs:2420, is `max(0, getHPMax() − getDamage())`).
 */
export const UNIT_HP_MAX = 20;

/** The four rating-derived terms a general puts on the unit they lead. */
export interface GeneralRatingModifiers {
	/** Percent added to the unit's attack. Can be negative — see below. */
	attack: number;
	/** Percent added to the unit's defense. Never negative. */
	defense: number;
	/** Percent added to the unit's critical chance. Never negative. */
	criticalChance: number;
	/** XP the unit banks every turn. Never negative. */
	unitXp: number;
}

/** One rating's value, or 0 — the loops skip a rating that is 0 or absent. */
function rating(value: number | null): number {
	return value ?? 0;
}

/**
 * The general's rating-derived contribution to one unit.
 *
 * Three of the four are one-sided. `getRatingDefenseModifier`
 * (InfoHelpers.cs:1148) returns 0 for a negative rating unless `bDefault`,
 * which only the explorer path passes; `getRatingCriticalChance` (`:1163`) and
 * `getRatingUnitXP` (`:1174`) return 0 outright. So only a POSITIVE Charisma,
 * Wisdom or Discipline is worth anything, and a negative one costs nothing.
 *
 * Attack is the asymmetric one. `getRatingAttackModifier` (`:1137`) answers a
 * negative rating from its else branch — `modifyRating(1, value, 0)`, with a
 * hardcoded 1 rather than the rating's own coefficient — so EVERY negative
 * rating costs the unit attack whichever rating it is, on top of whatever
 * Courage pays. A general with one rating at −2 costs 3% attack.
 *
 * `competitive` is whether the game linearizes the curve (see
 * `competitiveMode`); null means the blob doesn't say, and the caller drops
 * the rows rather than printing the wrong curve's number.
 */
export function generalRatingModifiers(
	general: CharacterInfo,
	competitive: boolean,
): GeneralRatingModifiers {
	const wisdom = rating(general.wisdom);
	const charisma = rating(general.charisma);
	const courage = rating(general.courage);
	const discipline = rating(general.discipline);

	// The rating-agnostic attack penalty, summed over every rating the way
	// getRatingAttackModifierTotal loops them. A zero rating is skipped before
	// the curve is reached, which matters: triangleOffset(0, 0) is 0 anyway,
	// but modifyRating would still be entered.
	let attack = 0;
	for (const value of [wisdom, charisma, courage, discipline]) {
		if (value < 0) attack += modifyRating(1, value, 0, competitive);
	}
	if (courage > 0) attack += boostRating(1, courage, competitive);

	return {
		attack,
		defense: charisma > 0 ? boostRating(1, charisma, competitive) : 0,
		criticalChance: wisdom > 0 ? boostRating(1, wisdom, competitive) : 0,
		unitXp: discipline > 0 ? boostRating(1, discipline, competitive) : 0,
	};
}

// ─── The effect units the general's traits confer ─────────────────────────

/** One effect unit a general's trait puts on the unit they lead. */
export interface GeneralEffectConferral {
	/** The trait that confers it — null for `LEADER_GENERAL_EFFECTUNIT`. */
	readonly trait: string | null;
	/** The game's name for that trait, or null for the global. */
	readonly traitName: string | null;
	readonly effectUnit: string;
	readonly effect: GeneralEffectUnit;
}

/**
 * The display gate, `Game.isEffectUnitValid(eUnit, eEffectUnit)`
 * (Game.cs:14409), resolved at bake time: `validUnits` is present only for an
 * effect unit some unit type fails, and lists the ones it lands on.
 *
 * Fails closed. A unit type the table has never seen — a new one between game
 * patch and re-bake, or a general on a unit the current `unit.xml` says cannot
 * have one — drops the row rather than claiming an effect the game denies,
 * which is the whole reason the gate is here.
 */
function isEffectUnitValid(
	effect: GeneralEffectUnit,
	unitType: string,
): boolean {
	return effect.validUnits == null || effect.validUnits.includes(unitType);
}

/**
 * The closure `Character.getGeneralEffectUnits` (Character.cs:10578) walks for
 * one general, gated to one unit type.
 *
 * Per trait, in the character's own trait order: the trait's
 * `GeneralEffectUnit`, then that entry's `aeEffectUnitUnlock` and
 * `AdjacentEffectUnit` — the game does not recurse past that first hop, and
 * neither does this — then, for a general who is their player's reigning
 * leader, the trait's `LeaderEffectUnit`. `LEADER_GENERAL_EFFECTUNIT` comes
 * last, also leader-only.
 *
 * A trait the blob carries that confers nothing is simply absent from
 * `GENERAL_TRAITS`, which is most of the 306 in `trait.xml`.
 */
export function generalEffectUnits(
	traits: readonly string[],
	isLeader: boolean,
	unitType: string,
): GeneralEffectConferral[] {
	const out: GeneralEffectConferral[] = [];
	const push = (trait: string | null, effectUnit: string): void => {
		const effect = GENERAL_EFFECT_UNITS[effectUnit];
		if (effect == null) return;
		if (!isEffectUnitValid(effect, unitType)) return;
		out.push({
			trait,
			traitName: trait == null ? null : (GENERAL_TRAITS[trait]?.name ?? null),
			effectUnit,
			effect,
		});
	};

	for (const trait of traits) {
		const conferred = GENERAL_TRAITS[trait];
		if (conferred == null) continue;
		for (const effectUnit of conferred.general ?? []) push(trait, effectUnit);
		if (isLeader) {
			for (const effectUnit of conferred.leader ?? []) push(trait, effectUnit);
		}
	}
	if (isLeader && LEADER_GENERAL_EFFECT_UNIT != null) {
		push(null, LEADER_GENERAL_EFFECT_UNIT);
	}
	return out;
}

/** The six running totals `buildMakeGeneralLine` accumulates. */
export interface GeneralLineTotals {
	movement: number;
	strength: number;
	attack: number;
	defense: number;
	criticalChance: number;
	unitXp: number;
}

/**
 * Fold the conferred effect units into the line's totals, exactly as the
 * `foreach (EffectUnitType … in pCharacter.getGeneralEffectUnits())` loop
 * does: `iMovementExtra`, `iStrengthModifier`, `iAttackModifier`,
 * `iPerLevelAttackModifier × getLevel()`, `iDefenseModifier` and
 * `iCriticalChance`, all six, whether or not the current `effectUnit.xml`
 * happens to pay through each — so a patch that starts paying strength or
 * attack through a general's trait moves the baked table rather than this
 * code. Today three of the six are paid: movement by three effect units,
 * critical chance by two and defense by one.
 *
 * `unitLevel` is 0 for a blob that doesn't carry the unit's level, which is
 * what `iPerLevelAttackModifier` is worth when there is no level to multiply.
 */
export function generalEffectTotals(
	conferrals: readonly GeneralEffectConferral[],
	unitLevel: number,
): GeneralLineTotals {
	const totals: GeneralLineTotals = {
		movement: 0,
		strength: 0,
		attack: 0,
		defense: 0,
		criticalChance: 0,
		unitXp: 0,
	};
	for (const { effect } of conferrals) {
		totals.movement += effect.movementExtra ?? 0;
		totals.strength += effect.strengthModifier ?? 0;
		totals.attack += effect.attackModifier ?? 0;
		totals.attack += (effect.perLevelAttackModifier ?? 0) * unitLevel;
		totals.defense += effect.defenseModifier ?? 0;
		totals.criticalChance += effect.criticalChance ?? 0;
	}
	return totals;
}

/** One row of the general's contribution, as the line prints it. */
export interface GeneralLineRow {
	readonly label: string;
	readonly value: number;
	readonly suffix: string;
}

/**
 * The rows `buildMakeGeneralLine` prints, in its own order and under its own
 * branch — which is why strength is not simply a sixth row:
 *
 *   movement                              when non-zero
 *   strength ALONE                         when attack and defense are both 0
 *   else attack = iAttackValue + iStrengthValue,
 *        defense = iDefenseValue + iStrengthValue,  each when either term is
 *                                                   non-zero
 *   critical chance                        when non-zero
 *   XP                                     when non-zero
 *
 * `opinionStrength` is the general's standing with their leader, which seeds
 * `iStrengthValue` — so it is folded into attack and defense here rather than
 * shown beside them.
 */
export function generalLineRows(
	ratings: GeneralRatingModifiers,
	effects: GeneralLineTotals,
	opinionStrength: number,
): GeneralLineRow[] {
	const movement = effects.movement;
	const strength = effects.strength + opinionStrength;
	const attack = effects.attack + ratings.attack;
	const defense = effects.defense + ratings.defense;
	const criticalChance = effects.criticalChance + ratings.criticalChance;
	const unitXp = ratings.unitXp;

	const rows: GeneralLineRow[] = [];
	if (movement !== 0) {
		rows.push({ label: "Movement", value: movement, suffix: "" });
	}
	if (strength !== 0 && attack === 0 && defense === 0) {
		rows.push({ label: "Strength", value: strength, suffix: "%" });
	} else {
		if (attack !== 0 || strength !== 0) {
			rows.push({ label: "Attack", value: attack + strength, suffix: "%" });
		}
		if (defense !== 0 || strength !== 0) {
			rows.push({ label: "Defense", value: defense + strength, suffix: "%" });
		}
	}
	if (criticalChance !== 0) {
		rows.push({
			label: "Critical chance",
			value: criticalChance,
			suffix: "%",
		});
	}
	if (unitXp !== 0) {
		rows.push({ label: "XP per turn", value: unitXp, suffix: "" });
	}
	return rows;
}
