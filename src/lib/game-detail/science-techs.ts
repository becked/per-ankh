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
//     The memory's OWNER (`player_xml_id`) is the THIEF and
//     `target_player_xml_id` is the victim, per the game source:
//     PlayerEvent.cs doMission runs on the acting player (`this` = the
//     thief; the mission's SubjectCharacter is their Spymaster and the same
//     doBonus pays the thief the stolen science) and its meMemory branch
//     calls addMemory(eMemoryPlayer, ePlayer: eOtherPlayer /* victim */),
//     appending to the THIEF's own list. The grudge direction comes from
//     the read side: PlayerOpinion.cs calculatePlayerOpinionOfUsRate —
//     "other player has this opinion of us" — scans a player's OWN memory
//     list, so an entry on P's list targeting Q feeds Q's opinion of P.
//     Memories can expire from the save, so this can undercount long games.
//   - expeditions — `EVENTSTORY_EXPEDITION_*` entries in `story_events`
//     (complete from parser 2.14.0; blobs below it carry only the newest 100
//     events of the whole game, so coverage is best-effort until re-imported).

import type { ImprovementInfo } from "$lib/types/ImprovementInfo";
import type { LawAdoptionDataPoint } from "$lib/types/LawAdoptionDataPoint";
import type { PlayerTech } from "$lib/types/PlayerTech";
import type { YieldDataPoint } from "$lib/types/YieldDataPoint";
import type { CityInfo } from "$lib/types/CityInfo";
import type { MapTile } from "$lib/types/MapTile";
import type { StoryEvent } from "$lib/types/StoryEvent";
import type { CharacterInfo, FamilyInfo } from "$lib/parser/types";
import { SPECIALISTS, SPECIALIST_CLASSES } from "$lib/generated/specialists";
import { IMPROVEMENT_NAMES } from "$lib/generated/improvement-names";
import {
	IMPROVEMENT_SCIENCE,
	IMPROVEMENT_RESOURCE_SCIENCE,
	IMPROVEMENT_ADJACENT_MODIFIER,
	IMPROVEMENT_ADJACENT_RESOURCE_SCIENCE,
	FAMILY_CLASS_IMPROVEMENT_MODIFIER,
	PROJECT_IMPROVEMENT_MODIFIER,
	NATION_IMPROVEMENT_MODIFIER,
	GOVERNOR_TRAIT_IMPROVEMENT_MODIFIER,
	LEADER_TRAIT_IMPROVEMENT_MODIFIER,
	IMPROVEMENT_FAMILY_CLASS_SCIENCE_MODIFIER,
	IMPROVEMENT_UNLOCK_COST,
	IMPROVEMENT_CLASS,
	SPECIALIST_SCIENCE,
	SPECIALIST_UNLOCK_COST,
	SPECIALIST_TILE_MODIFIER,
	LAW_UNLOCK_COST,
	SHRINE_TYPE,
	WISDOM_COURT_SCIENCE_RATE,
	WISDOM_GOVERNOR_SCIENCE_MODIFIER,
	SCIENCE_TRIANGLE_OFFSET,
	SCIENCE_DISCONTENT_MODIFIER,
	COMPETITIVE_EQUIVALENT_RATING,
	COMPETITIVE_SCIENCE_STIPEND,
	KNOWLEDGE_TIERS,
	FAMILY_CLASS_SCIENCE_PER_SPECIALIST,
	NATION_CITY_SCIENCE,
	THEOLOGY_SCIENCE_PER_RELIGION,
	PROJECT_SCIENCE,
	LAW_PROJECT_SCIENCE,
	ARCHETYPE_PROJECT_SCIENCE,
	PROJECT_CITY_HP,
	CITY_HP_BASE,
	CITY_DAMAGE_YIELD_MODIFIER,
	CITY_ASSIMILATE_YIELD_MODIFIER,
} from "$lib/generated/science-yields";
import {
	archetypeSpriteKey,
	formatArchetype,
	formatEnum,
	nationName,
} from "$lib/utils/formatting";
import { hexNeighbors } from "$lib/utils/hex";
import {
	storyEventType,
	storyEventsFor,
	projectDisplayName,
	type DetailPlayer,
} from "./helpers";
import { standingShiftMarkers, type StandingShift } from "./standings";

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
// and its target the victim (source derivation in the header comment), so
// callers filter memory_data by player_xml_id === player id — there is no
// nation on memory rows, so no nation fallback exists and pre-2.6.0-style
// blobs simply yield no espionage markers.
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

// The percent a staffing specialist applies to their tile's WHOLE output — a
// Gardener doubles the Grove's yields (Tile.yieldOutputForGovernor ×
// specialist.aiImprovementClassModifier). 0 when the tile is unstaffed or the
// specialist's class doesn't match the improvement's.
function specialistTileModifier(
	improvement: string,
	specialist: string | null,
): number {
	if (specialist == null) return 0;
	const cls = IMPROVEMENT_CLASS[improvement];
	return cls ? (SPECIALIST_TILE_MODIFIER[specialist]?.[cls] ?? 0) : 0;
}

// Base science of one standing improvement tile: the improvement's own flat
// science plus what it earns off its resource (a grove's science comes
// entirely from the luxury it sits on), multiplied by the staffing
// specialist's tile modifier when one applies.
function tileScience(
	improvement: string,
	resource: string | null,
	specialist: string | null,
): number {
	const base =
		(IMPROVEMENT_SCIENCE[improvement]?.flat ?? 0) +
		(resource != null
			? (IMPROVEMENT_RESOURCE_SCIENCE[improvement]?.[resource] ?? 0)
			: 0);
	if (base === 0 || specialist == null) return base;
	return (base * (100 + specialistTileModifier(improvement, specialist))) / 100;
}

// The game's yields are ×10 fixed-point integers and every modifier is
// applied to them with integer math, so the adjacency arithmetic below runs
// in tenths and divides only at the end — rounding earlier drifts off the
// real value.
const tenths = (science: number): number => Math.round(science * 10);

/**
 * The percent a NEIGHBOUR grants this tile, summing the three lookups
 * `InfoHelpers.adjacentYieldOutputImprovementModifier` (InfoHelpers.cs:2025)
 * makes: the neighbour's own rule against this improvement, its own rule
 * against this improvement's class, and its CLASS's rule against that class.
 * Every one is read off the neighbour — the tables live on the tile that
 * GRANTS the bonus, which is the opposite of how the XML reads.
 */
