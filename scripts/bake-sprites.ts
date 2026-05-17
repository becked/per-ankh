// Bake the loose 2D sprite PNGs that the runtime serves directly from
// /sprites/<category>/<name>.<hash>.png. These don't get packed into atlases
// — they ship as individual files under static/sprites/, content-hashed by
// their own bytes for safe long-cache HTTP serving.
//
// SOURCES (all under <pinacotheca>/extracted/sprites/):
//   crests/, techs/, laws/, religions/, yields/  → 1:1 copy by category dir
//   units/                                       → UNIT_*.png minus UNIT_3D_*
//   improvements/IMPROVEMENT_FINISHED.png        → icons/IMPROVEMENT_FINISHED.png
//   other/Cycle_Military_Normal.png              → icons/MILITARY.png
//   other/VICTORY_Normal.png                     → icons/VICTORY_NORMAL.png
//   other/MAP_OVERVIEW_Normal.png                → icons/MAP_OVERVIEW.png
//   other/Cycle_Normal_EndTurn.png               → icons/TURN.png
//
// OUTPUT:
//   static/sprites/<category>/<basename>.<hash>.png
//   static/sprites/.bake-info.json   (pinacotheca version + bakedAt stamp)
//   .bake/sprite-manifest.json       (registered for build-manifests.ts)
//
// Each target category dir is wiped and repopulated per run, so this is
// idempotent — running it twice produces identical bytes (and identical
// hashes, so the generated TS module is byte-stable).
//
// Run: npm run bake:sprites

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

import {
	readPinacothecaVersion,
	writeSpriteSidecar,
	type SpriteSidecar,
} from "./lib/atlas-bake.js";
import { resolvePinacotheca } from "./lib/paths.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const PINACOTHECA_ROOT = resolvePinacotheca();
const PINACOTHECA_SPRITES = resolve(PINACOTHECA_ROOT, "extracted/sprites");
const PINACOTHECA_PYPROJECT = resolve(PINACOTHECA_ROOT, "pyproject.toml");
const SPRITES_OUT = resolve(REPO_ROOT, "static/sprites");

// Categories that mirror Pinacotheca's extracted/sprites/<dir>/ 1:1.
const MIRROR_CATEGORIES = [
	"crests",
	"techs",
	"laws",
	"religions",
	"yields",
] as const;

// Pinacotheca's units/ holds both 2D icons (UNIT_*.png) and 3D renders
// (UNIT_3D_*.png). The runtime tech-fallback path requests UNIT_<NAME>.png
// (the 2D set) — the 3D variants are unused.
const UNITS_CATEGORY = "units";

// Three icons sourced from disparate Pinacotheca subdirs, with renames where
// the runtime expects a different name than Pinacotheca emits.
interface IconMapping {
	readonly source: string; // relative to extracted/sprites/
	readonly target: string; // filename under static/sprites/icons/ (with .png suffix)
}
const ICON_MAPPINGS: readonly IconMapping[] = [
	{
		source: "improvements/IMPROVEMENT_FINISHED.png",
		target: "IMPROVEMENT_FINISHED.png",
	},
	{
		source: "other/Cycle_Military_Normal.png",
		target: "MILITARY.png",
	},
	{
		source: "other/VICTORY_Normal.png",
		target: "VICTORY_NORMAL.png",
	},
	{
		source: "other/MAP_OVERVIEW_Normal.png",
		target: "MAP_OVERVIEW.png",
	},
	{
		source: "other/Cycle_Normal_EndTurn.png",
		target: "TURN.png",
	},
	{
		source: "achievements/ACHIEVEMENT_WIN.png",
		target: "ACHIEVEMENT_WIN.png",
	},
];

function contentHash(buf: Buffer): string {
	return createHash("sha256").update(buf).digest("hex").slice(0, 8);
}

async function wipeAndRecreate(dir: string): Promise<void> {
	await rm(dir, { recursive: true, force: true });
	await mkdir(dir, { recursive: true });
}

