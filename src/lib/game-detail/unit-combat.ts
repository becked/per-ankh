// A unit's attack and defense, reconstructed the way the game reconstructs
// them, and the effect units they were summed from.
//
// `Unit.modifiedAttack` / `modifiedDefense` (Unit.cs:6366) are
// `modify(baseStrength(), baseStrengthModifier() + base{Attack,Defense}
// Modifier())`, and all three modifiers sum the unit's effect-unit dictionary.
// A save writes no resolved effect-unit list, but it does not need to: the
// game rebuilds that dictionary on every load, from inputs the blob carries
// too. `Unit.init` (Unit.cs:5258) seeds it from the unit type's own
// `aeEffectUnit` and `aeUnitTrait`; `Unit.readGameXML` (Unit.cs:1263) re-adds
// the rest through the same setters — `loadPromotion` for `<Promotions>`,
// `setGeneralID` for `<GeneralID>`. So the same number is derivable here.
//
// WHICH CHANNELS ARE IN. `SourceEffectUnitType` (Enums.cs:234) has nine, and
// this module sums the five that can move a unit's attack or defense:
//
//   UNIT           the unit type's own `aeEffectUnit` and its `aeUnitTrait`
//                  traits' (`Unit.init`, Unit.cs:5258).
//   PROMOTION      each `<Promotions>` entry's effect unit
//                  (`loadPromotion`, Unit.cs:4671), and each
//                  `<BonusEffectUnits>` entry directly
//                  (`loadBonusEffectUnit`, Unit.cs:4485) — 255 of the 2,179
//                  units across `test-data/saves/` carry one of those, 4 of
//                  them a combat column (GUARD1, +10% defense).
//   TRAIT          the general's traits' (`Character.resetTraitEffectUnit`,
//                  Character.cs:6433).
//   FAMILY         `familyOpinion().meEffectUnit` (Unit.cs:4382) — the band
//                  the unit's own player's opinion of the unit's own family
//                  falls in, worth −20% to +10% strength. 1,827 of the
//                  corpus's units resolve to a family of their own player's
//                  and 1,633 of those sit on a non-neutral band.
//   EFFECT_PLAYER  `Player.changeEffectPlayerCount` (Player.cs:9296) pushes
//                  the player's effect players onto every unit it owns. Nine
//                  of the 282 confer an effect unit paying one of the six
//                  columns, and the bake proves that all nine are conferred
//                  only by `advantage.xml`'s `EffectPlayer` (non-human players
//                  only) and six traits' `LeaderEffectPlayer` — so the whole
//                  accumulation reduces to the game's advantage and the
//                  player's reigning leader.
//
// The remaining four cost nothing, each for its own reason:
//
//   ADJACENT, MOVES, OCCURRENCE   the whole of effectUnit.xml holds two
//                                 `AdjacentEffectUnit` values and no
//                                 `NoMoveEffectUnit`, occurrence.xml confers
//                                 no effect unit at all, and none of the three
//                                 carries one of the six columns.
//   APPLIED                       `<EffectUnitTurn>`, which appears on 0 of
//                                 the corpus's 2,179 units.
//
// THE CLOSURE AND THE GATE. `changeEffectUnit` (Unit.cs:5061) recurses into
// each added entry's `unlocks` under the same source, and does so inside its
// own validity test — so a seed the gate denies blocks its children too. The
// test is skipped where the caller passes `bForce`, which `Unit.init` and
// `loadPromotion` both do and the trait channel does not.

import {
	ADVANTAGE_EFFECT_PLAYER,
	COMBAT_EFFECT_PLAYERS,
	EFFECT_UNITS,
	FAMILY_OPINION_EFFECT_UNITS,
	GENERAL_TRAITS,
	LEADER_EFFECT_PLAYER,
	LEADER_GENERAL_EFFECT_UNIT,
	PROMOTION_EFFECT_UNITS,
	UNIT_EFFECT_UNITS,
	type EffectUnit,
} from "$lib/generated/effect-units";
import { FAMILY_OPINION_BANDS } from "$lib/generated/family-opinion";
import { UNIT_STATS } from "$lib/generated/unit-stats";
import type {
	CharacterInfo,
	FamilyOpinionEntry,
	UnitFamilyInfo,
} from "$lib/parser/types";
import { opinionBand } from "./helpers";
import { boostRating, modifyRating } from "./rating-curve";

