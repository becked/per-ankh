// Finalize step for the asset-bake pipeline. Reads the JSON sidecars left by
// each individual bake script, asserts every referenced file exists on disk,
// reconciles orphan files, and emits the runtime TypeScript modules at
// src/lib/generated/{atlas,sprite,tech-names}.ts.
//
// SIDECARS (gitignored, written by the individual bakes):
//   .bake/atlas-manifest.json   — { logicalName: { webp?, json } }
//   .bake/sprite-manifest.json  — { "<category>/<basename>": "<public URL>" }
//   .bake/tech-names.json       — { TECH_*: "Display Name" } (optional;
//                                  missing → empty map; only contains entries
//                                  whose XML name differs from formatEnum)
//   .bake/improvement-names.json — { IMPROVEMENT_*: "Display Name" } (optional;
//                                  missing → empty map; only contains entries
//                                  whose XML name differs from formatEnum)
//   .bake/game-option-names.json — { GAMEOPTION_*: "Display Name" } (optional;
//                                  missing → empty map; only contains entries
//                                  whose XML name differs from formatEnum)
//   .bake/victory-ordering.json — [ VICTORY_* ] in global info-list order
//                                  (optional; missing → empty array)
//
// OUTPUTS (committed; consumed at runtime):
//   src/lib/generated/atlas-manifest.ts   — ATLAS_MANIFEST + NATION_ALIASES_URL
//   src/lib/generated/sprite-manifest.ts  — SPRITE_MANIFEST
//   src/lib/generated/tech-names.ts       — TECH_NAMES
//   src/lib/generated/improvement-names.ts — IMPROVEMENT_NAMES
//   src/lib/generated/game-option-names.ts — GAME_OPTION_NAMES
//   src/lib/generated/goal-names.ts       — GOAL_NAMES
//   src/lib/generated/victory-ordering.ts — VICTORY_ORDERING
//   src/lib/generated/law-classes.ts +    — LAW_CLASSES + LAW_TO_CLASS, emitted
//   cloud/src/generated/law-classes.ts      identically to both (frontend + Worker)
//
// RECONCILIATION: deletes any file under static/atlases/, static/sprites/**,
// or assets/atlas-sources/ that isn't referenced by either sidecar. Each
// individual bake also wipes its own slice (per-name regex), but reconcile
// catches cross-cutting orphans — renamed atlases whose old name no longer
// has an owner, partial-bake leftovers, etc.
//
// Run: npm run bake:finalize  (also invoked at the end of npm run bake:all)

