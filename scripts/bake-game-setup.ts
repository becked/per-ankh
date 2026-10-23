// Bake the game-setup panel's vocabulary from the OW reference XML: the seven
// sections Old World's own setup screens declare, the parameters that sit in
// each, the display name of every value those parameters take, the game
// options with their help text and category, and the difficulty-mode presets
// the "Difficulty" row is reverse-looked-up against.
//
// WHY A TABLE AND NOT formatEnum. Six of the thirteen setup info-lists rename
// their values wholesale, and the renames are not cosmetic — `ADVANTAGE_
// PENALTY_HIGH` is "High Penalty", `OCCURRENCELEVEL_CALAMITIES_LOW` is "Rare",
// and `VICTORYPOINT_HIGH` is "Very High", which makes formatEnum off by a tier
// and silently wrong rather than merely ugly. Measured against
// Reference/XML/Infos: difficulty 7/7 diverge, difficultyMode 9/9, turnScale
// 4/4, advantage 7/8, occurrenceLevel 6/6, turnStyle 3/6, teamNation 2/3,
// victoryPoint 2/4, mortality 1/3, eventLevel 1/5, forceMarch 1/3,
// dynasty 14/70; development, opponentLevel, tribeLevel, successionGender,
// successionOrder, turnTimer and occurrenceClass are 0/N and fall through.
//
// WHY THE LABELS COME FROM THE SETUP SCREENS and not from the game-menu hover
// (`HelpText.buildGameParametersDesc`, HelpText.Game.cs:3408): the hover is a
// flat HUD list, and three of its labels are stale relative to the screen the
// player actually read — Tribe Level is "Tribal Strength" there, Force March
// is "Forced March", Map Type is "Map Script". The two agree on the rest.
//
// SOURCES (local-only, via the Reference/ symlink resolved by paths.ts), all
// under Reference/XML/Infos/:
//   text-ui.xml       — the seven TEXT_SP_SETUP_*_OPTIONS section headings and
//     the TEXT_{SP,MP}_SETUP_* parameter labels.
//   gameOption.xml    — <zType>, <zName>, <zHelp>, <Category> (the setup
//     screen an option appears on) and <zSubTypeOf>.
//   difficultyMode.xml — the six named presets plus their component tiers,
//     which is what `GameParameters.GetDifficultyMode` (GameParameters.cs:1907)
//     matches a game's settings against.
//   occurrenceClass.xml — the classes that same matcher iterates.
//   victory.xml       — <bToggle>, the victory types a game can switch on or
//     off, and <iPercentVP>, which is what gates the game's own "Points to
//     Win" row (`isPointsVictory`, HelpText.Game.cs:3726).
//   difficulty / development / opponentLevel / advantage / tribeLevel /
//   occurrenceLevel / successionGender / successionOrder / mortality /
//   turnScale / eventLevel / forceMarch / victoryPoint / teamNation /
//   turnStyle / turnTimer / dynasty / scenario .xml — the value lists.
//   text-*.xml        — <en-US> for every key above, merged across base and
//     DLC the way the other name bakers merge them.
//
// turnScale.xml carries no <Name> at all, so its row names itself through
// <ScalePlural> — the field the hover reads (HelpText.Game.cs:3673), which is
// why "Years" and not "Year".
//
// OUTPUT: src/lib/generated/game-setup.ts (checked in, self-contained — no
// .bake sidecar, so bake:finalize can never blank it in a checkout where this
// hasn't run; the arrangement bake-trait-names.ts and bake-character-opinion.ts
// use). Frontend only: the Worker labels no setup value.
//
// This baker REPLACES bake-difficulty-names.ts and bake-game-option-names.ts,
// whose DIFFICULTY_NAMES and GAME_OPTION_NAMES it subsumes — difficulty.xml is
// one of the value lists below, and a game option's name is GAME_OPTIONS[z].label.
//
// Run: npm run bake:game-setup

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { XMLParser } from "fast-xml-parser";
import { format as prettierFormat, resolveConfig } from "prettier";

import { resolveReferenceXml } from "./lib/paths.js";
import { formatEnum, stripMarkup } from "../src/lib/utils/formatting.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const OUTPUT_TS = resolve(REPO_ROOT, "src/lib/generated/game-setup.ts");