/**
 * A unit's maximum HP. `Unit.getHPMax` (Unit.cs:3437) returns the unit type's
 * own `iHPMax` with nothing applied to it, and all 91 `unit.xml` units set it
 * to 20 — so the maximum holds for every unit whatever the blob says, which is
 * what lets health render as a complement of `damage` alone (`Unit.getHP`,
 * Unit.cs:2420, is `max(0, getHPMax() − getDamage())`).
 */
export const UNIT_HP_MAX = 20;

/** `Utils.modify` (Utils.cs:58) with `bAllowNegative` left false. */
function modify(value: number, modifier: number): number {
	if (value === 0 || modifier === 0) return value;
	// C# integer division truncates toward zero, and both operands here are
	// non-negative — a unit's strength and a clamped multiplier.
	return Math.trunc((value * Math.max(0, modifier + 100)) / 100);
}

// ─── The general's rating-derived terms ───────────────────────────────────

/** The two rating-derived terms a general puts on the unit they lead. */
export interface GeneralRatingModifiers {
	/** Percent added to the unit's attack. Can be negative — see below. */
	attack: number;
	/** Percent added to the unit's defense. Never negative. */
	defense: number;
}

/** One rating's value, or 0 — the loops skip a rating that is 0 or absent. */
function rating(value: number | null): number {
	return value ?? 0;
}

/**
 * The general's rating-derived contribution, which is the only term in
 * `baseAttackModifier` (Unit.cs:6512) and `baseDefenseModifier` (`:6536`)
 * that is not an effect unit: `pGeneral.getRatingAttackModifierTotal()`
 * (Character.cs:5137) and its defense sibling (`:5152`), each of which loops
 * every rating and calls the matching `InfoHelpers.getRating*`. `rating.xml`
 * gives attack exactly one non-zero coefficient — Courage — and defense one,
 * Charisma, both 1.
 *
 * Defense is one-sided: `getRatingDefenseModifier` (InfoHelpers.cs:1148)
 * returns 0 for a negative rating unless `bDefault`, which only the explorer
 * path passes. Attack is the asymmetric one — `getRatingAttackModifier`
 * (`:1137`) answers a negative rating from its else branch, `modifyRating(1,
 * value, 0)` with a hardcoded 1 rather than the rating's own coefficient — so
 * EVERY negative rating costs the unit attack whichever rating it is, on top
 * of whatever Courage pays. A general with one rating at −2 costs 3% attack.
 *
 * `competitive` is whether the game linearizes the curve (see
 * `competitiveMode`).
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
	};
}

// ─── The dictionary ───────────────────────────────────────────────────────

/** One effect unit on a unit, ready to render as a name beside its glyph. */
export interface UnitEffectRow {
	/** EFFECTUNIT_* zType — the key, and the list's identity. */
	readonly type: string;
	readonly name: string;
	/** The `effect-units` sprite key. */
	readonly icon: string;
}

/**
 * The display gate, `Game.isEffectUnitValid(eUnit, eEffectUnit)`
 * (Game.cs:14409), resolved at bake time: `validUnits` is present only for an
 * effect unit some unit type fails, and lists the ones it lands on.
 *
 * Fails closed. A unit type the table has never seen — a new one between game
 * patch and re-bake — drops the row rather than claiming an effect the game
 * denies, which is the whole reason the gate is here.
 */
function isEffectUnitValid(effect: EffectUnit, unitType: string): boolean {
	return effect.validUnits == null || effect.validUnits.includes(unitType);
}

/**
 * Walk one channel's seeds into effect-unit rows, following each entry's
 * `unlocks` the way `changeEffectUnit` (Unit.cs:5061) recurses — and, when
 * `gated`, dropping a seed the gate denies along with its children, because
 * the recursion sits inside the test.
 *
 * `claimed` is every type an earlier channel already took. The dictionary
 * itself holds one key per effect unit however many sources add it
 * (`getEffectUnits`, Unit.cs:4790, returns `mdEffectUnits.Keys`), so a type
 * two channels confer is one row, and this is what decides which zone of the
 * card it appears in.
 */
