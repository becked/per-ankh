// Bake the specialist lookup tables from the OW reference XML so the Specialists
// tab can group placed specialists by class, split them urban vs rural, read
// their level, and label them with real in-game names — none of which the
// runtime can derive from the SPECIALIST_<zType> enum alone (formatEnum strips
// the trailing tier digit, collapsing the three urban levels into one name).
//
// In Old World a city builds a specialist onto an eligible improvement inside
// its borders. Rural improvements take a single-level rural specialist; urban
// improvements take an urban specialist that climbs three tiers
// (Apprentice → Master → Elder, replacing the previous one in place).
//
// SOURCES (local-only, via the Reference/ symlink resolved by paths.ts):
//   Reference/XML/Infos/specialist.xml   — <Entry> with <zType> (SPECIALIST_*),
//                                          <Class> (SPECIALISTCLASS_*), <Name>
//                                          (TEXT_SPECIALIST_* key) and
//                                          <EffectCityExtra>
//                                          (EFFECTCITY_SPECIALIST_RURAL for the
//                                          8 rural lines; the urban tiers carry
//                                          a _1/_2/_3 suffix on the zType).
//   Reference/XML/Infos/improvement.xml  — <Entry> with <zType> (IMPROVEMENT_*),
//                                          a <Specialist> tag iff the improvement
//                                          can hold a specialist, and <bUrban>1.
//   Reference/XML/Infos/text-*.xml       — <Entry> with <zType>TEXT_*</> and
//                                          <en-US>. text-specialistClass.xml has
//                                          the class line names ("Priest"); the
//                                          per-tier names ("Elder Priest") live
//                                          in text-infos.xml. Merge all text-*.xml.
//
// OUTPUT: .bake/specialists.json (gitignored sidecar). The finalize step
// (scripts/build-manifests.ts) reads it and emits the runtime module at
// src/lib/generated/specialists.ts.
//
// en-US values are '~'-separated grammatical forms ("Priest~Priests") — we take
// the first segment (the bare noun) and strip TextMeshPro markup, the same as
// bake-improvement-names.ts. formatEnum() is the fallback if a name is missing.
//
// Run: npm run bake:specialists

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { XMLParser } from "fast-xml-parser";

import { resolveReferenceXml } from "./lib/paths.js";
import { formatEnum, stripMarkup } from "../src/lib/utils/formatting.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SIDECAR = resolve(REPO_ROOT, ".bake/specialists.json");

const RURAL_MARKER = "EFFECTCITY_SPECIALIST_RURAL";

interface SpecialistEntry {
	zType?: string;
	Class?: string;
	Name?: string;
	EffectCityExtra?: string;
}
interface ImprovementEntry {
	zType?: string;
	Specialist?: string;
	bUrban?: string;
}
interface TextEntry {
	zType?: string;
	"en-US"?: string;
}

// Emitted per-specialist shape (mirrored by the generated SpecialistInfo).
interface SpecialistInfo {
	class: string;
	kind: "urban" | "rural";
	level: number | null;
	name: string;
}
// Emitted per-class shape (mirrored by the generated SpecialistClassInfo).
interface SpecialistClassInfo {
	name: string;
	kind: "urban" | "rural";
}
// Emitted per-eligible-improvement shape (mirrored by EligibleImprovement).
interface EligibleImprovement {
	urban: boolean;
}

const parser = new XMLParser({
	ignoreAttributes: true,
	parseTagValue: false,
	ignoreDeclaration: true,
	ignorePiTags: true,
});

async function loadEntries<T>(path: string): Promise<T[]> {
	const xml = await readFile(path, "utf-8");
	const parsed = parser.parse(xml) as { Root?: { Entry?: T | T[] } };
	const entry = parsed.Root?.Entry;
	if (entry == null) return [];
	return Array.isArray(entry) ? entry : [entry];
}

// Resolve a TEXT_* key to its bare English noun, or null if absent.
function displayName(
	key: string | undefined,
	textByKey: Map<string, string>,
): string | null {
	if (!key) return null;
	const raw = textByKey.get(key);
	if (!raw) return null;
	const display = stripMarkup(raw).split("~")[0]?.trim();
	return display || null;
}

