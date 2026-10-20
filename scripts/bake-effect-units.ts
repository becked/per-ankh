// Bake the effect units a unit can carry, their display names and glyphs, and
// the six columns the game's own attack and defense are computed from.
//
// WHAT THE CARD IS MIRRORING. `Unit.modifiedAttack` / `modifiedDefense`
// (Unit.cs:6366) are `modify(baseStrength(), baseStrengthModifier() +
// base{Attack,Defense}Modifier())`, and all three modifiers sum
// `getEffectUnits()` — the unit's own effect-unit dictionary. The save writes
// no resolved effect-unit list, but it does not need to: the game rebuilds the
// dictionary on every load from inputs the blob also carries, so the same
// number is derivable. `$lib/game-detail/unit-combat` is that reconstruction,
// and this table is what it reads.
//
// THE CHANNELS. `SourceEffectUnitType` (Enums.cs:234) has nine, and each one
// seeds the dictionary from a different table. Five of them are emitted here:
//
//   UNIT       `Unit.init` (Unit.cs:5258) adds the unit type's own
//              `aeEffectUnit` and each of its `aeUnitTrait` traits'
//              `meEffectUnit` → UNIT_EFFECT_UNITS.
//   PROMOTION  `Unit.loadPromotion` (Unit.cs:4671) adds the promotion's
//              `meEffectUnit` → PROMOTION_EFFECT_UNITS. `<BonusEffectUnits>`
//              shares the channel (`loadBonusEffectUnit`, Unit.cs:4485) but
//              names an effect unit directly, so it needs no table.
//   TRAIT      `Character.resetTraitEffectUnit` (Character.cs:6433) adds each
//              of the general's traits' `meGeneralEffectUnit`, plus
//              `meLeaderEffectUnit` and `LEADER_GENERAL_EFFECTUNIT` for a
//              general who reigns → GENERAL_TRAITS.
//   FAMILY     `Unit.changeFamily` (Unit.cs:4344) adds the band its own
//              player's opinion of its family falls in
//              → FAMILY_OPINION_EFFECT_UNITS. The family class's
//              `EffectCity.aeTraitEffectUnit` is the channel's other half and
//              is deliberately absent: the three entries that carry one
//              (TRADERS, RIDERS, HUNTERS) confer an effect unit with none of
//              the six columns, so it would be a table nothing reads.
//   EFFECT_PLAYER
//              `Player.changeEffectPlayerCount` (Player.cs:9296) pushes the
//              player's effect players onto every unit it owns, as
//              `meEffectUnit`, `maeEffectUnitTrait[trait]` and
//              `maeEffectUnit[unit]` → COMBAT_EFFECT_PLAYERS, with the
//              unit-trait arm resolved into unit types so the runtime needs no
//              unit-trait table. Ten of the 282 effect players confer an
//              effect unit carrying one of the six columns, and `main` asserts
//              that every one of them is named by `advantage.xml`'s
//              `EffectPlayer` or a trait's `LeaderEffectPlayer` — the two
//              tables ADVANTAGE_EFFECT_PLAYER and LEADER_EFFECT_PLAYER cover.
//              The rest of the accumulation (techs, laws, nation, dynasty,
//              state religion, council, projects, goals, improvements, family
//              supremacy, occurrences) reaches no combat-bearing effect
//              player, so it is not modelled rather than modelled and unused.
//
// THE CLOSURE. `changeEffectUnit` (Unit.cs:5061) recurses into the added
// entry's own `aeEffectUnitUnlock` and its `AdjacentEffectUnit` ("adjacent
// effect affects us too", `:5154`) with the same source — so one seed can put
// several effect units on the unit. Each row therefore carries its `unlocks`,
// the children of that recursion, and the runtime walks them. The recursion is
// inside the validity gate, so a parent the gate denies blocks its children.
//
// THE GATE. `Game.isEffectUnitValid(eUnit, eEffectUnit)` (Game.cs:14409) with
// `bCheckGameSettings` left false. That overload reads only effectUnit.xml and
// unit.xml — no game state — so the whole gate resolves here into a
// per-effect-unit list of the unit types it is valid on. Two arms stay out,
// each for a reason: the game-settings arm `Game.isEffectUnitValid`
// (Game.cs:14326), which no caller here reaches, and the instance arm of
// `Unit.isEffectUnitValid` (Unit.cs:4829), which tests whether anything the
// unit ALREADY carries lists the newcomer in `aeEffectUnitImmune`/
// `aeEffectUnitInvalid`. That arm is vacuous for the channels above — only the
// four `EFFECTUNIT_PLAGUE_*` entries carry `aeEffectUnitInvalid`, and no
// channel emitted here reaches one — which `main` asserts rather than assumes.
//
// `validUnits` is emitted VALID-side and only for an effect unit that some
// unit type fails, so a unit type missing from a re-bake fails closed (no row)
// rather than claiming an effect the game would deny. The gate applies only to
// the channels that pass it: `Unit.init` and `loadPromotion` both call
// `changeEffectUnit` with `bForce: true`, so a unit's innate and promoted
// effect units bypass it; the TRAIT channel does not force and is gated.
//
// SOURCES (local-only, via the Reference/ resolver), under Reference/XML/Infos/:
//   effectUnit.xml    — the 179 entries, their columns, <GenderedName> and
//                       <zIconName> (the glyph, baked by bake-sprites.ts into
//                       the `effect-units` category)
//   unit.xml          — <aeEffectUnit>, <aeUnitTrait>, and the gate's unit side
//   unitTrait.xml     — <EffectUnit> per unit trait
//   promotion.xml     — <EffectUnit> per promotion
//   trait.xml         — <GeneralEffectUnit> / <LeaderEffectUnit> /
//                       <LeaderEffectPlayer>
//   globalsType.xml   — LEADER_GENERAL_EFFECTUNIT
//   opinionFamily.xml — <EffectUnit> per band
//   effectPlayer.xml  — <EffectUnit>, <aeEffectUnitTrait>, <aeEffectUnit>
//   advantage.xml     — <EffectPlayer> per advantage tier
//   genderedText*.xml — <GenderedName> → TEXT_*, merged across base + DLC
//   text-*.xml        — <zType> → <en-US>, merged across base + DLC
//
// OUTPUT: src/lib/generated/effect-units.ts (checked in, self-contained — no
// .bake sidecar, so bake:finalize cannot empty it in a checkout where this has
// not run; the arrangement bake-character-opinion.ts and bake-trait-names.ts
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
// stays distinguishable from an absent tag.
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
 * as `{ __cdata: … }`, so unwrap that before stringifying.
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
 * only the non-zero entries.
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