function collect(
	seeds: readonly (string | null | undefined)[],
	unitType: string,
	gated: boolean,
	claimed: Set<string>,
): UnitEffectRow[] {
	const rows: UnitEffectRow[] = [];
	const stack = seeds.filter((s): s is string => s != null);
	while (stack.length > 0) {
		const type = stack.pop() as string;
		if (claimed.has(type)) continue;
		const effect = EFFECT_UNITS[type];
		// A type the table has never seen: a game patch ahead of a re-bake.
		if (effect == null) continue;
		if (gated && !isEffectUnitValid(effect, unitType)) continue;
		claimed.add(type);
		rows.push({ type, name: effect.name, icon: effect.icon });
		for (const child of effect.unlocks ?? []) stack.push(child);
	}
	return rows.sort((a, b) => a.name.localeCompare(b.name));
}

// ─── The card's numbers ───────────────────────────────────────────────────

/** What a general brings to the unit it leads, as far as the blob can say. */
export interface UnitGeneral {
	/** The general's traits, in their own order. Empty when the blob has none. */
	readonly traits: readonly string[];
	/** Whether the general is their player's reigning leader. */
	readonly isLeader: boolean;
	/**
	 * The rating-derived attack and defense terms, or null when the blob does
	 * not say which rating curve the game runs (a blob from before
	 * PARSER_VERSION 2.11.0).
	 */
	readonly ratings: GeneralRatingModifiers | null;
	/**
	 * The percent the general's standing with their own leader adds to the
	 * unit's strength — `player().characterOpinionOfUs(pGeneral)
	 * .miStrengthModifier` in `baseStrengthModifier` (Unit.cs:6334).
	 */
	readonly opinionStrengthModifier: number;
}

/** The unit's own inputs, as the blob spells them. */
export interface UnitCombatInput {
	readonly unitType: string;
	/** `<Level>`, which `miPerLevelAttackModifier` multiplies. */
	readonly level: number;
	/** Accumulated damage; `isDamaged()` is `> 0`. */
	readonly damage: number;
	/** The promotions the unit HAS, not the ones it is offered. */
	readonly promotions: readonly string[];
	/**
	 * `<BonusEffectUnits>`, which shares the promotion channel. Empty on a blob
	 * from before PARSER_VERSION 2.25.0, which `combatGaps` reports.
	 */
	readonly bonusEffectUnits: readonly string[];
	/**
	 * The `OPINIONFAMILY_*` band the unit's own player's opinion of the unit's
	 * own family falls in — `unitFamilyOpinionBand`. Null for a unit with no
	 * family to ask about, and on a pre-2.25.0 blob.
	 */
	readonly familyOpinionBand: string | null;
	/**
	 * The effect players the unit's player holds that pay a combat column —
	 * `unitEffectPlayers`.
	 */
	readonly effectPlayers: readonly string[];
	/** Null for a unit nobody leads. */
	readonly general: UnitGeneral | null;
}

export interface UnitCombat {
	/**
	 * `modifiedAttack` / `modifiedDefense`. Null for a unit type with no baked
	 * strength, where `modify(0, …)` would return a zero that reads as a real
	 * number: `UNIT_KUSHITE_CAVALRY` has a glyph while current `unit.xml` keeps
	 * that name only as another unit's `<zIconName>`, and the three
	 * `UNIT_*_TRIBE` types are gone from it altogether. 10 of the corpus's
	 * 1,411 military units, in those 4 types.
	 */
	readonly attack: number | null;
	readonly defense: number | null;
	/** The PROMOTION channel, which the game renders as a grid of glyphs. */
	readonly promotions: readonly UnitEffectRow[];
	/**
	 * The UNIT channel, plus the FAMILY and EFFECT_PLAYER ones: what the unit
	 * carries without either a promotion or a general behind it.
	 */
	readonly own: readonly UnitEffectRow[];
	/** The TRAIT channel: what its general confers. */
	readonly general: readonly UnitEffectRow[];
}

