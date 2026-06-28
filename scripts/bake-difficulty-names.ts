// Bake the DIFFICULTY_<zType> → English display name table from the OW reference
// XML so the game-detail Settings tab and save cards show the real in-game name
// instead of the title-cased enum.
//
// Old World fully remapped its difficulty display names to economy-themed words
// while keeping the legacy internal enum names, so formatEnum() is wrong for
// EVERY value (e.g. DIFFICULTY_ABLE renders "Able" but the in-game name is
// "Affluent"; GOOD→Abundant, STRONG→Thriving, NOBLE→Comfortable,
// GLORIOUS→Sufficient, MAGNIFICENT→Modest, GREAT→Fragile). A lookup table is the
// only way to render these correctly.
//
// SOURCES (local-only, via the Reference/ symlink resolved by paths.ts):
//   Reference/XML/Infos/difficulty.xml   — enumerates <Entry> with <zType>
//                                          and <Name> (a TEXT_DIFFICULTY_* key).
//   Reference/XML/Infos/text-*.xml       — <Entry> with <zType>TEXT_DIFFICULTY_*
//                                          and <en-US>. Base table is
//                                          text-infos.xml; merge across all
//                                          text-*.xml for DLC additions.
//
// OUTPUT: .bake/difficulty-names.json (gitignored sidecar). The finalize step
// (scripts/build-manifests.ts) reads it and emits the runtime module at
// src/lib/generated/difficulty-names.ts.
//
// We emit only entries whose resolved name differs from the runtime formatEnum()
// fallback — matching the tech/improvement bakers — so the manifest contains
// just the real overrides (today all difficulties qualify) and any future value
// that happens to match formatEnum falls through without a lookup.
//
// Run: npm run bake:difficulty-names

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { XMLParser } from "fast-xml-parser";

import { resolveReferenceXml } from "./lib/paths.js";
import { formatEnum, stripMarkup } from "../src/lib/utils/formatting.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SIDECAR = resolve(REPO_ROOT, ".bake/difficulty-names.json");

interface DifficultyEntry {
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
	const difficultyPath = resolve(infosDir, "difficulty.xml");

	// Difficulty display names live in text-infos.xml; merge all text-*.xml in
	// case a DLC ever adds or overrides one.
	const allFiles = await readdir(infosDir);
	const textFiles = allFiles
		.filter((f) => /^text-.*\.xml$/.test(f))
		.map((f) => resolve(infosDir, f));

	const [difficultyEntries, ...textFileEntries] = await Promise.all([
		loadEntries<DifficultyEntry>(difficultyPath),
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
	for (const diff of difficultyEntries) {
		const zType = diff.zType;
		const nameKey = diff.Name;
		if (!zType || !nameKey) continue;
		if (!zType.startsWith("DIFFICULTY_")) continue;

		const raw = textByKey.get(nameKey);
		if (!raw) continue;

		const display = stripMarkup(raw);
		if (!display) continue;

		// Skip difficulties whose XML name already matches what formatEnum would
		// produce. Keeps the manifest focused on real overrides.
		if (display === formatEnum(zType, "DIFFICULTY_")) continue;

		overrides[zType] = display;
	}

	// Sort keys for deterministic output.
	const sorted: Record<string, string> = {};
	for (const key of Object.keys(overrides).sort()) {
		sorted[key] = overrides[key];
	}

	await mkdir(dirname(SIDECAR), { recursive: true });
	await writeFile(SIDECAR, JSON.stringify(sorted, null, "\t") + "\n", "utf-8");

	const total = difficultyEntries.filter((d) =>
		d.zType?.startsWith("DIFFICULTY_"),
	).length;
	console.log(
		`bake-difficulty-names: ${Object.keys(sorted).length} overrides emitted (of ${total} difficulties, merged ${textFiles.length} text-*.xml files) → ${SIDECAR.replace(REPO_ROOT + "/", "")}`,
	);
}

await main();
