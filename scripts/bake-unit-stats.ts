// Bake the UNIT_<zType> → { strength, tech, naval, cycle, icon } table and the
// TECH_BONUS_UNITS bonus-card grants from the OW reference XML. UNIT_STATS
// powers the Military tab's "milpower built" figure (milpower per unit =
// displayed strength × 10 = the XML's <iStrength>), the unit-tech-unlock
// markers in the event rail, and the army-composition breakdown (via the
// game's own <UnitCycle> grouping — see classifyUnit). TECH_BONUS_UNITS powers
// the rail's bonus-card markers (cards that grant units on discovery).
//
// SOURCE (local-only, via the Reference/ resolver — set OLD_WORLD_REFERENCE_DIR
// to an OW install or an XML checkout such as the owtournamentatlas repo):
//   Reference/XML/Infos/unit.xml  — <Entry> with <zType>, <iStrength>,
//                                    <TechPrereq>, <zAudioMovementType>,
//                                    <UnitCycle>, <zIconName>
//   Reference/XML/Infos/tech.xml  — <Entry> with <zType>, <BonusDiscover>
//   Reference/XML/Infos/bonus.xml — <Entry> with <zType>, <aiUnits>
//
// Output: src/lib/generated/unit-stats.ts (committed; regenerate on Reference
// refresh). Deterministic — re-running with the same XML is byte-identical.

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { XMLParser } from "fast-xml-parser";

import { resolveReferenceXml } from "./lib/paths.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const OUT = resolve(REPO_ROOT, "src/lib/generated/unit-stats.ts");

interface UnitEntry {
	zType?: string;
	iStrength?: string;
	// fast-xml-parser collapses a single <TechPrereq> to a string but yields an
	// array if the tag ever repeats; take the first prereq in that case.
	TechPrereq?: string | string[];
	zAudioMovementType?: string;
	// The game's own unit grouping (UNITCYCLE_MILITARY_INFANTRY / _RANGED /
	// _MOUNTED / _SIEGE / _WATER for combat units, plus civilian cycles).
	UnitCycle?: string;
	// Some units render another unit's icon (e.g. UNIT_HITTITE_CHARIOT_1 →
	// UNIT_THREE_MEN_CHARIOT) and ship no sprite under their own name.
	zIconName?: string;
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

async function main(): Promise<void> {
	const infos = resolve(resolveReferenceXml(), "Infos");
	const entries = await loadEntries<UnitEntry>(resolve(infos, "unit.xml"));

	const stats: Record<
		string,
		{
			strength: number;
			tech: string | null;
			naval: boolean;
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
			// Displayed strength = <iStrength> / 10 (milpower = strength × 10).
			strength: iStrength / 10,
			tech:
				(Array.isArray(u.TechPrereq) ? u.TechPrereq[0] : u.TechPrereq) ?? null,
			naval: u.zAudioMovementType === "NAVAL",
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
			return `\t${JSON.stringify(k)}: { strength: ${s.strength}, tech: ${tech}, naval: ${s.naval}, cycle: ${cycle}, icon: ${icon} },`;
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
		`// (unit.xml, tech.xml, bonus.xml). Do not edit by hand — re-run\n` +
		`// \`npm run bake:unit-stats\`.\n` +
		`//\n` +
		`// strength = displayed unit strength (military power per unit = strength × 10).\n` +
		`// tech = the unit's unlocking tech (TechPrereq), or null. naval = sea unit.\n` +
		`// cycle = the game's <UnitCycle> grouping (UNITCYCLE_*), or null.\n` +
		`// icon = another unit whose sprite this unit renders (zIconName), or null.\n\n` +
		`export interface UnitStat {\n` +
		`\tstrength: number;\n` +
		`\ttech: string | null;\n` +
		`\tnaval: boolean;\n` +
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

	await writeFile(OUT, out, "utf-8");
	console.log(
		`[unit-stats] wrote ${keys.length} units, ${Object.keys(bonusUnits).length} bonus-card grants → ${OUT}`,
	);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
