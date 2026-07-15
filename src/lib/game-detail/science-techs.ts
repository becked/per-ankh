// Pure derivations for the Techs tab's science annotations: which "key
// science techs" a player researched AND actually used, plus the two
// blob-derivable free-science signals (free-tech turns, one-off science
// spikes). All inputs are per-player slices the component resolves with the
// ownedByPlayer/findByPlayer idiom; nothing here touches component state.
//
// A key science tech is one whose science payoff is conditional on a
// follow-through the save records: building the improvement line it unlocks
// (and staffing its specialist), adopting the law, or running agent
// missions. The conditions are evaluated against what the blob has:
//
//   - buildings / specialists — the final-turn board snapshot
//     (`improvement_data`); pillaged/replaced builds are invisible, so these
//     read as "standing at game end".
//   - laws — `law_adoption_history`, which keeps laws later switched away.
//   - agent missions — `MEMORYPLAYER_STEAL_RESEARCH` rows in `memory_data`.
//     The memory's OWNER is the thief (verified against cached prod games:
//     every owner had Portcullis + Cartography before the steal turn; targets
//     often had neither). Memories can expire from the save, so this can
//     undercount long games.
//   - expeditions — `EVENTSTORY_EXPEDITION_*` entries in `story_events`
//     (capped at 100 per blob, so coverage is best-effort).

import type { ImprovementInfo } from "$lib/types/ImprovementInfo";
import type { LawAdoptionDataPoint } from "$lib/types/LawAdoptionDataPoint";
import type { PlayerTech } from "$lib/types/PlayerTech";
import type { YieldDataPoint } from "$lib/types/YieldDataPoint";
import type { CityInfo } from "$lib/types/CityInfo";
import type { StoryEvent } from "$lib/types/StoryEvent";
import type { FamilyInfo } from "$lib/parser/types";
import { SPECIALISTS } from "$lib/generated/specialists";
import { IMPROVEMENT_NAMES } from "$lib/generated/improvement-names";
import {
	IMPROVEMENT_SCIENCE,
	IMPROVEMENT_RESOURCE_SCIENCE,
	SPECIALIST_SCIENCE,
	SHRINE_TYPE,
} from "$lib/generated/science-yields";
import { formatEnum } from "$lib/utils/formatting";

// ─── Key-science-tech conditions ─────────────────────────────────────

type UsageCondition =
	// The player has buildings of this improvement line standing at game end
	// (prefix, because lines tier — IMPROVEMENT_THEATER_1..3 — or carry a
	// god/religion suffix: shrines, temples, monasteries). When the line has a
	// working specialist class, its staffed tiers are reported alongside.
	| { kind: "line"; prefix: string; specialistClass?: string }
	// The player adopted this law at any point (switching away later counts).
	| { kind: "law"; law: string }
	// The player ran at least one steal-research agent mission.
	| { kind: "espionage" }
	// The player saw expedition story events (Exploration-law expeditions).
	| { kind: "expedition" };

