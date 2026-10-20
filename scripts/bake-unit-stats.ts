// Bake the UNIT_<zType> → { name, strength, tech, naval, cycle, icon } table and
// the TECH_BONUS_UNITS bonus-card grants from the OW reference XML. UNIT_STATS
// powers the Military tab's "milpower built" figure (milpower per unit =
// displayed strength × 10 = the XML's <iStrength>), the unit-tech-unlock
// markers in the event rail, the army-composition breakdown (via the game's
// own <UnitCycle> grouping — see classifyUnit), and — through `unitName` —
// every label a unit wears. TECH_BONUS_UNITS powers the rail's bonus-card
// markers (cards that grant units on discovery).
//
// SOURCE (local-only, via the Reference/ resolver — set OLD_WORLD_REFERENCE_DIR
// to an OW install or an XML checkout such as the owtournamentatlas repo):
//   Reference/XML/Infos/unit.xml  — <Entry> with <zType>, <Name>, <iStrength>,
//                                    <TechPrereq>, <zAudioMovementType>,
//                                    <UnitCycle>, <zIconName>,
//                                    <RequiresReligion>, <BuildReligion>
//   Reference/XML/Infos/tech.xml  — <Entry> with <zType>, <BonusDiscover>
//   Reference/XML/Infos/bonus.xml — <Entry> with <zType>, <aiUnits>
//   Reference/XML/Infos/text-*.xml, genderedText*.xml, religion.xml — the
//                                    name resolution below
//
// NAMES resolve the way `HelpText.buildUnitNameVariable` (HelpText.Game.cs:2704)
// does: <Name> keys a TEXT_* entry whose <en-US> is a `~`-separated noun list,
// of which index 0 is the singular the UI shows. A religion unit's entry
// substitutes its religion — TEXT_UNIT_RELIGION_DISCIPLE is
// "{UNIT-RELIGION,1} Disciple" — and the religion comes from
// <RequiresReligion> (`InfoHelpers.getUnitReligion`, InfoHelpers.cs:3353)
// falling back to <BuildReligion>, resolved through the religion's
// <GenderedName> at the masculine pair, which is what GenderType.NONE picks
// (`InfoHelpers.getGenderedName`, InfoHelpers.cs:2868). A game that renames a
// religion overrides this at runtime (`HelpText.buildReligionVariable` reads
// `Game.getCustomName`); a baked table carries the default name.
//
// An unresolvable name THROWS rather than falling back, the way
// bake-trait-names.ts treats an unexpected link() — a silent formatEnum here
// is exactly the defect the table exists to end.
//
// Output: src/lib/generated/unit-stats.ts (frontend) and cloud/src/generated/
// unit-stats.ts (Worker — the challenge scorer's generated mirror reads it; the
// wonders dual-emit pattern). Committed; regenerate on Reference refresh.
// Deterministic — re-running with the same XML is byte-identical.

import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { XMLParser } from "fast-xml-parser";
import { format as prettierFormat, resolveConfig } from "prettier";

import { stripMarkup } from "../src/lib/utils/formatting.js";
import { resolveReferenceXml } from "./lib/paths.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const OUTPUTS = [
	resolve(REPO_ROOT, "src/lib/generated/unit-stats.ts"),
	resolve(REPO_ROOT, "cloud/src/generated/unit-stats.ts"),
];

interface UnitEntry {
	zType?: string;
	// TEXT_* key for the unit's display name; the `~`-separated noun list it
	// points at is resolved by `unitDisplayName`.
	Name?: string;
	iStrength?: string;
	// fast-xml-parser collapses a single <TechPrereq> to a string but yields an
	// array if the tag ever repeats; take the first prereq in that case.
	TechPrereq?: string | string[];
	// Set on a nation's unique units (Hoplite → NATION_GREECE); absent otherwise.
	NationPrereq?: string;
	zAudioMovementType?: string;
	// The game's own unit grouping (UNITCYCLE_MILITARY_INFANTRY / _RANGED /
	// _MOUNTED / _SIEGE / _WATER for combat units, plus civilian cycles).
	UnitCycle?: string;
	// Some units render another unit's icon (e.g. UNIT_HITTITE_CHARIOT_1 →
	// UNIT_THREE_MEN_CHARIOT) and ship no sprite under their own name.
	zIconName?: string;
	// The religion a religion unit's name substitutes. `getUnitReligion`
	// prefers <RequiresReligion>; <BuildReligion> is the fallback.
	RequiresReligion?: string;
	BuildReligion?: string;
}