// ─── The seven setup screens ─────────────────────────────────────────
//
// Section keys are the <Category> values gameOption.xml already uses, so an
// option's category lands in the same scheme without a translation table; the
// two sections that carry no options (VICTORY, DLC_MOD) extend it.
const SECTIONS: readonly { key: string; textKey: string }[] = [
	{ key: "PLAYER", textKey: "TEXT_SP_SETUP_PLAYER_OPTIONS" },
	{ key: "OPPONENTS", textKey: "TEXT_SP_SETUP_OPPONENT_OPTIONS" },
	{ key: "CHARACTERS", textKey: "TEXT_SP_SETUP_CHARACTER_OPTIONS" },
	{ key: "VICTORY", textKey: "TEXT_SP_SETUP_VICTORY_OPTIONS" },
	{ key: "MAP", textKey: "TEXT_SP_SETUP_MAP_OPTIONS" },
	{ key: "RULES", textKey: "TEXT_SP_SETUP_RULES_OPTIONS" },
	{ key: "DLC_MOD", textKey: "TEXT_SP_SETUP_DLC_MOD_OPTIONS" },
];

// ─── The parameters, in the order each section shows them ────────────
//
// `key` is the root attribute name `GameParameters.writeGameXML`
// (GameParameters.cs:536) writes, verbatim — the key the parser's
// setup_parameters bag is keyed by. The text key is curated because it does
// not derive from the attribute name (@VictoryPointModifier is
// ..._VICTORY_POINT_THRESHOLD, @ForceMarch is ..._FORCEMARCH); everything
// downstream of it is read from XML.
//
// `prefix` is the formatEnum prefix for the parameter's values, or null for a
// value the renderer formats itself (a map script through mapScriptLabel, a
// map size through the baked MAPSIZE choices, an integer).
interface ParameterSpec {
	key: string;
	section: string;
	textKey: string;
	prefix: string | null;
	// The value list, when the parameter has one. `nameField` overrides the
	// default <Name> — turnScale.xml has none and names itself by its plural.
	list?: { file: string; nameField?: string };
}