import {
	mkdir,
	readdir,
	readFile,
	stat,
	unlink,
	writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

import { format as prettierFormat, resolveConfig } from "prettier";

import {
	readAtlasSidecar,
	readSpriteSidecar,
	type AtlasManifestEntry,
	type AtlasSidecar,
	type SpriteSidecar,
} from "./lib/atlas-bake.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

const STATIC_ATLASES = resolve(REPO_ROOT, "static/atlases");
const STATIC_SPRITES = resolve(REPO_ROOT, "static/sprites");
const ATLAS_SOURCES = resolve(REPO_ROOT, "assets/atlas-sources");
const ATLAS_MANIFEST_TS = resolve(
	REPO_ROOT,
	"src/lib/generated/atlas-manifest.ts",
);
const SPRITE_MANIFEST_TS = resolve(
	REPO_ROOT,
	"src/lib/generated/sprite-manifest.ts",
);
const TECH_NAMES_TS = resolve(REPO_ROOT, "src/lib/generated/tech-names.ts");
const TECH_NAMES_SIDECAR = resolve(REPO_ROOT, ".bake/tech-names.json");
const IMPROVEMENT_NAMES_TS = resolve(
	REPO_ROOT,
	"src/lib/generated/improvement-names.ts",
);
const IMPROVEMENT_NAMES_SIDECAR = resolve(
	REPO_ROOT,
	".bake/improvement-names.json",
);
const DIFFICULTY_NAMES_TS = resolve(
	REPO_ROOT,
	"src/lib/generated/difficulty-names.ts",
);
const DIFFICULTY_NAMES_SIDECAR = resolve(
	REPO_ROOT,
	".bake/difficulty-names.json",
);
const GAME_OPTION_NAMES_TS = resolve(
	REPO_ROOT,
	"src/lib/generated/game-option-names.ts",
);
const GAME_OPTION_NAMES_SIDECAR = resolve(
	REPO_ROOT,
	".bake/game-option-names.json",
);
const GOAL_NAMES_TS = resolve(REPO_ROOT, "src/lib/generated/goal-names.ts");
const GOAL_NAMES_SIDECAR = resolve(REPO_ROOT, ".bake/goal-names.json");
const MAP_OPTION_DEFS_TS = resolve(
	REPO_ROOT,
	"src/lib/generated/map-option-defs.ts",
);
const MAP_SCRIPT_OPTIONS_TS = resolve(
	REPO_ROOT,
	"src/lib/generated/map-script-options.ts",
);
const MAP_OPTIONS_SIDECAR = resolve(REPO_ROOT, ".bake/map-options.json");
const VICTORY_ORDERING_TS = resolve(
	REPO_ROOT,
	"src/lib/generated/victory-ordering.ts",
);
const VICTORY_ORDERING_SIDECAR = resolve(
	REPO_ROOT,
	".bake/victory-ordering.json",
);
// Law→class map is emitted to two locations: the frontend ($lib/generated) and
// the Worker (cloud/src/generated, picked up by cloud/tsconfig's src/** include).
// Both are generated from the one sidecar — no hand-mirroring.
const LAW_CLASSES_TS = resolve(REPO_ROOT, "src/lib/generated/law-classes.ts");
const LAW_CLASSES_CLOUD_TS = resolve(
	REPO_ROOT,
	"cloud/src/generated/law-classes.ts",
);
const LAW_CLASSES_SIDECAR = resolve(REPO_ROOT, ".bake/law-classes.json");
// Specialist lookups for the Specialists tab (frontend only).
const SPECIALISTS_TS = resolve(REPO_ROOT, "src/lib/generated/specialists.ts");
const SPECIALISTS_SIDECAR = resolve(REPO_ROOT, ".bake/specialists.json");

// The sole atlas-sidecar entry that has only `json` and no `webp`. Routed to
// its own constant export so ATLAS_MANIFEST stays uniformly typed
// `Record<string, { webp; json }>`.
const ALIAS_ENTRY_KEY = "nation-asset-aliases";

// ─── Existence assertion ────────────────────────────────────────────

interface ExpectedFile {
	url: string;
	dirs: readonly string[]; // absolute on-disk dirs that must contain the file
}

function urlToFilename(url: string): string {
	// e.g. "/atlases/terrain-3d.a1b2c3d4.webp" → "terrain-3d.a1b2c3d4.webp"
	const last = url.lastIndexOf("/");
	return last < 0 ? url : url.slice(last + 1);
}

function spriteCategoryFromUrl(url: string): string {
	// e.g. "/sprites/crests/CREST_NATION_EGYPT.q1w2e3r4.png" → "crests"
	const m = url.match(/^\/sprites\/([^/]+)\//);
	if (!m) throw new Error(`malformed sprite URL: ${url}`);
	return m[1];
}

function expectedFilesForAtlas(sidecar: AtlasSidecar): ExpectedFile[] {
	const expected: ExpectedFile[] = [];
	for (const entry of Object.values(sidecar)) {
		if (entry.webp) {
			expected.push({
				url: entry.webp,
				dirs: [STATIC_ATLASES, ATLAS_SOURCES],
			});
		}
		expected.push({
			url: entry.json,
			dirs: [STATIC_ATLASES, ATLAS_SOURCES],
		});
	}
	return expected;
}

function expectedFilesForSprites(sidecar: SpriteSidecar): ExpectedFile[] {
	return Object.values(sidecar).map((url) => {
		const category = spriteCategoryFromUrl(url);
		return {
			url,
			dirs: [resolve(STATIC_SPRITES, category)],
		};
	});
}

function assertReferencedFilesExist(
	atlasSidecar: AtlasSidecar,
	spriteSidecar: SpriteSidecar,
): void {
	const missing: string[] = [];
	for (const ef of [
		...expectedFilesForAtlas(atlasSidecar),
		...expectedFilesForSprites(spriteSidecar),
	]) {
		const filename = urlToFilename(ef.url);
		for (const dir of ef.dirs) {
			const full = resolve(dir, filename);
			if (!existsSync(full)) missing.push(full);
		}
	}
	if (missing.length > 0) {
		throw new Error(
			`build-manifests: ${missing.length} referenced file(s) missing on disk:\n` +
				missing.map((m) => `  ${m}`).join("\n") +
				`\n\nRe-run the relevant bake step (e.g. npm run bake:all).`,
		);
	}
}

// ─── Reconcile (delete orphans) ─────────────────────────────────────

function expectedFilenamesByDir(
	atlasSidecar: AtlasSidecar,
	spriteSidecar: SpriteSidecar,
): Map<string, Set<string>> {
	const byDir = new Map<string, Set<string>>();
	const add = (dir: string, filename: string) => {
		let set = byDir.get(dir);
		if (!set) {
			set = new Set();
			byDir.set(dir, set);
		}
		set.add(filename);
	};

	for (const ef of expectedFilesForAtlas(atlasSidecar)) {
		const filename = urlToFilename(ef.url);
		for (const dir of ef.dirs) add(dir, filename);
	}
	for (const ef of expectedFilesForSprites(spriteSidecar)) {
		const filename = urlToFilename(ef.url);
		for (const dir of ef.dirs) add(dir, filename);
	}
	return byDir;
}

async function listFilesInDir(dir: string): Promise<string[]> {
	try {
		const entries = await readdir(dir);
		const files: string[] = [];
		for (const entry of entries) {
			const full = resolve(dir, entry);
			const s = await stat(full);
			if (s.isFile()) files.push(entry);
		}
		return files;
	} catch {
		return [];
	}
}

async function reconcileDir(
	dir: string,
	expected: Set<string>,
	preserve: ReadonlySet<string> = new Set(),
): Promise<number> {
	const files = await listFilesInDir(dir);
	const orphans = files.filter((f) => !expected.has(f) && !preserve.has(f));
	for (const orphan of orphans) {
		await unlink(resolve(dir, orphan));
	}
	return orphans.length;
}

async function reconcile(
	atlasSidecar: AtlasSidecar,
	spriteSidecar: SpriteSidecar,
): Promise<void> {
	const byDir = expectedFilenamesByDir(atlasSidecar, spriteSidecar);
	let total = 0;

	// Atlas dirs
	for (const dir of [STATIC_ATLASES, ATLAS_SOURCES]) {
		const expected = byDir.get(dir) ?? new Set<string>();
		total += await reconcileDir(dir, expected);
	}

	// Sprite categories — discovered from sidecar URLs so we don't reach into
	// directories the bake doesn't own.
	const spriteCategories = new Set<string>();
	for (const url of Object.values(spriteSidecar)) {
		spriteCategories.add(spriteCategoryFromUrl(url));
	}
	for (const cat of spriteCategories) {
		const dir = resolve(STATIC_SPRITES, cat);
		const expected = byDir.get(dir) ?? new Set<string>();
		total += await reconcileDir(dir, expected);
	}

	// Top-level static/sprites/ holds .bake-info.json (metadata, not a sprite).
	// Don't reconcile that level — it's not the bake's concern.

	if (total > 0) {
		console.log(`[reconcile] removed ${total} orphan file(s)`);
	}
}

// ─── TS module emission ─────────────────────────────────────────────

function sortedKeys<T>(obj: Record<string, T>): string[] {
	return Object.keys(obj).sort();
}

function emitAtlasManifestTs(sidecar: AtlasSidecar): string {
	const aliasEntry = sidecar[ALIAS_ENTRY_KEY];
	if (!aliasEntry) {
		throw new Error(
			`build-manifests: atlas sidecar is missing required entry "${ALIAS_ENTRY_KEY}". ` +
				`Did npm run bake:improvements run successfully?`,
		);
	}

	const atlasEntries: Array<[string, AtlasManifestEntry]> = [];
	for (const key of sortedKeys(sidecar)) {
		if (key === ALIAS_ENTRY_KEY) continue;
		const entry = sidecar[key];
		if (!entry.webp) {
			throw new Error(
				`build-manifests: atlas sidecar entry "${key}" has no webp URL. ` +
					`Only "${ALIAS_ENTRY_KEY}" is permitted to be json-only.`,
			);
		}
		atlasEntries.push([key, entry]);
	}

	const lines: string[] = [];
	lines.push("// AUTO-GENERATED by scripts/build-manifests.ts. Do not edit.");
	lines.push("// Run `npm run bake:finalize` to refresh.");
	lines.push("");
	lines.push("export const ATLAS_MANIFEST: Readonly<");
	lines.push(
		"\tRecord<string, { readonly webp: string; readonly json: string }>",
	);
	lines.push("> = {");
	for (const [key, entry] of atlasEntries) {
		lines.push(`\t${JSON.stringify(key)}: {`);
		lines.push(`\t\twebp: ${JSON.stringify(entry.webp)},`);
		lines.push(`\t\tjson: ${JSON.stringify(entry.json)},`);
		lines.push("\t},");
	}
	lines.push("};");
	lines.push("");
	lines.push(
		`export const NATION_ALIASES_URL: string = ${JSON.stringify(aliasEntry.json)};`,
	);
	lines.push("");
	return lines.join("\n");
}

async function readTechNamesSidecar(): Promise<Record<string, string>> {
	if (!existsSync(TECH_NAMES_SIDECAR)) return {};
	const raw = await readFile(TECH_NAMES_SIDECAR, "utf-8");
	return JSON.parse(raw) as Record<string, string>;
}

async function readImprovementNamesSidecar(): Promise<Record<string, string>> {
	if (!existsSync(IMPROVEMENT_NAMES_SIDECAR)) return {};
	const raw = await readFile(IMPROVEMENT_NAMES_SIDECAR, "utf-8");
	return JSON.parse(raw) as Record<string, string>;
}

async function readDifficultyNamesSidecar(): Promise<Record<string, string>> {
	if (!existsSync(DIFFICULTY_NAMES_SIDECAR)) return {};
	const raw = await readFile(DIFFICULTY_NAMES_SIDECAR, "utf-8");
	return JSON.parse(raw) as Record<string, string>;
}

async function readGameOptionNamesSidecar(): Promise<Record<string, string>> {
	if (!existsSync(GAME_OPTION_NAMES_SIDECAR)) return {};
	const raw = await readFile(GAME_OPTION_NAMES_SIDECAR, "utf-8");
	return JSON.parse(raw) as Record<string, string>;
}

async function readGoalNamesSidecar(): Promise<Record<string, string>> {
	if (!existsSync(GOAL_NAMES_SIDECAR)) return {};
	const raw = await readFile(GOAL_NAMES_SIDECAR, "utf-8");
	return JSON.parse(raw) as Record<string, string>;
}

interface MapOptionsSidecar {
	options: Record<
		string,
		| {
				kind: "select";
				label: string;
				choices: { value: string; label: string }[];
				default: string;
		  }
		| { kind: "toggle"; label: string; default: false }
	>;
	scriptOptions: Record<string, string[]>;
}

async function readVictoryOrderingSidecar(): Promise<string[]> {
	if (!existsSync(VICTORY_ORDERING_SIDECAR)) return [];
	const raw = await readFile(VICTORY_ORDERING_SIDECAR, "utf-8");
	return JSON.parse(raw) as string[];
}

async function readMapOptionsSidecar(): Promise<MapOptionsSidecar> {
	if (!existsSync(MAP_OPTIONS_SIDECAR)) {
		return { options: {}, scriptOptions: {} };
	}
	const raw = await readFile(MAP_OPTIONS_SIDECAR, "utf-8");
	return JSON.parse(raw) as MapOptionsSidecar;
}

interface LawClassInfo {
	laws: string[];
	succession: boolean;
	techPrereq: string | null;
	startingLaw: string | null;
}
interface LawClassesSidecar {
	classes: Record<string, LawClassInfo>;
}

async function readLawClassesSidecar(): Promise<LawClassesSidecar> {
	if (!existsSync(LAW_CLASSES_SIDECAR)) return { classes: {} };
	const raw = await readFile(LAW_CLASSES_SIDECAR, "utf-8");
	return JSON.parse(raw) as LawClassesSidecar;
}

interface SpecialistInfo {
	class: string;
	kind: "urban" | "rural";
	level: number | null;
	name: string;
}
interface SpecialistClassInfo {
	name: string;
	kind: "urban" | "rural";
}
interface EligibleImprovement {
	urban: boolean;
}
interface SpecialistsSidecar {
	specialists: Record<string, SpecialistInfo>;
	classes: Record<string, SpecialistClassInfo>;
	eligibleImprovements: Record<string, EligibleImprovement>;
}

async function readSpecialistsSidecar(): Promise<SpecialistsSidecar> {
	if (!existsSync(SPECIALISTS_SIDECAR)) {
		return { specialists: {}, classes: {}, eligibleImprovements: {} };
	}
	const raw = await readFile(SPECIALISTS_SIDECAR, "utf-8");
	return JSON.parse(raw) as SpecialistsSidecar;
}

function emitTechNamesTs(sidecar: Record<string, string>): string {
	const lines: string[] = [];
	lines.push("// AUTO-GENERATED by scripts/build-manifests.ts. Do not edit.");
	lines.push("// Run `npm run bake:finalize` to refresh.");
	lines.push("");
	lines.push("export const TECH_NAMES: Readonly<Record<string, string>> = {");
	for (const key of sortedKeys(sidecar)) {
		lines.push(`\t${JSON.stringify(key)}: ${JSON.stringify(sidecar[key])},`);
	}
	lines.push("};");
	lines.push("");
	return lines.join("\n");
}

function emitImprovementNamesTs(sidecar: Record<string, string>): string {
	const lines: string[] = [];
	lines.push("// AUTO-GENERATED by scripts/build-manifests.ts. Do not edit.");
	lines.push("// Run `npm run bake:finalize` to refresh.");
	lines.push("");
	lines.push(
		"export const IMPROVEMENT_NAMES: Readonly<Record<string, string>> = {",
	);
	for (const key of sortedKeys(sidecar)) {
		lines.push(`\t${JSON.stringify(key)}: ${JSON.stringify(sidecar[key])},`);
	}
	lines.push("};");
	lines.push("");
	return lines.join("\n");
}

function emitDifficultyNamesTs(sidecar: Record<string, string>): string {
	const lines: string[] = [];
	lines.push("// AUTO-GENERATED by scripts/build-manifests.ts. Do not edit.");
	lines.push("// Run `npm run bake:finalize` to refresh.");
	lines.push("");
	lines.push(
		"export const DIFFICULTY_NAMES: Readonly<Record<string, string>> = {",
	);
	for (const key of sortedKeys(sidecar)) {
		lines.push(`\t${JSON.stringify(key)}: ${JSON.stringify(sidecar[key])},`);
	}
	lines.push("};");
	lines.push("");
	return lines.join("\n");
}

function emitGameOptionNamesTs(sidecar: Record<string, string>): string {
	const lines: string[] = [];
	lines.push("// AUTO-GENERATED by scripts/build-manifests.ts. Do not edit.");
	lines.push("// Run `npm run bake:finalize` to refresh.");
	lines.push("");
	lines.push(
		"export const GAME_OPTION_NAMES: Readonly<Record<string, string>> = {",
	);
	for (const key of sortedKeys(sidecar)) {
		lines.push(`\t${JSON.stringify(key)}: ${JSON.stringify(sidecar[key])},`);
	}
	lines.push("};");
	lines.push("");
	return lines.join("\n");
}

function emitGoalNamesTs(sidecar: Record<string, string>): string {
	const lines: string[] = [];
	lines.push("// AUTO-GENERATED by scripts/build-manifests.ts. Do not edit.");
	lines.push("// Run `npm run bake:finalize` to refresh.");
	lines.push("");
	lines.push("export const GOAL_NAMES: Readonly<Record<string, string>> = {");
	for (const key of sortedKeys(sidecar)) {
		lines.push(`\t${JSON.stringify(key)}: ${JSON.stringify(sidecar[key])},`);
	}
	lines.push("};");
	lines.push("");
	return lines.join("\n");
}

function emitVictoryOrderingTs(ordering: string[]): string {
	const lines: string[] = [];
	lines.push("// AUTO-GENERATED by scripts/build-manifests.ts. Do not edit.");
	lines.push("// Run `npm run bake:finalize` to refresh.");
	lines.push("");
	lines.push(
		"// Global victory info-list ordering from Reference victory.xml.",
	);
	lines.push(
		"// Index space for the legacy <WinnerVictory> save field — order",
	);
	lines.push("// is significant, do NOT sort.");
	lines.push("export const VICTORY_ORDERING: readonly string[] = [");
	for (const zType of ordering) {
		lines.push(`\t${JSON.stringify(zType)},`);
	}
	lines.push("];");
	lines.push("");
	return lines.join("\n");
}

function emitMapOptionDefsTs(sidecar: MapOptionsSidecar): string {
	const lines: string[] = [];
	lines.push("// AUTO-GENERATED by scripts/build-manifests.ts. Do not edit.");
	lines.push("// Run `npm run bake:finalize` to refresh.");
	lines.push("");
	lines.push("export type MapOptionDef =");
	lines.push("\t| {");
	lines.push('\t\t\treadonly kind: "select";');
	lines.push("\t\t\treadonly label: string;");
	lines.push(
		"\t\t\treadonly choices: readonly { readonly value: string; readonly label: string }[];",
	);
	lines.push("\t\t\treadonly default: string;");
	lines.push("\t  }");
	lines.push(
		'\t| { readonly kind: "toggle"; readonly label: string; readonly default: false };',
	);
	lines.push("");
	lines.push(
		"export const MAP_OPTION_DEFS: Readonly<Record<string, MapOptionDef>> = {",
	);
	for (const key of sortedKeys(sidecar.options)) {
		const def = sidecar.options[key];
		lines.push(`\t${JSON.stringify(key)}: ${JSON.stringify(def)},`);
	}
	lines.push("};");
	lines.push("");
	return lines.join("\n");
}

function emitMapScriptOptionsTs(sidecar: MapOptionsSidecar): string {
	const lines: string[] = [];
	lines.push("// AUTO-GENERATED by scripts/build-manifests.ts. Do not edit.");
	lines.push("// Run `npm run bake:finalize` to refresh.");
	lines.push("");
	lines.push(
		"export const MAP_SCRIPT_OPTIONS: Readonly<Record<string, readonly string[]>> = {",
	);
	for (const key of sortedKeys(sidecar.scriptOptions)) {
		const arr = sidecar.scriptOptions[key];
		lines.push(`\t${JSON.stringify(key)}: ${JSON.stringify(arr)},`);
	}
	lines.push("};");
	lines.push("");
	return lines.join("\n");
}

function emitLawClassesTs(sidecar: LawClassesSidecar): string {
	const classes = sidecar.classes;
	const lines: string[] = [];
	lines.push("// AUTO-GENERATED by scripts/build-manifests.ts. Do not edit.");
	lines.push("// Run `npm run bake:finalize` to refresh.");
	lines.push("");
	lines.push("export interface LawClassInfo {");
	lines.push("\treadonly laws: readonly string[];");
	lines.push("\treadonly succession: boolean;");
	lines.push("\treadonly techPrereq: string | null;");
	lines.push("\treadonly startingLaw: string | null;");
	lines.push("}");
	lines.push("");
	lines.push(
		"export const LAW_CLASSES: Readonly<Record<string, LawClassInfo>> = {",
	);
	for (const key of sortedKeys(classes)) {
		lines.push(`\t${JSON.stringify(key)}: ${JSON.stringify(classes[key])},`);
	}
	lines.push("};");
	lines.push("");
	// Flat law→class lookup, derived from LAW_CLASSES, keys sorted.
	const lawToClass: Record<string, string> = {};
	for (const key of sortedKeys(classes)) {
		for (const law of classes[key].laws) lawToClass[law] = key;
	}
	lines.push("export const LAW_TO_CLASS: Readonly<Record<string, string>> = {");
	for (const law of sortedKeys(lawToClass)) {
		lines.push(`\t${JSON.stringify(law)}: ${JSON.stringify(lawToClass[law])},`);
	}
	lines.push("};");
	lines.push("");
	return lines.join("\n");
}

function emitSpecialistsTs(sidecar: SpecialistsSidecar): string {
	const lines: string[] = [];
	lines.push("// AUTO-GENERATED by scripts/build-manifests.ts. Do not edit.");
	lines.push("// Run `npm run bake:finalize` to refresh.");
	lines.push("");
	lines.push("export interface SpecialistInfo {");
	lines.push("\treadonly class: string;");
	lines.push('\treadonly kind: "urban" | "rural";');
	lines.push("\treadonly level: number | null;");
	lines.push("\treadonly name: string;");
	lines.push("}");
	lines.push("");
	lines.push("export interface SpecialistClassInfo {");
	lines.push("\treadonly name: string;");
	lines.push('\treadonly kind: "urban" | "rural";');
	lines.push("}");
	lines.push("");
	lines.push("export interface EligibleImprovement {");
	lines.push("\treadonly urban: boolean;");
	lines.push("}");
	lines.push("");
	lines.push(
		"// Each placed specialist (SPECIALIST_* zType) → its class, urban/rural kind,",
	);
	lines.push(
		"// tier (1–3 for urban, null for rural) and level-distinct name.",
	);
	lines.push(
		"export const SPECIALISTS: Readonly<Record<string, SpecialistInfo>> = {",
	);
	for (const key of sortedKeys(sidecar.specialists)) {
		lines.push(
			`\t${JSON.stringify(key)}: ${JSON.stringify(sidecar.specialists[key])},`,
		);
	}
	lines.push("};");
	lines.push("");
	lines.push(
		"// Specialist class (SPECIALISTCLASS_* zType) → its line name + kind.",
	);
	lines.push(
		"export const SPECIALIST_CLASSES: Readonly<Record<string, SpecialistClassInfo>> = {",
	);
	for (const key of sortedKeys(sidecar.classes)) {
		lines.push(
			`\t${JSON.stringify(key)}: ${JSON.stringify(sidecar.classes[key])},`,
		);
	}
	lines.push("};");
	lines.push("");
	lines.push(
		"// Improvements that can hold a specialist (IMPROVEMENT_* zType) → urban flag.",
	);
	lines.push("// Presence in this map is the coverage denominator.");
	lines.push(
		"export const ELIGIBLE_IMPROVEMENTS: Readonly<Record<string, EligibleImprovement>> = {",
	);
	for (const key of sortedKeys(sidecar.eligibleImprovements)) {
		lines.push(
			`\t${JSON.stringify(key)}: ${JSON.stringify(sidecar.eligibleImprovements[key])},`,
		);
	}
	lines.push("};");
	lines.push("");
	return lines.join("\n");
}

function emitSpriteManifestTs(sidecar: SpriteSidecar): string {
	const lines: string[] = [];
	lines.push("// AUTO-GENERATED by scripts/build-manifests.ts. Do not edit.");
	lines.push("// Run `npm run bake:finalize` to refresh.");
	lines.push("");
	lines.push(
		"export const SPRITE_MANIFEST: Readonly<Record<string, string>> = {",
	);
	for (const key of sortedKeys(sidecar)) {
		lines.push(`\t${JSON.stringify(key)}: ${JSON.stringify(sidecar[key])},`);
	}
	lines.push("};");
	lines.push("");
	return lines.join("\n");
}

async function formatTs(path: string, content: string): Promise<string> {
	const config = await resolveConfig(path);
	return prettierFormat(content, {
		...config,
		parser: "typescript",
		filepath: path,
	});
}

async function writeIfChanged(path: string, content: string): Promise<boolean> {
	await mkdir(dirname(path), { recursive: true });
	if (existsSync(path)) {
		const existing = await readFile(path, "utf-8");
		if (existing === content) return false;
	}
	await writeFile(path, content);
	return true;
}

// ─── Main ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
	const atlasSidecar = await readAtlasSidecar();
	const spriteSidecar = await readSpriteSidecar();
	const techNamesSidecar = await readTechNamesSidecar();
	const improvementNamesSidecar = await readImprovementNamesSidecar();
	const difficultyNamesSidecar = await readDifficultyNamesSidecar();
	const gameOptionNamesSidecar = await readGameOptionNamesSidecar();
	const goalNamesSidecar = await readGoalNamesSidecar();
	const victoryOrderingSidecar = await readVictoryOrderingSidecar();
	const mapOptionsSidecar = await readMapOptionsSidecar();
	const lawClassesSidecar = await readLawClassesSidecar();
	const specialistsSidecar = await readSpecialistsSidecar();

	if (Object.keys(atlasSidecar).length === 0) {
		throw new Error(
			"build-manifests: atlas sidecar is empty. Run npm run bake:terrain-3d, " +
				"bake:improvements, and bake:resources first.",
		);
	}
	if (Object.keys(spriteSidecar).length === 0) {
		throw new Error(
			"build-manifests: sprite sidecar is empty. Run npm run bake:sprites first.",
		);
	}

	assertReferencedFilesExist(atlasSidecar, spriteSidecar);
	await reconcile(atlasSidecar, spriteSidecar);

	const atlasTs = await formatTs(
		ATLAS_MANIFEST_TS,
		emitAtlasManifestTs(atlasSidecar),
	);
	const spriteTs = await formatTs(
		SPRITE_MANIFEST_TS,
		emitSpriteManifestTs(spriteSidecar),
	);
	const techNamesTs = await formatTs(
		TECH_NAMES_TS,
		emitTechNamesTs(techNamesSidecar),
	);
	const improvementNamesTs = await formatTs(
		IMPROVEMENT_NAMES_TS,
		emitImprovementNamesTs(improvementNamesSidecar),
	);
	const difficultyNamesTs = await formatTs(
		DIFFICULTY_NAMES_TS,
		emitDifficultyNamesTs(difficultyNamesSidecar),
	);
	const gameOptionNamesTs = await formatTs(
		GAME_OPTION_NAMES_TS,
		emitGameOptionNamesTs(gameOptionNamesSidecar),
	);
	const goalNamesTs = await formatTs(
		GOAL_NAMES_TS,
		emitGoalNamesTs(goalNamesSidecar),
	);
	const victoryOrderingTs = await formatTs(
		VICTORY_ORDERING_TS,
		emitVictoryOrderingTs(victoryOrderingSidecar),
	);
	const mapOptionDefsTs = await formatTs(
		MAP_OPTION_DEFS_TS,
		emitMapOptionDefsTs(mapOptionsSidecar),
	);
	const mapScriptOptionsTs = await formatTs(
		MAP_SCRIPT_OPTIONS_TS,
		emitMapScriptOptionsTs(mapOptionsSidecar),
	);
	// One generated module, two destinations (frontend + Worker). Format once
	// against the frontend path; both files are byte-identical.
	const lawClassesTs = await formatTs(
		LAW_CLASSES_TS,
		emitLawClassesTs(lawClassesSidecar),
	);
	const specialistsTs = await formatTs(
		SPECIALISTS_TS,
		emitSpecialistsTs(specialistsSidecar),
	);
	const atlasChanged = await writeIfChanged(ATLAS_MANIFEST_TS, atlasTs);
	const spriteChanged = await writeIfChanged(SPRITE_MANIFEST_TS, spriteTs);
	const techNamesChanged = await writeIfChanged(TECH_NAMES_TS, techNamesTs);
	const improvementNamesChanged = await writeIfChanged(
		IMPROVEMENT_NAMES_TS,
		improvementNamesTs,
	);
	const difficultyNamesChanged = await writeIfChanged(
		DIFFICULTY_NAMES_TS,
		difficultyNamesTs,
	);
	const gameOptionNamesChanged = await writeIfChanged(
		GAME_OPTION_NAMES_TS,
		gameOptionNamesTs,
	);
	const goalNamesChanged = await writeIfChanged(GOAL_NAMES_TS, goalNamesTs);
	const victoryOrderingChanged = await writeIfChanged(
		VICTORY_ORDERING_TS,
		victoryOrderingTs,
	);
	const mapOptionDefsChanged = await writeIfChanged(
		MAP_OPTION_DEFS_TS,
		mapOptionDefsTs,
	);
	const mapScriptOptionsChanged = await writeIfChanged(
		MAP_SCRIPT_OPTIONS_TS,
		mapScriptOptionsTs,
	);
	const lawClassesChanged = await writeIfChanged(LAW_CLASSES_TS, lawClassesTs);
	const lawClassesCloudChanged = await writeIfChanged(
		LAW_CLASSES_CLOUD_TS,
		lawClassesTs,
	);
	const specialistsChanged = await writeIfChanged(
		SPECIALISTS_TS,
		specialistsTs,
	);

	const atlasCount = Object.keys(atlasSidecar).length;
	const spriteCount = Object.keys(spriteSidecar).length;
	const techNamesCount = Object.keys(techNamesSidecar).length;
	const improvementNamesCount = Object.keys(improvementNamesSidecar).length;
	const difficultyNamesCount = Object.keys(difficultyNamesSidecar).length;
	const gameOptionNamesCount = Object.keys(gameOptionNamesSidecar).length;
	const goalNamesCount = Object.keys(goalNamesSidecar).length;
	const mapOptionDefsCount = Object.keys(mapOptionsSidecar.options).length;
	const mapScriptOptionsCount = Object.keys(
		mapOptionsSidecar.scriptOptions,
	).length;
	console.log(
		`[manifests] atlas-manifest.ts: ${atlasCount} entries${atlasChanged ? "" : " (unchanged)"}`,
	);
	console.log(
		`[manifests] sprite-manifest.ts: ${spriteCount} entries${spriteChanged ? "" : " (unchanged)"}`,
	);
	console.log(
		`[manifests] tech-names.ts: ${techNamesCount} entries${techNamesChanged ? "" : " (unchanged)"}`,
	);
	console.log(
		`[manifests] improvement-names.ts: ${improvementNamesCount} entries${improvementNamesChanged ? "" : " (unchanged)"}`,
	);
	console.log(
		`[manifests] difficulty-names.ts: ${difficultyNamesCount} entries${difficultyNamesChanged ? "" : " (unchanged)"}`,
	);
	console.log(
		`[manifests] game-option-names.ts: ${gameOptionNamesCount} entries${gameOptionNamesChanged ? "" : " (unchanged)"}`,
	);
	console.log(
		`[manifests] goal-names.ts: ${goalNamesCount} entries${goalNamesChanged ? "" : " (unchanged)"}`,
	);
	console.log(
		`[manifests] victory-ordering.ts: ${victoryOrderingSidecar.length} entries${victoryOrderingChanged ? "" : " (unchanged)"}`,
	);
	console.log(
		`[manifests] map-option-defs.ts: ${mapOptionDefsCount} entries${mapOptionDefsChanged ? "" : " (unchanged)"}`,
	);
	console.log(
		`[manifests] map-script-options.ts: ${mapScriptOptionsCount} entries${mapScriptOptionsChanged ? "" : " (unchanged)"}`,
	);
	const lawClassesCount = Object.keys(lawClassesSidecar.classes).length;
	console.log(
		`[manifests] law-classes.ts (src + cloud): ${lawClassesCount} classes${lawClassesChanged || lawClassesCloudChanged ? "" : " (unchanged)"}`,
	);
	const specialistsCount = Object.keys(specialistsSidecar.specialists).length;
	console.log(
		`[manifests] specialists.ts: ${specialistsCount} specialists${specialistsChanged ? "" : " (unchanged)"}`,
	);
}

await main();