/** `<aeFoo><Pair><zIndex>K</zIndex><zValue>V</zValue></Pair>…</aeFoo>`. */
function typePairs(node: XmlNode, tag: string): [string, string][] {
	const out: [string, string][] = [];
	const list = node[tag];
	if (list == null || typeof list !== "object") return out;
	for (const pair of asArray((list as XmlNode).Pair as XmlNode | XmlNode[])) {
		const key = str(pair, "zIndex");
		const value = str(pair, "zValue");
		if (key != null && value != null) out.push([key, value]);
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

// ─── Name resolution ─────────────────────────────────────────────────────

/**
 * `<GenderedName>` → genderedText.xml → `TEXT_*` → the en-US string. The
 * masculine form is the base noun; every entry that carries a feminine variant
 * carries the masculine one too, so there is no arm for a missing masculine.
 */
const MASCULINE = "GRAMMATICAL_GENDER_MASCULINE";

class Names {
	/**
	 * Resolves a `link(X)` that appears inside another name, against the tables
	 * `main` wires in. Three kinds of thing are linked from an effect unit's
	 * name: a character trait (`link(TRAIT_HERO_ARCHETYPE) General` and its
	 * seven siblings), a unit trait (`link(UNITTRAIT_INFANTRY) Commander` and
	 * its sibling for ships) and a family-opinion band
	 * (`link(OPINIONFAMILY_ANGRY) Family`). A link to anything else throws
	 * rather than being approximated.
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
		// first segment is the bare noun, as the promotion-name bake read it.
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
}

// ─── The six columns the game's attack and defense read ──────────────────
//
// `baseStrengthModifier` (Unit.cs:6334) sums `miStrengthModifier` over the
// dictionary, plus `ifDamagedModifier(false)` (`:6786`, which sums
// `miDamagedUsModifier`) when the unit is damaged, plus `hasGeneralModifier`
// (`:6836`, which sums `miHasGeneralModifier`) when it has a general.
// `baseAttackModifier` (`:6512`) sums `miAttackModifier` and
// `miPerLevelAttackModifier × getLevel()`. `baseDefenseModifier` (`:6536`)
// sums `miDefenseModifier`. Those six, and no others, are what a row carries.
//
// Every other `effectUnit.xml` modifier is situational — read by
// `attackUnitStrength` / `defendUnitStrength` against a particular opponent on
// a particular tile, not by `modifiedAttack` / `modifiedDefense` — so it is
// deliberately absent rather than unclassified.
const COLUMNS = {
	strengthModifier: "iStrengthModifier",
	attackModifier: "iAttackModifier",
	perLevelAttackModifier: "iPerLevelAttackModifier",
	defenseModifier: "iDefenseModifier",
	damagedUsModifier: "iDamagedUsModifier",
	hasGeneralModifier: "iHasGeneralModifier",
} as const;

type ColumnKey = keyof typeof COLUMNS;

/**
 * Whether `type`'s closure pays any of the six columns — the test that keeps
 * the effect-player table to rows `$lib/game-detail/unit-combat` reads.
 */
function paysCombat(
	type: string,
	effectUnitXml: ReadonlyMap<string, XmlNode>,
	seen: Set<string> = new Set(),
): boolean {
	if (seen.has(type)) return false;
	seen.add(type);
	const node = effectUnitXml.get(type);
	if (node == null) return false;
	for (const tag of Object.values(COLUMNS)) {
		if (int(node, tag) !== 0) return true;
	}
	const children = [...typeList(node, "aeEffectUnitUnlock")];
	const adjacent = str(node, "AdjacentEffectUnit");
	if (adjacent != null) children.push(adjacent);
	return children.some((child) => paysCombat(child, effectUnitXml, seen));
}

/**
 * `aeEffectUnitInvalid` is the one column that would make the gate's instance
 * arm (`Unit.isEffectUnitValid`, Unit.cs:4829) non-vacuous for the channels
 * this bakes — it tests the unit's LIVE list, which a save does not write. The
 * bake asserts no reachable entry carries it, so the day a patch moves it onto
 * one, this fails rather than quietly over-counting.
 */
const INSTANCE_GATE_COLUMN = "aeEffectUnitInvalid";

// ─── The gate ────────────────────────────────────────────────────────────

interface UnitFacts {
	readonly water: boolean;
	readonly melee: boolean;
	readonly rangeFlat: boolean;
	readonly rangeMax: number;
	readonly traits: ReadonlySet<string>;
	/** The unit type's own innate effect units — two gate clauses read them. */
	readonly ownEffectUnits: readonly string[];
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

// ─── The effect-player accumulation ──────────────────────────────────────

/**
 * Every `(file, tag)` that CONFERS an effect player on a player — the XML side
 * of each `changeEffectPlayerCount` call site in the game. A combat-bearing
 * effect player named by any site outside the two this module can answer fails
 * the bake, so the list is what makes that check mean something: it has to
 * stay the whole set, not the subset that happens to matter today.
 *
 *   globalsType.xml  BASE_EFFECTPLAYER        Player.cs:15898
 *   gameOption.xml   EffectPlayer             Player.cs:15904
 *   difficulty.xml   EffectPlayer             Player.cs:15908
 *   advantage.xml    EffectPlayer             Player.cs:15912  (AI only)
 *   dynasty.xml      EffectPlayer             Player.cs:7447
 *   nation.xml       EffectPlayer             Player.cs:7551
 *   religion.xml     EffectPlayerState        Player.cs:7849
 *                    EffectPlayerUpkeep       Player.cs:7850
 *   theology.xml     StateReligionEffectPlayer Player.cs:7856
 *   tech.xml         EffectPlayer             Player.cs:8460
 *   law.xml          EffectPlayer             Player.cs:10705
 *                    EffectPlayerUpkeep       Player.cs:10706
 *   trait.xml        LeaderEffectPlayer       Player.cs:11997, Character.cs:6386
 *                    aeCouncilEffectPlayer    Character.cs:6391, Player.cs:10225
 *   cognomen.xml     EffectPlayer             Character.cs:4731
 *   project*.xml     EffectPlayer             City.cs:5098
 *   occurrence.xml   EffectPlayer             Game.cs:9378
 *   goal.xml         EffectPlayer             Player.cs:15167
 *   family.xml       SupremacyEffectPlayer    Player.cs:22520
 *   improvement*.xml EffectPlayer             Tile.cs:6620
 *   effectPlayer.xml EffectPlayer             Player.cs:9677  (the chain)
 */
const CONFERRING_TAGS: Readonly<Record<string, readonly string[]>> = {
	"advantage.xml": ["EffectPlayer"],
	"cognomen.xml": ["EffectPlayer"],
	"difficulty.xml": ["EffectPlayer"],
	"dynasty.xml": ["EffectPlayer"],
	"effectPlayer.xml": ["EffectPlayer"],
	"family.xml": ["SupremacyEffectPlayer"],
	"gameOption.xml": ["EffectPlayer"],
	"globalsType.xml": ["zValue"],
	"goal.xml": ["EffectPlayer"],
	"law.xml": ["EffectPlayer", "EffectPlayerUpkeep"],
	"nation.xml": ["EffectPlayer"],
	"occurrence.xml": ["EffectPlayer"],
	"religion.xml": ["EffectPlayerState", "EffectPlayerUpkeep"],
	"tech.xml": ["EffectPlayer"],
	"theology.xml": ["StateReligionEffectPlayer"],
	"trait.xml": ["LeaderEffectPlayer", "aeCouncilEffectPlayer"],
};

/**
 * The same tags on the DLC-split siblings of those files, which carry further
 * entries of the same info type — `improvement-*.xml`, `project-event-*.xml`,
 * `tech-*.xml` and so on. Matched by stem so a new DLC file is covered without
 * an edit.
 */
const CONFERRING_STEMS: Readonly<Record<string, readonly string[]>> = {
	improvement: ["EffectPlayer"],
	project: ["EffectPlayer"],
};

/** The two sites `$lib/game-detail/unit-combat` can answer from the blob. */
const ANSWERABLE_SITES = new Set([
	"advantage.xml:EffectPlayer",
	"trait.xml:LeaderEffectPlayer",
]);

/**
 * Every effect player any table confers on a player, mapped to the
 * `file.xml:tag` sites that confer it. One absent from this map is unreachable:
 * nothing in the game's own data can give it to anyone.
 */
async function loadConferringSites(
	infosDir: string,
): Promise<Map<string, string[]>> {
	const sites = new Map<string, string[]>();
	const record = (effectPlayer: string, site: string): void => {
		if (!effectPlayer.startsWith("EFFECTPLAYER_")) return;
		const existing = sites.get(effectPlayer);
		if (existing == null) sites.set(effectPlayer, [site]);
		else if (!existing.includes(site)) existing.push(site);
	};
	for (const file of await readdir(infosDir)) {
		if (!file.endsWith(".xml")) continue;
		// A DLC split carries further entries of the same info type, so the
		// stem's tags apply to it too (improvement-eoti.xml, project-event-wd.xml).
		const stem = file.replace(/\.xml$/, "").split("-")[0];
		const tags = [
			...(CONFERRING_TAGS[file] ?? []),
			...(CONFERRING_STEMS[stem] ?? []),
		];
		if (tags.length === 0) continue;
		for (const entry of await loadEntries(resolve(infosDir, file))) {
			for (const tag of tags) {
				const scalar = str(entry, tag);
				if (scalar != null) record(scalar, `${file}:${tag}`);
				for (const [, value] of typePairs(entry, tag)) {
					record(value, `${file}:${tag}`);
				}
			}
		}
	}
	return sites;
}

// ─── Emission ────────────────────────────────────────────────────────────

/** What one effect player puts on a unit, with the unit-trait arm resolved. */
interface EmittedEffectPlayer {
	all?: string;
	byUnit?: Record<string, string>;
}

interface EmittedEffectUnit {
	name: string;
	icon: string;
	validUnits?: readonly string[];
	strengthModifier?: number;
	attackModifier?: number;
	perLevelAttackModifier?: number;
	defenseModifier?: number;
	damagedUsModifier?: number;
	hasGeneralModifier?: number;
	unlocks?: readonly string[];
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
		unitEntries,
		unitTraitEntries,
		promotionEntries,
		traitEntries,
		globalsTypeEntries,
		opinionFamilyEntries,
		effectPlayerEntries,
		advantageEntries,
		textGroups,
		genderedGroups,
	] = await Promise.all([
		load("effectUnit.xml"),
		load("unit.xml"),
		load("unitTrait.xml"),
		load("promotion.xml"),
		load("trait.xml"),
		load("globalsType.xml"),
		load("opinionFamily.xml"),
		load("effectPlayer.xml"),
		load("advantage.xml"),
		Promise.all(textFiles.map(load)),
		Promise.all(genderedFiles.map(load)),
	]);

	// Merge the base and DLC text tables, base first — the tech, project and
	// trait name bakes merge them the same way.
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
	const unitTraitXml = byType(unitTraitEntries);
	const promotionXml = byType(promotionEntries);
	const traitXml = byType(traitEntries);
	const effectPlayerXml = byType(effectPlayerEntries);

	if (
		effectUnitXml.size === 0 ||
		unitXml.size === 0 ||
		promotionXml.size === 0 ||
		traitXml.size === 0
	) {
		throw new Error(
			"bake-effect-units: effectUnit.xml, unit.xml, promotion.xml or " +
				"trait.xml produced no entries — did the XML move?",
		);
	}

	// A rename guard on the six columns the computation folds: each has to be
	// a column the current table actually uses somewhere, or the fold is
	// silently summing nothing.
	for (const [field, tag] of Object.entries(COLUMNS)) {
		const used = [...effectUnitXml.values()].some((n) => int(n, tag) !== 0);
		if (!used) {
			throw new Error(
				`bake-effect-units: no effectUnit.xml entry carries <${tag}>, the ` +
					`column $lib/game-detail/unit-combat folds as \`${field}\` — ` +
					"either the game renamed it or it stopped being paid",
			);
		}
	}

	// Only the entries a link actually points at get a name, so an unrelated
	// one whose own name links to something else (TRAIT_ENVOY_TO_THE_HUNS names
	// a tribe) is never resolved. Memoised because eight effect-unit names link
	// to one of four archetype traits. The tables are tried in order; a zType
	// none of them holds leaves the link unresolved, which Names turns into a
	// throw naming the table to add.
	const LINK_TABLES: readonly [string, Map<string, XmlNode>][] = [
		["trait", traitXml],
		["unit trait", unitTraitXml],
		["family-opinion band", byType(opinionFamilyEntries)],
	];
	const linkNameCache = new Map<string, string>();
	names.linkResolver = (zType) => {
		const cached = linkNameCache.get(zType);
		if (cached != null) return cached;
		for (const [label, table] of LINK_TABLES) {
			const node = table.get(zType);
			if (node == null) continue;
			const name = names.fromNode(node);
			if (name == null) {
				throw new Error(`bake-effect-units: no ${label} name for ${zType}`);
			}
			linkNameCache.set(zType, name);
			return name;
		}
		return null;
	};

	const requireEffectUnit = (type: string, from: string): XmlNode => {
		const node = effectUnitXml.get(type);
		if (node == null) {
			throw new Error(`bake-effect-units: ${from} names unknown ${type}`);
		}
		return node;
	};

	// ── The channels, each a map of seeds ──
	const reachable = new Set<string>();
	const seed = (type: string | null, from: string): string | null => {
		if (type == null) return null;
		requireEffectUnit(type, from);
		reachable.add(type);
		return type;
	};

	// UNIT: `Unit.init` (Unit.cs:5258).
	const unitEffectUnits: Record<string, readonly string[]> = {};
	for (const [unitType, node] of [...unitXml].sort(([a], [b]) =>
		a.localeCompare(b),
	)) {
		const own: string[] = [];
		for (const effectUnit of typeList(node, "aeEffectUnit")) {
			const kept = seed(effectUnit, `${unitType}'s aeEffectUnit`);
			if (kept != null) own.push(kept);
		}
		for (const unitTrait of typeList(node, "aeUnitTrait")) {
			const traitNode = unitTraitXml.get(unitTrait);
			if (traitNode == null) {
				throw new Error(
					`bake-effect-units: ${unitType} names unknown unit trait ${unitTrait}`,
				);
			}
			const kept = seed(str(traitNode, "EffectUnit"), `${unitTrait}`);
			if (kept != null) own.push(kept);
		}
		if (own.length > 0) unitEffectUnits[unitType] = own;
	}

	// PROMOTION: `Unit.loadPromotion` (Unit.cs:4671). `<BonusEffectUnits>`
	// shares the channel (`loadBonusEffectUnit`, Unit.cs:4485) but names an
	// effect unit directly, so it needs no table of its own.
	const promotionEffectUnits: Record<string, string> = {};
	for (const [promotion, node] of [...promotionXml].sort(([a], [b]) =>
		a.localeCompare(b),
	)) {
		const kept = seed(str(node, "EffectUnit"), promotion);
		if (kept != null) promotionEffectUnits[promotion] = kept;
	}

	// TRAIT: `Character.resetTraitEffectUnit` (Character.cs:6433). The leader
	// arm is recorded separately because `isLeader()` gates it at render time.
	const traits: Record<string, { general?: string; leader?: string }> = {};
	for (const [traitType, node] of [...traitXml].sort(([a], [b]) =>
		a.localeCompare(b),
	)) {
		const general = seed(str(node, "GeneralEffectUnit"), traitType);
		const leader = seed(str(node, "LeaderEffectUnit"), traitType);
		if (general != null || leader != null) {
			traits[traitType] = {
				general: general ?? undefined,
				leader: leader ?? undefined,
			};
		}
	}

	const globals = new Map<string, string>();
	for (const entry of globalsTypeEntries) {
		const key = str(entry, "zType");
		const value = str(entry, "zValue");
		if (key != null && value != null) globals.set(key, value);
	}
	// `Character.resetAllTraitEffectUnit` (Character.cs:6455) adds this to the
	// unit of any general who is their player's reigning leader, whatever
	// their traits.
	const leaderGeneral = seed(
		globals.get("LEADER_GENERAL_EFFECTUNIT") ?? null,
		"LEADER_GENERAL_EFFECTUNIT",
	);

	// FAMILY: `Unit.changeFamily` (Unit.cs:4344) adds the band its own player's
	// opinion of its family falls in. The neutral band carries no effect unit
	// and so no entry.
	const familyOpinionEffectUnits: Record<string, string> = {};
	for (const entry of opinionFamilyEntries) {
		const band = str(entry, "zType");
		if (band == null) continue;
		const kept = seed(str(entry, "EffectUnit"), band);
		if (kept != null) familyOpinionEffectUnits[band] = kept;
	}

	// EFFECT_PLAYER: the three forms `Player.changeEffectPlayerCount`
	// (Player.cs:9763-9808) pushes onto a unit. The unit-trait arm is resolved
	// into unit types here — `pLoopUnit.info().maeUnitTrait.Contains(trait)` is
	// unit.xml data — so the runtime needs no unit-trait table.
	const traitsOfUnit = new Map<string, ReadonlySet<string>>();
	for (const [unitType, node] of unitXml) {
		traitsOfUnit.set(unitType, new Set(typeList(node, "aeUnitTrait")));
	}
	const combatEffectPlayers: Record<string, EmittedEffectPlayer> = {};
	for (const [effectPlayer, node] of [...effectPlayerXml].sort(([a], [b]) =>
		a.localeCompare(b),
	)) {
		const all = str(node, "EffectUnit");
		const byUnit: Record<string, string> = {};
		for (const [unitTrait, effectUnit] of typePairs(
			node,
			"aeEffectUnitTrait",
		)) {
			for (const [unitType, traits] of traitsOfUnit) {
				if (traits.has(unitTrait)) byUnit[unitType] = effectUnit;
			}
		}
		for (const [unitType, effectUnit] of typePairs(node, "aeEffectUnit")) {
			byUnit[unitType] = effectUnit;
		}
		// Only the rows that pay one of the six columns somewhere in their
		// closure: the rest confer an effect unit nothing here would read, and
		// whether a player HAS one is a question the blob can only answer for
		// the two tables below.
		const conferred = [all, ...Object.values(byUnit)].filter(
			(t): t is string => t != null,
		);
		if (!conferred.some((type) => paysCombat(type, effectUnitXml))) continue;
		for (const type of conferred) seed(type, effectPlayer);
		const sortedByUnit: Record<string, string> = {};
		for (const key of Object.keys(byUnit).sort()) {
			sortedByUnit[key] = byUnit[key];
		}
		combatEffectPlayers[effectPlayer] = {
			all: all ?? undefined,
			byUnit: Object.keys(sortedByUnit).length > 0 ? sortedByUnit : undefined,
		};
	}

	// The two tables that name a combat-bearing effect player, and the only two
	// the blob can answer: the game's own `<Advantage>` (which
	// `initPlayerEffects`, Player.cs:15896, gives every non-human player) and a
	// trait's `LeaderEffectPlayer` (which `Player.cs:11997` adds for the
	// reigning leader's traits).
	const advantageEffectPlayer: Record<string, string> = {};
	for (const entry of advantageEntries) {
		const advantage = str(entry, "zType");
		const effectPlayer = str(entry, "EffectPlayer");
		if (advantage == null || effectPlayer == null) continue;
		if (combatEffectPlayers[effectPlayer] == null) continue;
		advantageEffectPlayer[advantage] = effectPlayer;
	}
	const leaderEffectPlayer: Record<string, string> = {};
	for (const [traitType, node] of [...traitXml].sort(([a], [b]) =>
		a.localeCompare(b),
	)) {
		const effectPlayer = str(node, "LeaderEffectPlayer");
		if (effectPlayer == null) continue;
		if (combatEffectPlayers[effectPlayer] == null) continue;
		leaderEffectPlayer[traitType] = effectPlayer;
	}

	// Every combat-bearing effect player has to be conferred by one of those two
	// sites and nothing else, or the accumulation is silently missing a term.
	// So every conferring site in the game's tables is scanned, and a patch
	// that hangs one off a tech, a law or a nation fails the bake here rather
	// than shipping an attack number that is quietly low. An effect player no
	// site confers at all is unreachable — EFFECTPLAYER_DYNASTY_MARIUS is —
	// rather than a gap, so it is dropped once the check has run.
	const conferringSites = await loadConferringSites(infosDir);
	const unanswerable = new Map<string, string[]>();
	for (const effectPlayer of Object.keys(combatEffectPlayers)) {
		const sites = (conferringSites.get(effectPlayer) ?? []).filter(
			(site) => !ANSWERABLE_SITES.has(site),
		);
		if (sites.length > 0) unanswerable.set(effectPlayer, sites);
	}
	if (unanswerable.size > 0) {
		throw new Error(
			"bake-effect-units: these effect players confer an effect unit that " +
				"pays one of the six columns, and something other than an " +
				"advantage's <EffectPlayer> or a trait's <LeaderEffectPlayer> gives " +
				"them to a player — so $lib/game-detail/unit-combat cannot tell " +
				"which players have them. Widen the accumulation to cover the site, " +
				"or drop the column: " +
				[...unanswerable]
					.map(
						([effectPlayer, sites]) => `${effectPlayer} (${sites.join(", ")})`,
					)
					.join("; "),
		);
	}
	for (const effectPlayer of Object.keys(combatEffectPlayers)) {
		if (!conferringSites.has(effectPlayer)) {
			delete combatEffectPlayers[effectPlayer];
		}
	}

	// ── The closure `changeEffectUnit` recurses into ──
	// Walked to a fixed point, because a child can have children of its own:
	// the C# recursion has no depth limit and no visited set, so the data has
	// no cycle for one to guard against.
	const childrenOf = (type: string): string[] => {
		const node = requireEffectUnit(type, "the closure");
		const children = [...typeList(node, "aeEffectUnitUnlock")];
		const adjacent = str(node, "AdjacentEffectUnit");
		if (adjacent != null) children.push(adjacent);
		return children;
	};
	for (const queue = [...reachable]; queue.length > 0;) {
		const type = queue.pop() as string;
		for (const child of childrenOf(type)) {
			requireEffectUnit(child, type);
			if (!reachable.has(child)) {
				reachable.add(child);
				queue.push(child);
			}
		}
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

	// Every unit type, not just the ones that can hold a general: the gate's
	// domain is whoever an effect unit can be offered to, and the gated
	// channels reach civilians too.
	const gateDomain = [...unitXml.keys()].sort();

	// ── Per effect unit ──
	const emitted: Record<string, EmittedEffectUnit> = {};
	for (const effectType of [...reachable].sort()) {
		const node = requireEffectUnit(effectType, "the closure");
		const name = names.fromNode(node);
		if (name == null) {
			throw new Error(`bake-effect-units: no name for ${effectType}`);
		}
		if (boolPairs(node, INSTANCE_GATE_COLUMN).size > 0) {
			throw new Error(
				`bake-effect-units: ${effectType} carries <${INSTANCE_GATE_COLUMN}>, ` +
					"so the instance arm of Unit.isEffectUnitValid (Unit.cs:4829) is no " +
					"longer vacuous for the channels this bakes — it tests the unit's " +
					"live effect-unit list, which a save does not write",
			);
		}
		const row: EmittedEffectUnit = {
			name,
			// The art is named by <zIconName>, which 23 of the entries a unit can
			// carry spell differently from their zType; an entry with none names
			// its own art. bake-sprites.ts bakes these under `effect-units/`.
			icon: str(node, "zIconName") ?? effectType,
		};

		for (const [field, tag] of Object.entries(COLUMNS) as [
			ColumnKey,
			string,
		][]) {
			const value = int(node, tag);
			if (value !== 0) row[field] = value;
		}

		const children = childrenOf(effectType);
		if (children.length > 0) row.unlocks = children;

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

		emitted[effectType] = row;
	}

	const formatted = await render({
		emitted,
		unitEffectUnits,
		promotionEffectUnits,
		traits,
		leaderGeneral,
		familyOpinionEffectUnits,
		combatEffectPlayers,
		advantageEffectPlayer,
		leaderEffectPlayer,
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
	const renamedIcons = Object.entries(emitted).filter(
		([type, row]) => row.icon !== type,
	).length;
	console.log(
		`bake-effect-units: ${Object.keys(emitted).length} effect units of ` +
			`${effectUnitXml.size} reachable by a unit (${renamedIcons} whose glyph ` +
			`is named by <zIconName> rather than their zType) over ` +
			`${Object.keys(unitEffectUnits).length} unit types of ${unitXml.size}, ` +
			`${Object.keys(promotionEffectUnits).length} promotions of ` +
			`${promotionXml.size} and ${Object.keys(traits).length} traits of ` +
			`${traitXml.size} plus LEADER_GENERAL_EFFECTUNIT, ` +
			`${Object.keys(familyOpinionEffectUnits).length} family-opinion bands ` +
			`and ${Object.keys(combatEffectPlayers).length} combat-bearing effect ` +
			`players of ${effectPlayerXml.size} ` +
			`(${Object.keys(advantageEffectPlayer).length} from an advantage, ` +
			`${Object.keys(leaderEffectPlayer).length} from a leader's trait); ` +
			`${gatedCount} gated over ${gateDomain.length} unit types → ` +
			OUTPUT_TS.replace(`${REPO_ROOT}/`, ""),
	);
}

async function render(data: {
	emitted: Record<string, EmittedEffectUnit>;
	unitEffectUnits: Record<string, readonly string[]>;
	promotionEffectUnits: Record<string, string>;
	traits: Record<string, { general?: string; leader?: string }>;
	leaderGeneral: string | null;
	familyOpinionEffectUnits: Record<string, string>;
	combatEffectPlayers: Record<string, EmittedEffectPlayer>;
	advantageEffectPlayer: Record<string, string>;
	leaderEffectPlayer: Record<string, string>;
}): Promise<string> {
	const lines = [
		"// AUTO-GENERATED by scripts/bake-effect-units.ts from Reference/XML/Infos.",
		"// Do not edit by hand — re-run `npm run bake:effect-units`.",
		"//",
		"// The effect units a unit can carry, their glyphs, and the six columns",
		"// `Unit.modifiedAttack` / `modifiedDefense` (Unit.cs:6366) are summed from.",
		"// Read through `$lib/game-detail/unit-combat`, never directly.",
		"",
		"export interface EffectUnit {",
		"\t/** The game's own name, from `<GenderedName>` — never formatEnum. */",
		"\treadonly name: string;",
		"\t/**",
		"\t * `<zIconName>` — the key the `effect-units` sprite category takes,",
		"\t * which is NOT the zType for 23 of the entries a unit can carry.",
		"\t */",
		"\treadonly icon: string;",
		"\t/**",
		"\t * The unit types the display gate `Game.isEffectUnitValid`",
		"\t * (Game.cs:14409) lets it land on. Absent means every one of them — so",
		"\t * an unlisted unit type on a gated entry drops the effect rather than",
		"\t * claiming one the game denies. Only the channels that do not pass",
		"\t * `bForce` are gated; a unit's innate and promoted effect units are not.",
		"\t */",
		"\treadonly validUnits?: readonly string[];",
		"\t// ── The six the game's attack and defense are summed from ──",
		"\treadonly strengthModifier?: number;",
		"\treadonly attackModifier?: number;",
		"\treadonly perLevelAttackModifier?: number;",
		"\treadonly defenseModifier?: number;",
		"\t/** Paid only while the unit is damaged (`ifDamagedModifier`, Unit.cs:6786). */",
		"\treadonly damagedUsModifier?: number;",
		"\t/** Paid only while the unit has a general (`hasGeneralModifier`, Unit.cs:6836). */",
		"\treadonly hasGeneralModifier?: number;",
		"\t/**",
		"\t * `aeEffectUnitUnlock` and `AdjacentEffectUnit`, which",
		"\t * `changeEffectUnit` (Unit.cs:5061) adds alongside this one under the",
		"\t * same source — so one seed can put several effect units on the unit.",
		"\t */",
		"\treadonly unlocks?: readonly string[];",
		"}",
		"",
		`// The ${Object.keys(data.emitted).length} effect units a unit can carry, keyed by zType.`,
		"export const EFFECT_UNITS: Readonly<Record<string, EffectUnit>> =",
		`\t${tsLiteral(data.emitted, "\t")};`,
		"",
		"// The UNIT channel: what a unit type carries from birth — its own",
		"// `aeEffectUnit` plus each of its `aeUnitTrait` traits' `EffectUnit`,",
		"// which `Unit.init` (Unit.cs:5258) adds with `bForce: true`. A unit type",
		"// that carries none is absent.",
		"export const UNIT_EFFECT_UNITS: Readonly<Record<string, readonly string[]>> =",
		`\t${tsLiteral(data.unitEffectUnits, "\t")};`,
		"",
		"// The PROMOTION channel: the effect unit a promotion confers, which",
		"// `Unit.loadPromotion` (Unit.cs:4671) also adds with `bForce: true`.",
		"export const PROMOTION_EFFECT_UNITS: Readonly<Record<string, string>> =",
		`\t${tsLiteral(data.promotionEffectUnits, "\t")};`,
		"",
		"/** A trait that confers an effect unit on a unit its holder leads. */",
		"export interface GeneralTrait {",
		"\t/** `<GeneralEffectUnit>` — conferred by any general who holds the trait. */",
		"\treadonly general?: string;",
		"\t/** `<LeaderEffectUnit>` — only for a general who is their own leader. */",
		"\treadonly leader?: string;",
		"}",
		"",
		"// The TRAIT channel: `Character.resetTraitEffectUnit`",
		"// (Character.cs:6433), which is gated — unlike the two above, it does not",
		"// pass `bForce`, so `validUnits` applies.",
		"export const GENERAL_TRAITS: Readonly<Record<string, GeneralTrait>> =",
		`\t${tsLiteral(data.traits, "\t")};`,
		"",
		"// `infos().Globals.LEADER_GENERAL_EFFECTUNIT`, conferred on every unit a",
		"// reigning leader leads, whatever their traits.",
		`export const LEADER_GENERAL_EFFECT_UNIT: string | null = ${JSON.stringify(
			data.leaderGeneral,
		)};`,
		"",
		"// The FAMILY channel: the effect unit the band its own player's opinion of",
		"// its family falls in confers, which `Unit.changeFamily` (Unit.cs:4344)",
		"// adds \u2014 gated, like the trait channel. The neutral band confers none and",
		"// so has no entry.",
		"export const FAMILY_OPINION_EFFECT_UNITS: Readonly<",
		"\tRecord<string, string>",
		`> = ${tsLiteral(data.familyOpinionEffectUnits, "")};`,
		"",
		"/** What one effect player puts on a unit, as the three forms it takes. */",
		"export interface EffectPlayerConferral {",
		"\t/** `meEffectUnit` \u2014 every unit the player owns. */",
		"\treadonly all?: string;",
		"\t/**",
		"\t * `maeEffectUnitTrait[trait]` and `maeEffectUnit[unit]`, both resolved",
		"\t * into unit types at bake time \u2014 the unit-trait arm tests",
		"\t * `info().maeUnitTrait`, which is unit.xml data, so the runtime needs no",
		"\t * unit-trait table of its own.",
		"\t */",
		"\treadonly byUnit?: Readonly<Record<string, string>>;",
		"}",
		"",
		"// The EFFECT_PLAYER channel, narrowed to the effect players that confer an",
		"// effect unit paying one of the six columns. The bake asserts that every",
		"// one of them is conferred only by an advantage's `<EffectPlayer>` or a",
		"// trait's `<LeaderEffectPlayer>` \u2014 the two tables below \u2014 so this is the",
		"// whole of the accumulation that can move a unit's attack or defense.",
		"export const COMBAT_EFFECT_PLAYERS: Readonly<",
		"\tRecord<string, EffectPlayerConferral>",
		`> = ${tsLiteral(data.combatEffectPlayers, "")};`,
		"",
		"// `<Game Advantage=\u2026>` \u2192 the effect player `Player.initPlayerEffects`",
		"// (Player.cs:15896) gives every NON-HUMAN player. Only the",
		"// ADVANTAGE_PENALTY_* tiers appear: the bonus tiers confer no effect unit.",
		"export const ADVANTAGE_EFFECT_PLAYER: Readonly<Record<string, string>> =",
		`\t${tsLiteral(data.advantageEffectPlayer, "\t")};`,
		"",
		"// A trait \u2192 the effect player it confers while its holder reigns",
		"// (`Player.cs:11997`). Keyed by the trait, so the card asks it about the",
		"// player's LEADER rather than about the unit's general.",
		"export const LEADER_EFFECT_PLAYER: Readonly<Record<string, string>> =",
		`\t${tsLiteral(data.leaderEffectPlayer, "\t")};`,
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