const PARAMETERS: readonly ParameterSpec[] = [
	// Player Setup — the human's starting development. The game draws no row
	// for it (`ALLOW_HUMAN_DEVELOPMENT_OPTIONS` is 0, globalsInt.xml:1229), so
	// the renderer keeps it hidden unless a save carries something other than
	// DEVELOPMENT_NONE.
	{
		key: "HumanDevelopment",
		section: "PLAYER",
		textKey: "TEXT_SP_SETUP_ADVANCED_HUMAN_DEVELOPMENT",
		prefix: "DEVELOPMENT_",
		list: { file: "development.xml" },
	},
	// Opponent Setup — the five knobs the Difficulty preset expands into,
	// minus Prosperity, which is per-player. Calamities is the sixth and lives
	// in <OccurrenceLevels> rather than an attribute.
	{
		key: "OpponentLevel",
		section: "OPPONENTS",
		textKey: "TEXT_SP_SETUP_ADVANCED_AI_AGGRESSION",
		prefix: "OPPONENTLEVEL_",
		list: { file: "opponentLevel.xml" },
	},
	{
		key: "Development",
		section: "OPPONENTS",
		textKey: "TEXT_SP_SETUP_ADVANCED_AI_DEVELOPMENT",
		prefix: "DEVELOPMENT_",
		list: { file: "development.xml" },
	},
	{
		key: "Advantage",
		section: "OPPONENTS",
		textKey: "TEXT_SP_SETUP_ADVANCED_AI_ADVANTAGE",
		prefix: "ADVANTAGE_",
		list: { file: "advantage.xml" },
	},
	{
		key: "TribeLevel",
		section: "OPPONENTS",
		textKey: "TEXT_SP_SETUP_ADVANCED_TRIBE_LEVEL",
		prefix: "TRIBELEVEL_",
		list: { file: "tribeLevel.xml" },
	},
	// Characters and Events — the five the game gates together behind
	// GAMEOPTION_NO_CHARACTERS (HelpText.Game.cs:3655).
	{
		key: "SuccessionGender",
		section: "CHARACTERS",
		textKey: "TEXT_SP_SETUP_ADVANCED_SUCCESSION",
		prefix: "SUCCESSIONGENDER_",
		list: { file: "successionGender.xml" },
	},
	{
		key: "SuccessionOrder",
		section: "CHARACTERS",
		textKey: "TEXT_SP_SETUP_ADVANCED_SUCCESSION_ORDER",
		prefix: "SUCCESSIONORDER_",
		list: { file: "successionOrder.xml" },
	},
	{
		key: "Mortality",
		section: "CHARACTERS",
		textKey: "TEXT_SP_SETUP_ADVANCED_MORTALITY",
		prefix: "MORTALITY_",
		list: { file: "mortality.xml" },
	},
	{
		key: "TurnScale",
		section: "CHARACTERS",
		textKey: "TEXT_SP_SETUP_ADVANCED_TURN_SCALE",
		prefix: "TURNSCALE_",
		list: { file: "turnScale.xml", nameField: "ScalePlural" },
	},
	{
		key: "EventLevel",
		section: "CHARACTERS",
		textKey: "TEXT_SP_SETUP_ADVANCED_EVENTLEVEL",
		prefix: "EVENTLEVEL_",
		list: { file: "eventLevel.xml" },
	},
	// Victory Conditions — the enabled types are a list, not a parameter; this
	// is the threshold they are measured against.
	{
		key: "VictoryPointModifier",
		section: "VICTORY",
		textKey: "TEXT_SP_SETUP_ADVANCED_VICTORY_POINT_THRESHOLD",
		prefix: "VICTORYPOINT_",
		list: { file: "victoryPoint.xml" },
	},
	// Map Setup — all three already have a label helper in $lib/map-settings,
	// so they carry no prefix.
	{
		key: "MapClass",
		section: "MAP",
		textKey: "TEXT_SP_SETUP_SIMPLE_MAPSCRIPT",
		prefix: null,
	},
	{
		key: "MapSize",
		section: "MAP",
		textKey: "TEXT_SP_SETUP_SIMPLE_MAPSIZE",
		prefix: null,
	},
	{
		key: "MapAspectRatio",
		section: "MAP",
		textKey: "TEXT_SETUP_GAMEOPTIONS_LABEL_MAP_ASPECT_RATIO",
		prefix: null,
	},
	// Game Rules — the last three are multiplayer-only in the game
	// (HelpText.Game.cs:3706-3721).
	{
		key: "ForceMarch",
		section: "RULES",
		textKey: "TEXT_SP_SETUP_ADVANCED_FORCEMARCH",
		prefix: "FORCEMARCH_",
		list: { file: "forceMarch.xml" },
	},
	{
		key: "TeamNation",
		section: "RULES",
		textKey: "TEXT_MP_SETUP_GAMEOPTIONS_LABEL_TEAM_NATIONS",
		prefix: "TEAMNATION_",
		list: { file: "teamNation.xml" },
	},
	{
		key: "TurnStyle",
		section: "RULES",
		textKey: "TEXT_MP_SETUP_GAMEOPTIONS_LABEL_TURNSTYLE",
		prefix: "TURNSTYLE_",
		list: { file: "turnStyle.xml" },
	},
	{
		key: "TurnTimer",
		section: "RULES",
		textKey: "TEXT_MP_SETUP_GAMEOPTIONS_LABEL_TURNTIMER",
		prefix: "TURNTIMER_",
		list: { file: "turnTimer.xml" },
	},
	{
		key: "SimultaneousTurns",
		section: "RULES",
		textKey: "TEXT_MP_SETUP_GAMEOPTIONS_LABEL_SIMULTURNS",
		prefix: null,
	},
];

// Value lists no parameter owns: the three per-player columns (Prosperity,
// Dynasty), the Calamities row's class and level, and the scenario the header
// strip names.
const EXTRA_VALUE_LISTS: readonly { file: string; prefix: string }[] = [
	{ file: "difficulty.xml", prefix: "DIFFICULTY_" },
	{ file: "dynasty.xml", prefix: "DYNASTY_" },
	{ file: "occurrenceClass.xml", prefix: "OCCURRENCECLASS_" },
	{ file: "occurrenceLevel.xml", prefix: "OCCURRENCELEVEL_" },
	{ file: "scenario.xml", prefix: "SCENARIO_" },
];

