// Bake the global victory info-list ordering from the OW reference XML so the
// save parser can resolve a legacy `<WinnerVictory>` integer to a VICTORY_*
// string.
//
// `<WinnerVictory>` (older OW save format) is an index into the game's global
// victory info-list — the full ordered set of victory types — NOT into the
// per-save `<VictoryEnabled>` subset. Indexing into the enabled subset breaks
// whenever an earlier victory type is disabled (it compresses the list), which
// silently drops the winner. See src/lib/parser/parsers/match-metadata.ts.
//
// SOURCE (local-only, via the Reference/ symlink resolved by paths.ts):
//   Reference/XML/Infos/victory.xml — <Entry> with <zType> (VICTORY_*). The
//   leading <Entry> is a blank schema template (<zType/> empty) and is excluded;
//   the remaining entries, in document order, are the global index space.
//
// OUTPUT: .bake/victory-ordering.json (gitignored sidecar). The finalize step
// (scripts/build-manifests.ts) reads it and emits the runtime module at
// src/lib/generated/victory-ordering.ts.
//
// Reference/ is authoritative (it is the game). Order is the payload — the array
// is emitted verbatim, never sorted.
//
// Run: npm run bake:victory-ordering

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { XMLParser } from "fast-xml-parser";

import { resolveReferenceXml } from "./lib/paths.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SIDECAR = resolve(REPO_ROOT, ".bake/victory-ordering.json");

interface VictoryEntry {
	zType?: string;
}

const parser = new XMLParser({
	ignoreAttributes: true,
	parseTagValue: false,
	ignoreDeclaration: true,
	ignorePiTags: true,
});

async function loadEntries(path: string): Promise<VictoryEntry[]> {
	const xml = await readFile(path, "utf-8");
	const parsed = parser.parse(xml) as {
		Root?: { Entry?: VictoryEntry | VictoryEntry[] };
	};
	const entry = parsed.Root?.Entry;
	if (entry == null) return [];
	return Array.isArray(entry) ? entry : [entry];
}

async function main(): Promise<void> {
	const xmlDir = resolveReferenceXml();
	const victoryPath = resolve(xmlDir, "Infos", "victory.xml");

	const entries = await loadEntries(victoryPath);

	// Document order is the global index space. Skip the blank template entry
	// (its <zType/> parses to an empty string) and anything non-VICTORY_*.
	const ordering: string[] = [];
	for (const entry of entries) {
		const zType = entry.zType;
		if (typeof zType !== "string" || !zType.startsWith("VICTORY_")) continue;
		ordering.push(zType);
	}

	await mkdir(dirname(SIDECAR), { recursive: true });
	await writeFile(
		SIDECAR,
		JSON.stringify(ordering, null, "\t") + "\n",
		"utf-8",
	);

	console.log(
		`bake-victory-ordering: ${ordering.length} victory types → ${SIDECAR.replace(REPO_ROOT + "/", "")}`,
	);
}

await main();