/**
 * The unit's attack, defense, and the three channels of effect units they were
 * summed from.
 *
 * The channels are claimed in `updateUnitPromotionData`'s own precedence
 * (ClientUI.cs:11352): an effect unit the general confers is a general effect
 * wherever else it also comes from (`isGeneralEffectUnit`, Unit.cs:4866, asks
 * only whether TRAIT is among its sources), then a promoted one is a
 * promotion, and what is left is the unit's own.
 */
export function unitCombat(input: UnitCombatInput): UnitCombat {
	const claimed = new Set<string>();
	const general = input.general;

	const generalRows = collect(
		general == null
			? []
			: [
					...general.traits.flatMap((trait) => {
						const conferred = GENERAL_TRAITS[trait];
						if (conferred == null) return [];
						return general.isLeader
							? [conferred.general, conferred.leader]
							: [conferred.general];
					}),
					general.isLeader ? LEADER_GENERAL_EFFECT_UNIT : null,
				],
		input.unitType,
		// `Character.resetTraitEffectUnit` (Character.cs:6433) does not pass
		// `bForce`, so this channel is gated — as the family and effect-player
		// ones below are, and the two `bForce` ones between them are not.
		true,
		claimed,
	);
	const promotionRows = collect(
		[
			...input.promotions.map((promotion) => PROMOTION_EFFECT_UNITS[promotion]),
			// `loadBonusEffectUnit` (Unit.cs:4485) adds these under the same
			// source and with the same `bForce`, so they are the same channel and
			// land in the same grid.
			...input.bonusEffectUnits,
		],
		input.unitType,
		false,
		claimed,
	);
	// The UNIT channel is ungated (`bForce: true`); the family band and the
	// player's effect players are not, so they are collected separately and
	// joined into the same zone — none of the three has a promotion or a
	// general behind it.
	const ownRows = collect(
		UNIT_EFFECT_UNITS[input.unitType] ?? [],
		input.unitType,
		false,
		claimed,
	);
	ownRows.push(
		...collect(
			[
				input.familyOpinionBand == null
					? null
					: FAMILY_OPINION_EFFECT_UNITS[input.familyOpinionBand],
				...input.effectPlayers.flatMap((effectPlayer) => {
					const conferral = COMBAT_EFFECT_PLAYERS[effectPlayer];
					if (conferral == null) return [];
					return [conferral.all, conferral.byUnit?.[input.unitType]];
				}),
			],
			input.unitType,
			true,
			claimed,
		),
	);
	ownRows.sort((a, b) => a.name.localeCompare(b.name));

	// One pass over the whole dictionary, which is what each of the three
	// modifier methods loops.
	let strengthModifier = 0;
	let attackModifier = 0;
	let defenseModifier = 0;
	let damagedUsModifier = 0;
	let hasGeneralModifier = 0;
	for (const row of [...generalRows, ...promotionRows, ...ownRows]) {
		const effect = EFFECT_UNITS[row.type];
		strengthModifier += effect.strengthModifier ?? 0;
		attackModifier += effect.attackModifier ?? 0;
		attackModifier += (effect.perLevelAttackModifier ?? 0) * input.level;
		defenseModifier += effect.defenseModifier ?? 0;
		damagedUsModifier += effect.damagedUsModifier ?? 0;
		hasGeneralModifier += effect.hasGeneralModifier ?? 0;
	}

	// `baseStrengthModifier` (Unit.cs:6334), in its own order: the damaged
	// term, then the general's two, then the dictionary's strength column.
	let baseStrengthModifier = strengthModifier;
	if (input.damage > 0) baseStrengthModifier += damagedUsModifier;
	if (general != null) {
		baseStrengthModifier += hasGeneralModifier;
		baseStrengthModifier += general.opinionStrengthModifier;
	}
	const ratings = general?.ratings ?? null;
	const baseAttackModifier = attackModifier + (ratings?.attack ?? 0);
	const baseDefenseModifier = defenseModifier + (ratings?.defense ?? 0);

	const strength = UNIT_STATS[input.unitType]?.strength ?? null;
	return {
		attack:
			strength == null
				? null
				: modify(strength, baseStrengthModifier + baseAttackModifier),
		defense:
			strength == null
				? null
				: modify(strength, baseStrengthModifier + baseDefenseModifier),
		promotions: promotionRows,
		own: ownRows,
		general: generalRows,
	};
}

