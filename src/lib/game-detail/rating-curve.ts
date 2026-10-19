// Old World's character-rating curve, ported from the game.
//
// A rating never acts on anything linearly: the game bends it through
// `Utils.triangle` first, so a Wisdom of 5 is worth far more than five times a
// Wisdom of 1. Two entry points do that bending — `InfoHelpers.boostRating`
// (InfoHelpers.cs:1224) for a flat coefficient, `InfoHelpers.modifyRating`
// (`:1210`) for a rate evaluated at a yield's own triangle offset — and both
// have a second form under Competitive Mode, which linearizes the curve around
// one equivalent rating ("high Rating values have a less dramatic effect on a
// Character's resulting ability").
//
// All of it is integer math in the game, and callers here feed it raw
// fixed-point values and divide only at the end, so every function mirrors C#
// integer semantics — including the truncating-toward-zero division.
//
// Shared because two surfaces read the same curve off the same characters: a
// governor's and a leader's science (`science-techs.ts`) and a general's
// attack, defense, critical chance and XP (`unit-general.ts`). Two copies
// would drift, and the Competitive Mode arm is where they would drift first.

import { COMPETITIVE_EQUIVALENT_RATING } from "$lib/generated/science-yields";

/**
 * Whether a game runs the linearized curve.
 *
 * The option the curve itself tests is `GAMEOPTION_LOWER_CHARACTER_YIELDS`,
 * but that is a SUB-option of `GAMEOPTION_COMPETITIVE_MODE` and Old World
 * never writes a sub-option to a save — `SetGameOption` is a no-op for one and
 * `IsGameOption` answers by recursing to the parent (GameParameters.cs:202).
 * So the parent IS the sub-option's state, and it is what `game_options`
 * carries: 11 of the 16 saves in `test-data/saves/` have Competitive Mode on
 * and none carries `GAMEOPTION_LOWER_CHARACTER_YIELDS`, which is why a
 * membership test for the literal option would quietly run the steep curve on
 * two games in three.
 *
 * Null for a blob from before PARSER_VERSION 2.11.0, which carries no game
 * options at all — UNKNOWN, not "not competitive", so a caller drops the row
 * rather than printing the wrong curve's number.
 */
export function competitiveMode(
	gameOptions: Record<string, true> | null | undefined,
): boolean | null {
	if (gameOptions == null) return null;
	return gameOptions.GAMEOPTION_COMPETITIVE_MODE === true;
}

/** `Utils.triangle` (Utils.cs:119) — the sign-preserving triangular number. */
function triangle(n: number): number {
	const abs = Math.abs(n);
	// abs*(abs+1) is always even, so the game's integer divide is exact here.
	return Math.sign(n) * ((abs * (abs + 1)) / 2);
}

/** `Utils.triangleOffset` (Utils.cs:132). */
function triangleOffset(n: number, offset: number): number {
	const value = Math.abs(n) + offset;
	if (value <= 0) return n;
	return Math.sign(n) * (triangle(value) - offset);
}

/** `Utils.triangleBoost` (Utils.cs:124) — the plain rating curve. */
function triangleBoost(n: number): number {
	if (n === 0) return 0;
	return Math.sign(n) * triangle(Math.abs(n) + 1);
}

/**
 * `InfoHelpers.boostRating` (InfoHelpers.cs:1224) — scale a flat coefficient
 * by a character's rating. Signed: a negative rating genuinely subtracts,
 * wherever the caller's own branch lets a negative through at all.
 */
export function boostRating(
	value: number,
	rating: number,
	competitive: boolean,
): number {
	if (!competitive) return value * triangleBoost(rating);
	const equivalent = Math.max(1, COMPETITIVE_EQUIVALENT_RATING);
	// C# integer division truncates toward zero.
	return Math.trunc((value * rating * triangleBoost(equivalent)) / equivalent);
}

/**
 * `InfoHelpers.modifyRating` (InfoHelpers.cs:1210) — bend a flat rate by a
 * character's rating, evaluated at `offset`.
 *
 * Normally the rating runs through the triangular curve, so high ratings pay
 * off steeply. Under Competitive Mode the curve is instead linearized around
 * COMPETITIVE_EQUIVALENT_RATING, which is the whole point of the option: the
 * two agree at that rating and diverge sharply above it.
 */
export function modifyRating(
	value: number,
	rating: number,
	offset: number,
	competitive: boolean,
): number {
	if (!competitive) return value * triangleOffset(rating, offset);
	const equivalent = Math.max(1, COMPETITIVE_EQUIVALENT_RATING);
	// C# integer division truncates toward zero.
	return Math.trunc(
		(value * rating * triangleOffset(equivalent, offset)) / equivalent,
	);
}
