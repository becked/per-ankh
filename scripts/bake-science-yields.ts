// Bake the base science income of improvements and specialists from the OW
// reference XML, so the Techs tab's key-science-tech tooltips can show what
// a player's standing buildings/staff actually earn ("at least +X science").
//
// SOURCES (local-only, via the Reference/ symlink resolved by paths.ts):
//   Reference/XML/Infos/improvement.xml — <aiYieldOutput>/<aiYieldRate> on the
//     entry, plus <EffectCity> → effectCity.xml <aiYieldRate> (flat science)
//     and <aiYieldModifier> (percent science, e.g. libraries).
//   Reference/XML/Infos/improvementClass.xml — <aaiResourceYieldOutput>:
//     per-resource outputs of resource-sited classes (a Grove's science is
//     entirely here — +2 on every grove resource — not on the improvement).
//   Reference/XML/Infos/specialist.xml — <EffectCity> + <EffectCityExtra>
//     (the Apprentice/Master/Elder extras carry the tier science) resolved
//     through effectCity.xml the same way.
//   Reference/XML/Infos/rating.xml — <aiYieldCourtRate> on RATING_WISDOM: the
//     per-turn science a court character earns off their Wisdom.
//   Reference/XML/Infos/yield.xml — YIELD_SCIENCE <iTriangleOffset>, the offset
//     the court rating curve (Utils.triangleOffset) is evaluated at.
//   Reference/XML/Infos/globalsInt.xml — RATING_EQUIVALENT_LOWER_CHARACTER_YIELDS,
//     the rating Competitive Mode linearizes the court curve around.
//   Reference/XML/Infos/effectPlayer.xml — EFFECTPLAYER_COMPETITIVE_MODE
//     <aiYieldRate> YIELD_SCIENCE, Competitive Mode's flat science stipend.
//   Reference/XML/Infos/lawClass.xml + law.xml — each law class carries the
//     <TechPrereq> and each law its <Class>; inverted into the tech →
//     laws-it-unlocks table the tech-timeline ◆ markers use.
//   Reference/XML/Infos/tech.xml — <iCost> per tech, resolved through each
//     source's unlocking tech into the *_UNLOCK_COST tables that order the
//     Science Sources rows early-tech → late-tech.
//
// Values are the game's ×10 fixed-point; emitted ÷10 in display units. The
// one exception is WISDOM_COURT_SCIENCE_RATE — see its comment below.
// Only science-positive entries are emitted. Shrines additionally get their
// type — War/Fire/Sun/Wisdom/… — from the <AssetVariation> suffix (the same
// source owreference's shrine page uses).
//
// OUTPUT: src/lib/generated/science-yields.ts (checked in, self-contained —
// no .bake sidecar, so bake:finalize never wipes it when this hasn't run).
//
// Run: npm run bake:science-yields

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { XMLParser } from "fast-xml-parser";
import { format as prettierFormat, resolveConfig } from "prettier";

import { resolveReferenceXml } from "./lib/paths.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const OUTPUT_TS = resolve(REPO_ROOT, "src/lib/generated/science-yields.ts");

interface YieldPair {
	zIndex?: string;
	iValue?: string;
}
interface SubPair {
	zSubIndex?: string;
	iValue?: string;
}
interface ResourceYieldPair {
	zIndex?: string;
	SubPair?: SubPair | SubPair[];
}
interface Entry {
	zType?: string;
	Class?: string;
	AssetVariation?: string;
	EffectCity?: string;
	EffectCityExtra?: string;
	TechPrereq?: string;
	LawClass?: string;
	Specialist?: string;
	zIconName?: string;
	iCost?: string;
	iValue?: string;
	iTriangleOffset?: string;
	aiYieldOutput?: { Pair?: YieldPair | YieldPair[] };
	aiYieldRate?: { Pair?: YieldPair | YieldPair[] };
	aiYieldModifier?: { Pair?: YieldPair | YieldPair[] };
	aiYieldCourtRate?: { Pair?: YieldPair | YieldPair[] };
	aiImprovementClassModifier?: { Pair?: YieldPair | YieldPair[] };
	aaiResourceYieldOutput?: { Pair?: ResourceYieldPair | ResourceYieldPair[] };
}

