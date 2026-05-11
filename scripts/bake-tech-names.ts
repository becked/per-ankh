// Bake the TECH_<zType> → English display name table from the OW reference XML
// so the Techs Table / chart tooltip / Timeline event labels can show the
// real in-game name (e.g. "Goods Boost") instead of the title-cased enum
// ("Manor Bonus Goods").
//
// SOURCES (local-only, via the Reference/ symlink resolved by paths.ts):
//   Reference/XML/Infos/tech.xml         — enumerates <Entry> with <zType>
//                                          and <Name> (a TEXT_TECH_* key).
//   Reference/XML/Infos/text-*.xml       — <Entry> with <zType>TEXT_TECH_*</>
//                                          and <en-US> localized string. The
//                                          base table lives in text-infos.xml;
//                                          DLC adds (e.g. text-eoti.xml for
//                                          Echoes of the Indus, text-infos-
//                                          hittite.xml, text-misc-btt.xml) so
//                                          we merge across all text-*.xml.
//
// OUTPUT: .bake/tech-names.json (gitignored sidecar). The finalize step
// (scripts/build-manifests.ts) reads it and emits the runtime module at
// src/lib/generated/tech-names.ts.
//
// We strip Unity TextMeshPro markup from the raw en-US (some bonus-tech names
// look like "link(YIELD_STONE) Boost" → "Stone Boost") and only emit entries
// where the resulting name differs from the runtime formatEnum() fallback —
// so the manifest contains only the real overrides (bonus techs and a handful
// of others), and ordinary techs like TECH_IRONWORKING continue to render
// via formatEnum without round-tripping through a lookup.
//
// Run: npm run bake:tech-names

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { XMLParser } from "fast-xml-parser";

import { resolveReferenceXml } from "./lib/paths.js";
import { formatEnum, stripMarkup } from "../src/lib/utils/formatting.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SIDECAR = resolve(REPO_ROOT, ".bake/tech-names.json");

interface TechEntry {
	zType?: string;
	Name?: string;
}
interface TextEntry {
	zType?: string;
	"en-US"?: string;
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

async function main(): Promise<void> {
	const xmlDir = resolveReferenceXml();
	const infosDir = resolve(xmlDir, "Infos");
	const techPath = resolve(infosDir, "tech.xml");

	// Tech display names span multiple files: text-infos.xml carries the base
	// table and DLC-specific text-*.xml files add their entries. Glob all of
	// them and merge into a single key→en-US lookup.
	const allFiles = await readdir(infosDir);
	const textFiles = allFiles
		.filter((f) => /^text-.*\.xml$/.test(f))
		.map((f) => resolve(infosDir, f));

	const [techEntries, ...textFileEntries] = await Promise.all([
		loadEntries<TechEntry>(techPath),
		...textFiles.map((p) => loadEntries<TextEntry>(p)),
	]);

	const textByKey = new Map<string, string>();
	for (const entries of textFileEntries) {
		for (const t of entries) {
			if (t.zType && t["en-US"]) {
				textByKey.set(t.zType, t["en-US"]);
			}
		}
	}

	const overrides: Record<string, string> = {};
	for (const tech of techEntries) {
		const zType = tech.zType;
		const nameKey = tech.Name;
		if (!zType || !nameKey) continue;
		if (!zType.startsWith("TECH_")) continue;

		const raw = textByKey.get(nameKey);
		if (!raw) continue;

		const display = stripMarkup(raw);
		if (!display) continue;

		// Skip techs whose XML name already matches what formatEnum would
		// produce. Keeps the manifest focused on real overrides.
		if (display === formatEnum(zType, "TECH_")) continue;

		overrides[zType] = display;
	}

	// Sort keys for deterministic output.
	const sorted: Record<string, string> = {};
	for (const key of Object.keys(overrides).sort()) {
		sorted[key] = overrides[key];
	}

	await mkdir(dirname(SIDECAR), { recursive: true });
	await writeFile(SIDECAR, JSON.stringify(sorted, null, "\t") + "\n", "utf-8");

	const total = techEntries.filter((t) => t.zType?.startsWith("TECH_")).length;
	console.log(
		`bake-tech-names: ${Object.keys(sorted).length} overrides emitted (of ${total} techs, merged ${textFiles.length} text-*.xml files) → ${SIDECAR.replace(REPO_ROOT + "/", "")}`,
	);
}

await main();