// ─── XML plumbing ────────────────────────────────────────────────────

interface NamedEntry {
	zType?: string;
	Name?: string;
	ScalePlural?: string;
}
interface TextEntry {
	zType?: string;
	"en-US"?: string;
}
interface GameOptionEntry {
	zType?: string;
	zName?: string;
	zHelp?: string;
	Category?: string;
	zSubTypeOf?: string;
}
interface OccurrencePair {
	zIndex?: string;
	zValue?: string;
}
interface DifficultyModeEntry {
	zType?: string;
	Name?: string;
	Difficulty?: string;
	Development?: string;
	OpponentLevel?: string;
	TribeLevel?: string;
	Advantage?: string;
	OccurrenceLevels?: { Pair?: OccurrencePair | OccurrencePair[] };
}
interface VictoryEntry {
	zType?: string;
	iPercentVP?: string;
	bToggle?: string;
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

function asPairs(
	node: DifficultyModeEntry["OccurrenceLevels"],
): OccurrencePair[] {
	if (!node?.Pair) return [];
	return Array.isArray(node.Pair) ? node.Pair : [node.Pair];
}

// ─── Emit ────────────────────────────────────────────────────────────

interface SetupParameter {
	key: string;
	section: string;
	label: string;
	prefix: string | null;
}
interface GameOptionInfo {
	label: string;
	help: string;
	section: string;
	subOption: boolean;
}
interface DifficultyMode {
	zType: string;
	label: string;
	difficulty: string;
	development: string;
	opponentLevel: string;
	tribeLevel: string;
	advantage: string;
	occurrenceLevels: Record<string, string>;
}

function emit(data: {
	sections: { key: string; label: string }[];
	parameters: SetupParameter[];
	valueNames: Record<string, string>;
	gameOptions: Record<string, GameOptionInfo>;
	occurrenceClasses: string[];
	difficultyModes: DifficultyMode[];
	victoryToggles: string[];
	victoryPointVictories: string[];
}): string {
	const lines: string[] = [];
	const push = (...rows: string[]) => lines.push(...rows);
	const json = (v: unknown) => JSON.stringify(v);

	push(
		"// AUTO-GENERATED by scripts/bake-game-setup.ts. Do not edit.",
		"// Run `npm run bake:game-setup` to refresh.",
		"//",
		"// The vocabulary of the game-detail Settings tab: Old World's own setup",
		"// sections and parameter labels, the display name of every value a setup",
		"// parameter takes, the game options with their help text, and the",
		"// difficulty-mode presets the Difficulty row is matched against. Read by",
		"// `$lib/map-settings`, which builds the rows.",
		"",
		"export interface SetupSection {",
		"\t/** Section key — also a game option's <Category> value for the five that carry options. */",
		"\treadonly key: string;",
		'\t/** The heading the setup screen shows, e.g. "Opponent Setup". */',
		"\treadonly label: string;",
		"}",
		"",
		"// The seven sections Old World's setup screens declare, in setup order.",
		"export const SETUP_SECTIONS: readonly SetupSection[] = [",
	);
	for (const s of data.sections) {
		push(`\t{ key: ${json(s.key)}, label: ${json(s.label)} },`);
	}
	push(
		"];",
		"",
		"export interface SetupParameter {",
		"\t/** The root attribute name the save writes, and the setup_parameters key. */",
		"\treadonly key: string;",
		"\t/** Which SETUP_SECTIONS entry this row belongs to. */",
		"\treadonly section: string;",
		'\t/** The label the setup screen gives it, e.g. "AI Handicap". */',
		"\treadonly label: string;",
		"\t/**",
		"\t * formatEnum prefix for this parameter's values, or null for a value the",
		"\t * renderer formats itself (map script, map size, aspect ratio, integer).",
		"\t */",
		"\treadonly prefix: string | null;",
		"}",
		"",
		"// Every game-wide setup row, grouped by section and in the order its",
		"// section shows them.",
		"export const SETUP_PARAMETERS: readonly SetupParameter[] = [",
	);
	for (const p of data.parameters) {
		push(
			`\t{ key: ${json(p.key)}, section: ${json(p.section)}, label: ${json(p.label)}, prefix: ${json(p.prefix)} },`,
		);
	}
	push(
		"];",
		"",
		"// zType → the name the game displays, across every setup value list —",
		"// DIVERGENCES ONLY, so a value whose name already matches formatEnum falls",
		"// through without a lookup (see `setupValueName` in $lib/map-settings).",
		"export const SETUP_VALUE_NAMES: Readonly<Record<string, string>> = {",
	);
	for (const key of Object.keys(data.valueNames).sort()) {
		push(`\t${json(key)}: ${json(data.valueNames[key])},`);
	}
	push(
		"};",
		"",
		"export interface GameOptionInfo {",
		'\t/** The label the setup screen gives it — GAMEOPTION_PLAY_TO_WIN is "Ruthless AI". */',
		"\treadonly label: string;",
		"\t/** The option's own help text, as the setup screen shows it. */",
		"\treadonly help: string;",
		"\t/** The SETUP_SECTIONS key its <Category> names. */",
		"\treadonly section: string;",
		"\t/**",
		"\t * True for an option declared <zSubTypeOf> another. A save never writes",
		"\t * one (`GameParameters.writeGameXML`, GameParameters.cs:773), so one can",
		"\t * never appear in a game's game_options — it is here because the table is",
		"\t * a plain zType lookup, not a list of what a save can hold.",
		"\t */",
		"\treadonly subOption: boolean;",
		"}",
		"",
		"export const GAME_OPTIONS: Readonly<Record<string, GameOptionInfo>> = {",
	);
	for (const key of Object.keys(data.gameOptions).sort()) {
		push(`\t${json(key)}: ${json(data.gameOptions[key])},`);
	}
	push(
		"};",
		"",
		"// The occurrence classes `GameParameters.GetDifficultyMode`",
		"// (GameParameters.cs:1907) iterates when it compares a game's calamity",
		"// settings against a preset's — a class absent from either side reads as",
		"// NONE on that side, so the comparison has to walk the classes rather than",
		"// the keys present.",
		"export const OCCURRENCE_CLASSES: readonly string[] = [",
	);
	for (const c of data.occurrenceClasses) push(`\t${json(c)},`);
	push(
		"];",
		"",
		"export interface DifficultyMode {",
		"\treadonly zType: string;",
		'\t/** The preset\'s name, e.g. "The Great". */',
		"\treadonly label: string;",
		"\t/** The Prosperity tier the preset sets — per-player in a save. */",
		"\treadonly difficulty: string;",
		"\treadonly development: string;",
		"\treadonly opponentLevel: string;",
		"\treadonly tribeLevel: string;",
		"\treadonly advantage: string;",
		"\t/** Occurrence class → level; a class the preset omits means NONE. */",
		"\treadonly occurrenceLevels: Readonly<Record<string, string>>;",
		"}",
		"",
		"// The named presets, in info-list order — the order GetDifficultyMode",
		"// scans, so the first match wins there too.",
		"export const DIFFICULTY_MODES: readonly DifficultyMode[] = [",
	);
	for (const m of data.difficultyModes) push(`\t${json(m)},`);
	push(
		"];",
		"",
		"// The victory types a game can switch on or off (<bToggle>), in info-list",
		"// order \u2014 the ones the game draws an Enabled/Disabled line for",
		"// (HelpText.Game.cs:3736). Conquest is absent because it is always on, so",
		"// it has no line of its own.",
		"export const VICTORY_TOGGLES: readonly string[] = [",
	);
	for (const v of data.victoryToggles) push(`\t${json(v)},`);
	push(
		"];",
		"",
		"// Victory types worth victory points (<iPercentVP> non-zero), which is what",
		'// gates the game\'s own "Points to Win" row (`isPointsVictory`,',
		"// HelpText.Game.cs:3726) — a game with only Double enabled still has a",
		"// points threshold, so this is not the same question as whether",
		"// VICTORY_POINTS itself is on.",
		"export const VICTORY_POINT_VICTORIES: readonly string[] = [",
	);
	for (const v of data.victoryPointVictories) push(`\t${json(v)},`);
	push("];", "");
	return lines.join("\n");
}

// ─── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	const infosDir = resolve(resolveReferenceXml(), "Infos");
	const allFiles = await readdir(infosDir);
	const textFiles = allFiles.filter((f) => /^text-.*\.xml$/.test(f));

