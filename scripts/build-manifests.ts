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
//
// OUTPUTS (committed; consumed at runtime):
//   src/lib/generated/atlas-manifest.ts   — ATLAS_MANIFEST + NATION_ALIASES_URL
//   src/lib/generated/sprite-manifest.ts  — SPRITE_MANIFEST
//   src/lib/generated/tech-names.ts       — TECH_NAMES
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
const MAP_OPTION_DEFS_TS = resolve(
	REPO_ROOT,
	"src/lib/generated/map-option-defs.ts",
);
const MAP_SCRIPT_OPTIONS_TS = resolve(
	REPO_ROOT,
	"src/lib/generated/map-script-options.ts",
);
const MAP_OPTIONS_SIDECAR = resolve(REPO_ROOT, ".bake/map-options.json");

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

async function readMapOptionsSidecar(): Promise<MapOptionsSidecar> {
	if (!existsSync(MAP_OPTIONS_SIDECAR)) {
		return { options: {}, scriptOptions: {} };
	}
	const raw = await readFile(MAP_OPTIONS_SIDECAR, "utf-8");
	return JSON.parse(raw) as MapOptionsSidecar;
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
	const mapOptionsSidecar = await readMapOptionsSidecar();

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
	const mapOptionDefsTs = await formatTs(
		MAP_OPTION_DEFS_TS,
		emitMapOptionDefsTs(mapOptionsSidecar),
	);
	const mapScriptOptionsTs = await formatTs(
		MAP_SCRIPT_OPTIONS_TS,
		emitMapScriptOptionsTs(mapOptionsSidecar),
	);
	const atlasChanged = await writeIfChanged(ATLAS_MANIFEST_TS, atlasTs);
	const spriteChanged = await writeIfChanged(SPRITE_MANIFEST_TS, spriteTs);
	const techNamesChanged = await writeIfChanged(TECH_NAMES_TS, techNamesTs);
	const mapOptionDefsChanged = await writeIfChanged(
		MAP_OPTION_DEFS_TS,
		mapOptionDefsTs,
	);
	const mapScriptOptionsChanged = await writeIfChanged(
		MAP_SCRIPT_OPTIONS_TS,
		mapScriptOptionsTs,
	);

	const atlasCount = Object.keys(atlasSidecar).length;
	const spriteCount = Object.keys(spriteSidecar).length;
	const techNamesCount = Object.keys(techNamesSidecar).length;
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
		`[manifests] map-option-defs.ts: ${mapOptionDefsCount} entries${mapOptionDefsChanged ? "" : " (unchanged)"}`,
	);
	console.log(
		`[manifests] map-script-options.ts: ${mapScriptOptionsCount} entries${mapScriptOptionsChanged ? "" : " (unchanged)"}`,
	);
}

await main();
