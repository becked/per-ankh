// Bake the effect units a general confers on the unit they lead — the closure
// `Character.getGeneralEffectUnits` (Character.cs:10578) walks, each one's
// display name and content columns, the display gate's resolved validity
// table, and the `TEXT_HELPTEXT_*` templates the clauses need.
//
// WHAT THE CARD IS MIRRORING. `HelpText.buildMakeGeneralLine` (HelpText.cs:4579)
// is the game's own one-line statement of what one general does to one unit.
// It is a different computation from `Unit.modifiedAttack` (Unit.cs:6366),
// which sums `getEffectUnits()` across all ten `SourceEffectUnitType` sources
// and is unknowable from a save — `Unit.writeGameXML` (Unit.cs:972) writes no
// resolved effect-unit list. The narrow one is the one that bakes.
//
// The line has two halves and they read the closure differently:
//
//   NUMBERS  — over the WHOLE closure, folded into six running totals
//              (iStrengthModifier / iAttackModifier / iPerLevelAttackModifier ×
//              level / iDefenseModifier / iCriticalChance / iMovementExtra),
//              which is why those six are classified `NUMERIC` below and are
//              not clauses: `$lib/game-detail/unit-general` adds them to the
//              rating-derived totals the way the line does.
//   TEXT     — only on the TRAIT-DIRECT effect units: each trait's
//              `GeneralEffectUnit`, each trait's `LeaderEffectUnit` for a
//              general who is their player's reigning leader, and
//              `LEADER_GENERAL_EFFECTUNIT`. An effect unit reached only
//              through a parent's `AdjacentEffectUnit` or `aeEffectUnitUnlock`
//              contributes its numbers and its NAME (inside the parent's
//              `TEXT_HELPTEXT_ADJACENT_UNITS` row), never its own clauses.
//              `direct` on each emitted entry records which it is.
//
// THE GATE. `Game.isEffectUnitValid(eUnit, eEffectUnit)` (Game.cs:14409) with
// `bCheckGameSettings` left false, because that is how the line calls it. That
// overload reads only effectUnit.xml and unit.xml — no game state — so the
// whole gate resolves here into a per-effect-unit list of the unit types it is
// valid on. Two arms stay out, each for a reason at the call site: the
// game-settings arm `Game.isEffectUnitValid(eEffectUnit)` (Game.cs:14326),
// which the display call does not reach, and `Unit.isEffectUnitValid`
// (Unit.cs:4829), which tests the unit's LIVE effect-unit list — state
// `writeGameXML` never writes, and a different overload from the line's.
//
// `validUnits` is emitted VALID-side and only for an effect unit that some
// unit type fails, so a unit type missing from a re-bake fails closed (no row)
// rather than claiming an effect the game would deny — which is the whole
// reason the gate is built rather than skipped.
//
// SOURCES (local-only, via the Reference/ resolver), under Reference/XML/Infos/:
//   effectUnit.xml    — the 179 entries, their columns and <GenderedName>
//   trait.xml         — <GeneralEffectUnit> / <LeaderEffectUnit>, <GenderedName>
//   globalsType.xml   — LEADER_GENERAL_EFFECTUNIT
//   unit.xml          — the gate's unit side, and <bGeneral> (canHaveGeneral)
//   unitTrait.xml     — <Name> for the vs-unit-trait clauses
//   height.xml, vegetation.xml, terrain.xml, terrainTarget.xml, yield.xml,
//   concept.xml       — <Name> / <GenderedName> for the tile and link names
//   genderedText*.xml — <GenderedName> → TEXT_*, merged across base + DLC
//   text-*.xml        — <zType> → <en-US>, merged across base + DLC
//
// OUTPUT: src/lib/generated/effect-units.ts (checked in, self-contained — no
// .bake sidecar, so bake:finalize cannot empty it in a checkout where this has
// not run; the arrangement bake-character-opinion.ts and bake-promotion-names.ts
// already use).
//
// Deterministic: every map is emitted in sorted key order, so re-running
// against the same XML is byte-identical.
//
// Run: npm run bake:effect-units

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { XMLParser } from "fast-xml-parser";
import { format as prettierFormat, resolveConfig } from "prettier";

import { resolveReferenceXml } from "./lib/paths.js";
import { stripMarkup } from "../src/lib/utils/formatting.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const OUTPUT_TS = resolve(REPO_ROOT, "src/lib/generated/effect-units.ts");

// ─── XML plumbing ────────────────────────────────────────────────────────

// `parseTagValue: false` keeps every scalar a string, so a `<Second>0</Second>`
// stays distinguishable from an absent tag. CDATA is unwrapped into the text
// node, which is what the `<true_N>…<false>…<end>` templates arrive wrapped in.
const parser = new XMLParser({
	ignoreAttributes: true,
	parseTagValue: false,
	ignoreDeclaration: true,
	ignorePiTags: true,
	cdataPropName: "__cdata",
});

type XmlNode = Record<string, unknown>;

async function loadEntries(path: string): Promise<XmlNode[]> {
	const xml = await readFile(path, "utf-8");
	const parsed = parser.parse(xml) as {
		Root?: { Entry?: XmlNode | XmlNode[] };
	};
	const entry = parsed.Root?.Entry;
	if (entry == null) return [];
	return Array.isArray(entry) ? entry : [entry];
}

/** A `<Pair>` list collapses to one object when the XML holds a single pair. */
function asArray<T>(value: T | T[] | undefined): T[] {
	if (value == null) return [];
	return Array.isArray(value) ? value : [value];
}

/**
 * The scalar at `tag`, verbatim — or null. A tag whose value is CDATA parses
 * as `{ __cdata: … }`, which is how the `<true_N>…<false>…<end>` templates
 * arrive, so unwrap that before stringifying. Nothing is trimmed: a template's
 * own leading or trailing space is part of the string.
 */
function raw(node: XmlNode, tag: string): string | null {
	const value = node[tag];
	if (value == null) return null;
	if (typeof value === "object") {
		const cdata = (value as XmlNode).__cdata;
		return typeof cdata === "string" && cdata !== "" ? cdata : null;
	}
	const text = String(value);
	return text === "" ? null : text;
}

/** The scalar at `tag`, trimmed — an empty tag (the template Entry) reads null. */
function str(node: XmlNode, tag: string): string | null {
	const text = raw(node, tag);
	if (text == null) return null;
	const trimmed = text.trim();
	return trimmed === "" ? null : trimmed;
}

function int(node: XmlNode, tag: string): number {
	const text = str(node, tag);
	return text == null ? 0 : Number.parseInt(text, 10);
}

/** XML writes a bool as 1/0; absent and 0 are both false. */
function bool(node: XmlNode, tag: string): boolean {
	const text = str(node, tag);
	return text != null && text !== "0";
}

/** `<aeFoo><zValue>A</zValue>…</aeFoo>` → ["A", …]. */
function typeList(node: XmlNode, tag: string): string[] {
	const list = node[tag];
	if (list == null || typeof list !== "object") return [];
	return asArray((list as XmlNode).zValue as string | string[] | undefined)
		.map((v) => String(v).trim())
		.filter((v) => v !== "");
}