	const textByKey = new Map<string, string>();
	for (const entries of await Promise.all(
		textFiles.map((f) => loadEntries<TextEntry>(resolve(infosDir, f))),
	)) {
		for (const t of entries) {
			if (t.zType && t["en-US"]) textByKey.set(t.zType, String(t["en-US"]));
		}
	}

	// OW packs a string's grammatical variants into one ~-separated field; the
	// display form is field 0, the way the nation and trait bakes read it.
	const textFor = (key: string | undefined): string | null => {
		if (!key) return null;
		const raw = textByKey.get(key);
		if (!raw) return null;
		return stripMarkup(raw.split("~")[0]).trim() || null;
	};
	const requireText = (key: string, what: string): string => {
		const hit = textFor(key);
		if (hit == null) {
			throw new Error(
				`bake-game-setup: ${what} names ${key}, which no text-*.xml holds — ` +
					"did the key move?",
			);
		}
		return hit;
	};

	// ─── Sections ────────────────────────────────────────────────────
	const sections = SECTIONS.map((s) => ({
		key: s.key,
		label: requireText(s.textKey, `section ${s.key}`),
	}));

	// ─── Value names, divergences only ───────────────────────────────
	const valueNames: Record<string, string> = {};
	let valuesSeen = 0;
	const addList = async (
		file: string,
		prefix: string,
		nameField?: string,
	): Promise<void> => {
		for (const e of await loadEntries<NamedEntry>(resolve(infosDir, file))) {
			const zType = e.zType;
			if (typeof zType !== "string" || !zType.startsWith(prefix)) continue;
			valuesSeen += 1;
			const display = textFor(
				nameField === "ScalePlural" ? e.ScalePlural : e.Name,
			);
			if (display == null) continue;
			if (display === formatEnum(zType, prefix)) continue;
			valueNames[zType] = display;
		}
	};
	for (const p of PARAMETERS) {
		if (!p.list || p.prefix == null) continue;
		await addList(p.list.file, p.prefix, p.list.nameField);
	}
	for (const l of EXTRA_VALUE_LISTS) await addList(l.file, l.prefix);
	if (valuesSeen === 0) {
		throw new Error(
			"bake-game-setup: the setup value lists produced no entries — did " +
				"Reference/XML/Infos move?",
		);
	}