// Tech → the usage evidence that shows its science unlock paid off. Any one
// condition met surfaces the marker; the tooltip lists every one that hit.
// Specialist↔line pairings verified against blob tiles: Acolyte/Shrine,
// Poet/Theater, Officer/Barracks, Doctor/Baths, Scribe/Courthouse,
// Priest/Temple, Monk/Monastery, Philosopher/Library.
const KEY_SCIENCE_TECHS: Readonly<Record<string, UsageCondition[]>> = {
	TECH_DIVINATION: [
		{
			kind: "line",
			prefix: "IMPROVEMENT_SHRINE",
			specialistClass: "SPECIALISTCLASS_ACOLYTE",
		},
	],
	TECH_DRAMA: [
		{
			kind: "line",
			prefix: "IMPROVEMENT_THEATER",
			specialistClass: "SPECIALISTCLASS_POET",
		},
	],
	TECH_MILITARY_DRILL: [
		{
			kind: "line",
			prefix: "IMPROVEMENT_BARRACKS",
			specialistClass: "SPECIALISTCLASS_OFFICER",
		},
	],
	// Architecture pays off two ways: Baths/Doctors or the Philosophy law.
	TECH_ARCHITECTURE: [
		{
			kind: "line",
			prefix: "IMPROVEMENT_BATHS",
			specialistClass: "SPECIALISTCLASS_DOCTOR",
		},
		{ kind: "law", law: "LAW_PHILOSOPHY" },
	],
	TECH_CITIZENSHIP: [
		{
			kind: "line",
			prefix: "IMPROVEMENT_COURTHOUSE",
			specialistClass: "SPECIALISTCLASS_SCRIBE",
		},
	],
	TECH_DOCTRINE: [
		{
			kind: "line",
			prefix: "IMPROVEMENT_TEMPLE",
			specialistClass: "SPECIALISTCLASS_PRIEST",
		},
	],
	// Law unlocks.
	TECH_ARISTOCRACY: [{ kind: "law", law: "LAW_CENTRALIZATION" }],
	// Rhetoric: the Exploration law, plus any expeditions actually run.
	TECH_RHETORIC: [
		{ kind: "law", law: "LAW_EXPLORATION" },
		{ kind: "expedition" },
	],
	TECH_SOVEREIGNTY: [{ kind: "law", law: "LAW_CONSTITUTION" }],
	TECH_JURISPRUDENCE: [{ kind: "law", law: "LAW_GUILDS" }],
	TECH_VAULTING: [{ kind: "law", law: "LAW_CALLIGRAPHY" }],
	// Improvement unlocks. Groves earn their science through Gardeners.
	TECH_LAND_CONSOLIDATION: [
		{
			kind: "line",
			prefix: "IMPROVEMENT_GROVE",
			specialistClass: "SPECIALISTCLASS_GARDENER",
		},
	],
	TECH_MONASTICISM: [
		{
			kind: "line",
			prefix: "IMPROVEMENT_MONASTERY",
			specialistClass: "SPECIALISTCLASS_MONK",
		},
	],
	TECH_HYDRAULICS: [{ kind: "line", prefix: "IMPROVEMENT_WATERMILL" }],
	TECH_WINDLASS: [{ kind: "line", prefix: "IMPROVEMENT_WINDMILL" }],
	TECH_SCHOLARSHIP: [
		{
			kind: "line",
			prefix: "IMPROVEMENT_LIBRARY",
			specialistClass: "SPECIALISTCLASS_PHILOSOPHER",
		},
	],
	// Espionage: steal-research needs agents (Portcullis) + the mission
	// (Cartography). The blob has no council/agent data (the parsers exist but
	// aren't wired — see cloud parser notes), so the recorded missions stand in
	// for both techs' usage.
	TECH_PORTCULLIS: [{ kind: "espionage" }],
	TECH_CARTOGRAPHY: [{ kind: "espionage" }],
};

// "n× Name" pair for tooltip breakdowns.
export type NamedCount = { name: string; count: number };

// Evidence for one met condition, pre-shaped for tooltip rendering. `flat`
// is the base science/turn the standing buildings + staffed specialists earn
// (display units); `pct` the summed percent city-science modifiers
// (libraries). Both are floors — laws, wonders, and adjacencies stack on top.
export type ScienceTechUsage =
	| {
			kind: "line";
			buildings: NamedCount[];
			specialists: NamedCount[];
			flat: number;
			pct: number;
	  }
	| { kind: "law"; law: string; turn: number }
	| { kind: "espionage"; turns: number[] }
	| { kind: "expedition"; events: { name: string; turn: number }[] };

export type ScienceTechMarker = {
	tech: string;
	// The turn the player completed the tech.
	turn: number;
	// Every condition that hit (non-empty).
	usage: ScienceTechUsage[];
};

// The player's steal-research mission turns. The memory's owner is the thief
// (see header comment), so callers filter memory_data by player_xml_id ===
// player id — there is no nation on memory rows, so no nation fallback exists
// and pre-2.6.0-style blobs simply yield no espionage markers.
export const STEAL_RESEARCH_MEMORY = "MEMORYPLAYER_STEAL_RESEARCH";