async function main(): Promise<void> {
	const infosDir = resolve(resolveReferenceXml(), "Infos");

	// Class line names and per-tier names span multiple text-*.xml files; merge
	// them all into one key→en-US lookup (same approach as improvement-names).
	const allFiles = await readdir(infosDir);
	const textFiles = allFiles
		.filter((f) => /^text-.*\.xml$/.test(f))
		.map((f) => resolve(infosDir, f));

	const [specialistEntries, improvementEntries, ...textFileEntries] =
		await Promise.all([
			loadEntries<SpecialistEntry>(resolve(infosDir, "specialist.xml")),
			loadEntries<ImprovementEntry>(resolve(infosDir, "improvement.xml")),
			...textFiles.map((p) => loadEntries<TextEntry>(p)),
		]);

	const textByKey = new Map<string, string>();
	for (const entries of textFileEntries) {
		for (const t of entries) {
			if (t.zType && t["en-US"]) textByKey.set(t.zType, t["en-US"]);
		}
	}

	const specialists: Record<string, SpecialistInfo> = {};
	const classes: Record<string, SpecialistClassInfo> = {};
	for (const s of specialistEntries) {
		// Skip the empty template entry and any malformed row.
		if (!s.zType || !s.zType.startsWith("SPECIALIST_") || !s.Class) continue;

		const kind: "urban" | "rural" =
			s.EffectCityExtra === RURAL_MARKER ? "rural" : "urban";
		// Tier is the trailing _N on the zType for urban lines; rural is unleveled.
		const tier = s.zType.match(/_(\d+)$/);
		const level = kind === "urban" && tier ? Number(tier[1]) : null;

		specialists[s.zType] = {
			class: s.Class,
			kind,
			level,
			name:
				displayName(s.Name, textByKey) ?? formatEnum(s.zType, "SPECIALIST_"),
		};

		// Class line name comes from text-specialistClass.xml (TEXT_ + the class
		// zType). All members of a class share the same kind.
		if (!classes[s.Class]) {
			classes[s.Class] = {
				name:
					displayName(`TEXT_${s.Class}`, textByKey) ??
					formatEnum(s.Class, "SPECIALISTCLASS_"),
				kind,
			};
		}
	}

	// An improvement is specialist-eligible iff it declares a <Specialist>; its
	// urban/rural side comes from <bUrban>.
	const eligibleImprovements: Record<string, EligibleImprovement> = {};
	for (const imp of improvementEntries) {
		if (!imp.zType || !imp.zType.startsWith("IMPROVEMENT_")) continue;
		if (!imp.Specialist || !imp.Specialist.startsWith("SPECIALIST_")) continue;
		eligibleImprovements[imp.zType] = { urban: imp.bUrban === "1" };
	}

	// Sort keys for deterministic output (finalize also sorts on emit).
	const sortRecord = <T>(rec: Record<string, T>): Record<string, T> => {
		const out: Record<string, T> = {};
		for (const key of Object.keys(rec).sort()) out[key] = rec[key];
		return out;
	};

	await mkdir(dirname(SIDECAR), { recursive: true });
	await writeFile(
		SIDECAR,
		JSON.stringify(
			{
				specialists: sortRecord(specialists),
				classes: sortRecord(classes),
				eligibleImprovements: sortRecord(eligibleImprovements),
			},
			null,
			"\t",
		) + "\n",
		"utf-8",
	);

	const urbanClasses = Object.values(classes).filter(
		(c) => c.kind === "urban",
	).length;
	console.log(
		`bake-specialists: ${Object.keys(specialists).length} specialists, ` +
			`${Object.keys(classes).length} classes (${urbanClasses} urban), ` +
			`${Object.keys(eligibleImprovements).length} eligible improvements → ` +
			`${SIDECAR.replace(REPO_ROOT + "/", "")}`,
	);
}

await main();