/**
 * The effect units an archetype trait confers on a unit its holder leads —
 * what the unit card leaves out of the general's list, where the archetype
 * crest beside the general's name already says it.
 *
 * Only four archetypes confer anything at all — Commander, Hero, Tactician and
 * Zealot have a `GENERAL_TRAITS` entry and the other ten do not — and none of
 * the eight effect units between them carries a combat column, an `unlocks`
 * child or a `validUnits` gate. So what this hides is a name the crest repeats,
 * never a term one of the card's numbers was summed from.
 */
export function archetypeEffectUnits(archetype: string | null): Set<string> {
	const conferred = archetype == null ? null : GENERAL_TRAITS[archetype];
	if (conferred == null) return new Set();
	return new Set(
		[conferred.general, conferred.leader].filter(
			(type): type is string => type != null,
		),
	);
}

// ─── The two channels that are a blob join ────────────────────────────────

/** The fields the family channel reads off a unit. */
interface UnitFamilyLike {
	readonly xml_id: number;
	readonly player_xml_id: number | null;
}

/**
 * The `OPINIONFAMILY_*` band the unit's own player's opinion of the unit's own
 * family falls in — the band whose `meEffectUnit` `Unit.changeFamily`
 * (Unit.cs:4344) puts on the unit.
 *
 * `Unit.getFamily` (Unit.cs:4246) reads the `<PlayerFamily>` entry for the
 * unit's OWN player, so the other players' entries are not this unit's family
 * even though the save records them. Null where the question has no answer:
 * a unit with no player (a tribe's — `familyOpinion()`, Unit.cs:4309, returns
 * null without one), a unit whose own player claims no family for it, a family
 * the opinion history never records, and any unit on a blob from before
 * PARSER_VERSION 2.25.0, where `unit_families` is absent altogether.
 *
 * The opinion taken is the LAST turn recorded for that player and family,
 * which is the vintage the whole card is.
 */
export function unitFamilyOpinionBand(
	unit: UnitFamilyLike,
	unitFamilies: readonly UnitFamilyInfo[] | undefined,
	familyOpinionHistory: readonly FamilyOpinionEntry[] | undefined,
): string | null {
	if (unit.player_xml_id == null || unitFamilies == null) return null;
	const family = unitFamilies.find(
		(f) =>
			f.unit_xml_id === unit.xml_id && f.player_xml_id === unit.player_xml_id,
	)?.family;
	if (family == null) return null;
	let opinion: number | null = null;
	let turn = -Infinity;
	for (const entry of familyOpinionHistory ?? []) {
		if (entry.player_xml_id !== unit.player_xml_id) continue;
		if (entry.family_name !== family) continue;
		if (entry.turn < turn) continue;
		turn = entry.turn;
		opinion = entry.opinion;
	}
	if (opinion == null) return null;
	return opinionBand(opinion, FAMILY_OPINION_BANDS).type;
}

/** The fields the effect-player channel reads off a unit's player. */
interface UnitPlayerLike {
	readonly player_id?: number;
	readonly is_human: boolean;
	readonly leader_character_xml_id?: number | null;
}

/**
 * The effect players the unit's player holds that pay one of the six columns.
 *
 * The bake proves there are only two ways to hold one, which is what makes
 * this short: `Player.initPlayerEffects` (Player.cs:15912) gives every
 * non-human player the game's `<Advantage>` effect player, and `Player.cs:11997`
 * gives the player each of their reigning leader's traits'
 * `LeaderEffectPlayer`. Everything else in the accumulation — techs, laws,
 * nation, dynasty, state religion, council, projects, goals, improvements,
 * family supremacy, occurrences — reaches no combat-bearing effect player, and
 * the bake fails rather than letting a patch change that silently.
 *
 * `is_human` stands in for `isHumanOriginal()` (Player.cs:6445). It is the
 * blob's closest answer — the parser derives it from `OnlineID` and
 * `AIControlledToTurn`, neither of which is the surrender `isHuman()` also
 * tests — and the advantage gate reads the original flag, not the current one.
 *
 * `advantage` is `undefined` on a blob from before PARSER_VERSION 2.25.0,
 * where that half is simply unknown; `combatGaps` is what reports it.
 */