// Read source PNG, write a content-hashed copy to dst, register in the
// sidecar under "<category>/<basename>" → public URL. `basename` is the
// stem without .png (e.g., "CREST_NATION_EGYPT") so manifest keys mirror
// what callers in helpers.ts construct.
async function bakeOne(
	srcPath: string,
	dstDir: string,
	category: string,
	basename: string,
	sidecar: SpriteSidecar,
): Promise<void> {
	const buf = await readFile(srcPath);
	const hash = contentHash(buf);
	const filename = `${basename}.${hash}.png`;
	await writeFile(resolve(dstDir, filename), buf);
	sidecar[`${category}/${basename}`] = `/sprites/${category}/${filename}`;
}

async function copyMirrorCategory(
	category: string,
	sidecar: SpriteSidecar,
): Promise<number> {
	const src = resolve(PINACOTHECA_SPRITES, category);
	const dst = resolve(SPRITES_OUT, category);
	await wipeAndRecreate(dst);
	const entries = await readdir(src);
	const pngs = entries.filter((f) => f.endsWith(".png"));
	for (const filename of pngs) {
		const basename = filename.slice(0, -".png".length);
		await bakeOne(resolve(src, filename), dst, category, basename, sidecar);
	}
	return pngs.length;
}

async function copyUnits(sidecar: SpriteSidecar): Promise<number> {
	const src = resolve(PINACOTHECA_SPRITES, "units");
	const dst = resolve(SPRITES_OUT, UNITS_CATEGORY);
	await wipeAndRecreate(dst);
	const entries = await readdir(src);
	const pngs = entries.filter(
		(f) =>
			f.startsWith("UNIT_") && f.endsWith(".png") && !f.startsWith("UNIT_3D_"),
	);
	for (const filename of pngs) {
		const basename = filename.slice(0, -".png".length);
		await bakeOne(
			resolve(src, filename),
			dst,
			UNITS_CATEGORY,
			basename,
			sidecar,
		);
	}
	return pngs.length;
}

async function copyIcons(sidecar: SpriteSidecar): Promise<number> {
	const dst = resolve(SPRITES_OUT, "icons");
	await wipeAndRecreate(dst);
	for (const { source, target } of ICON_MAPPINGS) {
		const basename = target.slice(0, -".png".length);
		await bakeOne(
			resolve(PINACOTHECA_SPRITES, source),
			dst,
			"icons",
			basename,
			sidecar,
		);
	}
	return ICON_MAPPINGS.length;
}

async function main(): Promise<void> {
	const pinacothecaVersion = await readPinacothecaVersion(
		PINACOTHECA_PYPROJECT,
	);
	const bakedAt = new Date().toISOString();
	console.log(
		`[sprites] pinacotheca ${pinacothecaVersion}, baked at ${bakedAt}`,
	);

	await mkdir(SPRITES_OUT, { recursive: true });

	// All sprite-bake outputs are owned by this script, so the sidecar is
	// rewritten wholesale rather than read-merged. (Atlas bakes use
	// updateAtlasSidecar() because multiple scripts contribute to the atlas
	// sidecar.)
	const sidecar: SpriteSidecar = {};
	const counts: Record<string, number> = {};

	for (const cat of MIRROR_CATEGORIES) {
		counts[cat] = await copyMirrorCategory(cat, sidecar);
	}
	counts[UNITS_CATEGORY] = await copyUnits(sidecar);
	counts.icons = await copyIcons(sidecar);

	// Sort keys so the resulting JSON is deterministic across runs.
	const sortedSidecar: SpriteSidecar = {};
	for (const key of Object.keys(sidecar).sort()) {
		sortedSidecar[key] = sidecar[key];
	}
	await writeSpriteSidecar(sortedSidecar);

	await writeFile(
		resolve(SPRITES_OUT, ".bake-info.json"),
		JSON.stringify({ pinacothecaVersion, bakedAt, counts }, null, 2) + "\n",
	);

	const total = Object.values(counts).reduce((a, b) => a + b, 0);
	const summary = Object.entries(counts)
		.map(([k, v]) => `${k}=${v}`)
		.join(" ");
	console.log(`[sprites] wrote ${total} files (${summary})`);
}

await main();