/**
 * `SparseList<K, int>` (SparseList.cs:14) — `Set` DELETES a key whose value
 * equals the default, so a pair written as 0 stores nothing and `Count` counts
 * only the non-zero entries. Dropping zeros here is what makes `.Count > 0`
 * and the iteration order of the C# loops agree with this table.
 */
function intPairs(node: XmlNode, tag: string): Map<string, number> {
	const out = new Map<string, number>();
	const list = node[tag];
	if (list == null || typeof list !== "object") return out;
	for (const pair of asArray((list as XmlNode).Pair as XmlNode | XmlNode[])) {
		const key = str(pair, "zIndex");
		const value = int(pair, "iValue");
		if (key != null && value !== 0) out.set(key, value);
	}
	return out;
}

/** The same sparse rule for `SparseList<K, bool>`: a false pair stores nothing. */
function boolPairs(node: XmlNode, tag: string): Set<string> {
	const out = new Set<string>();
	const list = node[tag];
	if (list == null || typeof list !== "object") return out;
	for (const pair of asArray((list as XmlNode).Pair as XmlNode | XmlNode[])) {
		const key = str(pair, "zIndex");
		if (key != null && bool(pair, "bValue")) out.add(key);
	}
	return out;
}

/** `<Foo><First>X</First><Second>2</Second></Foo>` — the C# `mz*` tuples. */
function tuple(
	node: XmlNode,
	tag: string,
): { first: string; second: number } | null {
	const value = node[tag];
	if (value == null || typeof value !== "object") return null;
	const inner = value as XmlNode;
	const first = str(inner, "First");
	if (first == null) return null;
	return { first, second: int(inner, "Second") };
}

// ─── Name resolution ─────────────────────────────────────────────────────

/**
 * `<GenderedName>` → genderedText.xml → `TEXT_*` → the en-US string. The
 * masculine form is the base noun; every entry that carries a feminine variant
 * carries the masculine one too, so there is no arm for a missing masculine.
 */
const MASCULINE = "GRAMMATICAL_GENDER_MASCULINE";

class Names {
	/**
	 * Resolves a `link(X)` that appears inside another name. Eight of the
	 * closure's effect units are named `link(TRAIT_HERO_ARCHETYPE) General` and
	 * its siblings, so this is wired to trait.xml and to nothing else — a link
	 * to any other kind of thing throws rather than being approximated.
	 */
	linkResolver: ((zType: string) => string | null) | null = null;

	constructor(
		private readonly text: Map<string, string>,
		private readonly gendered: Map<string, string>,
	) {}

	/** The display string behind a `TEXT_*` key: markup off, first `~` form. */
	fromKey(key: string | null): string | null {
		if (key == null) return null;
		const stored = this.text.get(key);
		if (stored == null) return null;
		// en-US packs the grammatical forms into one '~'-separated field; the
		// first segment is the bare noun, as the promotion-name bake reads it.
		const bare = stored.split("~")[0] ?? "";
		// Resolve `link(X)` against the linked thing's OWN name rather than
		// letting stripMarkup's formatEnum-shaped fallback approximate it —
		// `link(TRAIT_TACTICIAN_ARCHETYPE) General` is "Tactician General", not
		// "Tactician Archetype General". An unresolvable target throws rather
		// than degrading quietly.
		const resolved = bare.replace(
			/link\(([A-Z0-9_]+)(?:,[^)]*)?\)/g,
			(_, target: string) => {
				const name = this.linkResolver?.(target) ?? null;
				if (name == null) {
					throw new Error(
						`bake-effect-units: ${key} links to ${target}, which Names ` +
							"cannot resolve — widen linkResolver to the table holding it",
					);
				}
				return name;
			},
		);
		const display = stripMarkup(resolved).trim();
		return display !== "" ? display : null;
	}

	/** `<Name>` where an entry has one, else `<GenderedName>`. */
	fromNode(node: XmlNode): string | null {
		const plain = this.fromKey(str(node, "Name"));
		if (plain != null) return plain;
		const genderedKey = str(node, "GenderedName");
		if (genderedKey == null) return null;
		return this.fromKey(this.gendered.get(genderedKey) ?? null);
	}

	/** The raw template behind a `TEXT_HELPTEXT_*` key, markup intact. */
	template(key: string): string | null {
		return this.text.get(key) ?? null;
	}
}

// ─── Column classification ───────────────────────────────────────────────
//
// Every non-presentational tag an effect unit in the closure carries is
// classified here, and `main` THROWS on one that is not — so a game patch that
// adds a column to a general's effect unit fails the bake rather than silently
// dropping whatever it says. That is the guarantee that makes the clause table
// in `$lib/game-detail/effect-unit-help` complete for what this emits.

/** Tags that describe the entry rather than its effect. */
const PRESENTATION = new Set([
	"zType",
	"GameContentDisplay",
	"GenderedName",
	"GrammaticalGenderNames",
	"zIconName",
	"Description",
	"TileAsset",
	"Class",
	"iClassNum",
]);

/**
 * The six `buildMakeGeneralLine` folds into its own totals rather than
 * printing as a clause. The first five are also the five blocks
 * `buildEffectUnitHelp` skips when called with `bSkipIcons: true`, which is
 * how the line calls it; `iPerLevelAttackModifier` keeps its clause there but
 * is folded as well, and no entry in the closure carries it.
 */
const NUMERIC = [
	"iStrengthModifier",
	"iAttackModifier",
	"iPerLevelAttackModifier",
	"iDefenseModifier",
	"iCriticalChance",
	"iMovementExtra",
] as const;

/** Read by the gate above, never printed. */
const GATE_COLUMNS = new Set(["abUnitTraitValid", "abUnitTraitInvalid"]);

/**
 * Columns with no clause anywhere in `buildEffectUnitHelp`, each for its own
 * reason: `bSkipIcon` is read nowhere in GameCore outside `InfoBase.cs:2260`,
 * `bMultiTeams` only in the game-settings arm at `Game.cs:14332`, and
 * `SelfApplyEffectUnitYieldCost` renders inside
 * `buildSelfApplyEffectUnitLinkVariable` (HelpText.Effect.cs:399), which the
 * self-apply clause reaches for its NAME only.
 */
const NO_CLAUSE = new Set([
	"bSkipIcon",
	"bMultiTeams",
	"SelfApplyEffectUnitYieldCost",
]);

/**
 * `aeEffectUnitImmune`'s clause sits behind `if (!bLine)`, and `bLine: true` is
 * passed on exactly one call — `LEADER_GENERAL_EFFECTUNIT` — which is the only
 * entry in the closure that carries the column. So the immune list is
 * suppressed for every row the card can render, and is deliberately not a
 * clause here.
 */
const LINE_SUPPRESSED = new Set(["aeEffectUnitImmune"]);

