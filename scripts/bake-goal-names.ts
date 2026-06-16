// Bake the GOAL_<zType> → English display name table from the OW reference XML
// so the Leaders-tab ambition list shows the real in-game name (e.g. "Capture
// Five Foreign Cities") instead of the title-cased internal enum, whose token
// order is meaningless ("Five Capture Cities").
//
// formatEnum() is wrong for essentially every goal: the enum is an internal id
// (GOAL_FIVE_CAPTURE_CITIES, GOAL_FOUR_LIBRARY_2, GOAL_REVEAL_40) while the
// display string is the localized <Name> text. Those strings also carry Unity
// TextMeshPro markup — link(ZTYPE[,N]) entity references and icon(ZTYPE) glyphs —
// which we resolve here (the shared stripMarkup() leaves tier digits and never
// pluralizes, so it can't produce "Control Four Libraries" on its own).
//
// SOURCES (local-only, via the Reference/ symlink resolved by paths.ts):
//   Reference/XML/Infos/goal.xml          — enumerates <Entry> with <zType> and
//                                            <Name> (a TEXT_GOAL_* key).
//   Reference/XML/Infos/text-*.xml        — <Entry> with <zType>TEXT_GOAL_* and
//                                            <en-US>. Base table is text-infos.xml;
//                                            merge all text-*.xml for DLC adds.
//
// OUTPUT: .bake/goal-names.json (gitignored sidecar). The finalize step
// (scripts/build-manifests.ts) reads it and emits the runtime module at
// src/lib/generated/goal-names.ts.
//
// We emit only entries whose resolved name differs from the runtime formatEnum()
// fallback — matching the tech/difficulty bakers — so any goal that happens to
// match formatEnum falls through without a lookup.
//
// Run: npm run bake:goal-names

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { XMLParser } from "fast-xml-parser";

import { resolveReferenceXml } from "./lib/paths.js";
import { formatEnum } from "../src/lib/utils/formatting.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SIDECAR = resolve(REPO_ROOT, ".bake/goal-names.json");

interface GoalEntry {
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

// Resolve a markup zType (IMPROVEMENT_LIBRARY_2, CONCEPT_SPECIALIST, …) to its
// display word(s). formatEnum drops the prefix and any trailing tier digit, so
// IMPROVEMENT_LIBRARY_2 → "Library", MISSION_STEAL_RESEARCH → "Steal Research".
function resolveZType(zType: string): string {
	const underscore = zType.indexOf("_");
	const prefix = underscore >= 0 ? zType.slice(0, underscore + 1) : "";
	return formatEnum(zType, prefix);
}

// Pluralize the last word of a resolved entity name. OW's link(ZTYPE,N) uses a
// declension argument of 2 for the plural form, so "Library" → "Libraries",
// "Grove" → "Groves", "Specialist" → "Specialists".
function pluralize(name: string): string {
	const words = name.split(" ");
	const last = words[words.length - 1];
	if (!last) return name;
	let plural: string;
	if (/[^aeiou]y$/i.test(last)) plural = `${last.slice(0, -1)}ies`;
	else if (/(s|x|z|ch|sh)$/i.test(last)) plural = `${last}es`;
	else plural = `${last}s`;
	words[words.length - 1] = plural;
	return words.join(" ");
}

// Turn a raw localized goal string into a clean display label: drop rich-text
// tags, resolve link()/icon() entity references to words, pluralizing links
// whose declension argument is ≥ 2.
function cleanGoalName(raw: string): string {
	return raw
		.replace(/<[^>]*>/g, "")
		.replace(/link\(([^)]*)\)/g, (_, content: string) => {
			const [zType, count] = content.split(",").map((s) => s.trim());
			const name = resolveZType(zType);
			return count && parseInt(count, 10) >= 2 ? pluralize(name) : name;
		})
		.replace(/icon\(([^)]*)\)/g, (_, content: string) =>
			resolveZType(content.split(",")[0].trim()),
		)
		.replace(/\s+/g, " ")
		.replace(/\s+([,.;:])/g, "$1")
		.trim();
}

async function main(): Promise<void> {
	const xmlDir = resolveReferenceXml();
	const infosDir = resolve(xmlDir, "Infos");
	const goalPath = resolve(infosDir, "goal.xml");

	// Goal display names live in text-infos.xml; merge all text-*.xml for DLC.
	const allFiles = await readdir(infosDir);
	const textFiles = allFiles
		.filter((f) => /^text-.*\.xml$/.test(f))
		.map((f) => resolve(infosDir, f));

	const [goalEntries, ...textFileEntries] = await Promise.all([
		loadEntries<GoalEntry>(goalPath),
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
	for (const goal of goalEntries) {
		const zType = goal.zType;
		const nameKey = goal.Name;
		if (!zType || !nameKey) continue;
		if (!zType.startsWith("GOAL_")) continue;

		const raw = textByKey.get(nameKey);
		if (!raw) continue;

		const display = cleanGoalName(raw);
		if (!display) continue;

		// Skip goals whose resolved name already matches formatEnum.
		if (display === formatEnum(zType, "GOAL_")) continue;

		overrides[zType] = display;
	}

	// Sort keys for deterministic output.
	const sorted: Record<string, string> = {};
	for (const key of Object.keys(overrides).sort()) {
		sorted[key] = overrides[key];
	}

	await mkdir(dirname(SIDECAR), { recursive: true });
	await writeFile(SIDECAR, JSON.stringify(sorted, null, "\t") + "\n", "utf-8");

	const total = goalEntries.filter((g) => g.zType?.startsWith("GOAL_")).length;
	console.log(
		`bake-goal-names: ${Object.keys(sorted).length} overrides emitted (of ${total} goals, merged ${textFiles.length} text-*.xml files) → ${SIDECAR.replace(REPO_ROOT + "/", "")}`,
	);
}

await main();
