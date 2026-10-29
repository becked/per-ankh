// Bake the map-pin type table from the OW reference XML. A save writes a pin's
// kind as an INTEGER — `Player.writeGameXML` emits `ping.meType.ToString()`
// (Player.cs:3574) — so the parser needs ping.xml's entry order to turn
// `PingType="5"` back into `PING_NOTE`, and the tile panel needs each kind's
// `<LogText>` to render a pin whose author typed nothing.
//
// SOURCES (local-only, via the Reference/ symlink resolved by paths.ts):
//   Reference/XML/Infos/ping.xml      — the seven kinds, in the order that IS
//                                       the integer. The leading template
//                                       <Entry> has an empty <zType> and is not
//                                       indexed, which is why index 5 is the
//                                       SIXTH <Entry> in the file.
//   Reference/XML/Infos/text-*.xml    — <LogText> / <Name> keys → <en-US>.
//
// Three strings outside ping.xml come along because `buildTileTooltipPingText`
// (HelpText.Game.cs:5325) needs them to render an empty-text pin:
// TEXT_PING_IMPROVEMENT_SPECIFIC_LOG ("Planning {0_improvement}"), and the Road
// and Urban labels the two improvement-ping sentinels resolve to
// (`buildRoadLinkVariable` / `buildUrbanLinkVariable`, HelpText.Game.cs:1986 and
// :2511). The GENERIC sentinel deliberately has no label: the game's own branch
// falls through to the pin kind's LogText for it.
//
// OUTPUT: src/lib/generated/ping-types.ts (checked in, self-contained — no
// .bake/ sidecar, no finalize step).
//
// Run: npm run bake:ping-types

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { format as prettierFormat, resolveConfig } from "prettier";

import { resolveReferenceXml } from "./lib/paths.js";
import { parseReferenceEntries } from "./lib/reference-xml.js";
import { stripMarkup } from "../src/lib/utils/formatting.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const OUTPUT_TS = resolve(REPO_ROOT, "src/lib/generated/ping-types.ts");

// The two improvement-ping sentinels that resolve to a word rather than to an
// improvement. `Player.writeGameXML` writes three by name — GENERIC, ROAD,
// URBAN (Player.cs:3578-3592) — but only these two have a label: the game
// renders GENERIC through the pin kind's LogText instead.
const SENTINEL_TEXT_KEYS: ReadonlyArray<[string, string]> = [
	["ROAD", "TEXT_HELPTEXT_LINK_ROAD"],
	["URBAN", "TEXT_CONCEPT_URBAN"],
];

const IMPROVEMENT_SPECIFIC_KEY = "TEXT_PING_IMPROVEMENT_SPECIFIC_LOG";

interface PingEntry {
	zType?: string;
	Name?: string;
	LogText?: string;
}
interface TextEntry {
	zType?: string;
	"en-US"?: string;
}

// en-US values carry TextMeshPro markup and '~'-separated grammatical forms
// ("Road~a Road~Roads"); take the bare first form, as bake-specialists does.
function bareText(
	key: string | undefined,
	textByKey: Map<string, string>,
): string | null {
	if (!key) return null;
	const raw = textByKey.get(key);
	if (!raw) return null;
	return stripMarkup(raw).split("~")[0]?.trim() || null;
}