/** Clause columns, each with the `TEXT_HELPTEXT_*` template it renders. */
const CLAUSE_TEMPLATES: Readonly<Record<string, readonly string[]>> = {
	AdjacentEffectUnit: ["TEXT_HELPTEXT_ADJACENT_UNITS"],
	// The APPLIES family has nine members and the branch that picks one reads
	// only XML, so it is resolved below and the chosen key emitted with the row
	// rather than all nine here.
	AttackApplyEffectUnitTurns: [],
	AttackerApplyEffectUnitTurns: [],
	SelfApplyEffectUnitTurns: [
		"TEXT_HELPTEXT_EFFECT_UNIT_HELP_SELF_APPLY_EFFECT",
	],
	abHideTerrainTarget: ["TEXT_HELPTEXT_EFFECT_UNIT_HELP_HIDDEN_IN"],
	aiHeightFromModifier: ["TEXT_HELPTEXT_EFFECT_UNIT_HELP_FIGHT_FROM"],
	aiVegetationFromModifier: ["TEXT_HELPTEXT_EFFECT_UNIT_HELP_FIGHT_FROM"],
	aiMilitaryKillYield: [
		"TEXT_HELPTEXT_EFFECT_UNIT_HELP_UNIT_MILITARY_KILL_YIELD",
	],
	aiUnitTraitModifier: ["TEXT_HELPTEXT_EFFECT_UNIT_HELP_VS_UNIT_TRAIT"],
	aiUnitTraitModifierAttack: ["TEXT_HELPTEXT_EFFECT_UNIT_HELP_VS_UNIT_TRAIT"],
	aiUnitTraitModifierDefense: ["TEXT_HELPTEXT_EFFECT_UNIT_HELP_VS_UNIT_TRAIT"],
	bBuildRoad: ["TEXT_HELPTEXT_EFFECT_UNIT_HELP_BUILD_ROAD"],
	bCriticalImmune: ["TEXT_HELPTEXT_EFFECT_UNIT_HELP_CRITICAL_IMMUNE"],
	bGeneralHopping: ["TEXT_HELPTEXT_EFFECT_UNIT_HELP_GENERAL_HOPPING"],
	bHealKill: ["TEXT_HELPTEXT_EFFECT_UNIT_HELP_HEAL_KILL"],
	bHealNeutral: ["TEXT_HELPTEXT_EFFECT_UNIT_HELP_HEAL_NEUTRAL"],
	bLastStand: ["TEXT_HELPTEXT_EFFECT_UNIT_HELP_LAST_STAND"],
	bLaunchOffensive: [
		"TEXT_HELPTEXT_EFFECT_UNIT_HELP_LAUNCH_OFFENSIVE",
		"TEXT_HELPTEXT_LINK_LAUNCH_OFFENSIVE",
	],
	bRout: ["TEXT_HELPTEXT_EFFECT_UNIT_HELP_CAN_ROUT"],
	bStun: ["TEXT_HELPTEXT_EFFECT_UNIT_HELP_STUN"],
	bZOC: ["TEXT_HELPTEXT_UNIT_TYPE_HAS_ZOC"],
	iActionsExtra: ["TEXT_HELPTEXT_UNIT_FREE_ACTIONS"],
	iAdjacentSameModifier: ["TEXT_HELPTEXT_EFFECT_UNIT_HELP_SAME_UNIT_ADJACENT"],
	iConnectedAttackModifier: [
		"TEXT_HELPTEXT_EFFECT_UNIT_HELP_ATTACK_INTO",
		"TEXT_HELPTEXT_LINK_CONNECTED",
	],
	iUrbanAttackModifier: ["TEXT_HELPTEXT_EFFECT_UNIT_HELP_ATTACK_INTO"],
	iDamagedThemModifier: ["TEXT_HELPTEXT_EFFECT_UNIT_HELP_VS_DAMAGED"],
	iDamagedUsModifier: ["TEXT_HELPTEXT_EFFECT_UNIT_HELP_IF_DAMAGED"],
	iFatigueExtra: ["TEXT_HELPTEXT_EFFECT_UNIT_HELP_FATIGUE_LIMIT"],
	iFlankingAttackModifier: ["TEXT_HELPTEXT_EFFECT_UNIT_HELP_FLANKING_ATTACK"],
	iHealExtra: ["TEXT_HELPTEXT_EFFECT_UNIT_HELP_HEAL_EXTRA"],
	iHomeModifier: ["TEXT_HELPTEXT_EFFECT_UNIT_HELP_HOME_MODIFIER"],
	iMeleeCounterPercent: ["TEXT_HELPTEXT_EFFECT_UNIT_HELP_MELEE_COUNTER"],
	iRangeExtra: [],
	iRevealExtra: ["TEXT_HELPTEXT_EFFECT_UNIT_HELP_REVEAL"],
	iVisionExtra: ["TEXT_HELPTEXT_EFFECT_UNIT_HELP_VISION"],
	iVsGeneralModifier: ["TEXT_HELPTEXT_EFFECT_UNIT_HELP_VS_GENERAL"],
};

/**
 * Templates every row goes through whatever its clause is:
 * `buildSignedTextVariable` (HelpText.cs:1352) for the signed number,
 * `TEXT_HELPTEXT_CONCAT_SPACE_TWO` for the icon-and-number link variables, and
 * `TEXT_HELPTEXT_TURN` — which is `buildTurnScaleName`'s own `pGame == null`
 * branch (HelpText.Game.cs:22). The blob takes that branch because the save
 * writes the turn scale as a `<Game TurnScale=…>` attribute that
 * `match-metadata.ts` does not read, so the scale's own name (Year, Semester,
 * Season, Month — 14 Years and 1 Semester across the corpus) is not on it.
 */
const FRAMEWORK_TEMPLATES = [
	"TEXT_HELPTEXT_SIGNED_VALUE",
	"TEXT_HELPTEXT_CONCAT_SPACE_TWO",
	"TEXT_HELPTEXT_CONCAT_SPACE_TWO_NBSP",
	"TEXT_HELPTEXT_TURN",
] as const;

// ─── The gate ────────────────────────────────────────────────────────────

interface UnitFacts {
	readonly water: boolean;
	readonly melee: boolean;
	readonly rangeFlat: boolean;
	readonly rangeMax: number;
	readonly traits: ReadonlySet<string>;
	/** The unit type's own innate effect units — two gate clauses read them. */
	readonly ownEffectUnits: readonly string[];
	/** `Unit.canHaveGeneral` (Unit.cs:14718) is `info().mbGeneral`. */
	readonly canHaveGeneral: boolean;
}

interface EffectUnitFacts {
	readonly noRoadCooldown: boolean;
	readonly buildRoad: boolean;
	readonly rangeExtra: number;
	readonly riverAttackModifier: number;
	readonly ignoresDistance: boolean;
	readonly attackValue: ReadonlyMap<string, number>;
	readonly attackPercent: ReadonlyMap<string, number>;
	readonly unitTraitValid: ReadonlySet<string>;
	readonly unitTraitInvalid: ReadonlySet<string>;
}

/** `Game.isEffectUnitValid(eUnit, eEffectUnit)`, Game.cs:14409, clause order. */
function isEffectUnitValid(
	unit: UnitFacts,
	effect: EffectUnitFacts,
	effectUnits: ReadonlyMap<string, EffectUnitFacts>,
): boolean {
	if (effect.noRoadCooldown) {
		const roadBuilder =
			effect.buildRoad ||
			unit.ownEffectUnits.some(
				(own) => effectUnits.get(own)?.buildRoad === true,
			);
		if (!roadBuilder) return false;
	}
	if (effect.buildRoad && unit.water) return false;
	if (effect.rangeExtra > 0 && (unit.melee || unit.rangeFlat)) return false;
	if (effect.riverAttackModifier !== 0 && !unit.melee) return false;
	if (
		effect.ignoresDistance &&
		(unit.melee || (unit.rangeMax === 1 && unit.rangeFlat))
	) {
		return false;
	}
	for (const [attack, percent] of effect.attackPercent) {
		if (percent > 0 && (effect.attackValue.get(attack) ?? 0) === 0) {
			const found = unit.ownEffectUnits.some(
				(own) => (effectUnits.get(own)?.attackValue.get(attack) ?? 0) > 0,
			);
			if (!found) return false;
		}
	}
	if (effect.unitTraitValid.size > 0) {
		let valid = false;
		for (const trait of unit.traits) {
			if (effect.unitTraitValid.has(trait)) {
				valid = true;
				break;
			}
		}
		if (!valid) return false;
	}
	for (const trait of unit.traits) {
		if (effect.unitTraitInvalid.has(trait)) return false;
	}
	return true;
}

