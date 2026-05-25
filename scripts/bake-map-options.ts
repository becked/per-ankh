// Bake the map-script options manifest from the OW reference XML + C# source
// so tournament admins can configure per-script options (e.g. Donut's Player
// Start Location, Irregularity, etc.) the way OW's lobby exposes them.
//
// SOURCES (local-only, via the Reference/ symlink resolved by paths.ts):
//   Reference/XML/Infos/mapOptionsSingle.xml      — toggle options (bMultiPlayerValid)
//   Reference/XML/Infos/mapOptionsMulti.xml       — select options (Choices, Default)
//   Reference/XML/Infos/mapOptionsMulti-wog.xml   — WoG DLC select options
//   Reference/XML/Infos/mapSize.xml               — synthetic MAPSIZE option
//   Reference/XML/Infos/mapAspectRatio.xml        — synthetic MAPASPECTRATIO option
//   Reference/XML/Infos/text-*.xml                — TEXT_* → en-US labels (merged)
//   Reference/Source/Base/Game/GameCore/MapScripts/{Map,m}apScript*.cs
//                                                 — per-script options.Add(...) calls
//   Reference/Source/Base/Game/GameCore/MapScripts/DefaultMapScript.cs
//                                                 — globals applied to every script
//
// SYNTHETIC OPTIONS: map size and aspect ratio aren't registered via the
// usual options.Add(...) C# calls — they're top-level OW game-setup params
// in their own XML files. We inject them as "MAPSIZE" / "MAPASPECTRATIO"
// synthetic globals so admins can configure them per-script alongside the
// real options.
//
// Filename quirks preserved verbatim (Mohawk source):
//   MapScripLakesAndGulfs.cs        — missing trailing 't' in "MapScript"
//   MapScriptMediterrancean.cs      — misspelling in source
//   Mapscript<X>.cs (Indus DLC)     — lowercase 's' in "Mapscript"
//
// OUTPUT: .bake/map-options.json (gitignored sidecar). The finalize step
// (scripts/build-manifests.ts) reads it and emits the runtime modules at
// src/lib/generated/{map-option-defs,map-script-options}.ts.
//
// Filters:
//   - Options with bMultiPlayerValid=0 are dropped (tournaments are MP-only).
//   - Options not registered by any script (including DefaultMapScript) are
//     dropped — there's nowhere to surface them.
//
// Run: npm run bake:map-options

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { XMLParser } from "fast-xml-parser";

import { resolveReferenceXml } from "./lib/paths.js";
import { formatEnum } from "../src/lib/utils/formatting.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SIDECAR = resolve(REPO_ROOT, ".bake/map-options.json");

interface MultiEntry {
	zType?: string;
	Name?: string;
	Choices?: { zValue?: string | string[] };
	Default?: string;
	bSinglePlayerValid?: string;
	bMultiPlayerValid?: string;
}

interface SingleEntry {
	zType?: string;
	Name?: string;
	bSinglePlayerValid?: string;
	bMultiPlayerValid?: string;
}

interface TextEntry {
	zType?: string;
	"en-US"?: string;
}

interface SizeOrAspectEntry {
	zType?: string;
	Name?: string;
}

// Synthetic option zTypes injected as globals — see header comment. Defaults
// suit Per-Ankh's 1v1 Swiss tournament format: Duel is the OW map size sized
// for two players (2025 tiles), and Square is the standard competitive aspect.
const SYNTHETIC_OPTION_LABELS: Readonly<Record<string, string>> = {
	MAPSIZE: "Map Size",
	MAPASPECTRATIO: "Map Aspect Ratio",
};
const SYNTHETIC_OPTION_DEFAULTS: Readonly<Record<string, string>> = {
	MAPSIZE: "MAPSIZE_SMALLEST",
	MAPASPECTRATIO: "MAPASPECTRATIO_SQUARE",
};
const SYNTHETIC_GLOBALS: readonly string[] = ["MAPSIZE", "MAPASPECTRATIO"];

