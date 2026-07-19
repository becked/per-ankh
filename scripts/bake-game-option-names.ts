// Bake the GAMEOPTION_<zType> → English display name table from the OW reference
// XML so the game-detail Settings tab shows the real in-game option name instead
// of the title-cased enum.
//
// Old World's internal option enums diverge from their setup-screen labels for
// roughly half the options, and the divergences are not cosmetic — they name a
// different thing entirely. GAMEOPTION_NO_BONUS_IMPROVEMENTS is "No Ancient
// Ruins", GAMEOPTION_PLAY_TO_WIN is "Ruthless AI", GAMEOPTION_CRITICAL_HIT_PREVIEW
// is "Show Pending Critical Hits". Rendering the formatEnum() form would show
// players an option name that appears nowhere in the game.
//
// SOURCES (local-only, via the Reference/ symlink resolved by paths.ts):
//   Reference/XML/Infos/gameOption.xml  — enumerates <Entry> with <zType> and
//                                         <zName> (a TEXT_GAMEOPTION_* key).
//   Reference/XML/Infos/text-*.xml      — <Entry> with <zType>TEXT_GAMEOPTION_*
//                                         and <en-US>. Base table is
//                                         text-infos.xml; merge across all
//                                         text-*.xml for DLC additions.
//
// Some names carry OW markup — an inline link() to a concept or tribe
// (GAMEOPTION_NO_ORGANIZED_TRIBES resolves to "No Organized Tribes (Huns)"), or a
// bare link() standing in for the whole label (GAMEOPTION_ONE_CITY_CHALLENGE).
// stripMarkup() already handles both, so no markup handling lives here.
//
// OUTPUT: .bake/game-option-names.json (gitignored sidecar). The finalize step
// (scripts/build-manifests.ts) reads it and emits the runtime module at
// src/lib/generated/game-option-names.ts.
//
// We emit only entries whose resolved name differs from the runtime formatEnum()
// fallback — matching the tech/improvement/difficulty bakers — so the manifest
// holds just the real overrides and every other option falls through.
//
// Sub-options (<zSubTypeOf>, e.g. GAMEOPTION_LOWER_CHARACTER_YIELDS) are baked
// alongside their parents. A save never writes one (see the parseGameOptions
// note in src/lib/parser/parsers/match-metadata.ts), but that's a save-format
// fact, not a display one — the table stays a plain zType → name lookup.
//
// Run: npm run bake:game-option-names

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { XMLParser } from "fast-xml-parser";

import { resolveReferenceXml } from "./lib/paths.js";
import { formatEnum, stripMarkup } from "../src/lib/utils/formatting.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SIDECAR = resolve(REPO_ROOT, ".bake/game-option-names.json");

interface GameOptionEntry {
	zType?: string;
	zName?: string;
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
	const gameOptionPath = resolve(infosDir, "gameOption.xml");

	// Option display names live in text-infos.xml; merge all text-*.xml in case a
	// DLC ever adds or overrides one.
	const allFiles = await readdir(infosDir);
	const textFiles = allFiles
		.filter((f) => /^text-.*\.xml$/.test(f))
		.map((f) => resolve(infosDir, f));

	const [gameOptionEntries, ...textFileEntries] = await Promise.all([
		loadEntries<GameOptionEntry>(gameOptionPath),
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
	for (const opt of gameOptionEntries) {
		const zType = opt.zType;
		const nameKey = opt.zName;
		if (!zType || !nameKey) continue;
		if (!zType.startsWith("GAMEOPTION_")) continue;

		const raw = textByKey.get(nameKey);
		if (!raw) continue;

		const display = stripMarkup(raw);
		if (!display) continue;

		// Skip options whose XML name already matches what formatEnum would
		// produce. Keeps the manifest focused on real overrides.
		if (display === formatEnum(zType, "GAMEOPTION_")) continue;

		overrides[zType] = display;
	}

	// Sort keys for deterministic output.
	const sorted: Record<string, string> = {};
	for (const key of Object.keys(overrides).sort()) {
		sorted[key] = overrides[key];
	}

	await mkdir(dirname(SIDECAR), { recursive: true });
	await writeFile(SIDECAR, JSON.stringify(sorted, null, "\t") + "\n", "utf-8");

	const total = gameOptionEntries.filter((o) =>
		o.zType?.startsWith("GAMEOPTION_"),
	).length;
	console.log(
		`bake-game-option-names: ${Object.keys(sorted).length} overrides emitted (of ${total} options, merged ${textFiles.length} text-*.xml files) → ${SIDECAR.replace(REPO_ROOT + "/", "")}`,
	);
}

await main();