// ─── Emission ────────────────────────────────────────────────────────────

/** One grouped `<Pair>` run: the names that share a value, and the value. */
interface ValueGroup {
	readonly names: readonly string[];
	readonly value: number;
}

/** One yield a kill pays. Flat, because the kill-yield clauses do not group. */
interface YieldValue {
	readonly yieldType: string;
	/** For the sprite's accessible name — the game's line shows only the glyph. */
	readonly name: string;
	readonly value: number;
}

interface EmittedEffectUnit {
	name: string;
	/** True when a trait (or the global) names it, so its clauses render. */
	direct: boolean;
	validUnits?: readonly string[];
	// NUMERIC — folded into the general line's totals.
	strengthModifier?: number;
	attackModifier?: number;
	perLevelAttackModifier?: number;
	defenseModifier?: number;
	criticalChance?: number;
	movementExtra?: number;
	// CLAUSE columns.
	adjacentEffectUnit?: string;
	attackApply?: {
		/** The resolved `TEXT_HELPTEXT_EFFECT_UNIT_APPLIES*` key. */
		readonly template: string;
		readonly effectUnit: string;
		readonly turns: number;
		readonly adjacentOnly: boolean;
	};
	selfApply?: string;
	hiddenIn?: readonly string[];
	fightFrom?: readonly ValueGroup[];
	militaryKillYield?: readonly YieldValue[];
	vsUnitTrait?: readonly (ValueGroup & {
		readonly kind: "strength" | "attack" | "defense";
	})[];
	buildRoad?: true;
	criticalImmune?: true;
	generalHopping?: true;
	healKill?: true;
	healNeutral?: true;
	lastStand?: true;
	launchOffensive?: true;
	rout?: true;
	stun?: true;
	zoc?: true;
	actionsExtra?: number;
	adjacentSameModifier?: number;
	connectedAttackModifier?: number;
	urbanAttackModifier?: number;
	damagedThemModifier?: number;
	damagedUsModifier?: number;
	fatigueExtra?: number;
	flankingAttackModifier?: number;
	healExtra?: number;
	homeModifier?: number;
	meleeCounterPercent?: number;
	rangeExtra?: number;
	revealExtra?: number;
	visionExtra?: number;
	vsGeneralModifier?: number;
}

/**
 * A name table that also remembers its XML order, which is the order the C#
 * `for (FooType eLoop = 0; …)` loops walk the enum — so a grouped clause lists
 * its names the way the game lists them.
 */
interface OrderedNames {
	name(key: string): string;
	index(key: string): number;
}

/**
 * The tile and unit-trait clauses collect the distinct values into a set and
 * emit one line per value, naming everything that shares it — so a column with
 * two values renders two lines. Both the lines and the names within a line come
 * out in enum order, matching the loops in `buildEffectUnitHelp`.
 *
 * This is NOT how the kill-yield clauses read their column: those loop the
 * yields and emit a line each, which is why they are flattened rather than
 * grouped.
 */
function groupByValue(
	pairs: ReadonlyMap<string, number>,
	names: OrderedNames,
): ValueGroup[] {
	const keys = [...pairs.keys()].sort(
		(a, b) => names.index(a) - names.index(b),
	);
	const byValue = new Map<number, string[]>();
	for (const key of keys) {
		const value = pairs.get(key);
		if (value == null) continue;
		const group = byValue.get(value);
		if (group == null) byValue.set(value, [names.name(key)]);
		else group.push(names.name(key));
	}
	return [...byValue].map(([value, group]) => ({ names: group, value }));
}