type OptionDef =
	| {
			kind: "select";
			label: string;
			choices: { value: string; label: string }[];
			default: string;
	  }
	| { kind: "toggle"; label: string; default: false };

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
	const arr = Array.isArray(entry) ? entry : [entry];
	// The first <Entry> in each file is a template with empty/null fields
	// declaring the shape. Filter it out — entries with no zType are noise.
	return arr.filter((e) => {
		const z = (e as { zType?: string }).zType;
		return typeof z === "string" && z.length > 0;
	});
}

function toChoiceArray(c: MultiEntry["Choices"]): string[] {
	if (!c?.zValue) return [];
	return Array.isArray(c.zValue) ? c.zValue : [c.zValue];
}

function isMpValid(e: { bMultiPlayerValid?: string }): boolean {
	// Absent flag means valid (XML default). Explicit "0" means invalid in MP.
	return e.bMultiPlayerValid !== "0";
}

// Strips inline-comment prefix so commented-out lines don't match. We rely on
// the fact that C# uses // for both leading and trailing comments; the regex
// then anchors options.Add to start-of-effective-line.
const ADD_OPTION_RE =
	/^\s*options\.Add\(infos\.getType<MapOptions(Multi|Single)Type>\("([^"]+)"\)\)/gm;

interface ScriptDecl {
	mapclass: string;
	options: string[]; // ordered, de-duplicated
	// Raw return expression of the script's static AllowMirror() method, or
	// null if it declares none. Resolved (following delegations) in main() to
	// decide whether the Mirror toggle applies to this script. See MIRROR_OPTION.
	allowMirrorExpr: string | null;
}

// Real option zType for the Mirror lobby toggle. Unlike normal options it is
// never registered via an options.Add(...) call — DefaultMapScript applies it
// to every script whose static AllowMirror() returns true (and only at
// NumTeams == 2, i.e. the 1v1 tournament case). We surface it per-script by
// parsing that method, then let the normal singleEntries pass emit its toggle
// def (Mirror is in mapOptionsSingle.xml and MP-valid).
const MIRROR_OPTION = "MAP_OPTIONS_SINGLE_MIRROR";

