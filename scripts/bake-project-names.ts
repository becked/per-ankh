// Bake the PROJECT_<zType> → English display name table from the OW reference
// XML so city-project labels show the real in-game name instead of the
// title-cased enum. The title-caser (formatEnum) strips trailing digits, so the
// four-tier Archive line (PROJECT_ARCHIVE_1..4) all collapses to "Archive" —
// the real names are Archive I / II / III / IV. Convoys are the other common
// case: PROJECT_CONVOY_MONEY is "Trade Convoy", not "Convoy Money".
//
// SOURCES (local-only, via the Reference/ symlink resolved by paths.ts):
//   Reference/XML/Infos/project.xml       — <Entry> with <zType> and <Name>
//   Reference/XML/Infos/project-event*.xml  (a TEXT_PROJECT_* key). The event
//                                          projects live in their own files,
//                                          hyphenated per DLC — same set
//                                          bake-project-icons.ts sweeps.
//   Reference/XML/Infos/text-*.xml        — <Entry> with <zType>TEXT_PROJECT_*</>
//                                          and <en-US> localized string, split
//                                          across the base and DLC text tables,
//                                          so we merge all text-*.xml.
//
// OUTPUT: .bake/project-names.json (gitignored sidecar). The finalize step
// (scripts/build-manifests.ts) reads it and emits the runtime module at
// src/lib/generated/project-names.ts.
//
// The en-US value uses '~'-separated grammatical forms (e.g.
// "Archive II~an Archive II~Archives II") — we take the first segment (the bare
// noun). We strip Unity TextMeshPro markup and only emit entries where the
// resulting name differs from the runtime formatEnum() fallback, so the table
// holds only real overrides and ordinary projects render through formatEnum
// without round-tripping a lookup.
//
// Run: npm run bake:project-names

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { XMLParser } from "fast-xml-parser";

import { resolveReferenceXml } from "./lib/paths.js";
import { formatEnum, stripMarkup } from "../src/lib/utils/formatting.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SIDECAR = resolve(REPO_ROOT, ".bake/project-names.json");

interface ProjectEntry {
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

// The project-definition files: the base table plus the event projects, whose
// DLC variants are hyphenated (project-event-eoti.xml, …). Deliberately NOT
// text-project*.xml, which holds the localized strings, not the definitions.
// Same predicate as bake-project-icons.ts, which sweeps the same set.
function isProjectDefFile(name: string): boolean {
	return name === "project.xml" || /^project-event(-.*)?\.xml$/.test(name);
}

async function main(): Promise<void> {
	const infosDir = resolve(resolveReferenceXml(), "Infos");
	const allFiles = await readdir(infosDir);

	const defFiles = allFiles.filter(isProjectDefFile);
	const textFiles = allFiles.filter((f) => /^text-.*\.xml$/.test(f));

	const [defEntries, textEntries] = await Promise.all([
		Promise.all(
			defFiles.map((f) => loadEntries<ProjectEntry>(resolve(infosDir, f))),
		),
		Promise.all(
			textFiles.map((f) => loadEntries<TextEntry>(resolve(infosDir, f))),
		),
	]);

	const textByKey = new Map<string, string>();
	for (const entries of textEntries) {
		for (const t of entries) {
			if (t.zType && t["en-US"]) textByKey.set(t.zType, t["en-US"]);
		}
	}

	const overrides: Record<string, string> = {};
	let total = 0;
	for (const project of defEntries.flat()) {
		const zType = project.zType;
		// The template <Entry> at the head of each file has every tag empty.
		if (!zType || !zType.startsWith("PROJECT_")) continue;
		total += 1;
		if (!project.Name) continue;

		const raw = textByKey.get(project.Name);
		if (!raw) continue;

		// en-US is '~'-separated grammatical forms; the first segment is the bare
		// noun ("Archive II~an Archive II~Archives II" → "Archive II").
		const display = stripMarkup(raw).split("~")[0]?.trim();
		if (!display) continue;

		// Skip projects whose XML name already matches what formatEnum produces.
		if (display === formatEnum(zType, "PROJECT_")) continue;

		overrides[zType] = display;
	}

	// Sort keys for deterministic output.
	const sorted: Record<string, string> = {};
	for (const key of Object.keys(overrides).sort()) {
		sorted[key] = overrides[key];
	}

	await mkdir(dirname(SIDECAR), { recursive: true });
	await writeFile(SIDECAR, JSON.stringify(sorted, null, "\t") + "\n", "utf-8");

	console.log(
		`bake-project-names: ${Object.keys(sorted).length} overrides emitted (of ${total} projects across ${defFiles.length} definition files, merged ${textFiles.length} text-*.xml files) → ${SIDECAR.replace(REPO_ROOT + "/", "")}`,
	);
}

await main();