export function unitEffectPlayers(
	player: UnitPlayerLike | undefined,
	advantage: string | null | undefined,
	leaderTraits: readonly string[],
): string[] {
	const out: string[] = [];
	if (player == null) return out;
	if (!player.is_human && advantage != null) {
		const effectPlayer = ADVANTAGE_EFFECT_PLAYER[advantage];
		if (effectPlayer != null) out.push(effectPlayer);
	}
	for (const trait of leaderTraits) {
		const effectPlayer = LEADER_EFFECT_PLAYER[trait];
		if (effectPlayer != null) out.push(effectPlayer);
	}
	return out;
}

// ─── What the numbers can't account for ───────────────────────────────────

/**
 * A reason the attack and defense above may not be the game's own numbers, in
 * the order the card lists them. Every one of these is a term the blob does
 * not carry — not an approximation — so each is a channel that resolved to
 * nothing here and may have resolved to something in the save.
 *
 * All five are blob-vintage gaps: a freshly parsed save answers every channel,
 * and these say which ones a stored blob is too old to answer. Most stored
 * blobs are, because a `PARSER_VERSION` bump leaves them on the old shape
 * until their owner re-uploads.
 */
export type CombatGap =
	"units" | "advantage" | "general" | "rating-curve" | "traits";

/** What the card says about each gap, keyed the same way. */
export const COMBAT_GAP_NOTES: Readonly<Record<CombatGap, string>> = {
	units:
		"This game was parsed before a unit's family and bonus effects were read, so two terms are missing: its player's opinion of its family is worth \u221220% to +10% strength, and a bonus effect is worth +10% defense. Re-uploading the save fills them in.",
	advantage:
		"This game was parsed before the AI advantage was read, so a penalty advantage \u2014 up to 25% of an AI unit's strength \u2014 is not in the stored data. Re-uploading the save fills it in.",
	general:
		"This game was parsed before a unit's general was read, so whatever general it has contributes nothing here. Re-uploading the save fills it in.",
	"rating-curve":
		"This game was parsed before the game options were read, so which rating curve it runs \u2014 and therefore what the general's ratings are worth \u2014 is not in the stored data.",
	traits:
		"This save is older than the element the parser reads a character's traits from, so what the general's traits confer is not in the stored data.",
};

/**
 * The gaps that apply to one unit, given what its blob carries.
 *
 * Each flag is a field's presence, not its value: `unit_families` and
 * `unit_effects` arrived together in PARSER_VERSION 2.25.0 and so share one
 * gap, `match_metadata.advantage` arrived with them but is worth nothing to a
 * human player's unit, and `general_xml_id` arrived back in 2.23.0 \u2014 so a blob
 * can be missing the general entirely, which costs the rating, trait and
 * opinion terms at once.
 */
export function combatGaps(input: {
	readonly hasPlayer: boolean;
	readonly hasGeneral: boolean;
	readonly generalKnown: boolean;
	readonly unitChannelsKnown: boolean;
	readonly advantageKnown: boolean;
	readonly isHuman: boolean;
	readonly ratingsKnown: boolean;
	readonly traitsKnown: boolean;
}): CombatGap[] {
	const gaps: CombatGap[] = [];
	// `familyOpinion()` (Unit.cs:4309) returns null without a player, so the
	// family half of this gap costs a tribe's unit nothing. The bonus half
	// costs any unit, which is why the test is the fields' presence.
	if (!input.unitChannelsKnown) gaps.push("units");
	// `initPlayerEffects` (Player.cs:15912) gives the advantage effect player
	// to non-human players only, so a human's unit loses nothing by not
	// knowing it.
	if (!input.advantageKnown && input.hasPlayer && !input.isHuman) {
		gaps.push("advantage");
	}
	if (!input.generalKnown) gaps.push("general");
	if (input.hasGeneral && !input.ratingsKnown) gaps.push("rating-curve");
	if (input.hasGeneral && !input.traitsKnown) gaps.push("traits");
	return gaps;
}