// Display name for one standing building: the baked override when the game
// names the tier distinctly (Odeon/Theater/Amphitheater, Cold/Warm/Heated
// Baths), else formatEnum — which drops the tier digit ("Courthouse") but
// would keep a god/religion suffix ("Shrine Zeus"), so non-tier suffixes
// collapse to the line label instead ("Shrine"). A shrine additionally gets
// its god's domain as its type: "Shrine of Nabu (Wisdom)".
function buildingName(zType: string, prefix: string): string {
	const named = IMPROVEMENT_NAMES[zType];
	const suffix = zType.slice(prefix.length);
	const base =
		named ??
		(/^(_\d+)?$/.test(suffix)
			? formatEnum(zType, "IMPROVEMENT_")
			: formatEnum(prefix, "IMPROVEMENT_"));
	const domain = SHRINE_TYPE[zType];
	return domain ? `${base} (${domain})` : base;
}

// General display name for an improvement zType, with a shrine's domain
// appended: "Shrine of Nabu (Wisdom)". The baked IMPROVEMENT_NAMES overrides
// cover the awkward enum names (monasteries, shrine-of-X, tiers).
export function improvementDisplayName(zType: string): string {
	const named = IMPROVEMENT_NAMES[zType] ?? formatEnum(zType, "IMPROVEMENT_");
	const domain = SHRINE_TYPE[zType];
	return domain ? `${named} (${domain})` : named;
}

// Base science of one standing improvement tile: the improvement's own flat
// science plus what it earns off its resource (a grove's science comes
// entirely from the luxury it sits on).
function tileScience(improvement: string, resource: string | null): number {
	return (
		(IMPROVEMENT_SCIENCE[improvement]?.flat ?? 0) +
		(resource != null
			? (IMPROVEMENT_RESOURCE_SCIENCE[improvement]?.[resource] ?? 0)
			: 0)
	);
}

// Count rows into "n× Name" pairs, keeping first-seen name order.
function countByName<T>(rows: T[], nameOf: (row: T) => string): NamedCount[] {
	const counts = new Map<string, number>();
	for (const r of rows) {
		const name = nameOf(r);
		counts.set(name, (counts.get(name) ?? 0) + 1);
	}
	return [...counts].map(([name, count]) => ({ name, count }));
}