function tsLiteral(value: unknown, indent: string): string {
	if (Array.isArray(value)) {
		if (value.length === 0) return "[]";
		const inner = value
			.map((v) => `${indent}\t${tsLiteral(v, `${indent}\t`)},`)
			.join("\n");
		return `[\n${inner}\n${indent}]`;
	}
	if (value !== null && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>).filter(
			([, v]) => v !== undefined,
		);
		if (entries.length === 0) return "{}";
		const inner = entries
			.map(
				([k, v]) =>
					`${indent}\t${JSON.stringify(k)}: ${tsLiteral(v, `${indent}\t`)},`,
			)
			.join("\n");
		return `{\n${inner}\n${indent}}`;
	}
	return JSON.stringify(value);
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	const infosDir = resolve(resolveReferenceXml(), "Infos");
	const allFiles = await readdir(infosDir);
	const textFiles = allFiles.filter((f) => /^text.*\.xml$/.test(f));
	const genderedFiles = allFiles.filter((f) => /^genderedText.*\.xml$/.test(f));

	const load = (f: string): Promise<XmlNode[]> =>
		loadEntries(resolve(infosDir, f));

	const [
		effectUnitEntries,
		traitEntries,
		globalsTypeEntries,
		unitEntries,
		unitTraitEntries,
		heightEntries,
		vegetationEntries,
		terrainEntries,
		terrainTargetEntries,
		yieldEntries,
		conceptEntries,
		textGroups,
		genderedGroups,
	] = await Promise.all([
		load("effectUnit.xml"),
		load("trait.xml"),
		load("globalsType.xml"),
		load("unit.xml"),
		load("unitTrait.xml"),
		load("height.xml"),
		load("vegetation.xml"),
		load("terrain.xml"),
		load("terrainTarget.xml"),
		load("yield.xml"),
		load("concept.xml"),
		Promise.all(textFiles.map(load)),
		Promise.all(genderedFiles.map(load)),
	]);

	// Merge the base and DLC text tables, base first — the project, tech and
	// promotion name bakes merge them the same way.
	const text = new Map<string, string>();
	for (const group of textGroups) {
		for (const entry of group) {
			const key = str(entry, "zType");
			const value = raw(entry, "en-US");
			if (key != null && value != null && !text.has(key)) {
				text.set(key, value);
			}
		}
	}
	const gendered = new Map<string, string>();
	for (const group of genderedGroups) {
		for (const entry of group) {
			const key = str(entry, "zType");
			const texts = entry.Texts;
			if (key == null || texts == null || typeof texts !== "object") continue;
			const pairs = asArray((texts as XmlNode).Pair as XmlNode | XmlNode[]);
			const masculine = pairs.find((p) => str(p, "zIndex") === MASCULINE);
			const chosen = str(masculine ?? pairs[0] ?? {}, "zValue");
			if (chosen != null && !gendered.has(key)) gendered.set(key, chosen);
		}
	}
	const names = new Names(text, gendered);

	// Keyed tables. The first `<Entry>` of every Infos file is a template with
	// every tag empty, which `str(entry, "zType") == null` drops.
	const byType = (entries: XmlNode[]): Map<string, XmlNode> => {
		const out = new Map<string, XmlNode>();
		for (const entry of entries) {
			const key = str(entry, "zType");
			if (key != null) out.set(key, entry);
		}
		return out;
	};
	const effectUnitXml = byType(effectUnitEntries);
	const unitXml = byType(unitEntries);
	const traitXml = byType(traitEntries);

	if (effectUnitXml.size === 0 || unitXml.size === 0 || traitXml.size === 0) {
		throw new Error(
			"bake-effect-units: effectUnit.xml, unit.xml or trait.xml produced no " +
				"entries — did the XML move?",
		);
	}

	// Display names for everything a clause links to, in XML order — which is
	// the enum order the C# loops walk, and so the order a grouped clause lists
	// its names in.
	const nameTable = (
		entries: XmlNode[],
		label: string,
	): Map<string, string> => {
		const out = new Map<string, string>();
		for (const entry of entries) {
			const key = str(entry, "zType");
			if (key == null) continue;
			const name = names.fromNode(entry);
			if (name == null) {
				throw new Error(`bake-effect-units: no ${label} name for ${key}`);
			}
			out.set(key, name);
		}
		return out;
	};
	const ordered = (table: Map<string, string>, label: string): OrderedNames => {
		const order = new Map([...table.keys()].map((k, i) => [k, i] as const));
		return {
			name: (key) => {
				const value = table.get(key);
				if (value == null) {
					throw new Error(`bake-effect-units: no ${label} name for ${key}`);
				}
				return value;
			},
			index: (key) => order.get(key) ?? Number.MAX_SAFE_INTEGER,
		};
	};
	// Only the traits this emits get a name, so an unrelated one whose own name
	// links to something else (TRAIT_ENVOY_TO_THE_HUNS names a tribe) is never
	// reached. Memoised because eight effect-unit names link to one of four
	// archetype traits that are also emitted in their own right.
	const traitNameCache = new Map<string, string>();
	const traitName = (traitType: string): string => {
		const cached = traitNameCache.get(traitType);
		if (cached != null) return cached;
		const node = traitXml.get(traitType);
		const name = node == null ? null : names.fromNode(node);
		if (name == null) {
			throw new Error(`bake-effect-units: no trait name for ${traitType}`);
		}
		traitNameCache.set(traitType, name);
		return name;
	};
	names.linkResolver = (zType) =>
		traitXml.has(zType) ? traitName(zType) : null;

	const unitTraitNames = nameTable(unitTraitEntries, "unit trait");
	const heightNames = nameTable(heightEntries, "height");
	const vegetationNames = nameTable(vegetationEntries, "vegetation");
	const terrainNames = nameTable(terrainEntries, "terrain");
	const yieldNames = nameTable(yieldEntries, "yield");
	const conceptNames = nameTable(conceptEntries, "concept");
	const terrainTargetXml = byType(terrainTargetEntries);
	const orderedHeights = ordered(heightNames, "height");
	const orderedVegetation = ordered(vegetationNames, "vegetation");
	const orderedUnitTraits = ordered(unitTraitNames, "unit trait");
	const orderedYields = ordered(yieldNames, "yield");

	// ── The closure: Character.getGeneralEffectUnits (Character.cs:10578) ──
	//
	// Walked over EVERY trait rather than one character's, so the table covers
	// any general. `isLeader()` gates the LeaderEffectUnit arm and the global
	// at render time, which is why they are recorded separately per trait.
	const traitGeneral = new Map<string, string[]>();
	const traitLeader = new Map<string, string[]>();
	const direct = new Set<string>();
	const reachable = new Set<string>();

	const requireEffectUnit = (type: string, from: string): XmlNode => {
		const node = effectUnitXml.get(type);
		if (node == null) {
			throw new Error(`bake-effect-units: ${from} names unknown ${type}`);
		}
		return node;
	};

	for (const [traitType, traitNode] of [...traitXml].sort(([a], [b]) =>
		a.localeCompare(b),
	)) {
		const general = str(traitNode, "GeneralEffectUnit");
		if (general != null) {
			const node = requireEffectUnit(general, traitType);
			const conferred = [general];
			direct.add(general);
			// The game does not recurse past this first hop, and neither does this.
			for (const unlocked of typeList(node, "aeEffectUnitUnlock")) {
				requireEffectUnit(unlocked, general);
				conferred.push(unlocked);
			}
			const adjacent = str(node, "AdjacentEffectUnit");
			if (adjacent != null) {
				requireEffectUnit(adjacent, general);
				conferred.push(adjacent);
			}
			traitGeneral.set(traitType, conferred);
			for (const type of conferred) reachable.add(type);
		}
		const leader = str(traitNode, "LeaderEffectUnit");
		if (leader != null) {
			requireEffectUnit(leader, traitType);
			traitLeader.set(traitType, [leader]);
			direct.add(leader);
			reachable.add(leader);
		}
	}

	const globals = new Map<string, string>();
	for (const entry of globalsTypeEntries) {
		const key = str(entry, "zType");
		const value = str(entry, "zValue");
		if (key != null && value != null) globals.set(key, value);
	}
	const leaderGeneral = globals.get("LEADER_GENERAL_EFFECTUNIT") ?? null;
	if (leaderGeneral != null) {
		requireEffectUnit(leaderGeneral, "LEADER_GENERAL_EFFECTUNIT");
		direct.add(leaderGeneral);
		reachable.add(leaderGeneral);
	}

	// ── The gate's two sides ──
	const unitFacts = new Map<string, UnitFacts>();
	for (const [unitType, node] of unitXml) {
		unitFacts.set(unitType, {
			water: bool(node, "bWater"),
			melee: bool(node, "bMelee"),
			rangeFlat: bool(node, "bRangeFlat"),
			rangeMax: int(node, "iRangeMax"),
			traits: new Set(typeList(node, "aeUnitTrait")),
			ownEffectUnits: typeList(node, "aeEffectUnit"),
			canHaveGeneral: bool(node, "bGeneral"),
		});
	}
	const effectUnitFacts = new Map<string, EffectUnitFacts>();
	for (const [effectType, node] of effectUnitXml) {
		effectUnitFacts.set(effectType, {
			noRoadCooldown: bool(node, "bNoRoadCooldown"),
			buildRoad: bool(node, "bBuildRoad"),
			rangeExtra: int(node, "iRangeExtra"),
			riverAttackModifier: int(node, "iRiverAttackModifier"),
			ignoresDistance: bool(node, "bIgnoresDistance"),
			attackValue: intPairs(node, "aiAttackValue"),
			attackPercent: intPairs(node, "aiAttackPercent"),
			unitTraitValid: boolPairs(node, "abUnitTraitValid"),
			unitTraitInvalid: boolPairs(node, "abUnitTraitInvalid"),
		});
	}

	// The gate's domain is the unit types a general can lead. `canHaveGeneral`
	// is the game's own test and the exact set — narrower than the military
	// UnitCycles, which also hold UNIT_MILITIA and UNIT_CONSCRIPT.
	const gateDomain = [...unitXml.keys()]
		.filter((u) => unitFacts.get(u)?.canHaveGeneral === true)
		.sort();

	// ── Per effect unit ──
	const emitted: Record<string, EmittedEffectUnit> = {};
	const unhandled = new Map<string, string[]>();
	const templatesNeeded = new Set<string>(FRAMEWORK_TEMPLATES);
	const clauseTags = new Set<string>();
	let clauseColumns = 0;

	for (const effectType of [...reachable].sort()) {
		const node = requireEffectUnit(effectType, "the closure");
		const name = names.fromNode(node);
		if (name == null) {
			throw new Error(`bake-effect-units: no name for ${effectType}`);
		}
		const row: EmittedEffectUnit = { name, direct: direct.has(effectType) };

		for (const tag of Object.keys(node)) {
			if (PRESENTATION.has(tag)) continue;
			if (GATE_COLUMNS.has(tag)) continue;
			if (NO_CLAUSE.has(tag)) continue;
			if (LINE_SUPPRESSED.has(tag)) continue;
			if ((NUMERIC as readonly string[]).includes(tag)) continue;
			if (CLAUSE_TEMPLATES[tag] == null) {
				const owners = unhandled.get(tag) ?? [];
				owners.push(effectType);
				unhandled.set(tag, owners);
			}
		}

		// NUMERIC: all six, so a patch that starts paying strength or attack
		// through a general's trait moves the data rather than this code.
		const numeric: Record<string, number> = {};
		for (const tag of NUMERIC) {
			const value = int(node, tag);
			if (value !== 0) {
				numeric[tag] = value;
			}
		}
		row.strengthModifier = numeric.iStrengthModifier;
		row.attackModifier = numeric.iAttackModifier;
		row.perLevelAttackModifier = numeric.iPerLevelAttackModifier;
		row.defenseModifier = numeric.iDefenseModifier;
		row.criticalChance = numeric.iCriticalChance;
		row.movementExtra = numeric.iMovementExtra;

		// CLAUSE columns, in the order buildEffectUnitHelp reaches them.
		const flag = (tag: string): true | undefined =>
			bool(node, tag) ? true : undefined;
		const value = (tag: string): number | undefined => {
			const n = int(node, tag);
			return n === 0 ? undefined : n;
		};

		row.fatigueExtra = value("iFatigueExtra");
		row.visionExtra = value("iVisionExtra");
		row.revealExtra = value("iRevealExtra");
		row.rangeExtra = value("iRangeExtra");
		row.actionsExtra = value("iActionsExtra");
		row.homeModifier = value("iHomeModifier");
		row.connectedAttackModifier = value("iConnectedAttackModifier");
		row.urbanAttackModifier = value("iUrbanAttackModifier");
		row.damagedUsModifier = value("iDamagedUsModifier");
		row.damagedThemModifier = value("iDamagedThemModifier");
		row.vsGeneralModifier = value("iVsGeneralModifier");
		row.flankingAttackModifier = value("iFlankingAttackModifier");
		row.adjacentSameModifier = value("iAdjacentSameModifier");
		row.healExtra = value("iHealExtra");
		row.zoc = flag("bZOC");
		row.rout = flag("bRout");
		row.stun = flag("bStun");
		row.lastStand = flag("bLastStand");
		row.criticalImmune = flag("bCriticalImmune");
		row.healKill = flag("bHealKill");
		row.healNeutral = flag("bHealNeutral");
		row.launchOffensive = flag("bLaunchOffensive");
		row.generalHopping = flag("bGeneralHopping");
		row.buildRoad = flag("bBuildRoad");
		const meleeCounterPercent = int(node, "iMeleeCounterPercent");
		row.meleeCounterPercent =
			meleeCounterPercent > 0 ? meleeCounterPercent : undefined;

		// Grouped `<Pair>` runs. `aiHeightFromModifier` and
		// `aiVegetationFromModifier` share one clause (FIGHT_FROM) and so share
		// one field, which is also the order the C# emits them in.
		const fightFrom = [
			...groupByValue(intPairs(node, "aiHeightFromModifier"), orderedHeights),
			...groupByValue(
				intPairs(node, "aiVegetationFromModifier"),
				orderedVegetation,
			),
		];
		row.fightFrom = fightFrom.length > 0 ? fightFrom : undefined;

		// Flat and in yield order: `buildEffectUnitHelp` loops the yields and
		// emits one line each, so EFFECTUNIT_PERICLES_LEADER's two yields are two
		// lines rather than one line naming both.
		const killYield = [...intPairs(node, "aiMilitaryKillYield")]
			.sort(([a], [b]) => orderedYields.index(a) - orderedYields.index(b))
			.map(([yieldType, value]) => ({
				yieldType,
				name: orderedYields.name(yieldType),
				value,
			}));
		row.militaryKillYield = killYield.length > 0 ? killYield : undefined;

		const vsUnitTrait = [
			...groupByValue(
				intPairs(node, "aiUnitTraitModifier"),
				orderedUnitTraits,
			).map((g) => ({ ...g, kind: "strength" as const })),
			...groupByValue(
				intPairs(node, "aiUnitTraitModifierAttack"),
				orderedUnitTraits,
			).map((g) => ({ ...g, kind: "attack" as const })),
			...groupByValue(
				intPairs(node, "aiUnitTraitModifierDefense"),
				orderedUnitTraits,
			).map((g) => ({ ...g, kind: "defense" as const })),
		];
		row.vsUnitTrait = vsUnitTrait.length > 0 ? vsUnitTrait : undefined;

		// `abHideTerrainTarget` resolves through terrainTarget.xml, which the
		// clause expands into the target's terrains, heights and vegetations
		// plus its fresh-water access, in that order.
		const hiddenIn: string[] = [];
		for (const target of boolPairs(node, "abHideTerrainTarget")) {
			const targetNode = terrainTargetXml.get(target);
			if (targetNode == null) {
				throw new Error(`bake-effect-units: no terrain target ${target}`);
			}
			// terrainTarget.xml spells these without the ae- prefix the C#
			// member names (`maeTerrains`, …) carry.
			const expand = (
				tag: string,
				table: Map<string, string>,
				label: string,
			): void => {
				for (const key of typeList(targetNode, tag)) {
					const name = table.get(key);
					if (name == null) {
						throw new Error(`bake-effect-units: no ${label} name for ${key}`);
					}
					hiddenIn.push(name);
				}
			};
			expand("Terrains", terrainNames, "terrain");
			expand("Heights", heightNames, "height");
			expand("Vegetations", vegetationNames, "vegetation");
			if (bool(targetNode, "bFreshWaterAccess")) {
				const name = conceptNames.get("CONCEPT_FRESH_WATER");
				if (name == null) {
					throw new Error("bake-effect-units: no CONCEPT_FRESH_WATER name");
				}
				hiddenIn.push(name);
			}
		}
		row.hiddenIn = hiddenIn.length > 0 ? hiddenIn : undefined;

		const adjacent = str(node, "AdjacentEffectUnit");
		if (adjacent != null) {
			const adjacentName = names.fromNode(
				requireEffectUnit(adjacent, effectType),
			);
			if (adjacentName == null) {
				throw new Error(`bake-effect-units: no name for ${adjacent}`);
			}
			row.adjacentEffectUnit = adjacentName;
		}

		// The APPLIES family. `buildEffectUnitHelp` picks its template from
		// whether the attacked and attacker payloads agree, so the branch is
		// resolved here and the row carries the key it chose.
		const attackApply = tuple(node, "AttackApplyEffectUnitTurns");
		const attackerApply = tuple(node, "AttackerApplyEffectUnitTurns");
		const applied = attackApply ?? attackerApply;
		if (applied != null) {
			const appliedName = names.fromNode(
				requireEffectUnit(applied.first, effectType),
			);
			if (appliedName == null) {
				throw new Error(`bake-effect-units: no name for ${applied.first}`);
			}
			// `buildEffectUnitHelp` picks one of nine templates from whether the
			// attacked and attacker payloads agree and how long the effect lasts.
			// `iTurns == 0 || eEffectUnit == eEffectUnitApply` collapse to the same
			// durationless wording, so both are normalised to 0 turns here.
			const family =
				attackApply != null &&
				attackerApply != null &&
				attackApply.first === attackerApply.first &&
				attackApply.second === attackerApply.second
					? "_BOTH"
					: attackApply != null
						? ""
						: "_ATTACKER";
			const turns = applied.first === effectType ? 0 : applied.second;
			const duration = turns === 0 ? "" : turns === 1 ? "_0" : "_NUM";
			const template = `TEXT_HELPTEXT_EFFECT_UNIT_APPLIES${family}${duration}`;
			templatesNeeded.add(template);
			row.attackApply = {
				template,
				effectUnit: appliedName,
				turns,
				adjacentOnly: bool(node, "bApplyEffectUnitAdjacentOnly"),
			};
		}

		const selfApply = tuple(node, "SelfApplyEffectUnitTurns");
		if (selfApply != null) {
			const selfName = names.fromNode(
				requireEffectUnit(selfApply.first, effectType),
			);
			if (selfName == null) {
				throw new Error(`bake-effect-units: no name for ${selfApply.first}`);
			}
			row.selfApply = selfName;
		}

		// The validity row, VALID-side and omitted when nothing fails.
		const facts = effectUnitFacts.get(effectType);
		if (facts == null) {
			throw new Error(`bake-effect-units: no gate facts for ${effectType}`);
		}
		const valid = gateDomain.filter((unitType) => {
			const unit = unitFacts.get(unitType);
			return unit != null && isEffectUnitValid(unit, facts, effectUnitFacts);
		});
		if (valid.length < gateDomain.length) row.validUnits = valid;

		// Count the clause columns that actually carry something, which is what
		// the renderer has to cover.
		for (const tag of Object.keys(node)) {
			if (CLAUSE_TEMPLATES[tag] != null) {
				clauseColumns += 1;
				clauseTags.add(tag);
				for (const template of CLAUSE_TEMPLATES[tag]) {
					templatesNeeded.add(template);
				}
			}
		}

		emitted[effectType] = row;
	}

	if (unhandled.size > 0) {
		const detail = [...unhandled]
			.map(([tag, owners]) => `${tag} (${owners.join(", ")})`)
			.join("; ");
		throw new Error(
			"bake-effect-units: effectUnit.xml columns reachable through a general " +
				"that no clause in $lib/game-detail/effect-unit-help covers — a " +
				"patch moved the data ahead of the code. Classify each one in " +
				`CLAUSE_TEMPLATES, NUMERIC, GATE_COLUMNS, NO_CLAUSE or LINE_SUPPRESSED: ${detail}`,
		);
	}

	// Templates, and the concepts their `link(...)` segments point at.
	const helpText: Record<string, string> = {};
	for (const key of [...templatesNeeded].sort()) {
		const template = names.template(key);
		if (template == null) {
			throw new Error(`bake-effect-units: no text for ${key}`);
		}
		helpText[key] = template;
	}
	// `buildZOCLinkVariable` / `buildUrbanLinkVariable` (HelpText.Game.cs:2687,
	// :2511) are concept links the clauses pass as arguments rather than
	// template content, so they join the ones scanned out of the templates.
	const concepts = new Set(["CONCEPT_ZOC", "CONCEPT_URBAN"]);
	for (const template of Object.values(helpText)) {
		for (const match of template.matchAll(/link\((CONCEPT_[A-Z0-9_]+)/g)) {
			concepts.add(match[1]);
		}
	}
	const conceptTable: Record<string, string> = {};
	for (const concept of [...concepts].sort()) {
		const name = conceptNames.get(concept);
		if (name == null) {
			throw new Error(`bake-effect-units: no concept name for ${concept}`);
		}
		conceptTable[concept] = name;
	}

	// Which effect units each trait reaches. No display name here: the pill
	// each group of rows sits under reads `traitName()`, over the whole of
	// trait.xml rather than this closure's 39 — see bake-trait-names.ts.
	// `traitName` above stays, because the link resolver still needs it to
	// name the effect units the game calls `link(TRAIT_HERO_ARCHETYPE) General`.
	const traits: Record<
		string,
		{ general?: readonly string[]; leader?: readonly string[] }
	> = {};
	for (const traitType of [
		...new Set([...traitGeneral.keys(), ...traitLeader.keys()]),
	].sort()) {
		traits[traitType] = {
			general: traitGeneral.get(traitType),
			leader: traitLeader.get(traitType),
		};
	}

	const formatted = await render({
		emitted,
		traits,
		leaderGeneral,
		helpText,
		conceptTable,
		gateDomainSize: gateDomain.length,
	});

	await mkdir(dirname(OUTPUT_TS), { recursive: true });
	if (existsSync(OUTPUT_TS)) {
		const existing = await readFile(OUTPUT_TS, "utf-8");
		if (existing === formatted) {
			console.log("bake-effect-units: no changes");
			return;
		}
	}
	await writeFile(OUTPUT_TS, formatted);

	const gatedCount = Object.values(emitted).filter(
		(r) => r.validUnits != null,
	).length;
	const directCount = Object.values(emitted).filter((r) => r.direct).length;
	console.log(
		`bake-effect-units: ${Object.keys(emitted).length} effect units reachable ` +
			`through a general (${directCount} trait-direct, ` +
			`${Object.keys(emitted).length - directCount} adjacency-only) over ` +
			`${Object.keys(traits).length} traits (${traitGeneral.size} general, ` +
			`${traitLeader.size} leader) plus LEADER_GENERAL_EFFECTUNIT; ` +
			`${clauseTags.size} distinct clause columns in ${clauseColumns} ` +
			"occurrences → " +
			`${Object.keys(helpText).length} templates, ` +
			`${Object.keys(conceptTable).length} concept names; ` +
			`${gatedCount} gated of ${Object.keys(emitted).length} over ` +
			`${gateDomain.length} unit types a general can lead → ` +
			OUTPUT_TS.replace(`${REPO_ROOT}/`, ""),
	);
}

