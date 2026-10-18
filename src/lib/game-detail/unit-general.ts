// What a general does to the unit they lead, as far as the blob can say.
//
// `Unit.modifiedAttack` (Unit.cs:6366) is `modify(baseStrength(),
// baseStrengthModifier() + baseAttackModifier())`, and both modifiers sum
// `getEffectUnits()` across all ten `SourceEffectUnitType` sources —
// promotion, trait, adjacency, applied, moves, occurrence, family,
// effect-player, unit. `Unit.writeGameXML` writes `<Promotions>` and
// `<CurrentFormation>` but no resolved effect-unit list (`Unit.cs:972`), so a
// total recomputed here would be a different number from the game's. What IS
// attributable to the general is the four RATING-derived terms below, each of
// which comes from one character rating through one coefficient — so this
// module hands back the general's own contribution and never a total.
//
// The four ratings are all on the blob (`CharacterInfo.wisdom` / `charisma` /
// `courage` / `discipline`), and `rating.xml` gives each unit total exactly
// one non-zero coefficient, all of them 1:
//
//   attack %          ← Courage      `Unit.baseAttackModifier` (Unit.cs:6512)
//   defense %         ← Charisma     `Unit.baseDefenseModifier` (Unit.cs:6536)
//   critical chance % ← Wisdom       `Unit.criticalChance` (Unit.cs:6569)
//   XP per turn       ← Discipline   `Unit.doTurn` (Unit.cs:5808)
//
// Each total is `Character.getRatingAttackModifierTotal` (Character.cs:5137)
// and its three siblings (`:5152`, `:5167`, `:5197`), which loop every rating
// and call the matching `InfoHelpers.getRating*` — so a rating with a zero
// coefficient contributes nothing, EXCEPT on the attack penalty below.

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