// Captures the return expression of a script's AllowMirror() method. Every
// script's body is a single `return <expr>;` where <expr> is `true`, `false`,
// or a delegation like `MapScriptSeaside.AllowMirror()`.
const ALLOW_MIRROR_RE =
	/public static (?:new )?bool AllowMirror\(\)\s*\{\s*return\s+([^;]+);/;

function parseAllowMirrorExpr(src: string): string | null {
	const m = src.match(ALLOW_MIRROR_RE);
	return m ? m[1].trim() : null;
}

// Distinct option zTypes registered via options.Add(...) calls, in source
// order. Shared by per-script and global (DefaultMapScript) parsing.
function parseOptionAdds(src: string): string[] {
	const seen = new Set<string>();
	const options: string[] = [];
	for (const m of src.matchAll(ADD_OPTION_RE)) {
		const zType = m[2];
		if (seen.has(zType)) continue;
		seen.add(zType);
		options.push(zType);
	}
	return options;
}

// Translate a C# filename (without extension) into its MAPCLASS_* identifier.
// Examples:
//   MapScriptDonut          → MAPCLASS_MapScriptDonut
//   MapScripLakesAndGulfs   → MAPCLASS_MapScripLakesAndGulfs   (preserved typo)
//   MapscriptJungle         → MAPCLASS_MapscriptJungle         (lowercase s)
//   DefaultMapScript        → (skipped — handled separately as globals)
//   MapScriptInterface      → (skipped — interface, not a script)
function mapclassForFile(basename: string): string | null {
	if (basename === "DefaultMapScript" || basename === "MapScriptInterface") {
		return null;
	}
	// Both "MapScrip" (covers the LakesAndGulfs typo + all real MapScript*)
	// and "Mapscript" (Indus DLC lowercase-s) are valid prefixes.
	if (basename.startsWith("MapScrip") || basename.startsWith("Mapscript")) {
		return `MAPCLASS_${basename}`;
	}
	return null;
}

async function parseScriptFile(
	path: string,
	basename: string,
): Promise<ScriptDecl | null> {
	const mapclass = mapclassForFile(basename);
	if (!mapclass) return null;
	const src = await readFile(path, "utf-8");
	return {
		mapclass,
		options: parseOptionAdds(src),
		allowMirrorExpr: parseAllowMirrorExpr(src),
	};
}

async function parseGlobalOptions(path: string): Promise<string[]> {
	return parseOptionAdds(await readFile(path, "utf-8"));
}

async function main(): Promise<void> {
	const xmlDir = resolveReferenceXml();
	// resolveReferenceXml() returns the XML dir; the source tree is its
	// sibling under the same Reference root.
	const referenceRoot = resolve(xmlDir, "..");
	const infosDir = resolve(xmlDir, "Infos");
	const mapScriptsDir = resolve(
		referenceRoot,
		"Source/Base/Game/GameCore/MapScripts",
	);

	// ─── Option definitions ──────────────────────────────────────────
	const singlePath = resolve(infosDir, "mapOptionsSingle.xml");
	const multiPath = resolve(infosDir, "mapOptionsMulti.xml");
	const multiWogPath = resolve(infosDir, "mapOptionsMulti-wog.xml");
	const mapSizePath = resolve(infosDir, "mapSize.xml");
	const mapAspectRatioPath = resolve(infosDir, "mapAspectRatio.xml");

	const [
		singleEntries,
		multiEntries,
		multiWogEntries,
		sizeEntries,
		aspectEntries,
	] = await Promise.all([
		loadEntries<SingleEntry>(singlePath),
		loadEntries<MultiEntry>(multiPath),
		loadEntries<MultiEntry>(multiWogPath),
		loadEntries<SizeOrAspectEntry>(mapSizePath),
		loadEntries<SizeOrAspectEntry>(mapAspectRatioPath),
	]);

	// ─── Text lookup (TEXT_* → en-US) merged across all text-*.xml files ──
	const allFiles = await readdir(infosDir);
	const textFiles = allFiles
		.filter((f) => /^text-.*\.xml$/.test(f))
		.map((f) => resolve(infosDir, f));
	const textFileEntries = await Promise.all(
		textFiles.map((p) => loadEntries<TextEntry>(p)),
	);
	const textByKey = new Map<string, string>();
	for (const entries of textFileEntries) {
		for (const t of entries) {
			if (t.zType && t["en-US"]) textByKey.set(t.zType, t["en-US"]);
		}
	}
	const labelFor = (textKey: string | undefined, fallback: string): string => {
		if (textKey) {
			const hit = textByKey.get(textKey);
			if (hit) return hit;
		}
		return fallback;
	};

	// ─── C# source: per-script + globals ─────────────────────────────
	const mapScriptFiles = await readdir(mapScriptsDir);
	const csFiles = mapScriptFiles.filter((f) => /\.cs$/.test(f));

	const defaultPath = resolve(mapScriptsDir, "DefaultMapScript.cs");
	const parsedGlobals = await parseGlobalOptions(defaultPath);
	// Prepend synthetic globals so MAPSIZE / MAPASPECTRATIO appear first in
	// every script's option block, matching OW lobby ordering.
	const globals = [...SYNTHETIC_GLOBALS, ...parsedGlobals];

	const scriptDecls: ScriptDecl[] = [];
	for (const f of csFiles) {
		const basename = f.replace(/\.cs$/, "");
		const decl = await parseScriptFile(resolve(mapScriptsDir, f), basename);
		if (decl) scriptDecls.push(decl);
	}

	// Hard assertion: if a known script registered no options after parsing,
	// something is wrong with the C# regex. Catches a complete parse failure
	// immediately rather than emitting a confusingly-empty manifest.
	for (const decl of scriptDecls) {
		if (decl.options.length === 0) {
			console.warn(
				`bake-map-options: warning — ${decl.mapclass} parsed zero options.Add() calls. ` +
					`This script will only get the DefaultMapScript globals.`,
			);
		}
	}
	if (globals.length === 0) {
		throw new Error(
			"bake-map-options: DefaultMapScript.cs yielded zero options.Add() calls. " +
				"Did Mohawk refactor how options are registered? Re-check ADD_OPTION_RE.",
		);
	}

	// ─── Mirror (conditional lobby toggle) ───────────────────────────
	// Mirror is applied by DefaultMapScript only to scripts whose static
	// AllowMirror() returns true. Some scripts delegate (e.g. Bay returns
	// MapScriptSeaside.AllowMirror()), so resolve transitively. Append
	// MIRROR_OPTION to the qualifying scripts so it lands in `registered`
	// below and the singleEntries pass emits its toggle def.
	const allowMirrorByBasename = new Map<string, string>();
	for (const d of scriptDecls) {
		if (d.allowMirrorExpr) {
			allowMirrorByBasename.set(
				d.mapclass.replace(/^MAPCLASS_/, ""),
				d.allowMirrorExpr,
			);
		}
	}
	const resolveAllowMirror = (
		basename: string,
		seen: Set<string> = new Set(),
	): boolean => {
		if (seen.has(basename)) return false; // delegation cycle guard
		seen.add(basename);
		const expr = allowMirrorByBasename.get(basename);
		if (!expr) return false;
		if (expr === "true") return true;
		if (expr === "false") return false;
		const delegate = expr.match(/^(\w+)\.AllowMirror\(\)$/);
		if (delegate) return resolveAllowMirror(delegate[1], seen);
		console.warn(
			`bake-map-options: unrecognized AllowMirror() body for ${basename}: ` +
				`"${expr}" — treating as Mirror-disallowed.`,
		);
		return false;
	};
	for (const d of scriptDecls) {
		const basename = d.mapclass.replace(/^MAPCLASS_/, "");
		if (resolveAllowMirror(basename) && !d.options.includes(MIRROR_OPTION)) {
			d.options.push(MIRROR_OPTION);
		}
	}

	// ─── Build the canonical zType set (registered by any script + globals) ──
	const registered = new Set<string>(globals);
	for (const d of scriptDecls) {
		for (const o of d.options) registered.add(o);
	}

	// ─── Build OptionDef map, filtering by MP-validity + registration ────
	const optionDefs: Record<string, OptionDef> = {};

	for (const e of multiEntries) {
		const zType = e.zType!;
		if (!isMpValid(e)) continue;
		if (!registered.has(zType)) continue;
		const choiceValues = toChoiceArray(e.Choices);
		if (choiceValues.length === 0) continue;
		const defaultValue = e.Default ?? choiceValues[0];
		optionDefs[zType] = {
			kind: "select",
			label: labelFor(e.Name, formatEnum(zType, "MAP_OPTIONS_")),
			choices: choiceValues.map((v) => ({
				value: v,
				label: labelFor(undefined, formatEnum(v, "MAP_OPTION_")),
			})),
			default: defaultValue,
		};
	}
	for (const e of multiWogEntries) {
		const zType = e.zType!;
		if (!isMpValid(e)) continue;
		if (!registered.has(zType)) continue;
		const choiceValues = toChoiceArray(e.Choices);
		if (choiceValues.length === 0) continue;
		const defaultValue = e.Default ?? choiceValues[0];
		optionDefs[zType] = {
			kind: "select",
			label: labelFor(e.Name, formatEnum(zType, "MAP_OPTIONS_")),
			choices: choiceValues.map((v) => ({
				value: v,
				label: labelFor(undefined, formatEnum(v, "MAP_OPTION_")),
			})),
			default: defaultValue,
		};
	}
	for (const e of singleEntries) {
		const zType = e.zType!;
		if (!isMpValid(e)) continue;
		if (!registered.has(zType)) continue;
		optionDefs[zType] = {
			kind: "toggle",
			label: labelFor(e.Name, formatEnum(zType, "MAP_OPTIONS_SINGLE_")),
			default: false,
		};
	}

	// ─── Synthetic options (size + aspect ratio) ─────────────────────
	// Built from mapSize.xml / mapAspectRatio.xml. Each XML <Entry> becomes
	// a choice on the synthetic option. Entries' <Name> fields are TEXT_*
	// keys resolved against the merged text-*.xml lookup (e.g.
	// TEXT_MAPSIZE_DUEL → "Duel"). Option-group labels are hand-set.
	function buildSyntheticOption(
		key: keyof typeof SYNTHETIC_OPTION_LABELS,
		entries: SizeOrAspectEntry[],
		valuePrefix: string,
	): OptionDef {
		const choices = entries
			.filter(
				(
					e,
				): e is Required<Pick<SizeOrAspectEntry, "zType">> &
					SizeOrAspectEntry =>
					typeof e.zType === "string" && e.zType.length > 0,
			)
			.map((e) => ({
				value: e.zType,
				label: labelFor(e.Name, formatEnum(e.zType, valuePrefix)),
			}));
		if (choices.length === 0) {
			throw new Error(
				`bake-map-options: synthetic option ${key} resolved zero choices. ` +
					`Did Reference/XML/Infos/${key === "MAPSIZE" ? "mapSize" : "mapAspectRatio"}.xml change shape?`,
			);
		}
		const def: string = SYNTHETIC_OPTION_DEFAULTS[key];
		if (!choices.some((c) => c.value === def)) {
			throw new Error(
				`bake-map-options: synthetic default ${def} is not a choice of ${key}.`,
			);
		}
		return {
			kind: "select",
			label: SYNTHETIC_OPTION_LABELS[key],
			choices,
			default: def,
		};
	}
	optionDefs.MAPSIZE = buildSyntheticOption("MAPSIZE", sizeEntries, "MAPSIZE_");
	optionDefs.MAPASPECTRATIO = buildSyntheticOption(
		"MAPASPECTRATIO",
		aspectEntries,
		"MAPASPECTRATIO_",
	);

	// Now re-fill the choice labels — the multi loop above used formatEnum
	// fallback for every choice because we didn't have the choice's TEXT_*
	// key. For choice labels, the convention is the choice zValue itself
	// resolves directly through text-infos as a TEXT_MAP_OPTION_* key in
	// some cases (e.g. TEXT_MAP_OPTION_HIGH_RESOURCES → "High"). Try the
	// straight zValue key first, then the TEXT_-prefixed form.
	for (const def of Object.values(optionDefs)) {
		if (def.kind !== "select") continue;
		for (const c of def.choices) {
			const direct = textByKey.get(c.value);
			if (direct) {
				c.label = direct;
				continue;
			}
			const textForm = textByKey.get(`TEXT_${c.value}`);
			if (textForm) {
				c.label = textForm;
				continue;
			}
			// formatEnum fallback already applied above.
		}
	}

	// ─── Per-script options array (globals first, then script-specific) ──
	// Some scripts already include some globals via their own options.Add(...)
	// calls (e.g. MapScriptRejuvenation.cs adds CITY_SITE_DENSITY itself).
	// Dedupe but keep globals-first ordering.
	const scriptOptions: Record<string, string[]> = {};
	for (const decl of scriptDecls) {
		const seen = new Set<string>();
		const out: string[] = [];
		for (const o of globals) {
			if (!optionDefs[o]) continue; // dropped by filters
			if (seen.has(o)) continue;
			seen.add(o);
			out.push(o);
		}
		for (const o of decl.options) {
			if (!optionDefs[o]) continue;
			if (seen.has(o)) continue;
			seen.add(o);
			out.push(o);
		}
		// Only emit scripts that resolved to at least one option.
		if (out.length > 0) scriptOptions[decl.mapclass] = out;
	}

	// Sort the option-def map and the script keys for deterministic output.
	const sortedOptions: Record<string, OptionDef> = {};
	for (const k of Object.keys(optionDefs).sort())
		sortedOptions[k] = optionDefs[k];
	const sortedScripts: Record<string, string[]> = {};
	for (const k of Object.keys(scriptOptions).sort())
		sortedScripts[k] = scriptOptions[k];

	const payload = {
		options: sortedOptions,
		scriptOptions: sortedScripts,
	};

	await mkdir(dirname(SIDECAR), { recursive: true });
	await writeFile(SIDECAR, JSON.stringify(payload, null, "\t") + "\n", "utf-8");

	console.log(
		`bake-map-options: ${Object.keys(sortedOptions).length} option defs, ` +
			`${Object.keys(sortedScripts).length} scripts ` +
			`(globals: ${globals.length}, merged ${textFiles.length} text-*.xml files) ` +
			`→ ${SIDECAR.replace(REPO_ROOT + "/", "")}`,
	);
}

await main();