// A player's expedition story events, deduped and display-ready. Story rows
// key players by name (no id), and prefixed variants of the same event
// ("P.1.EVENTSTORY_X" / "EVENTSTORY_X") appear per audience, so entries
// normalize to their EVENTSTORY_ suffix and dedupe on (event, turn).
export function expeditionEvents(
	playerName: string,
	storyEvents: StoryEvent[],
): { name: string; turn: number }[] {
	const seen = new Set<string>();
	const out: { name: string; turn: number }[] = [];
	for (const s of storyEvents) {
		if (s.player_name !== playerName) continue;
		const at = s.event_type.indexOf("EVENTSTORY_EXPEDITION");
		if (at < 0) continue;
		const norm = s.event_type.slice(at);
		const key = `${norm}@${s.occurred_turn}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({
			name: formatEnum(norm, "EVENTSTORY_EXPEDITION_"),
			turn: s.occurred_turn,
		});
	}
	return out.sort((a, b) => a.turn - b.turn);
}

/**
 * Key-science-tech markers for one player: each tech they completed whose
 * unlock they demonstrably used, at its discovery turn, with the evidence.
 * `techs`/`improvements` are the player's own rows (pre-filtered by the
 * caller); `laws` is the player's law_adoption_history data; `stealTurns`
 * their steal-research mission turns; `expeditions` their expedition story
 * events (see {@link expeditionEvents}).
 */
export function scienceTechMarkers(
	techs: PlayerTech[],
	improvements: ImprovementInfo[],
	laws: LawAdoptionDataPoint[],
	stealTurns: number[],
	expeditions: { name: string; turn: number }[],
): ScienceTechMarker[] {
	const markers: ScienceTechMarker[] = [];
	for (const t of techs) {
		const conditions = KEY_SCIENCE_TECHS[t.tech];
		if (!conditions) continue;
		const usage: ScienceTechUsage[] = [];
		for (const c of conditions) {
			if (c.kind === "line") {
				const standing = improvements.filter((i) =>
					i.improvement.startsWith(c.prefix),
				);
				if (standing.length === 0) continue;
				const staffed = c.specialistClass
					? standing.filter(
							(i) =>
								i.specialist != null &&
								SPECIALISTS[i.specialist]?.class === c.specialistClass,
						)
					: [];
				usage.push({
					kind: "line",
					buildings: countByName(standing, (i) =>
						buildingName(i.improvement, c.prefix),
					),
					// Level-distinct names ("Apprentice Poet" / "Master Poet" /
					// "Elder Poet") straight from the baked specialist table.
					specialists: countByName(
						staffed,
						(i) =>
							SPECIALISTS[i.specialist!]?.name ??
							formatEnum(i.specialist!, "SPECIALIST_"),
					),
					// Base science these earn per turn (floor — modifiers stack).
					flat:
						standing.reduce(
							(t, i) => t + tileScience(i.improvement, i.resource),
							0,
						) +
						staffed.reduce(
							(t, i) => t + (SPECIALIST_SCIENCE[i.specialist!] ?? 0),
							0,
						),
					pct: standing.reduce(
						(t, i) => t + (IMPROVEMENT_SCIENCE[i.improvement]?.pct ?? 0),
						0,
					),
				});
			} else if (c.kind === "law") {
				const adopted = laws.find((d) => d.law_name === c.law);
				if (adopted) usage.push({ kind: "law", law: c.law, turn: adopted.turn });
			} else if (c.kind === "espionage") {
				if (stealTurns.length > 0)
					usage.push({
						kind: "espionage",
						turns: [...stealTurns].sort((a, b) => a - b),
					});
			} else {
				if (expeditions.length > 0)
					usage.push({ kind: "expedition", events: expeditions });
			}
		}
		if (usage.length > 0)
			markers.push({ tech: t.tech, turn: t.completed_turn, usage });
	}
	return markers.sort((a, b) => a.turn - b.turn);
}

// ─── Free techs ──────────────────────────────────────────────────────

export type FreeTechMarker = {
	turn: number;
	// Every (non-bonus-card) tech the player completed that turn.
	techs: string[];
	// True when the turn matches the player's Sages seat founding — the seat
	// grants a free tech, which attributes the extra completion.
	sages: boolean;
};

/**
 * Turns where a player completed more than one tech — research finishes at
 * most one tech per turn, so the extras were granted free (event, ruins,
 * Sages seat). Turn 1 is skipped (nation starting techs all land there), and
 * bonus cards are excluded (they complete alongside their parent by design).
 * A single-tech turn is still flagged when it matches the Sages seat founding
 * turn, since the free tech may have been the only completion.
 */
export function freeTechMarkers(
	techs: PlayerTech[],
	sagesSeatTurn: number | null,
): FreeTechMarker[] {
	const byTurn = new Map<number, string[]>();
	for (const t of techs) {
		if (t.completed_turn <= 1 || t.tech.includes("_BONUS")) continue;
		const list = byTurn.get(t.completed_turn) ?? [];
		list.push(t.tech);
		byTurn.set(t.completed_turn, list);
	}
	const markers: FreeTechMarker[] = [];
	for (const [turn, list] of byTurn) {
		const sages = turn === sagesSeatTurn;
		if (list.length > 1 || sages) markers.push({ turn, techs: list, sages });
	}
	return markers.sort((a, b) => a.turn - b.turn);
}

/**
 * The turn the player's Sages family seat was founded (the founding grants a
 * free tech), or null when they never seated Sages or the seat city can't be
 * resolved. `city_id` on CityInfo is the city's xml id, matching
 * `FamilyInfo.seat_city_xml_id`.
 */
export function sagesSeatFoundedTurn(
	playerId: number,
	families: FamilyInfo[],
	cities: CityInfo[],
): number | null {
	const sages = families.find(
		(f) =>
			f.player_xml_id === playerId && f.family_class === "FAMILYCLASS_SAGES",
	);
	if (sages?.seat_city_xml_id == null) return null;
	const seat = cities.find((c) => c.city_id === sages.seat_city_xml_id);
	return seat?.founded_turn ?? null;
}

// ─── End-state science-source breakdown ──────────────────────────────

// One itemized science source: "Elder Poet", "Grove (luxury)", "Library".
// `pct` is set on percent-modifier items (libraries, Musaeum, governors),
// where `science` is the estimated points (city base × pct).
export type BreakdownItem = {
	label: string;
	count: number;
	science: number;
	pct?: number;
};

export type ScienceBreakdown = {
	specialists: { items: BreakdownItem[]; total: number };
	buildings: { items: BreakdownItem[]; total: number };
	// Flat conditional sources: science laws (Constitution per urban
	// specialist, Centralization off capital culture), science law UPKEEP
	// (negative, × city count), and the Competitive Mode stipend. Exact
	// rates from law/effect XML; upkeep×cities per Player.getYieldUpkeepNet.
	laws: { items: BreakdownItem[]; total: number };
	// Court members' Wisdom → science (InfoHelpers.getRatingYieldRateCourt):
	// ruler at full rate, spouse at −50%. Successors (4, −50%) and courtiers
	// (−67%) also count in-game but aren't derivable from the blob — no
	// courtier flag is parsed and the succession list is recomputed at load —
	// and character-opinion rate modifiers are likewise unavailable, so this
	// is the identifiable floor.
	court: { items: BreakdownItem[]; total: number };
	// Percent modifiers — the percentages are exact game data (Library +10%,
	// Musaeum +50%, governors by rating curve); their POINTS are computed
	// against each city's reconstructed flat base.
	modifiers: { items: BreakdownItem[]; total: number };
	// Remainder vs the actual rate: Philosophy (needs Forum counts the save
	// lacks), court, religion, and every interaction the save doesn't
	// itemize. Never negative.
	other: number;
	// The player's actual science/turn at game end.
	total: number;
};

// Science-law rates (law.xml → effectCity.xml, ÷10 display):
// EFFECTCITY_LAW_CONSTITUTION aiYieldRateSpecialistUrban SCIENCE 10;
// EFFECTCITY_LAW_CENTRALIZATION_CAPITAL aiYieldRateCulture SCIENCE 20;
// EFFECTPLAYER_COMPETITIVE_MODE aiYieldRate SCIENCE 40.
const CONSTITUTION_SCIENCE_PER_URBAN_SPECIALIST = 1;
const CENTRALIZATION_CAPITAL_SCIENCE_PER_CULTURE = 2;
const COMPETITIVE_MODE_SCIENCE = 4;

// Laws whose UPKEEP costs science, PER CITY (law.xml EffectPlayerUpkeep →
// effectPlayer.xml UPKEEP_MEDIUM/HIGH/VERY_HIGH_SCIENCE ÷10;
// Player.getYieldUpkeepNet multiplies by the city count).
const LAW_SCIENCE_UPKEEP_PER_CITY: Readonly<Record<string, number>> = {
	LAW_DIVINE_RULE: -0.5,
	LAW_HOLY_WAR: -1,
	LAW_AUTARKY: -2,
};

// Court science (game ints, ÷10 at display): rating.xml aiYieldCourtRate
// Wisdom→science = 10, run through InfoHelpers.modifyRating with
// YIELD_SCIENCE's iTriangleOffset (−2); the spouse rate is first cut by
// LEADER_SPOUSE_YIELD_MODIFIER (−50%).
const COURT_WISDOM_SCIENCE_RATE = 10;
const SCIENCE_TRIANGLE_OFFSET = -2;
export const SPOUSE_YIELD_MODIFIER = -50;

function triangleOffset(n: number, off: number): number {
	const v = Math.abs(n) + off;
	if (v <= 0) return n;
	return Math.sign(n) * (triangle(v) - off);
}
// InfoHelpers.modifyRating — flat-yield rating scaling (integer math).
function modifyRating(
	value: number,
	rating: number,
	off: number,
	competitive: boolean,
): number {
	if (!competitive) return value * triangleOffset(rating, off);
	return Math.floor(
		(value * rating * triangleOffset(RATING_EQUIVALENT, off)) /
			RATING_EQUIVALENT,
	);
}

/**
 * One court member's science/turn from their Wisdom (display units).
 * `modifierPct` is the role's yield modifier (0 ruler, −50 spouse).
 * Character-opinion modifiers aren't in the blob and are ignored.
 */
export function courtWisdomScience(
	wisdom: number,
	modifierPct: number,
	competitive: boolean,
): number {
	const rate = Math.floor(
		(COURT_WISDOM_SCIENCE_RATE * (100 + modifierPct)) / 100,
	);
	return modifyRating(rate, wisdom, SCIENCE_TRIANGLE_OFFSET, competitive) / 10;
}

// Culture levels in game order — index+1 is the level multiplier
// aiYieldRateCulture uses.
const CULTURE_LEVELS = [
	"CULTURE_WEAK",
	"CULTURE_DEVELOPING",
	"CULTURE_STRONG",
	"CULTURE_LEGENDARY",
];

// ── the game's rating math (InfoHelpers.boostRating; see owreference's
// stat-scaling page). Governor yield % = rate.xml's 2 per Wisdom, run
// through triangleBoost — or, in Competitive Mode ("Lower Character
// Yields", the multiplayer standard), a linear curve through rating 5.
const RATING_EQUIVALENT = 5; // RATING_EQUIVALENT_LOWER_CHARACTER_YIELDS
const GOVERNOR_WISDOM_SCIENCE = 2; // rating.xml aiYieldGovernorModifier ÷10

function triangle(n: number): number {
	const a = Math.abs(n);
	return Math.sign(n) * ((a * (a + 1)) / 2);
}
function triangleBoost(n: number): number {
	return n === 0 ? 0 : Math.sign(n) * triangle(Math.abs(n) + 1);
}
function boostRating(
	value: number,
	rating: number,
	competitive: boolean,
): number {
	if (!competitive) return value * triangleBoost(rating);
	return Math.floor(
		(value * rating * triangleBoost(RATING_EQUIVALENT)) / RATING_EQUIVALENT,
	);
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Decompose a player's end-of-game science rate into itemized sources.
 * `improvements` are the player's own tiles; `governorWisdomByCity` maps a
 * city name → its governor's Wisdom rating; `competitive` selects the
 * Competitive Mode rating curve (the multiplayer standard); `finalRate` is
 * the last non-null YIELD_SCIENCE rate.
 */
export function scienceBreakdown(
	improvements: ImprovementInfo[],
	governorWisdomByCity: ReadonlyMap<string, number>,
	// The player's ACTIVE laws at game end plus their capital's culture level
	// (null when unknown), for the conditional law sources; cityCount scales
	// the per-city law upkeep.
	activeLaws: ReadonlySet<string>,
	capitalCulture: string | null,
	cityCount: number,
	// Court members with their Wisdom and role yield-modifier (ruler 0,
	// spouse −50), pre-resolved by the caller from characters/marriages.
	courtMembers: { label: string; wisdom: number; modifierPct: number }[],
	competitive: boolean,
	finalRate: number,
	specialistName: (zType: string) => string,
	improvementLabel: (zType: string) => string,
): ScienceBreakdown {
	type Acc = { count: number; science: number; pct: number };
	const bump = (
		m: Map<string, Acc>,
		label: string,
		science: number,
		pct = 0,
	) => {
		const acc = m.get(label) ?? { count: 0, science: 0, pct: 0 };
		acc.count += 1;
		acc.science += science;
		acc.pct += pct;
		m.set(label, acc);
	};

	const specialists = new Map<string, Acc>();
	const buildings = new Map<string, Acc>();
	// Per-city flat base and per-city percent items, for modifier estimates.
	const cityFlat = new Map<string, number>();
	const cityPct = new Map<string, Map<string, Acc>>();
	for (const i of improvements) {
		const flat = IMPROVEMENT_SCIENCE[i.improvement]?.flat ?? 0;
		const lux =
			i.resource != null
				? (IMPROVEMENT_RESOURCE_SCIENCE[i.improvement]?.[i.resource] ?? 0)
				: 0;
		const pct = IMPROVEMENT_SCIENCE[i.improvement]?.pct ?? 0;
		const staff = i.specialist ? (SPECIALIST_SCIENCE[i.specialist] ?? 0) : 0;
		// Flat + luxury science under one name — every grove resource yields
		// the same +2, so "Grove (Citrus)" rows would just be noise.
		if (flat + lux > 0)
			bump(buildings, improvementLabel(i.improvement), flat + lux);
		if (staff > 0 && i.specialist)
			bump(specialists, specialistName(i.specialist), staff);
		if (i.city_name != null) {
			cityFlat.set(
				i.city_name,
				(cityFlat.get(i.city_name) ?? 0) + flat + lux + staff,
			);
			if (pct > 0) {
				const m = cityPct.get(i.city_name) ?? new Map<string, Acc>();
				// The exact per-building percentage goes in the label, so tiers
				// stay distinct rows: "Library (+10%)", "Academy (+20%)".
				bump(m, `${improvementLabel(i.improvement)} (+${pct}%)`, 0, pct);
				cityPct.set(i.city_name, m);
			}
		}
	}

	// Percent modifiers, estimated per city against that city's flat base.
	const modifiers = new Map<string, Acc>();
	for (const [city, mods] of cityPct) {
		const base = cityFlat.get(city) ?? 0;
		for (const [label, acc] of mods) {
			const est = round1((base * acc.pct) / 100);
			const out = modifiers.get(label) ?? { count: 0, science: 0, pct: 0 };
			out.count += acc.count;
			out.science += est;
			out.pct += acc.pct;
			modifiers.set(label, out);
		}
	}
	for (const [city, wisdom] of governorWisdomByCity) {
		if (wisdom === 0) continue;
		const pct = boostRating(GOVERNOR_WISDOM_SCIENCE, wisdom, competitive);
		const est = round1(((cityFlat.get(city) ?? 0) * pct) / 100);
		const out = modifiers.get("Governors") ?? { count: 0, science: 0, pct: 0 };
		out.count += 1;
		out.science += est;
		out.pct += pct;
		modifiers.set("Governors", out);
	}

	// Conditional flat law sources + the Competitive Mode stipend.
	const laws = new Map<string, Acc>();
	if (activeLaws.has("LAW_CONSTITUTION")) {
		const urban = improvements.filter(
			(i) => i.specialist != null && SPECIALISTS[i.specialist]?.kind === "urban",
		).length;
		if (urban > 0) {
			laws.set("Constitution", {
				count: urban,
				science: urban * CONSTITUTION_SCIENCE_PER_URBAN_SPECIALIST,
				pct: 0,
			});
		}
	}
	if (activeLaws.has("LAW_CENTRALIZATION") && capitalCulture != null) {
		const level = CULTURE_LEVELS.indexOf(capitalCulture) + 1;
		if (level > 0) {
			laws.set("Centralization", {
				count: 1,
				science: level * CENTRALIZATION_CAPITAL_SCIENCE_PER_CULTURE,
				pct: 0,
			});
		}
	}
	if (competitive) {
		laws.set("Competitive Mode", {
			count: 1,
			science: COMPETITIVE_MODE_SCIENCE,
			pct: 0,
		});
	}
	for (const [lawId, cost] of Object.entries(LAW_SCIENCE_UPKEEP_PER_CITY)) {
		if (activeLaws.has(lawId) && cityCount > 0) {
			laws.set(`${formatEnum(lawId, "LAW_")} (upkeep)`, {
				count: cityCount,
				science: cost * cityCount,
				pct: 0,
			});
		}
	}

	// Court: each resolved member's Wisdom at their role rate.
	const court = new Map<string, Acc>();
	for (const m of courtMembers) {
		const science = courtWisdomScience(m.wisdom, m.modifierPct, competitive);
		if (science !== 0)
			court.set(m.label, { count: 1, science, pct: 0 });
	}

	const toItems = (m: Map<string, Acc>, withPct: boolean): BreakdownItem[] =>
		[...m]
			.map(([label, a]) => ({
				label,
				count: a.count,
				science: round1(a.science),
				...(withPct ? { pct: a.pct } : {}),
			}))
			.sort((a, b) => b.science - a.science);
	const sum = (items: BreakdownItem[]) =>
		round1(items.reduce((t, i) => t + i.science, 0));

	const specialistItems = toItems(specialists, false);
	const buildingItems = toItems(buildings, false);
	const lawItems = toItems(laws, false);
	const courtItems = toItems(court, false);
	const modifierItems = toItems(modifiers, true);
	const specialistsTotal = sum(specialistItems);
	const buildingsTotal = sum(buildingItems);
	const lawsTotal = sum(lawItems);
	const courtTotal = sum(courtItems);
	const modifiersTotal = sum(modifierItems);
	return {
		specialists: { items: specialistItems, total: specialistsTotal },
		buildings: { items: buildingItems, total: buildingsTotal },
		laws: { items: lawItems, total: lawsTotal },
		court: { items: courtItems, total: courtTotal },
		modifiers: { items: modifierItems, total: modifiersTotal },
		other: round1(
			Math.max(
				0,
				finalRate -
					specialistsTotal -
					buildingsTotal -
					lawsTotal -
					courtTotal -
					modifiersTotal,
			),
		),
		total: finalRate,
	};
}

// ─── One-off science gains ───────────────────────────────────────────

export type ScienceSpike = {
	turn: number;
	amount: number;
	// Best-effort attribution: what the save shows happening to this player
	// that turn (steal-research mission, story events). Empty when nothing
	// lines up — ruins/tribe rewards leave no trace, and story_events is
	// capped at 100 per blob.
	sources: string[];
};

// Minimum one-off gain (in science) to flag. The cumulative/rate series are
// stored ÷10 with independent rounding, so deltas jitter by a few points;
// real event gains (steal research, expeditions, event choices) start ~20.
const SCIENCE_SPIKE_MIN = 10;

// Cap the attribution list per spike — several story events can share a turn
// and only a few are plausibly the source.
const SPIKE_SOURCES_MAX = 3;

/**
 * Turns where cumulative science jumped by more than the turn's rate —
 * one-off gains from events, expeditions, ruins, or steal-research missions —
 * with best-effort attribution from the player's same-turn steal-research
 * missions and story events.
 */
export function scienceSpikes(
	data: YieldDataPoint[],
	playerName: string,
	stealTurns: number[],
	storyEvents: StoryEvent[],
): ScienceSpike[] {
	// Same-turn story events per turn for this player, deduped on the
	// normalized event type (audience-prefixed variants collapse).
	const storiesByTurn = new Map<number, Set<string>>();
	for (const s of storyEvents) {
		if (s.player_name !== playerName) continue;
		const at = s.event_type.indexOf("EVENTSTORY_");
		if (at < 0) continue;
		const set = storiesByTurn.get(s.occurred_turn) ?? new Set<string>();
		set.add(formatEnum(s.event_type.slice(at), "EVENTSTORY_"));
		storiesByTurn.set(s.occurred_turn, set);
	}
	const steals = new Set(stealTurns);

	const spikes: ScienceSpike[] = [];
	for (let i = 1; i < data.length; i++) {
		const prev = data[i - 1];
		const cur = data[i];
		if (cur.cumulative == null || prev.cumulative == null || cur.rate == null)
			continue;
		const bonus = cur.cumulative - prev.cumulative - cur.rate;
		if (bonus < SCIENCE_SPIKE_MIN) continue;
		const sources: string[] = [];
		if (steals.has(cur.turn)) sources.push("Steal Research mission");
		sources.push(...(storiesByTurn.get(cur.turn) ?? []));
		spikes.push({
			turn: cur.turn,
			amount: Math.round(bonus),
			sources: sources.slice(0, SPIKE_SOURCES_MAX),
		});
	}
	return spikes;
}
