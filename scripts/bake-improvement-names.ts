// Bake the IMPROVEMENT_<zType> → English display name table from the OW
// reference XML so the Improvements Table, map tooltip, and wonder labels can
// show the real in-game name instead of the title-cased enum. The title-caser
// (formatEnum) strips trailing digits, so the three-tier theater line
// (IMPROVEMENT_THEATER_1/2/3) all collapses to "Theater" — the real names are
// Odeon / Theater / Amphitheater. Wonders come along for free: they're just
// IMPROVEMENT_* entries (flagged <bWonder/>) in improvement.xml, so e.g.
// "The Pyramids" stops rendering as "Pyramids".
//
// SOURCES (local-only, via the Reference/ symlink resolved by paths.ts):
//   Reference/XML/Infos/improvement.xml  — <Entry> with <zType> and <Name>
//                                          (a TEXT_IMPROVEMENT_* key).
//   Reference/XML/Infos/text-*.xml       — <Entry> with <zType>TEXT_IMPROVEMENT_*</>
//                                          and <en-US> localized string. The
//                                          base table lives in text-improvement
//                                          .xml; DLC adds (text-improvement-sap
//                                          .xml, text-improvement-hittite.xml,
//                                          text-wonders-dynasties-infos.xml, …)
//                                          so we merge across all text-*.xml.
//
// OUTPUT: .bake/improvement-names.json (gitignored sidecar). The finalize step
// (scripts/build-manifests.ts) reads it and emits the runtime module at
// src/lib/generated/improvement-names.ts.
//
// The en-US value uses '~'-separated grammatical forms (e.g.
// "Odeon~an Odeon~Odeons") — we take the first segment (the bare noun). Some
// wonders have no '~' ("The Pyramids"), so the split is a no-op there. We strip
// Unity TextMeshPro markup and only emit entries where the resulting name
// differs from the runtime formatEnum() fallback — so the manifest contains
// only the real overrides, and ordinary improvements continue to render via
// formatEnum without round-tripping through a lookup.
//
// Run: npm run bake:improvement-names

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { XMLParser } from "fast-xml-parser";

import { resolveReferenceXml } from "./lib/paths.js";
import { formatEnum, stripMarkup } from "../src/lib/utils/formatting.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SIDECAR = resolve(REPO_ROOT, ".bake/improvement-names.json");

interface ImprovementEntry {
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
	const improvementPath = resolve(infosDir, "improvement.xml");

	// Improvement display names span multiple files: text-improvement.xml carries
	// the base table and DLC-specific text-*.xml files add their entries (incl.
	// wonders in text-wonders-dynasties-infos.xml). Glob all of them and merge
	// into a single key→en-US lookup.
	const allFiles = await readdir(infosDir);
	const textFiles = allFiles
		.filter((f) => /^text-.*\.xml$/.test(f))
		.map((f) => resolve(infosDir, f));

	const [improvementEntries, ...textFileEntries] = await Promise.all([
		loadEntries<ImprovementEntry>(improvementPath),
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
	for (const improvement of improvementEntries) {
		const zType = improvement.zType;
		const nameKey = improvement.Name;
		if (!zType || !nameKey) continue;
		if (!zType.startsWith("IMPROVEMENT_")) continue;

		const raw = textByKey.get(nameKey);
		if (!raw) continue;

		// en-US is '~'-separated grammatical forms; the first segment is the bare
		// noun ("Odeon~an Odeon~Odeons" → "Odeon"). Strip markup first.
		const display = stripMarkup(raw).split("~")[0]?.trim();
		if (!display) continue;

		// Skip improvements whose XML name already matches what formatEnum would
		// produce. Keeps the manifest focused on real overrides.
		if (display === formatEnum(zType, "IMPROVEMENT_")) continue;

		overrides[zType] = display;
	}

	// Sort keys for deterministic output.
	const sorted: Record<string, string> = {};
	for (const key of Object.keys(overrides).sort()) {
		sorted[key] = overrides[key];
	}

	await mkdir(dirname(SIDECAR), { recursive: true });
	await writeFile(SIDECAR, JSON.stringify(sorted, null, "\t") + "\n", "utf-8");

	const total = improvementEntries.filter((i) =>
		i.zType?.startsWith("IMPROVEMENT_"),
	).length;
	console.log(
		`bake-improvement-names: ${Object.keys(sorted).length} overrides emitted (of ${total} improvements, merged ${textFiles.length} text-*.xml files) → ${SIDECAR.replace(REPO_ROOT + "/", "")}`,
	);
}

await main();