function adjacentModifier(
	improvement: string,
	improvementClass: string | undefined,
	neighbour: string,
): number {
	const byNeighbour = IMPROVEMENT_ADJACENT_MODIFIER[neighbour];
	const neighbourClass = IMPROVEMENT_CLASS[neighbour];
	const byNeighbourClass =
		neighbourClass != null
			? IMPROVEMENT_ADJACENT_MODIFIER[neighbourClass]
			: undefined;
	if (improvementClass == null) return byNeighbour?.[improvement] ?? 0;
	return (
		(byNeighbour?.[improvement] ?? 0) +
		(byNeighbour?.[improvementClass] ?? 0) +
		(byNeighbourClass?.[improvementClass] ?? 0)
	);
}

/**
 * `Utils.modify` (Utils.cs:58) — apply a percent to a ×10 fixed-point yield.
 * Integer division truncating toward zero, and a modifier past −100% floors
 * the multiplier at zero rather than flipping the yield's sign.
 */
function modify(value: number, percent: number): number {
	if (value === 0 || percent === 0) return value;
	return Math.trunc((value * Math.max(0, percent + 100)) / 100);
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

// A player's expedition story events, deduped and display-ready. Prefixed
// variants of the same event appear per audience, so entries normalize
// through storyEventType and dedupe on (event, turn).
export function expeditionEvents(
	player: Pick<DetailPlayer, "playerId" | "player_name">,
	storyEvents: StoryEvent[],
): { name: string; turn: number }[] {
	const seen = new Set<string>();
	const out: { name: string; turn: number }[] = [];
	for (const s of storyEventsFor(storyEvents, player)) {
		const norm = storyEventType(s.event_type);
		if (norm == null || !norm.startsWith("EVENTSTORY_EXPEDITION")) continue;
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
							(t, i) =>
								t + tileScience(i.improvement, i.resource, i.specialist),
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
				if (adopted)
					usage.push({ kind: "law", law: c.law, turn: adopted.turn });
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

// Sprite for one breakdown row, resolved through getSpritePath by the view.
export type BreakdownIcon = { category: string; value: string };

// One itemized science source: "Elder Poet", "Grove (luxury)", "Library".
// `pct` is set on percent-modifier items (libraries, Musaeum, governors),
// where `science` is the estimated points (city base × pct). `order` is the
// research cost of the source's unlocking tech (0 = no tech gate), so rows
// read early-tech → late-tech.
export type BreakdownItem = {
	label: string;
	count: number;
	science: number;
	pct?: number;
	icon?: BreakdownIcon;
	order: number;
};

export type ScienceBreakdown = {
	// Split by workplace kind — rural staff (miners, farmers, gardeners) are
	// a different economic decision than urban building staff.
	specialistsRural: { items: BreakdownItem[]; total: number };
	specialistsUrban: { items: BreakdownItem[]; total: number };
	buildings: { items: BreakdownItem[]; total: number };
	// What a tile's NEIGHBOURS add to it — the terms of
	// Tile.yieldOutputForGovernor the flat rows above don't see: a Monastery
	// is +60% to every Grove beside it, a Temple +20% to its own religion's
	// Monastery, and a Library earns +1 per adjacent resource. Empty when the
	// blob carries no map (the coordinates live only on map_tiles).
	adjacency: { items: BreakdownItem[]; total: number };
	// The other half of the same modifier, granted by the CITY the tile sits
	// in (City.getImprovementModifierForGovernor): a Clerics family doubles
	// its monasteries, a Cultivator governor lifts their groves, Kush its
	// shrines. Same section rules as Adjacency — empty without a map.
	cityBonuses: { items: BreakdownItem[]; total: number };
	// Flat conditional law sources: Constitution per urban specialist,
	// Centralization off capital culture, and science law UPKEEP (negative,
	// × city count per Player.getYieldUpkeepNet). Exact rates from the
	// law/effect XML.
	laws: { items: BreakdownItem[]; total: number };
	// Flat per-city effect sources (2.15.0+ blobs, empty before): the Sages
	// family (+1/specialist in their cities), Babylonia's nation bonus
	// (+1/city), Dualism (+1 × religions present, in each city holding a
	// Dualism religion), and science city projects (Archives, Convoys). All
	// are EffectCity base yields, so they feed the modifier estimates below.
	cityEffects: { items: BreakdownItem[]; total: number };
	// Percent modifiers — the percentages are exact game data (Library +10%,
	// Musaeum +50%, a governor's Wisdom curve); their POINTS are computed
	// against each city's reconstructed base (which, matching City.cs
	// calculateBaseYield → :4682, includes the law and city-effect yields
	// above).
	modifiers: { items: BreakdownItem[]; total: number };
	// Player-level (not per-city) science from the ruling court, plus the
	// Competitive Mode stipend that compensates for it. Only the LEADER is
	// itemized: every other court contributor (spouses, successors,
	// courtiers, council) is scaled by that character's opinion of the
	// player, which the save doesn't store — it's recomputed on load from 26
	// separate sources (PlayerOpinion.calculateCharacterOpinionRate). The
	// leader is exempt by construction (a leader has no opinion of
	// themselves — calculateCharacterOpinionRate returns null for them), so
	// their contribution is exact. The rest stay in `other` below.
	court: { items: BreakdownItem[]; total: number };
	// SIGNED remainder vs the actual rate: the non-leader court (spouses,
	// successors, courtiers, council — all opinion-scaled),
	// Philosophy-via-Forums, connected-foreign-trade science, and every
	// interaction the save doesn't itemize. What drives it NEGATIVE is the
	// Modifiers estimate: a percent is exact but the base it's applied to is
	// only what we itemize, so a discontented empire under-charges its own
	// -5%-per-level and the remainder absorbs the difference. (Family opinion
	// is not the culprit — opinionFamily.xml pays its ANGRY/FURIOUS penalty
	// in Civics, Training and Maintenance, and never touches science.)
	// Deliberately not clamped so over-counting shows.
	other: number;
	// The player's actual science/turn at game end.
	total: number;
};

// Science-law rates (law.xml → effectCity.xml, ÷10 display):
// EFFECTCITY_LAW_CONSTITUTION aiYieldRateSpecialistUrban SCIENCE 10;
// EFFECTCITY_LAW_CENTRALIZATION_CAPITAL aiYieldRateCulture SCIENCE 20.
const CONSTITUTION_SCIENCE_PER_URBAN_SPECIALIST = 1;
const CENTRALIZATION_CAPITAL_SCIENCE_PER_CULTURE = 2;

// Laws whose UPKEEP costs science, PER CITY (law.xml EffectPlayerUpkeep →
// effectPlayer.xml UPKEEP_MEDIUM/HIGH/VERY_HIGH_SCIENCE ÷10;
// Player.getYieldUpkeepNet multiplies by the city count).
const LAW_SCIENCE_UPKEEP_PER_CITY: Readonly<Record<string, number>> = {
	LAW_DIVINE_RULE: -0.5,
	LAW_HOLY_WAR: -1,
	LAW_AUTARKY: -2,
};

// Stable per-class disambiguator for the specialist row ordering, so classes
// sharing an unlock cost sort as contiguous blocks (alphabetical by class id).
const SPECIALIST_CLASS_ORDINAL: Readonly<Record<string, number>> =
	Object.fromEntries(
		Object.keys(SPECIALIST_CLASSES)
			.sort()
			.map((cls, i) => [cls, i]),
	);

/**
 * Sort key for a specialist row: unlock cost first, then the class as a
 * contiguous block, then the tier — so two classes sharing a cost (Officers
 * and Poets, both 160) don't intermingle and each line reads Apprentice →
 * Master → Elder. Shared with the Economy tab so specialists sort the same way
 * wherever they're listed.
 */
export function specialistSortKey(zType: string): number {
	const info = SPECIALISTS[zType];
	return (
		(SPECIALIST_UNLOCK_COST[zType] ?? 0) * 10_000 +
		(SPECIALIST_CLASS_ORDINAL[info?.class ?? ""] ?? 99) * 10 +
		(info?.level ?? 0)
	);
}

// Culture levels in game order — index+1 is the level multiplier
// aiYieldRateCulture uses (City.cs:11916 adds getCultureStep() on top for
// post-Legendary growth, which the blob doesn't record, so Centralization
// is a floor for long-lived Legendary capitals).
const CULTURE_LEVELS = [
	"CULTURE_WEAK",
	"CULTURE_DEVELOPING",
	"CULTURE_STRONG",
	"CULTURE_LEGENDARY",
];

const round1 = (n: number) => Math.round(n * 10) / 10;

// ─── Court science ────────────────────────────────────────────────────
//
// Ported from the game, which computes every court character's yield through
// InfoHelpers.getRatingYieldRateCourt. All of it is integer math on the ×10
// fixed-point rate, so these mirror the C# exactly and divide only at the end
// — rounding earlier drifts off the real value.

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

/** `Utils.triangleBoost` (Utils.cs:124) — the governor rating curve. */
function triangleBoost(n: number): number {
	if (n === 0) return 0;
	return Math.sign(n) * triangle(Math.abs(n) + 1);
}

/**
 * A governor's percent science modifier on their city —
 * `InfoHelpers.boostRating` over rating.xml's aiYieldGovernorModifier. Same
 * Competitive Mode linearization as the court curve, but WITHOUT the
 * triangle offset (boostRating uses the plain triangleBoost). Signed: a
 * negative-Wisdom governor genuinely costs the city science.
 */
function governorSciencePct(wisdom: number, competitive: boolean): number {
	if (!competitive) {
		return WISDOM_GOVERNOR_SCIENCE_MODIFIER * triangleBoost(wisdom);
	}
	const equivalent = Math.max(1, COMPETITIVE_EQUIVALENT_RATING);
	// C# integer division truncates toward zero.
	return Math.trunc(
		(WISDOM_GOVERNOR_SCIENCE_MODIFIER * wisdom * triangleBoost(equivalent)) /
			equivalent,
	);
}

/**
 * `InfoHelpers.modifyRating` (InfoHelpers.cs:1205) — bend a flat rate by a
 * character's rating.
 *
 * Normally the rating runs through the triangular curve, so high ratings pay
 * off steeply. Under Competitive Mode the curve is instead linearized around
 * COMPETITIVE_EQUIVALENT_RATING, which is the whole point of the option
 * ("high Rating values have a less dramatic effect"): the two agree at that
 * rating and diverge sharply above it.
 */
function modifyRating(
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

/**
 * The reigning leader's court science per turn, in display units.
 *
 * Exact, not an estimate. `getYieldRateLeader` (Character.cs:5268) sums
 * getRatingYieldRateCourt over every rating, but RATING_WISDOM is the only
 * one with a science court rate (Charisma pays Civics, Courage Training,
 * Discipline Money), so the leader's science is that single term. The role
 * modifier is 0 for a leader (InfoHelpers.cs:1263) and the opinion modifier
 * is absent (a leader has no opinion of themselves), which is exactly why
 * this one is computable and the rest of the court isn't.
 *
 * Wisdom can be negative, and a negative result is real — a foolish ruler
 * costs the realm science — so it isn't clamped.
 */
function leaderCourtScience(wisdom: number, competitive: boolean): number {
	// getRatingYieldRateCourt bails on a zero rating before touching the curve.
	if (wisdom === 0) return 0;
	return (
		modifyRating(
			WISDOM_COURT_SCIENCE_RATE,
			wisdom,
			SCIENCE_TRIANGLE_OFFSET,
			competitive,
		) / 10
	);
}

// Per-city context for the city-effect and governor rows: the player's own
// CityInfo rows plus game-level lookups. The 2.15.0 city fields (religions,
// project_counts, governor_xml_id, happiness_level, damage,
// assimilate_turns) are optional on older blobs — absent fields simply
// produce no rows, and those sources stay in `other`.
export interface CityEffectContext {
	cities: CityInfo[];
	// The player's nation (Babylonia's bonus keys on it).
	nation: string | null;
	// The reigning leader's archetype trait (TRAIT_*_ARCHETYPE), which pays
	// science in every city holding the project it favours — a Scholar's
	// Archives. Null when there is no reigning leader or none is recorded.
	leaderArchetype: string | null;
	// religion → theologies it established, from game_religions (2.15.0+).
	theologiesByReligion: ReadonlyMap<string, readonly string[]>;
	// Governor character xml_id → their Wisdom rating (null = unknown).
	governorWisdom: (xmlId: number) => number | null;
	// Governor character xml_id → their traits, for the ones that lift an
	// improvement's yield in the city they govern (a Cultivator's groves).
	governorTraits: (xmlId: number) => readonly string[];
	// The reigning leader's traits — the same rules reach EVERY city when the
	// ruler carries them. Empty when there is no reigning leader.
	leaderTraits: readonly string[];
}

/**
 * Decompose a player's end-of-game science rate into itemized sources.
 * `improvements` are the player's own tiles; `tiles` the same tiles as the
 * map records them, carrying the coordinates the adjacency terms need (pass
 * the player's own map tiles, or an empty list when the blob has no map —
 * the two views agree row for row, so nothing is double-counted);
 * `activeLaws` their laws still active at game end; `capital` their capital's
 * name + culture level (null when unresolvable); `cityCount` scales the
 * per-city law upkeep;
 * `finalRate` is the last non-null YIELD_SCIENCE rate; `cityContext` the
 * per-city data for the city-effect and governor rows.
 *
 * `leaderWisdom` is the reigning leader's RATING_WISDOM — null when there is
 * no reigning leader (an eliminated realm, whose last leader died without a
 * successor) or when the blob predates PARSER_VERSION 2.11.0. `competitive`
 * is whether GAMEOPTION_COMPETITIVE_MODE is set, and null on those same older
 * blobs: null means UNKNOWN, not "not competitive", so the court section is
 * omitted entirely rather than priced against a guessed default (the two
 * curves diverge sharply at high wisdom, so guessing wrong is worse than not
 * itemizing).
 */
export function scienceBreakdown(
	improvements: ImprovementInfo[],
	tiles: readonly MapTile[],
	activeLaws: ReadonlySet<string>,
	capital: { cityName: string; cultureLevel: string | null } | null,
	cityCount: number,
	finalRate: number,
	leaderWisdom: number | null,
	competitive: boolean | null,
	cityContext: CityEffectContext,
	specialistName: (zType: string) => string,
	improvementLabel: (zType: string) => string,
): ScienceBreakdown {
	type Acc = {
		count: number;
		science: number;
		pct: number;
		icon?: BreakdownIcon;
		order: number;
	};
	const bump = (
		m: Map<string, Acc>,
		label: string,
		science: number,
		pct = 0,
		icon?: BreakdownIcon,
		order = 0,
	) => {
		const acc = m.get(label) ?? { count: 0, science: 0, pct: 0, icon, order };
		acc.count += 1;
		acc.science += science;
		acc.pct += pct;
		m.set(label, acc);
	};

	// City → its ruling family class, for the conditional wonder modifiers
	// below (an Aksum Stele pays only in a Clerics city).
	const familyClassOfCity = new Map<string, string>();
	for (const city of cityContext.cities) {
		if (city.family_class != null) {
			familyClassOfCity.set(city.city_name, city.family_class);
		}
	}

	const specialistsRural = new Map<string, Acc>();
	const specialistsUrban = new Map<string, Acc>();
	const buildings = new Map<string, Acc>();
	// Per-city flat base, per-city specialist counts (all / urban-only), and
	// per-city percent items, for the law, city-effect, and modifier passes
	// below.
	const cityFlat = new Map<string, number>();
	const citySpecialists = new Map<string, number>();
	const cityUrban = new Map<string, number>();
	const cityPct = new Map<string, Map<string, Acc>>();
	for (const i of improvements) {
		// The building row carries the tile's UNSTAFFED science (flat +
		// luxury; one row per improvement name, since every grove resource
		// yields the same +2). A staffing specialist's tile modifier — the
		// Gardener doubling the Grove — is the specialist's doing, so that
		// boost lands on THEIR row, on top of their own yield.
		const tile = tileScience(i.improvement, i.resource, null);
		const boost = tileScience(i.improvement, i.resource, i.specialist) - tile;
		// A wonder can also pay a percent only while the city's ruling family
		// is of the right class — <aeEffectCityEffectCity>, "when the city ALSO
		// holds this effect" (City.addEffectYield). The Aksum Stele tiers are
		// the only science ones, and they read as one row with the rest.
		const familyClass =
			i.city_name != null ? familyClassOfCity.get(i.city_name) : undefined;
		const pct =
			(IMPROVEMENT_SCIENCE[i.improvement]?.pct ?? 0) +
			(familyClass != null
				? (IMPROVEMENT_FAMILY_CLASS_SCIENCE_MODIFIER[i.improvement]?.[
						familyClass
					] ?? 0)
				: 0);
		const staff =
			(i.specialist ? (SPECIALIST_SCIENCE[i.specialist] ?? 0) : 0) + boost;
		if (tile > 0)
			bump(
				buildings,
				improvementLabel(i.improvement),
				tile,
				0,
				{ category: "improvements", value: i.improvement },
				IMPROVEMENT_UNLOCK_COST[i.improvement] ?? 0,
			);
		if (staff > 0 && i.specialist) {
			// Rows read by unlock cost with each CLASS contiguous — all of a
			// line's tiers together, Apprentice → Master → Elder — so two
			// classes sharing a cost (Officers and Poets, both 160) don't
			// intermingle. Composite key: cost, then a stable class ordinal,
			// then the tier.
			const info = SPECIALISTS[i.specialist];
			bump(
				info?.kind === "rural" ? specialistsRural : specialistsUrban,
				specialistName(i.specialist),
				staff,
				0,
				{ category: "specialists", value: i.specialist },
				specialistSortKey(i.specialist),
			);
		}
		if (i.city_name != null) {
			cityFlat.set(
				i.city_name,
				(cityFlat.get(i.city_name) ?? 0) + tile + staff,
			);
			if (i.specialist != null) {
				citySpecialists.set(
					i.city_name,
					(citySpecialists.get(i.city_name) ?? 0) + 1,
				);
			}
			if (i.specialist != null && SPECIALISTS[i.specialist]?.kind === "urban") {
				cityUrban.set(i.city_name, (cityUrban.get(i.city_name) ?? 0) + 1);
			}
			if (pct > 0) {
				const m = cityPct.get(i.city_name) ?? new Map<string, Acc>();
				// The exact per-building percentage goes in the label, so tiers
				// stay distinct rows: "Library (+10%)", "Academy (+20%)".
				bump(
					m,
					`${improvementLabel(i.improvement)} (+${pct}%)`,
					0,
					pct,
					{ category: "improvements", value: i.improvement },
					IMPROVEMENT_UNLOCK_COST[i.improvement] ?? 0,
				);
				cityPct.set(i.city_name, m);
			}
		}
	}

	// ─── Tile modifiers ──────────────────────────────────────────────────
	//
	// What the flat rows above don't see. Tile.yieldOutputForGovernor
	// (Tile.cs:13233) runs base → × tile modifiers → × the staffing
	// specialist, and yieldBaseForGovernor (:13364) folds a
	// per-adjacent-resource yield into the base before any of it. Two sources
	// of modifier, reported as two sections because a player reads them
	// differently, though the game sums them into one percent:
	//
	//   Adjacency    what the tile's NEIGHBOURS grant it — a Monastery is +60%
	//                to every Grove beside it, stacking per direction, so a
	//                Grove ringed by five is at +300%.
	//   City bonuses what the CITY grants it (City.getImprovementModifier
	//                ForGovernor): a Clerics family doubles its monasteries,
	//                Kush lifts its shrines, a Cultivator governor their groves.
	//
	// The whole delta lands in these sections, INCLUDING the staffing
	// specialist's share of it. A Gardener on that Grove doubles 8 science, not
	// 2, and those extra 6 exist only because the monasteries are there;
	// crediting them to the Gardener's row would read as a specialist the
	// player could have placed anywhere.
	//
	// Coordinates live only on map_tiles, so this reads the map rather than the
	// improvement rows. The tiles passed in are the player's OWN, so a
	// neighbour belonging to anyone else is simply absent from the lookup —
	// which is the game's same-team test, give or take a team game (the save
	// records no teams, so an allied neighbour's grant is missed).
	const adjacencyRows = new Map<string, Acc>();
	const cityBonusRows = new Map<string, Acc>();
	const addModifierRow = (
		rows: Map<string, Acc>,
		label: string,
		science: number,
		count: number,
		order: number,
	) => {
		const acc = rows.get(label) ?? { count: 0, science: 0, pct: 0, order };
		acc.count += count;
		acc.science += science;
		// A row's tiers can differ in unlock cost; the latest gates the row.
		acc.order = Math.max(acc.order, order);
		rows.set(label, acc);
	};
	// A tile reads as its CLASS — "Grove next to Monastery" — so the six
	// per-religion monastery rules collapse into one row instead of splitting
	// the comparison table six ways.
	const tileLabel = (improvement: string): string => {
		const cls = IMPROVEMENT_CLASS[improvement];
		return cls
			? formatEnum(cls, "IMPROVEMENTCLASS_")
			: improvementLabel(improvement);
	};

	// City-granted rules, resolved per city from what the save records: the
	// player's nation and their ruler's traits reach every city; the city's own
	// family class, completed projects and governor's traits reach only it.
	type CityRule = { token: string; percent: number; scope: string };
	const collect = (
		into: CityRule[],
		mods: Readonly<Record<string, number>> | undefined,
		scope: string,
	) => {
		for (const [token, percent] of Object.entries(mods ?? {})) {
			if (percent !== 0) into.push({ token, percent, scope });
		}
	};
	const playerRules: CityRule[] = [];
	if (cityContext.nation != null) {
		collect(
			playerRules,
			NATION_IMPROVEMENT_MODIFIER[cityContext.nation],
			`in ${nationName(cityContext.nation)}`,
		);
	}
	for (const trait of cityContext.leaderTraits) {
		collect(
			playerRules,
			LEADER_TRAIT_IMPROVEMENT_MODIFIER[trait],
			`under a ${formatEnum(trait, "TRAIT_")} ruler`,
		);
	}
	const cityRules = new Map<string, CityRule[]>();
	for (const city of cityContext.cities) {
		const rules = [...playerRules];
		if (city.family_class != null) {
			collect(
				rules,
				FAMILY_CLASS_IMPROVEMENT_MODIFIER[city.family_class],
				`in ${formatEnum(city.family_class, "FAMILYCLASS_")} cities`,
			);
		}
		for (const pc of city.project_counts ?? []) {
			// bSingle throughout, so a repeated completion pays once.
			if (pc.count <= 0) continue;
			collect(
				rules,
				PROJECT_IMPROVEMENT_MODIFIER[pc.project],
				`with ${projectDisplayName(pc.project)}`,
			);
		}
		if (city.governor_xml_id != null) {
			for (const trait of cityContext.governorTraits(city.governor_xml_id)) {
				collect(
					rules,
					GOVERNOR_TRAIT_IMPROVEMENT_MODIFIER[trait],
					`under a ${formatEnum(trait, "TRAIT_")} governor`,
				);
			}
		}
		if (rules.length > 0) cityRules.set(city.city_name, rules);
	}

	const tileAt = new Map<string, MapTile>();
	for (const t of tiles) tileAt.set(`${t.x},${t.y}`, t);
	for (const t of tiles) {
		const improvement = t.improvement;
		if (improvement == null || t.improvement_pillaged) continue;
		const perResource = IMPROVEMENT_ADJACENT_RESOURCE_SCIENCE[improvement] ?? 0;
		const base = tenths(tileScience(improvement, t.resource, null));
		if (base === 0 && perResource === 0) continue;
		const cls = IMPROVEMENT_CLASS[improvement];
		const order = IMPROVEMENT_UNLOCK_COST[improvement] ?? 0;
		// Every rule that fires on this tile, with the percentage points it
		// contributes — they're attributed their share of the result below.
		const rules: {
			rows: Map<string, Acc>;
			label: string;
			percent: number;
			count: number;
			order: number;
		}[] = [];

		// One pass over the six neighbours collects both neighbour terms: how
		// many carry a resource (Tile.countTeamAdjacentResources) and what each
		// grants this tile, grouped by granting class and rate for the row.
		let resources = 0;
		const granted = new Map<
			string,
			{ rate: number; count: number; unlock: number }
		>();
		for (const [nx, ny] of hexNeighbors(t.x, t.y)) {
			const n = tileAt.get(`${nx},${ny}`);
			if (n == null) continue;
			if (n.resource != null) resources += 1;
			if (n.improvement == null || n.improvement_pillaged) continue;
			const rate = adjacentModifier(improvement, cls, n.improvement);
			if (rate === 0) continue;
			// Keyed by class AND rate, so a class whose members grant different
			// percentages can't hide behind one row's headline number.
			const key = `${tileLabel(n.improvement)} (+${rate}%)`;
			const seen = granted.get(key) ?? { rate, count: 0, unlock: 0 };
			seen.count += 1;
			seen.unlock = Math.max(
				seen.unlock,
				IMPROVEMENT_UNLOCK_COST[n.improvement] ?? 0,
			);
			granted.set(key, seen);
		}
		for (const [neighbour, source] of granted) {
			rules.push({
				rows: adjacencyRows,
				label: `${tileLabel(improvement)} next to ${neighbour}`,
				percent: source.rate * source.count,
				count: source.count,
				// The row needs BOTH sides built, so the later unlock gates it.
				order: Math.max(order, source.unlock),
			});
		}
		for (const rule of cityRules.get(t.owner_city ?? "") ?? []) {
			if (rule.token !== improvement && rule.token !== cls) continue;
			rules.push({
				rows: cityBonusRows,
				label: `${tileLabel(improvement)} ${rule.scope} (+${rule.percent}%)`,
				percent: rule.percent,
				count: 1,
				order,
			});
		}

		const flat = tenths(perResource) * resources;
		const percent = rules.reduce((total, r) => total + r.percent, 0);
		if (flat === 0 && percent === 0) continue;
		const specialistPct = specialistTileModifier(improvement, t.specialist);
		const staffed = (value: number) =>
			modify(modify(value, percent), specialistPct);
		// The flat term is priced as its own marginal value on top of the
		// percent ones; what's left is theirs, split in proportion to the
		// percentage each contributed (the game applies them as a single sum,
		// so no exact per-rule split exists).
		const fromFlat = staffed(base + flat) - staffed(base);
		const fromPercent = staffed(base) - modify(base, specialistPct);
		if (fromFlat !== 0) {
			addModifierRow(
				adjacencyRows,
				`${improvementLabel(improvement)} (per adjacent resource)`,
				fromFlat / 10,
				1,
				order,
			);
		}
		// Rules that cancel out — a penalty against a bonus — leave nothing to
		// attribute, and their share is undefined rather than zero.
		if (percent !== 0) {
			for (const rule of rules) {
				addModifierRow(
					rule.rows,
					rule.label,
					(fromPercent * rule.percent) / percent / 10,
					rule.count,
					rule.order,
				);
			}
		}
		if (t.owner_city != null) {
			cityFlat.set(
				t.owner_city,
				(cityFlat.get(t.owner_city) ?? 0) + (fromFlat + fromPercent) / 10,
			);
		}
	}

	// Conditional flat law sources. These are EffectCity yields — City.cs
	// puts them in the city's BASE (calculateBaseYield), which the city's
	// percent modifiers then multiply — so they also feed cityFlat before
	// the modifier pass below.
	const laws = new Map<string, Acc>();
	if (activeLaws.has("LAW_CONSTITUTION")) {
		let urban = 0;
		for (const [city, count] of cityUrban) {
			urban += count;
			cityFlat.set(
				city,
				(cityFlat.get(city) ?? 0) +
					count * CONSTITUTION_SCIENCE_PER_URBAN_SPECIALIST,
			);
		}
		if (urban > 0) {
			laws.set("Constitution", {
				count: urban,
				science: urban * CONSTITUTION_SCIENCE_PER_URBAN_SPECIALIST,
				pct: 0,
				icon: { category: "laws", value: "LAW_CONSTITUTION" },
				order: LAW_UNLOCK_COST["LAW_CONSTITUTION"] ?? 0,
			});
		}
	}
	if (activeLaws.has("LAW_CENTRALIZATION") && capital?.cultureLevel != null) {
		// Floor: City.cs:11916 also adds getCultureStep() (post-Legendary
		// culture growth), which the blob doesn't record.
		const level = CULTURE_LEVELS.indexOf(capital.cultureLevel) + 1;
		if (level > 0) {
			const science = level * CENTRALIZATION_CAPITAL_SCIENCE_PER_CULTURE;
			laws.set("Centralization", {
				count: 1,
				science,
				pct: 0,
				icon: { category: "laws", value: "LAW_CENTRALIZATION" },
				order: LAW_UNLOCK_COST["LAW_CENTRALIZATION"] ?? 0,
			});
			cityFlat.set(
				capital.cityName,
				(cityFlat.get(capital.cityName) ?? 0) + science,
			);
		}
	}
	for (const [lawId, cost] of Object.entries(LAW_SCIENCE_UPKEEP_PER_CITY)) {
		if (activeLaws.has(lawId) && cityCount > 0) {
			laws.set(`${formatEnum(lawId, "LAW_")} (upkeep)`, {
				count: cityCount,
				science: cost * cityCount,
				pct: 0,
				icon: { category: "laws", value: lawId },
				order: LAW_UNLOCK_COST[lawId] ?? 0,
			});
		}
	}

	// Flat city-effect sources (all EffectCity base yields, so each feeds
	// cityFlat for the modifier estimates below). Rows are built directly —
	// their counts mean different things (specialists for Sages, cities for
	// Babylonia/Dualism, completions for projects).
	const cityEffects = new Map<string, Acc>();
	const addEffect = (
		label: string,
		city: string,
		science: number,
		countDelta: number,
		icon?: BreakdownIcon,
	) => {
		const acc = cityEffects.get(label) ?? {
			count: 0,
			science: 0,
			pct: 0,
			icon,
			order: 0,
		};
		acc.count += countDelta;
		acc.science += science;
		cityEffects.set(label, acc);
		cityFlat.set(city, (cityFlat.get(city) ?? 0) + science);
	};
	const nationScience =
		cityContext.nation != null
			? (NATION_CITY_SCIENCE[cityContext.nation] ?? 0)
			: 0;
	// The player-level sources that pay per-city science off a project the
	// city holds, resolved once: every active law that grants, plus the
	// reigning leader's archetype.
	const cityGrants: {
		label: string;
		icon: BreakdownIcon;
		byProject: Readonly<Record<string, number>>;
	}[] = [];
	for (const law of activeLaws) {
		const byProject = LAW_PROJECT_SCIENCE[law];
		if (byProject) {
			cityGrants.push({
				label: formatEnum(law, "LAW_"),
				icon: { category: "laws", value: law },
				byProject,
			});
		}
	}
	const archetype = cityContext.leaderArchetype;
	const archetypeGrant =
		archetype != null ? ARCHETYPE_PROJECT_SCIENCE[archetype] : undefined;
	if (archetype != null && archetypeGrant) {
		cityGrants.push({
			label: formatArchetype(archetype),
			icon: { category: "traits", value: archetypeSpriteKey(archetype) },
			byProject: archetypeGrant,
		});
	}
	for (const city of cityContext.cities) {
		// Sages: +1 science per placed specialist in the family's cities
		// (effectCity aiYieldRateSpecialist — any specialist, unlike
		// Constitution's urban-only rate).
		const familyRate =
			city.family_class != null
				? (FAMILY_CLASS_SCIENCE_PER_SPECIALIST[city.family_class] ?? 0)
				: 0;
		const specialists = citySpecialists.get(city.city_name) ?? 0;
		if (familyRate > 0 && specialists > 0 && city.family_class != null) {
			addEffect(
				`${formatEnum(city.family_class, "FAMILYCLASS_")} cities`,
				city.city_name,
				familyRate * specialists,
				specialists,
				{
					category: "crests",
					value: `ARCHETYPE_${city.family_class.slice("FAMILYCLASS_".length)}`,
				},
			);
		}
		// Babylonia: flat science in every city, from the nation's player
		// effect.
		if (nationScience > 0 && cityContext.nation != null) {
			addEffect(
				formatEnum(cityContext.nation, "NATION_"),
				city.city_name,
				nationScience,
				1,
			);
		}
		// Theologies (Dualism): a city holding a religion that established the
		// theology earns its rate × ALL religions present
		// (City.cs ×getReligionCount, effect once per holding religion).
		const religions = city.religions ?? [];
		for (const [theology, rate] of Object.entries(
			THEOLOGY_SCIENCE_PER_RELIGION,
		)) {
			const holders = religions.filter((r) =>
				cityContext.theologiesByReligion.get(r)?.includes(theology),
			).length;
			if (holders > 0 && religions.length > 0) {
				addEffect(
					formatEnum(theology, "THEOLOGY_"),
					city.city_name,
					holders * rate * religions.length,
					1,
				);
			}
		}
		// Science city projects (Archives, Convoys). bSingle effects pay once
		// regardless of the completion count.
		for (const pc of city.project_counts ?? []) {
			const info = PROJECT_SCIENCE[pc.project];
			if (!info || pc.count <= 0) continue;
			const effective = info.single ? 1 : pc.count;
			addEffect(
				projectDisplayName(pc.project),
				city.city_name,
				effective * info.science,
				effective,
			);
		}
		// Conditional grants: a law the player still holds, or their leader's
		// archetype, paying science in every city holding a given project —
		// Philosophy per Forum city, a Scholar leader per Archive city. The
		// grant is on the project effect being present, so it pays once per
		// city however many completions the city reports.
		for (const grant of cityGrants) {
			const science = (city.project_counts ?? []).reduce(
				(total, pc) =>
					pc.count > 0 ? total + (grant.byProject[pc.project] ?? 0) : total,
				0,
			);
			if (science > 0) {
				addEffect(grant.label, city.city_name, science, 1, grant.icon);
			}
		}
	}

	// Governors: a percent city-science modifier off the governor's Wisdom
	// (City.cs getYieldModifierForGovernor), estimated per city like the
	// building modifiers. Gated on a known Competitive flag — the two curves
	// diverge sharply at high Wisdom, same rationale as the court section.
	if (competitive != null) {
		for (const city of cityContext.cities) {
			if (city.governor_xml_id == null) continue;
			const wisdom = cityContext.governorWisdom(city.governor_xml_id);
			if (wisdom == null) continue;
			const pct = governorSciencePct(wisdom, competitive);
			if (pct === 0) continue;
			const m = cityPct.get(city.city_name) ?? new Map<string, Acc>();
			bump(
				m,
				"Governors",
				0,
				pct,
				{ category: "icons", value: "RATING_WISDOM" },
				0,
			);
			cityPct.set(city.city_name, m);
		}
	}

	// Discontent: −5% science per NEGATIVE happiness level in the city
	// (getHappinessLevelYieldModifier: -(level) × the negative modifier;
	// positive levels pay nothing for science), estimated against the same
	// city base. The big legitimate NEGATIVE modifier — with it priced, a
	// negative Other genuinely means over-counting.
	for (const city of cityContext.cities) {
		const level = city.happiness_level;
		if (level == null || level >= 0) continue;
		const pct = -level * SCIENCE_DISCONTENT_MODIFIER;
		const m = cityPct.get(city.city_name) ?? new Map<string, Acc>();
		bump(
			m,
			"Discontent",
			0,
			pct,
			{ category: "yields", value: "YIELD_DISCONTENT" },
			0,
		);
		cityPct.set(city.city_name, m);
	}

	// Damage and assimilation: the other two negative terms of
	// City.calculateTotalYieldModifier (governor + happiness + damage +
	// assimilate), which YIELD_SCIENCE opts out of neither.
	//
	// Damage is (damage × CITY_DAMAGE_YIELD_MODIFIER) / getHPMax(), and
	// getHPMax() is CITY_HP plus the HP the city's own effects add. The save
	// writes no HP total, so the denominator is rebuilt from the defensive
	// projects the city reports. Walls, Moat, Towers and Improvised Defences
	// are all of them the blob can see; a Hill Fort or a Paranoid ruler's
	// capital raise it too and don't appear here, so a city with those reads
	// slightly harsher than the game charged it.
	for (const city of cityContext.cities) {
		const damage = city.damage ?? 0;
		if (damage <= 0) continue;
		const hpMax = (city.project_counts ?? []).reduce(
			(hp, pc) => (pc.count > 0 ? hp + (PROJECT_CITY_HP[pc.project] ?? 0) : hp),
			CITY_HP_BASE,
		);
		// Integer division, as the game does it.
		const pct = Math.trunc((damage * CITY_DAMAGE_YIELD_MODIFIER) / hpMax);
		if (pct === 0) continue;
		const m = cityPct.get(city.city_name) ?? new Map<string, Acc>();
		bump(m, "Damage", 0, pct, undefined, 0);
		cityPct.set(city.city_name, m);
	}
	// Assimilation runs down a turn at a time after a capture, and the
	// modifier is max(-turns, CITY_ASSIMILATE_YIELD_MODIFIER) — one percent
	// per remaining turn, floored at the global cap.
	for (const city of cityContext.cities) {
		const turns = city.assimilate_turns ?? 0;
		if (turns <= 0) continue;
		const pct = Math.max(-turns, CITY_ASSIMILATE_YIELD_MODIFIER);
		const m = cityPct.get(city.city_name) ?? new Map<string, Acc>();
		bump(m, "Assimilating", 0, pct, undefined, 0);
		cityPct.set(city.city_name, m);
	}

	// Percent modifiers, estimated per city against that city's base (flat
	// tiles + staff + the law and city-effect yields above).
	const modifiers = new Map<string, Acc>();
	for (const [city, mods] of cityPct) {
		const base = cityFlat.get(city) ?? 0;
		for (const [label, acc] of mods) {
			const est = round1((base * acc.pct) / 100);
			const out =
				modifiers.get(label) ??
				({
					count: 0,
					science: 0,
					pct: 0,
					icon: acc.icon,
					order: acc.order,
				} as Acc);
			out.count += acc.count;
			out.science += est;
			out.pct += acc.pct;
			modifiers.set(label, out);
		}
	}

	// Early-tech sources first (unlock cost asc), biggest contribution as the
	// tiebreak — so each section reads "early tech science → late tech science".
	const toItems = (m: Map<string, Acc>, withPct: boolean): BreakdownItem[] =>
		[...m]
			.map(([label, a]) => ({
				label,
				count: a.count,
				science: round1(a.science),
				icon: a.icon,
				order: a.order,
				...(withPct ? { pct: a.pct } : {}),
			}))
			.sort((a, b) => a.order - b.order || b.science - a.science);
	const sum = (items: BreakdownItem[]) =>
		round1(items.reduce((t, i) => t + i.science, 0));

	// Court + Competitive stipend. These are PLAYER-level yields (Player.cs
	// :18248 adds them to the player's total, not to any city), so unlike the
	// sections above they're untouched by the cities' percent modifiers and
	// are summed in flat.
	//
	// Labels are deliberately generic ("Leader", not the ruler's name): the
	// table unions item labels across players to build shared rows, so a
	// per-player name would split one row into N single-player rows.
	const court = new Map<string, Acc>();
	if (competitive != null) {
		if (leaderWisdom != null) {
			const science = leaderCourtScience(leaderWisdom, competitive);
			if (science !== 0) {
				court.set("Leader", {
					count: 1,
					science,
					pct: 0,
					icon: { category: "icons", value: "RATING_WISDOM" },
					order: 0,
				});
			}
		}
		if (competitive) {
			court.set("Competitive Mode", {
				count: 1,
				science: COMPETITIVE_SCIENCE_STIPEND,
				pct: 0,
				icon: { category: "yields", value: "YIELD_SCIENCE" },
				order: 0,
			});
		}
	}

	const ruralItems = toItems(specialistsRural, false);
	const urbanItems = toItems(specialistsUrban, false);
	const buildingItems = toItems(buildings, false);
	const adjacencyItems = toItems(adjacencyRows, false);
	const cityBonusItems = toItems(cityBonusRows, false);
	const lawItems = toItems(laws, false);
	const cityEffectItems = toItems(cityEffects, false);
	const modifierItems = toItems(modifiers, true);
	const courtItems = toItems(court, false);
	const ruralTotal = sum(ruralItems);
	const urbanTotal = sum(urbanItems);
	const buildingsTotal = sum(buildingItems);
	const adjacencyTotal = sum(adjacencyItems);
	const cityBonusesTotal = sum(cityBonusItems);
	const lawsTotal = sum(lawItems);
	const cityEffectsTotal = sum(cityEffectItems);
	const modifiersTotal = sum(modifierItems);
	const courtTotal = sum(courtItems);
	return {
		specialistsRural: { items: ruralItems, total: ruralTotal },
		specialistsUrban: { items: urbanItems, total: urbanTotal },
		buildings: { items: buildingItems, total: buildingsTotal },
		adjacency: { items: adjacencyItems, total: adjacencyTotal },
		cityBonuses: { items: cityBonusItems, total: cityBonusesTotal },
		laws: { items: lawItems, total: lawsTotal },
		cityEffects: { items: cityEffectItems, total: cityEffectsTotal },
		modifiers: { items: modifierItems, total: modifiersTotal },
		court: { items: courtItems, total: courtTotal },
		// Signed on purpose — a negative remainder is the signal that the
		// itemized floor over-counted somewhere.
		other: round1(
			finalRate -
				ruralTotal -
				urbanTotal -
				buildingsTotal -
				adjacencyTotal -
				cityBonusesTotal -
				lawsTotal -
				cityEffectsTotal -
				modifiersTotal -
				courtTotal,
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
	// lines up — ruins/tribe rewards leave no trace, and blobs below parser
	// 2.14.0 carry only the newest 100 story events.
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
	player: Pick<DetailPlayer, "playerId" | "player_name">,
	stealTurns: number[],
	storyEvents: StoryEvent[],
): ScienceSpike[] {
	// Same-turn story events per turn for this player, deduped on the
	// normalized event type (audience-prefixed variants collapse).
	const storiesByTurn = new Map<number, Set<string>>();
	for (const s of storyEventsFor(storyEvents, player)) {
		const norm = storyEventType(s.event_type);
		if (norm == null) continue;
		const set = storiesByTurn.get(s.occurred_turn) ?? new Set<string>();
		set.add(formatEnum(norm, "EVENTSTORY_"));
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

// ─── Leader changes ──────────────────────────────────────────────────

// How a reign ended, for the marker's headline verb.
export type ReignEnd = "died" | "abdicated" | "deposed";

export type LeaderChangeMarker = {
	turn: number;
	// The outgoing leader — null when a leaderless realm crowned someone.
	// `age` and `reignYears` use the game's turn-as-year convention (the
	// same one the Leaders tab's reign windows use); `age` is at the reign's
	// end. Ratings freeze at death, so a dead ruler's stored Wisdom IS their
	// Wisdom when the reign ended; a LIVING character's is their end-of-game
	// value.
	prev: {
		character: CharacterInfo;
		end: ReignEnd;
		age: number;
		reignYears: number;
	} | null;
	// The incoming leader — null when the last leader died unsucceeded.
	next: { character: CharacterInfo } | null;
};

function reignEndOf(
	c: CharacterInfo,
	successionTurn: number | null,
): { end: ReignEnd; endTurn: number | null } {
	if (
		c.abdicated_turn != null &&
		(c.death_turn == null || c.abdicated_turn < c.death_turn) &&
		(successionTurn == null || c.abdicated_turn <= successionTurn)
	) {
		return { end: "abdicated", endTurn: c.abdicated_turn };
	}
	if (c.death_turn != null) return { end: "died", endTurn: c.death_turn };
	return { end: "deposed", endTurn: successionTurn };
}

/**
 * A player's leader transitions: every succession (with the outgoing and
 * incoming rulers — Wisdom is the court's only science rating), plus a final
 * marker when the last leader died with no successor. The first accession
 * (game start) is not a change and isn't marked.
 */
export function leaderChangeMarkers(
	playerId: number,
	characters: CharacterInfo[],
): LeaderChangeMarker[] {
	const reigns = characters
		.filter((c) => c.player_xml_id === playerId && c.became_leader_turn != null)
		.sort((a, b) => a.became_leader_turn! - b.became_leader_turn!);
	const outgoing = (
		c: CharacterInfo,
		successionTurn: number | null,
	): NonNullable<LeaderChangeMarker["prev"]> => {
		const { end, endTurn } = reignEndOf(c, successionTurn);
		const at = endTurn ?? successionTurn ?? c.became_leader_turn!;
		return {
			character: c,
			end,
			age: Math.max(0, at - c.birth_turn),
			reignYears: Math.max(0, at - c.became_leader_turn!),
		};
	};
	const markers: LeaderChangeMarker[] = [];
	for (let i = 1; i < reigns.length; i++) {
		const next = reigns[i];
		markers.push({
			turn: next.became_leader_turn!,
			prev: outgoing(reigns[i - 1], next.became_leader_turn),
			next: { character: next },
		});
	}
	// The fall of the line: last leader died, nobody took the throne.
	const last = reigns[reigns.length - 1];
	if (last != null && last.death_turn != null) {
		markers.push({
			turn: last.death_turn,
			prev: outgoing(last, null),
			next: null,
		});
	}
	return markers;
}

// ─── Knowledge standing (Player.calculateKnowledgeOf) ────────────────

// A new tier must hold this many consecutive turns to count as a shift
// (see standings.ts).
const KNOWLEDGE_MIN_RUN = 3;

export type KnowledgeFlipMarker = StandingShift;

/**
 * Turns where the player's knowledge standing vs the opponent shifted tier —
 * Primitive/Naive/Competent/Learned/Erudite, the exact classification the
 * game computes in Player.calculateKnowledgeOf: the player's cumulative
 * science as an integer percent of the opponent's, bucketed by
 * knowledge.xml's thresholds (shared standings machinery).
 *
 * The opponent's zero-science opening turns are dropped: the game reads a
 * zero denominator as an unbounded percent, i.e. Erudite, which says nothing
 * about either player and would open every rail with an E→ chip. A zero of
 * the player's OWN is kept — that one is a real Primitive. So `pct` is never
 * null here.
 */
export function knowledgeFlipMarkers(
	mine: YieldDataPoint[],
	theirs: YieldDataPoint[],
): KnowledgeFlipMarker[] {
	const series = (data: YieldDataPoint[]) =>
		data
			.filter((d) => d.cumulative != null)
			.map((d) => ({ turn: d.turn, value: d.cumulative! }));
	return standingShiftMarkers(
		series(mine),
		series(theirs).filter((d) => d.value > 0),
		KNOWLEDGE_TIERS,
		KNOWLEDGE_MIN_RUN,
	);
}