async function main(): Promise<void> {
	const infosDir = resolve(resolveReferenceXml(), "Infos");

	// Pin strings are split across text-infos.xml (the PING_* block) and
	// text-helptext.xml (the Road link); merge every text-*.xml as the other
	// name bakers do, so a DLC file can add one.
	const textFiles = (await readdir(infosDir))
		.filter((f) => /^text-.*\.xml$/.test(f))
		.sort()
		.map((f) => resolve(infosDir, f));

	const [pingXml, ...textXmls] = await Promise.all([
		readFile(resolve(infosDir, "ping.xml"), "utf-8"),
		...textFiles.map((p) => readFile(p, "utf-8")),
	]);

	const textByKey = new Map<string, string>();
	for (const xml of textXmls) {
		for (const t of parseReferenceEntries<TextEntry>(xml)) {
			if (t.zType && t["en-US"]) textByKey.set(t.zType, t["en-US"]);
		}
	}

	// `zType` is "" on the template entry, which is what drops it — and
	// dropping it is what makes the array index the save's own integer.
	const types = parseReferenceEntries<PingEntry>(pingXml)
		.filter((e) => e.zType)
		.map((e) => ({
			type: e.zType!,
			name: bareText(e.Name, textByKey) ?? e.zType!,
			logText: bareText(e.LogText, textByKey) ?? "",
		}));

	// A renamed tag or a reordered file would silently remap every stored pin
	// onto the wrong kind — fail the bake instead. PING_NOTE and
	// PING_IMPROVEMENT are the two kinds that carry a save's pins in practice
	// (1,400 of the 1,403 across test-data/saves/), so their indices are the
	// ones worth pinning: 5 and 6.
	if (types[5]?.type !== "PING_NOTE" || types[6]?.type !== "PING_IMPROVEMENT") {
		throw new Error(
			`bake-ping-types: ping.xml order changed — index 5/6 are ${types[5]?.type}/${types[6]?.type}`,
		);
	}
	const missing = types.filter((t) => !t.logText).map((t) => t.type);
	if (missing.length > 0) {
		throw new Error(`bake-ping-types: no LogText for ${missing.join(", ")}`);
	}

	const sentinels: Record<string, string> = {};
	for (const [sentinel, key] of SENTINEL_TEXT_KEYS) {
		const label = bareText(key, textByKey);
		if (!label) {
			throw new Error(`bake-ping-types: no en-US for ${key}`);
		}
		sentinels[sentinel] = label;
	}

	const specific = bareText(IMPROVEMENT_SPECIFIC_KEY, textByKey);
	if (!specific?.includes("{0_improvement}")) {
		throw new Error(
			`bake-ping-types: ${IMPROVEMENT_SPECIFIC_KEY} lost its substitution`,
		);
	}

	const lines = [
		"// AUTO-GENERATED by scripts/bake-ping-types.ts. Do not edit.",
		"// Run `npm run bake:ping-types` to refresh from Reference/XML.",
		"",
		"/** One kind of map pin: its zType, the game's name for it, and the line",
		" *  the tile tooltip shows when the pin carries no typed text. */",
		"export interface PingTypeInfo {",
		"\treadonly type: string;",
		"\treadonly name: string;",
		"\treadonly logText: string;",
		"}",
		"",
		"// ping.xml in file order, with the template <Entry> dropped — so the",
		"// position in this array IS the integer the save writes as PingType",
		"// (`ping.meType.ToString()`, Player.cs:3574).",
		`export const PING_TYPES: readonly PingTypeInfo[] = ${JSON.stringify(types)};`,
		"",
		"// The improvement-ping sentinels that name a word rather than an",
		"// improvement zType (Player.cs:3578-3592). GENERIC is written the same",
		"// way and is deliberately absent: the game renders it through the pin",
		"// kind's own logText (`buildTileTooltipPingText`, HelpText.Game.cs:5340).",
		"export const PING_IMPROVEMENT_SENTINEL_NAMES: Readonly<",
		"\tRecord<string, string>",
		`> = ${JSON.stringify(sentinels)};`,
		"",
		"// TEXT_PING_IMPROVEMENT_SPECIFIC_LOG — what an improvement pin reads as",
		"// when its author typed nothing, with {0_improvement} standing in for the",
		"// improvement's own name.",
		`export const PING_IMPROVEMENT_SPECIFIC_LOG = ${JSON.stringify(specific)};`,
		"",
	];

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
			console.log("bake-ping-types: no changes");
			return;
		}
	}
	await writeFile(OUTPUT_TS, formatted);
	console.log(
		`bake-ping-types: ${types.length} kinds, ${Object.keys(sentinels).length} sentinels → ${OUTPUT_TS.replace(REPO_ROOT + "/", "")}`,
	);
}

await main();