interface TextEntry {
	zType?: string;
	"en-US"?: string;
}

// fast-xml-parser collapses a single <Pair> to an object; zIndex is the
// grammatical gender, zValue the TEXT_* key for that gender.
type GenderedPair = { zIndex?: string; zValue?: string };
interface GenderedTextEntry {
	zType?: string;
	Texts?: { Pair?: GenderedPair | GenderedPair[] };
}

interface ReligionEntry {
	zType?: string;
	GenderedName?: string;
}

interface TechEntry {
	zType?: string;
	// A bonus-card tech's payload lives on the referenced bonus.xml entry.
	BonusDiscover?: string;
}

// fast-xml-parser collapses a single <Pair> to an object, an XML list to an
// array; zIndex is the unit, iValue the count (string — parseTagValue off).
type XmlPair = { zIndex?: string; iValue?: string };
interface BonusEntry {
	zType?: string;
	aiUnits?: { Pair?: XmlPair | XmlPair[] };
}

const parser = new XMLParser({
	ignoreAttributes: true,
	parseTagValue: false,
	ignoreDeclaration: true,
	ignorePiTags: true,
});

async function loadEntries<T>(path: string): Promise<T[]> {
	const xml = await readFile(path, "utf-8");
	const parsed = parser.parse(xml) as {
		Root?: { Entry?: T | T[] };
	};
	const entry = parsed.Root?.Entry;
	if (entry == null) return [];
	return Array.isArray(entry) ? entry : [entry];
}

// Every Infos file matching `pattern`, flattened into one entry list — the
// merge bake-specialists.ts and bake-improvement-names.ts do, because the
// strings one name needs are spread across files (a unit's own name is in
// text-unit.xml, the religion it substitutes in text-eoti.xml).
async function loadMerged<T>(infosDir: string, pattern: RegExp): Promise<T[]> {
	const files = (await readdir(infosDir)).filter((f) => pattern.test(f)).sort();
	const lists = await Promise.all(
		files.map((f) => loadEntries<T>(resolve(infosDir, f))),
	);
	return lists.flat();
}

// One noun out of a `~`-separated TEXT_* list: 0 singular, 1 the adjectival
// form the religion placeholder asks for, 2 plural. An index the list doesn't
// reach is null rather than index 0 — falling back there would spell a
// disciple's religion as the noun ("Buddhism Disciple"), which is the name
// this table exists to stop.
function noun(
	key: string | undefined,
	index: number,
	textByKey: Map<string, string>,
): string | null {
	if (!key) return null;
	const raw = textByKey.get(key);
	if (!raw) return null;
	return stripMarkup(raw).split("~")[index]?.trim() || null;
}

// The name the game shows for a unit type, religion substituted. Throws on
// anything it can't resolve — see NAMES in the header.
function unitDisplayName(
	zType: string,
	unit: UnitEntry,
	textByKey: Map<string, string>,
	religionName: (religion: string, index: number) => string | null,
): string {
	const base = noun(unit.Name, 0, textByKey);
	if (base == null) {
		throw new Error(
			`bake-unit-stats: no <en-US> name for ${zType} (<Name>${unit.Name ?? ""})`,
		);
	}
	const religion = unit.RequiresReligion ?? unit.BuildReligion ?? null;
	const name = base.replace(/\{UNIT-RELIGION,(\d+)\}/g, (_m, index) => {
		if (religion == null) {
			throw new Error(
				`bake-unit-stats: ${zType} substitutes a religion into its name but ` +
					"declares neither <RequiresReligion> nor <BuildReligion>",
			);
		}
		const resolved = religionName(religion, Number(index));
		if (resolved == null) {
			throw new Error(
				`bake-unit-stats: no noun ${index} for ${religion}, which ${zType} ` +
					"substitutes into its name",
			);
		}
		return resolved;
	});
	if (/[{}]/.test(name)) {
		throw new Error(
			`bake-unit-stats: ${zType} name "${name}" keeps an unresolved placeholder`,
		);
	}
	return name;
}