const parser = new XMLParser({
	ignoreAttributes: true,
	parseTagValue: false,
	ignoreDeclaration: true,
	ignorePiTags: true,
});

async function loadEntries(path: string): Promise<Entry[]> {
	const xml = await readFile(path, "utf-8");
	const parsed = parser.parse(xml) as { Root?: { Entry?: Entry | Entry[] } };
	const entry = parsed.Root?.Entry;
	if (entry == null) return [];
	return Array.isArray(entry) ? entry : [entry];
}

function pairs(block?: { Pair?: YieldPair | YieldPair[] }): YieldPair[] {
	const p = block?.Pair;
	if (p == null) return [];
	return Array.isArray(p) ? p : [p];
}

function yieldValue(block: YieldPair[], yieldType: string): number {
	return block
		.filter((p) => p.zIndex === yieldType)
		.reduce((t, p) => t + Number(p.iValue ?? 0), 0);
}

async function main(): Promise<void> {
	const infosDir = resolve(resolveReferenceXml(), "Infos");
	const [
		improvements,
		improvementClasses,
		specialists,
		effects,
		ratings,
		yields,
		globalInts,
		effectPlayers,
		laws,
		lawClasses,
		techs,
	] = await Promise.all([
		loadEntries(resolve(infosDir, "improvement.xml")),
		loadEntries(resolve(infosDir, "improvementClass.xml")),
		loadEntries(resolve(infosDir, "specialist.xml")),
		loadEntries(resolve(infosDir, "effectCity.xml")),
		loadEntries(resolve(infosDir, "rating.xml")),
		loadEntries(resolve(infosDir, "yield.xml")),
		loadEntries(resolve(infosDir, "globalsInt.xml")),
		loadEntries(resolve(infosDir, "effectPlayer.xml")),
		loadEntries(resolve(infosDir, "law.xml")),
		loadEntries(resolve(infosDir, "lawClass.xml")),
		loadEntries(resolve(infosDir, "tech.xml")),
	]);

	const effectByType = new Map(effects.map((e) => [e.zType, e]));

	// The court constants are single scalars rather than tables, so a silent
	// 0 from a renamed tag would poison the breakdown rather than show up as
	// a missing row. Fail the bake instead.
	const findEntry = (
		entries: Entry[],
		zType: string,
		source: string,
	): Entry => {
		const found = entries.find((e) => e.zType === zType);
		if (!found)
			throw new Error(`bake-science-yields: ${zType} not in ${source}`);
		return found;
	};
	const requireInt = (raw: string | undefined, what: string): number => {
		const n = Number(raw);
		if (raw == null || Number.isNaN(n)) {
			throw new Error(`bake-science-yields: ${what} missing or non-numeric`);
		}
		return n;
	};

	// RATING_WISDOM is the only rating with a science court rate (Charisma
	// pays Civics, Courage Training, Discipline Money), so the leader's court
	// science is this term alone.
	const wisdomCourtScienceRate = yieldValue(
		pairs(findEntry(ratings, "RATING_WISDOM", "rating.xml").aiYieldCourtRate),
		"YIELD_SCIENCE",
	);
	if (wisdomCourtScienceRate === 0) {
		throw new Error(
			"bake-science-yields: RATING_WISDOM has no YIELD_SCIENCE aiYieldCourtRate",
		);
	}
	const scienceTriangleOffset = requireInt(
		findEntry(yields, "YIELD_SCIENCE", "yield.xml").iTriangleOffset,
		"YIELD_SCIENCE iTriangleOffset",
	);
	const competitiveEquivalentRating = requireInt(
		findEntry(
			globalInts,
			"RATING_EQUIVALENT_LOWER_CHARACTER_YIELDS",
			"globalsInt.xml",
		).iValue,
		"RATING_EQUIVALENT_LOWER_CHARACTER_YIELDS iValue",
	);
	const competitiveScienceStipend =
		yieldValue(
			pairs(
				findEntry(
					effectPlayers,
					"EFFECTPLAYER_COMPETITIVE_MODE",
					"effectPlayer.xml",
				).aiYieldRate,
			),
			"YIELD_SCIENCE",
		) / 10;

	// Per-resource science of resource-sited improvement classes (groves):
	// class → { RESOURCE_* → display science }.
	const classResourceScience = new Map<string, Record<string, number>>();
	for (const cls of improvementClasses) {
		if (!cls.zType) continue;
		const p = cls.aaiResourceYieldOutput?.Pair;
		const rows = p == null ? [] : Array.isArray(p) ? p : [p];
		const byResource: Record<string, number> = {};
		for (const row of rows) {
			if (!row.zIndex) continue;
			const subs =
				row.SubPair == null
					? []
					: Array.isArray(row.SubPair)
						? row.SubPair
						: [row.SubPair];
			const sci = subs
				.filter((s) => s.zSubIndex === "YIELD_SCIENCE")
				.reduce((t, s) => t + Number(s.iValue ?? 0), 0);
			if (sci > 0) byResource[row.zIndex] = sci / 10;
		}
		if (Object.keys(byResource).length > 0) {
			classResourceScience.set(cls.zType, byResource);
		}
	}
	const effectScience = (name?: string): { flat: number; pct: number } => {
		const e = name ? effectByType.get(name) : undefined;
		return e
			? {
					flat: yieldValue(pairs(e.aiYieldRate), "YIELD_SCIENCE"),
					pct: yieldValue(pairs(e.aiYieldModifier), "YIELD_SCIENCE"),
				}
			: { flat: 0, pct: 0 };
	};

	const improvementScience: Record<string, { flat: number; pct: number }> = {};
	const improvementResourceScience: Record<string, Record<string, number>> = {};
	// Improvement → its class, for science-relevant improvements only — the
	// key the specialist tile modifiers above are looked up by.
	const improvementClass: Record<string, string> = {};
	const shrineType: Record<string, string> = {};
	for (const imp of improvements) {
		if (!imp.zType) continue;
		const own =
			yieldValue(pairs(imp.aiYieldOutput), "YIELD_SCIENCE") +
			yieldValue(pairs(imp.aiYieldRate), "YIELD_SCIENCE");
		const eff = effectScience(imp.EffectCity);
		const flat = own + eff.flat;
		if (flat > 0 || eff.pct > 0) {
			improvementScience[imp.zType] = { flat: flat / 10, pct: eff.pct };
		}
		const byResource = imp.Class
			? classResourceScience.get(imp.Class)
			: undefined;
		if (byResource) improvementResourceScience[imp.zType] = byResource;
		if (imp.Class && (flat > 0 || eff.pct > 0 || byResource)) {
			improvementClass[imp.zType] = imp.Class;
		}
		if (imp.zType.startsWith("IMPROVEMENT_SHRINE_") && imp.AssetVariation) {
			// "ASSET_VARIATION_IMPROVEMENT_SHRINE_WISDOM" → "Wisdom".
			const raw = imp.AssetVariation.replace(
				/^ASSET_VARIATION_IMPROVEMENT_SHRINE_/,
				"",
			);
			shrineType[imp.zType] = raw
				.split("_")
				.map((w) => w.charAt(0) + w.slice(1).toLowerCase())
				.join(" ");
		}
	}

	const specialistScience: Record<string, number> = {};
	// Specialists that multiply their tile's whole output — a staffed
	// Gardener is +100% to the Grove's yields (Tile.yieldOutputForGovernor
	// applies specialist.aiImprovementClassModifier to iOutput).
	const specialistTileModifier: Record<string, Record<string, number>> = {};
	for (const sp of specialists) {
		if (!sp.zType) continue;
		const flat =
			effectScience(sp.EffectCity).flat +
			effectScience(sp.EffectCityExtra).flat;
		if (flat > 0) specialistScience[sp.zType] = flat / 10;
		const mods: Record<string, number> = {};
		for (const p of pairs(sp.aiImprovementClassModifier)) {
			if (p.zIndex && Number(p.iValue ?? 0) !== 0) {
				mods[p.zIndex] = Number(p.iValue);
			}
		}
		if (Object.keys(mods).length > 0) {
			specialistTileModifier[sp.zType] = mods;
		}
	}

	// Tech → the laws it unlocks: the law CLASS carries the tech prereq
	// (lawClass.xml) and each law names its class (law.xml), so a class's
	// prereq fans out to its law pair (Sovereignty → Tyranny+Constitution).
	const classTech = new Map<string, string>();
	for (const cls of lawClasses) {
		if (cls.zType && cls.TechPrereq) classTech.set(cls.zType, cls.TechPrereq);
	}
	const techLaws: Record<string, string[]> = {};
	for (const law of laws) {
		const tech = law.LawClass ? classTech.get(law.LawClass) : undefined;
		if (!law.zType || !tech) continue;
		(techLaws[tech] ??= []).push(law.zType);
	}
	for (const list of Object.values(techLaws)) list.sort();

	// Unlock costs: each source's unlocking tech resolved to its research
	// cost, so the Science Sources rows can order early-tech → late-tech.
	// Sources with no tech gate (farms, succession laws) stay at 0.
	const techCost = new Map<string, number>();
	for (const t of techs) {
		if (t.zType && t.iCost != null) techCost.set(t.zType, Number(t.iCost));
	}
	const improvementClassTech = new Map<string, string>();
	for (const cls of improvementClasses) {
		if (cls.zType && cls.TechPrereq)
			improvementClassTech.set(cls.zType, cls.TechPrereq);
	}
	const improvementIcon: Record<string, string> = {};
	const improvementUnlockCost: Record<string, number> = {};
	const specialistUnlockCost: Record<string, number> = {};
	for (const imp of improvements) {
		if (!imp.zType) continue;
		if (imp.zIconName && imp.zIconName !== imp.zType) {
			improvementIcon[imp.zType] = imp.zIconName;
		}
		const tech =
			imp.TechPrereq ??
			(imp.Class ? improvementClassTech.get(imp.Class) : undefined);
		const cost = tech ? (techCost.get(tech) ?? 0) : 0;
		if (cost > 0) improvementUnlockCost[imp.zType] = cost;
		// A specialist unlocks with its workplace improvement's tech.
		if (imp.Specialist && cost > 0) {
			specialistUnlockCost[imp.Specialist] = Math.min(
				specialistUnlockCost[imp.Specialist] ?? Infinity,
				cost,
			);
		}
	}
	// Higher tiers of specialists whose workplace is untiered (Elder Officer
	// on the one Barracks) appear on no improvement entry — propagate the
	// cheapest cost across each specialist CLASS so every tier inherits it.
	const specialistClassCost = new Map<string, number>();
	for (const sp of specialists) {
		const cost = sp.zType ? specialistUnlockCost[sp.zType] : undefined;
		if (sp.Class && cost != null) {
			specialistClassCost.set(
				sp.Class,
				Math.min(specialistClassCost.get(sp.Class) ?? Infinity, cost),
			);
		}
	}
	for (const sp of specialists) {
		if (!sp.zType || specialistUnlockCost[sp.zType] != null) continue;
		const cost = sp.Class ? specialistClassCost.get(sp.Class) : undefined;
		if (cost != null) specialistUnlockCost[sp.zType] = cost;
	}
	const lawUnlockCost: Record<string, number> = {};
	for (const law of laws) {
		const tech = law.LawClass ? classTech.get(law.LawClass) : undefined;
		const cost = tech ? (techCost.get(tech) ?? 0) : 0;
		if (law.zType && cost > 0) lawUnlockCost[law.zType] = cost;
	}

	const sorted = <T>(o: Record<string, T>): Record<string, T> =>
		Object.fromEntries(
			Object.keys(o)
				.sort()
				.map((k) => [k, o[k]]),
		);
	// Deterministic AND consistently ordered: inner resource keys too.
	const sortedDeep = (
		o: Record<string, Record<string, number>>,
	): Record<string, Record<string, number>> =>
		Object.fromEntries(
			Object.keys(o)
				.sort()
				.map((k) => [k, sorted(o[k])]),
		);

	const lines: string[] = [];
	lines.push(
		"// AUTO-GENERATED by scripts/bake-science-yields.ts. Do not edit.",
	);
	lines.push(
		"// Run `npm run bake:science-yields` to refresh from Reference/XML.",
	);
	lines.push("");
	lines.push(
		"// Base science of an improvement, in display units: `flat` per turn,",
	);
	lines.push("// `pct` as a percent city-science modifier (libraries).");
	lines.push("export interface ImprovementScience {");
	lines.push("\treadonly flat: number;");
	lines.push("\treadonly pct: number;");
	lines.push("}");
	lines.push("");
	lines.push(
		`export const IMPROVEMENT_SCIENCE: Readonly<Record<string, ImprovementScience>> = ${JSON.stringify(sorted(improvementScience))};`,
	);
	lines.push("");
	lines.push(
		"// Per-resource science of resource-sited improvements (groves earn",
	);
	lines.push("// their science off the luxury they sit on), per turn.");
	lines.push(
		`export const IMPROVEMENT_RESOURCE_SCIENCE: Readonly<Record<string, Readonly<Record<string, number>>>> = ${JSON.stringify(sortedDeep(improvementResourceScience))};`,
	);
	lines.push("");
	lines.push(
		"// Base science of a placed specialist (tier extras included), per turn.",
	);
	lines.push(
		`export const SPECIALIST_SCIENCE: Readonly<Record<string, number>> = ${JSON.stringify(sorted(specialistScience))};`,
	);
	lines.push("");
	lines.push(
		"// Specialist → % modifier applied to their tile's WHOLE output, keyed",
	);
	lines.push(
		"// by the improvement class (a Gardener doubles the Grove's yields:",
	);
	lines.push("// Tile.yieldOutputForGovernor × aiImprovementClassModifier).");
	lines.push(
		`export const SPECIALIST_TILE_MODIFIER: Readonly<Record<string, Readonly<Record<string, number>>>> = ${JSON.stringify(sortedDeep(specialistTileModifier))};`,
	);
	lines.push("");
	lines.push(
		"// Improvement → its class, for the science-relevant improvements the",
	);
	lines.push("// tile modifiers above are looked up against.");
	lines.push(
		`export const IMPROVEMENT_CLASS: Readonly<Record<string, string>> = ${JSON.stringify(sorted(improvementClass))};`,
	);
	lines.push("");
	lines.push(
		"// Each pagan shrine's type (War/Fire/Sun/Wisdom/…), from AssetVariation.",
	);
	lines.push(
		`export const SHRINE_TYPE: Readonly<Record<string, string>> = ${JSON.stringify(sorted(shrineType))};`,
	);
	lines.push("");
	lines.push(
		"// Tech → the LAW_* choices it unlocks (law.xml TechPrereq, inverted).",
	);
	lines.push(
		`export const TECH_LAWS: Readonly<Record<string, readonly string[]>> = ${JSON.stringify(sorted(techLaws))};`,
	);
	lines.push("");
	lines.push(
		"// Improvement zType → its 2D icon name (zIconName), where they differ",
	);
	lines.push("// (tiers share a line icon: LIBRARY_2 → IMPROVEMENT_ACADEMY).");
	lines.push(
		`export const IMPROVEMENT_ICON: Readonly<Record<string, string>> = ${JSON.stringify(sorted(improvementIcon))};`,
	);
	lines.push("");
	lines.push(
		"// Research cost of each source's unlocking tech (0 / absent = no tech",
	);
	lines.push(
		"// gate) — orders the Science Sources rows early-tech → late-tech.",
	);
	lines.push(
		`export const IMPROVEMENT_UNLOCK_COST: Readonly<Record<string, number>> = ${JSON.stringify(sorted(improvementUnlockCost))};`,
	);
	lines.push("");
	lines.push(
		`export const SPECIALIST_UNLOCK_COST: Readonly<Record<string, number>> = ${JSON.stringify(sorted(specialistUnlockCost))};`,
	);
	lines.push("");
	lines.push(
		`export const LAW_UNLOCK_COST: Readonly<Record<string, number>> = ${JSON.stringify(sorted(lawUnlockCost))};`,
	);
	lines.push("");
	lines.push(
		"// ─── Court science (InfoHelpers.getRatingYieldRateCourt) ───────────",
	);
	lines.push("");
	lines.push(
		"// Science a court character earns per point of the rating curve, from",
	);
	lines.push(
		"// rating.xml RATING_WISDOM <aiYieldCourtRate>. Emitted RAW (×10 fixed",
	);
	lines.push(
		"// point), unlike the tables above: the curve it feeds is integer math,",
	);
	lines.push("// so callers must divide by 10 only at the end.");
	lines.push(
		`export const WISDOM_COURT_SCIENCE_RATE = ${wisdomCourtScienceRate};`,
	);
	lines.push("");
	lines.push(
		"// yield.xml YIELD_SCIENCE <iTriangleOffset> — the offset the court",
	);
	lines.push("// rating curve (Utils.triangleOffset) is evaluated at.");
	lines.push(
		`export const SCIENCE_TRIANGLE_OFFSET = ${scienceTriangleOffset};`,
	);
	lines.push("");
	lines.push(
		"// globalsInt.xml RATING_EQUIVALENT_LOWER_CHARACTER_YIELDS — under",
	);
	lines.push(
		"// Competitive Mode the court curve is linearized around this rating,",
	);
	lines.push("// so high ratings pay far less than they do normally.");
	lines.push(
		`export const COMPETITIVE_EQUIVALENT_RATING = ${competitiveEquivalentRating};`,
	);
	lines.push("");
	lines.push("// effectPlayer.xml EFFECTPLAYER_COMPETITIVE_MODE <aiYieldRate>");
	lines.push(
		"// YIELD_SCIENCE, per turn: the flat stipend that compensates for the",
	);
	lines.push("// lowered character yields above.");
	lines.push(
		`export const COMPETITIVE_SCIENCE_STIPEND = ${competitiveScienceStipend};`,
	);
	lines.push("");

	const config = await resolveConfig(OUTPUT_TS);
	const formatted = await prettierFormat(lines.join("\n"), {
		...config,
		parser: "typescript",
		filepath: OUTPUT_TS,
	});
	await mkdir(dirname(OUTPUT_TS), { recursive: true });
	if (existsSync(OUTPUT_TS)) {
		const existing = await readFile(OUTPUT_TS, "utf-8");
		if (existing === formatted) {
			console.log("bake-science-yields: no changes");
			return;
		}
	}
	await writeFile(OUTPUT_TS, formatted);
	console.log(
		`bake-science-yields: ${Object.keys(improvementScience).length} improvements, ${Object.keys(improvementResourceScience).length} resource-sited, ${Object.keys(specialistScience).length} specialists, ${Object.keys(shrineType).length} shrines, ${Object.keys(techLaws).length} law techs → ${OUTPUT_TS.replace(REPO_ROOT + "/", "")}`,
	);
}

await main();
