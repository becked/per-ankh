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
//
// Values are the game's ×10 fixed-point; emitted ÷10 in display units.
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
	aiYieldOutput?: { Pair?: YieldPair | YieldPair[] };
	aiYieldRate?: { Pair?: YieldPair | YieldPair[] };
	aiYieldModifier?: { Pair?: YieldPair | YieldPair[] };
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
	const [improvements, improvementClasses, specialists, effects] =
		await Promise.all([
			loadEntries(resolve(infosDir, "improvement.xml")),
			loadEntries(resolve(infosDir, "improvementClass.xml")),
			loadEntries(resolve(infosDir, "specialist.xml")),
			loadEntries(resolve(infosDir, "effectCity.xml")),
		]);

	const effectByType = new Map(effects.map((e) => [e.zType, e]));

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
	const improvementResourceScience: Record<
		string,
		Record<string, number>
	> = {};
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
	for (const sp of specialists) {
		if (!sp.zType) continue;
		const flat =
			effectScience(sp.EffectCity).flat + effectScience(sp.EffectCityExtra).flat;
		if (flat > 0) specialistScience[sp.zType] = flat / 10;
	}

	const sorted = <T>(o: Record<string, T>): Record<string, T> =>
		Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));

	const lines: string[] = [];
	lines.push("// AUTO-GENERATED by scripts/bake-science-yields.ts. Do not edit.");
	lines.push("// Run `npm run bake:science-yields` to refresh from Reference/XML.");
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
		`export const IMPROVEMENT_RESOURCE_SCIENCE: Readonly<Record<string, Readonly<Record<string, number>>>> = ${JSON.stringify(sorted(improvementResourceScience))};`,
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
		"// Each pagan shrine's type (War/Fire/Sun/Wisdom/…), from AssetVariation.",
	);
	lines.push(
		`export const SHRINE_TYPE: Readonly<Record<string, string>> = ${JSON.stringify(sorted(shrineType))};`,
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
		`bake-science-yields: ${Object.keys(improvementScience).length} improvements, ${Object.keys(improvementResourceScience).length} resource-sited, ${Object.keys(specialistScience).length} specialists, ${Object.keys(shrineType).length} shrines → ${OUTPUT_TS.replace(REPO_ROOT + "/", "")}`,
	);
}

await main();