async function render(data: {
	emitted: Record<string, EmittedEffectUnit>;
	traits: Record<
		string,
		{ general?: readonly string[]; leader?: readonly string[] }
	>;
	leaderGeneral: string | null;
	helpText: Record<string, string>;
	conceptTable: Record<string, string>;
	gateDomainSize: number;
}): Promise<string> {
	const lines = [
		"// AUTO-GENERATED by scripts/bake-effect-units.ts from Reference/XML/Infos.",
		"// Do not edit by hand — re-run `npm run bake:effect-units`.",
		"//",
		"// What a general's traits confer on the unit they lead, as",
		"// `HelpText.buildMakeGeneralLine` (HelpText.cs:4579) states it. Read",
		"// through `$lib/game-detail/unit-general` (the numbers) and",
		"// `$lib/game-detail/effect-unit-help` (the text), never directly.",
		"",
		"/** One grouped run of `<Pair>` names that share a value. */",
		"export interface EffectUnitValueGroup {",
		"\treadonly names: readonly string[];",
		"\treadonly value: number;",
		"}",
		"",
		"/** One yield a kill pays. The game's line shows the glyph, not the name. */",
		"export interface EffectUnitYield {",
		"\treadonly yieldType: string;",
		"\t/** The game's yield name, for the glyph's accessible name. */",
		"\treadonly name: string;",
		"\treadonly value: number;",
		"}",
		"",
		"/** What an effect unit applies to the units it fights. */",
		"export interface EffectUnitApply {",
		"\t/**",
		"\t * The `TEXT_HELPTEXT_EFFECT_UNIT_APPLIES*` key `buildEffectUnitHelp`",
		"\t * picks from the payload and the duration, resolved at bake time.",
		"\t */",
		"\treadonly template: string;",
		"\t/** The applied effect unit's own display name. */",
		"\treadonly effectUnit: string;",
		"\t/** 0 means until the start of the target's own turn. */",
		"\treadonly turns: number;",
		"\treadonly adjacentOnly: boolean;",
		"}",
		"",
		"export interface GeneralEffectUnit {",
		"\t/** The game's own name, from `<GenderedName>` — never formatEnum. */",
		"\treadonly name: string;",
		"\t/**",
		"\t * True when a trait (or `LEADER_GENERAL_EFFECT_UNIT`) names it directly,",
		"\t * which is what `buildMakeGeneralLine` calls `buildEffectUnitHelp` on.",
		"\t * False for one reached only through a parent's `AdjacentEffectUnit` or",
		"\t * `aeEffectUnitUnlock`: its numbers and its name are used, its clauses",
		"\t * are not.",
		"\t */",
		"\treadonly direct: boolean;",
		"\t/**",
		"\t * The unit types the display gate `Game.isEffectUnitValid`",
		"\t * (Game.cs:14409) lets it land on, of the ones a general can lead.",
		"\t * Absent means every one of them — so an unlisted unit type on a gated",
		"\t * entry renders nothing rather than claiming an effect the game denies.",
		"\t */",
		"\treadonly validUnits?: readonly string[];",
		"\t// ── The six the general line folds into its own totals ──",
		"\treadonly strengthModifier?: number;",
		"\treadonly attackModifier?: number;",
		"\treadonly perLevelAttackModifier?: number;",
		"\treadonly defenseModifier?: number;",
		"\treadonly criticalChance?: number;",
		"\treadonly movementExtra?: number;",
		"\t// ── Clause columns, in buildEffectUnitHelp's own order ──",
		"\treadonly fatigueExtra?: number;",
		"\treadonly visionExtra?: number;",
		"\treadonly revealExtra?: number;",
		"\treadonly rangeExtra?: number;",
		"\treadonly actionsExtra?: number;",
		"\treadonly homeModifier?: number;",
		"\treadonly connectedAttackModifier?: number;",
		"\treadonly urbanAttackModifier?: number;",
		"\treadonly damagedUsModifier?: number;",
		"\treadonly damagedThemModifier?: number;",
		"\treadonly vsGeneralModifier?: number;",
		"\treadonly flankingAttackModifier?: number;",
		"\treadonly adjacentSameModifier?: number;",
		"\treadonly healExtra?: number;",
		"\treadonly zoc?: true;",
		"\treadonly rout?: true;",
		"\treadonly stun?: true;",
		"\treadonly lastStand?: true;",
		"\treadonly criticalImmune?: true;",
		"\treadonly healKill?: true;",
		"\treadonly healNeutral?: true;",
		"\treadonly launchOffensive?: true;",
		"\treadonly generalHopping?: true;",
		"\treadonly buildRoad?: true;",
		"\treadonly meleeCounterPercent?: number;",
		"\t/** Height and vegetation runs, which share the FIGHT_FROM clause. */",
		"\treadonly fightFrom?: readonly EffectUnitValueGroup[];",
		"\t/** One line each, in yield order — these clauses do not group. */",
		"\treadonly militaryKillYield?: readonly EffectUnitYield[];",
		"\treadonly vsUnitTrait?: readonly (EffectUnitValueGroup & {",
		'\t\treadonly kind: "strength" | "attack" | "defense";',
		"\t})[];",
		"\t/** Terrain, height and vegetation names the unit hides in. */",
		"\treadonly hiddenIn?: readonly string[];",
		"\t/** The adjacent-aura effect unit's display name. */",
		"\treadonly adjacentEffectUnit?: string;",
		"\treadonly attackApply?: EffectUnitApply;",
		"\t/** The self-applied effect unit's display name. */",
		"\treadonly selfApply?: string;",
		"}",
		"",
		"/** A trait that confers effect units on a unit its holder leads. */",
		"export interface GeneralTrait {",
		"\t/**",
		"\t * `<GeneralEffectUnit>`, then that entry's `aeEffectUnitUnlock` and",
		"\t * `AdjacentEffectUnit` — the one hop `getGeneralEffectUnits`",
		"\t * (Character.cs:10578) takes.",
		"\t */",
		"\treadonly general?: readonly string[];",
		"\t/** `<LeaderEffectUnit>` — only for a general who is their own leader. */",
		"\treadonly leader?: readonly string[];",
		"}",
		"",
		`// The ${Object.keys(data.emitted).length} effect units a general can reach, keyed by zType.`,
		"export const GENERAL_EFFECT_UNITS: Readonly<",
		"\tRecord<string, GeneralEffectUnit>",
		`> = ${tsLiteral(data.emitted, "")};`,
		"",
		"export const GENERAL_TRAITS: Readonly<Record<string, GeneralTrait>> =",
		`\t${tsLiteral(data.traits, "\t")};`,
		"",
		"// `infos().Globals.LEADER_GENERAL_EFFECTUNIT`, conferred on every unit a",
		"// reigning leader leads, whatever their traits.",
		`export const LEADER_GENERAL_EFFECT_UNIT: string | null = ${JSON.stringify(
			data.leaderGeneral,
		)};`,
		"",
		"// The game's own templates, so a patch that rewords one moves this table",
		"// rather than the renderer. `$lib/game-detail/effect-unit-help` reads them.",
		"export const EFFECT_UNIT_HELP_TEXT: Readonly<Record<string, string>> =",
		`\t${tsLiteral(data.helpText, "\t")};`,
		"",
		"// The concepts those templates' `link(...)` segments name. Flattened to the",
		"// concept's own name on render — there is no encyclopedia here to link to —",
		'// which is why the name has to be the game\'s: CONCEPT_ZOC is "ZOC", where',
		'// formatEnum gives "Zoc".',
		"export const EFFECT_UNIT_CONCEPT_NAMES: Readonly<Record<string, string>> =",
		`\t${tsLiteral(data.conceptTable, "\t")};`,
		"",
	];
	const source = lines.join("\n");
	const config = await resolveConfig(OUTPUT_TS);
	return prettierFormat(source, {
		...config,
		parser: "typescript",
		filepath: OUTPUT_TS,
	});
}

await main();