	// ─── Parameters ──────────────────────────────────────────────────
	const parameters: SetupParameter[] = [];
	for (const section of sections) {
		for (const p of PARAMETERS) {
			if (p.section !== section.key) continue;
			parameters.push({
				key: p.key,
				section: p.section,
				label: requireText(p.textKey, `parameter ${p.key}`),
				prefix: p.prefix,
			});
		}
	}
	if (parameters.length !== PARAMETERS.length) {
		throw new Error(
			`bake-game-setup: ${PARAMETERS.length - parameters.length} parameter(s) ` +
				"name a section SECTIONS does not declare",
		);
	}

	// ─── Game options ────────────────────────────────────────────────
	const sectionKeys = new Set(sections.map((s) => s.key));
	const gameOptions: Record<string, GameOptionInfo> = {};
	for (const o of await loadEntries<GameOptionEntry>(
		resolve(infosDir, "gameOption.xml"),
	)) {
		const zType = o.zType;
		if (typeof zType !== "string" || !zType.startsWith("GAMEOPTION_")) continue;
		const category = o.Category;
		if (typeof category !== "string" || !sectionKeys.has(category)) {
			throw new Error(
				`bake-game-setup: ${zType} has <Category>${category ?? ""}</Category>, ` +
					"which is not one of the setup sections — widen SECTIONS",
			);
		}
		gameOptions[zType] = {
			label: requireText(o.zName ?? "", `game option ${zType}`),
			help: requireText(o.zHelp ?? "", `game option ${zType} help`),
			section: category,
			subOption: typeof o.zSubTypeOf === "string" && o.zSubTypeOf.length > 0,
		};
	}
	if (Object.keys(gameOptions).length === 0) {
		throw new Error(
			"bake-game-setup: gameOption.xml produced no entries — did the XML move?",
		);
	}