// Emit through Prettier so the committed file matches `npm run format`.
async function formatTs(path: string, source: string): Promise<string> {
	return prettierFormat(source, {
		...(await resolveConfig(path)),
		parser: "typescript",
		filepath: path,
	});
}

async function main(): Promise<void> {
	const infos = resolve(resolveReferenceXml(), "Infos");
	const [entries, textEntries, genderedEntries, religionEntries] =
		await Promise.all([
			loadEntries<UnitEntry>(resolve(infos, "unit.xml")),
			loadMerged<TextEntry>(infos, /^text-.*\.xml$/),
			loadMerged<GenderedTextEntry>(infos, /^genderedText.*\.xml$/),
			loadEntries<ReligionEntry>(resolve(infos, "religion.xml")),
		]);

	const textByKey = new Map<string, string>();
	for (const t of textEntries) {
		if (t.zType && t["en-US"]) textByKey.set(t.zType, t["en-US"]);
	}
	// GenderType.NONE resolves to the masculine pair, so that is the only one
	// a unit name ever reads.
	const masculineText = new Map<string, string>();
	for (const g of genderedEntries) {
		if (!g.zType) continue;
		const pairs = g.Texts?.Pair;
		const list = pairs == null ? [] : Array.isArray(pairs) ? pairs : [pairs];
		const masculine = list.find(
			(pair) => pair.zIndex === "GRAMMATICAL_GENDER_MASCULINE",
		);
		if (masculine?.zValue) masculineText.set(g.zType, masculine.zValue);
	}
	const genderedNameOf = new Map(
		religionEntries
			.filter((r) => r.zType && r.GenderedName)
			.map((r) => [r.zType as string, r.GenderedName as string]),
	);
	const religionName = (religion: string, index: number): string | null =>
		noun(
			masculineText.get(genderedNameOf.get(religion) ?? ""),
			index,
			textByKey,
		);

	const stats: Record<
		string,
		{
			name: string;
			strength: number;
			tech: string | null;
			naval: boolean;
			nation: string | null;
			cycle: string | null;
			icon: string | null;
		}
	> = {};
	for (const u of entries) {
		const zType = u.zType;
		if (!zType || !zType.startsWith("UNIT_")) continue;
		const iStrength = u.iStrength != null ? Number(u.iStrength) : NaN;
		if (!Number.isFinite(iStrength) || iStrength <= 0) continue; // non-combat
		const icon = u.zIconName ?? null;
		stats[zType] = {
			name: unitDisplayName(zType, u, textByKey, religionName),
			// Displayed strength = <iStrength> / 10 (milpower = strength × 10).
			strength: iStrength / 10,
			tech:
				(Array.isArray(u.TechPrereq) ? u.TechPrereq[0] : u.TechPrereq) ?? null,
			naval: u.zAudioMovementType === "NAVAL",
			nation: u.NationPrereq ?? null,
			// Raw <UnitCycle>; classifyUnit maps the military cycles to chart
			// classes and treats civilian cycles as non-combat.
			cycle: u.UnitCycle ?? null,
			// Borrowed icon only — null when the unit's sprite is its own name.
			icon: icon !== null && icon !== zType ? icon : null,
		};
	}

	// Bonus-card unit grants: tech.xml <BonusDiscover> → bonus.xml <aiUnits>.
	// Keyed by the bonus tech id exactly as it appears in a save's
	// tech_discovery_history; grants keep civilian units too (consumers filter).
	const techs = await loadEntries<TechEntry>(resolve(infos, "tech.xml"));
	const bonuses = await loadEntries<BonusEntry>(resolve(infos, "bonus.xml"));
	const bonusById = new Map(bonuses.map((b) => [b.zType, b]));
	const bonusUnits: Record<string, { unit: string; count: number }[]> = {};
	for (const t of techs) {
		if (!t.zType || !t.BonusDiscover) continue;
		const pair = bonusById.get(t.BonusDiscover)?.aiUnits?.Pair;
		if (pair == null) continue;
		const grants = (Array.isArray(pair) ? pair : [pair])
			.filter((p) => p.zIndex != null && Number(p.iValue) > 0)
			.map((p) => ({ unit: p.zIndex as string, count: Number(p.iValue) }));
		if (grants.length > 0) bonusUnits[t.zType] = grants;
	}

	const keys = Object.keys(stats).sort();
	const body = keys
		.map((k) => {
			const s = stats[k];
			const tech = s.tech == null ? "null" : JSON.stringify(s.tech);
			const cycle = s.cycle == null ? "null" : JSON.stringify(s.cycle);
			const icon = s.icon == null ? "null" : JSON.stringify(s.icon);
			const nation = s.nation == null ? "null" : JSON.stringify(s.nation);
			return `\t${JSON.stringify(k)}: { name: ${JSON.stringify(s.name)}, strength: ${s.strength}, tech: ${tech}, naval: ${s.naval}, nation: ${nation}, cycle: ${cycle}, icon: ${icon} },`;
		})
		.join("\n");

	const bonusBody = Object.keys(bonusUnits)
		.sort()
		.map((k) => {
			const grants = bonusUnits[k]
				.map((g) => `{ unit: ${JSON.stringify(g.unit)}, count: ${g.count} }`)
				.join(", ");
			return `\t${JSON.stringify(k)}: [${grants}],`;
		})
		.join("\n");

	const out =
		`// AUTO-GENERATED by scripts/bake-unit-stats.ts from Reference/XML/Infos\n` +
		`// (unit.xml, tech.xml, bonus.xml, and text-*.xml / genderedText*.xml /\n` +
		`// religion.xml for the names). Do not edit by hand — re-run\n` +
		`// \`npm run bake:unit-stats\`.\n` +
		`//\n` +
		`// name = the name the game shows (<Name> → text-*.xml, religion\n` +
		`// substituted) — read it through \`unitName\`, never formatEnum.\n` +
		`// strength = displayed unit strength (military power per unit = strength × 10).\n` +
		`// tech = the unit's unlocking tech (TechPrereq), or null. naval = sea unit.\n` +
		`// nation = the nation whose unique unit this is (NationPrereq), or null.\n` +
		`// cycle = the game's <UnitCycle> grouping (UNITCYCLE_*), or null.\n` +
		`// icon = another unit whose sprite this unit renders (zIconName), or null.\n\n` +
		`export interface UnitStat {\n` +
		`\tname: string;\n` +
		`\tstrength: number;\n` +
		`\ttech: string | null;\n` +
		`\tnaval: boolean;\n` +
		`\tnation: string | null;\n` +
		`\tcycle: string | null;\n` +
		`\ticon: string | null;\n` +
		`}\n\n` +
		`export const UNIT_STATS: Readonly<Record<string, UnitStat>> = {\n` +
		`${body}\n};\n\n` +
		`// Units granted outright when a bonus-card tech is taken\n` +
		`// (tech.xml <BonusDiscover> → bonus.xml <aiUnits>), keyed by the bonus\n` +
		`// tech id as recorded in tech_discovery_history. Includes civilian grants\n` +
		`// (Worker/Settler cards) — filter with classifyUnit where only combat\n` +
		`// units matter.\n` +
		`export interface BonusUnitGrant {\n` +
		`\tunit: string;\n` +
		`\tcount: number;\n` +
		`}\n\n` +
		`export const TECH_BONUS_UNITS: Readonly<\n` +
		`\tRecord<string, readonly BonusUnitGrant[]>\n` +
		`> = {\n` +
		`${bonusBody}\n};\n`;

	for (const out_ of OUTPUTS)
		await writeFile(out_, await formatTs(out_, out), "utf-8");
	console.log(
		`[unit-stats] wrote ${keys.length} units, ${Object.keys(bonusUnits).length} bonus-card grants → ${OUTPUTS.map((o) => o.replace(REPO_ROOT + "/", "")).join(", ")}`,
	);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