	// ─── Occurrence classes + difficulty modes ───────────────────────
	const occurrenceClasses = (
		await loadEntries<NamedEntry>(resolve(infosDir, "occurrenceClass.xml"))
	)
		.map((e) => e.zType)
		.filter(
			(z): z is string =>
				typeof z === "string" && z.startsWith("OCCURRENCECLASS_"),
		);

	const difficultyModes: DifficultyMode[] = [];
	for (const m of await loadEntries<DifficultyModeEntry>(
		resolve(infosDir, "difficultyMode.xml"),
	)) {
		const zType = m.zType;
		if (typeof zType !== "string" || !zType.startsWith("DIFFICULTYMODE_")) {
			continue;
		}
		const occurrenceLevels: Record<string, string> = {};
		for (const pair of asPairs(m.OccurrenceLevels)) {
			if (pair.zIndex && pair.zValue)
				occurrenceLevels[pair.zIndex] = pair.zValue;
		}
		difficultyModes.push({
			zType,
			label: requireText(m.Name ?? "", `difficulty mode ${zType}`),
			difficulty: m.Difficulty ?? "",
			development: m.Development ?? "",
			opponentLevel: m.OpponentLevel ?? "",
			tribeLevel: m.TribeLevel ?? "",
			advantage: m.Advantage ?? "",
			occurrenceLevels,
		});
	}
	if (difficultyModes.length === 0) {
		throw new Error(
			"bake-game-setup: difficultyMode.xml produced no presets — did the XML " +
				"move?",
		);
	}

	// ─── Victory toggles + the points-victory gate ───────────────────
	const victories = (
		await loadEntries<VictoryEntry>(resolve(infosDir, "victory.xml"))
	).filter(
		(v): v is VictoryEntry & { zType: string } =>
			typeof v.zType === "string" && v.zType.startsWith("VICTORY_"),
	);
	const victoryToggles = victories
		.filter((v) => Number(v.bToggle ?? 0) !== 0)
		.map((v) => v.zType);
	const victoryPointVictories = victories
		.filter((v) => Number(v.iPercentVP ?? 0) !== 0)
		.map((v) => v.zType);
	if (victoryToggles.length === 0) {
		throw new Error(
			"bake-game-setup: no victory type carries <bToggle> — the Victory " +
				"Conditions section would never render",
		);
	}
	if (victoryPointVictories.length === 0) {
		throw new Error(
			"bake-game-setup: no victory type carries <iPercentVP> — the Points to " +
				"Win row would never render",
		);
	}

	const content = emit({
		sections,
		parameters,
		valueNames,
		gameOptions,
		occurrenceClasses,
		difficultyModes,
		victoryToggles,
		victoryPointVictories,
	});
	const config = await resolveConfig(OUTPUT_TS);
	const formatted = await prettierFormat(content, {
		...config,
		parser: "typescript",
		filepath: OUTPUT_TS,
	});
	await mkdir(dirname(OUTPUT_TS), { recursive: true });
	if (existsSync(OUTPUT_TS)) {
		const existing = await readFile(OUTPUT_TS, "utf-8");
		if (existing === formatted) {
			console.log("bake-game-setup: no changes");
			return;
		}
	}
	await writeFile(OUTPUT_TS, formatted);
	console.log(
		`bake-game-setup: ${sections.length} sections, ${parameters.length} ` +
			`parameters, ${Object.keys(valueNames).length} value-name overrides ` +
			`(of ${valuesSeen} values), ${Object.keys(gameOptions).length} game ` +
			`options, ${difficultyModes.length} difficulty modes, ` +
			`${occurrenceClasses.length} occurrence classes, ` +
			`${victoryToggles.length} victory toggles, merged ` +
			`${textFiles.length} text-*.xml files → ` +
			OUTPUT_TS.replace(REPO_ROOT + "/", ""),
	);
}

await main();
