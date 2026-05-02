// Bake the loose 2D sprite PNGs that the runtime serves directly from
// /sprites/<category>/<name>.png. These don't get packed into atlases — they
// ship as individual files under static/sprites/, fetched on demand by
// SpriteIcon.svelte and SpriteMap.svelte.
//
// SOURCES (all under <pinacotheca>/extracted/sprites/):
//   crests/, techs/, laws/, religions/, yields/  → 1:1 copy by category dir
//   units/                                       → UNIT_*.png minus UNIT_3D_*
//   improvements/IMPROVEMENT_FINISHED.png        → icons/IMPROVEMENT_FINISHED.png
//   other/Cycle_Military_Normal.png              → icons/MILITARY.png
//   other/VICTORY_Normal.png                     → icons/VICTORY_NORMAL.png
//
// OUTPUT:
//   static/sprites/<category>/*.png
//   static/sprites/.bake-info.json   (pinacotheca version + bakedAt stamp)
//
// Each target category dir is wiped and repopulated per run, so this is
// idempotent — running it twice produces the same tree.
//
// Run: npm run bake:sprites

import { copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readPinacothecaVersion } from "./lib/atlas-bake.js";
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
	readonly target: string; // filename under static/sprites/icons/
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
];

async function wipeAndRecreate(dir: string): Promise<void> {
	await rm(dir, { recursive: true, force: true });
	await mkdir(dir, { recursive: true });
}

async function copyMirrorCategory(category: string): Promise<number> {
	const src = resolve(PINACOTHECA_SPRITES, category);
	const dst = resolve(SPRITES_OUT, category);
	await wipeAndRecreate(dst);
	const entries = await readdir(src);
	const pngs = entries.filter((f) => f.endsWith(".png"));
	for (const filename of pngs) {
		await copyFile(resolve(src, filename), resolve(dst, filename));
	}
	return pngs.length;
}

async function copyUnits(): Promise<number> {
	const src = resolve(PINACOTHECA_SPRITES, "units");
	const dst = resolve(SPRITES_OUT, UNITS_CATEGORY);
	await wipeAndRecreate(dst);
	const entries = await readdir(src);
	const pngs = entries.filter(
		(f) =>
			f.startsWith("UNIT_") && f.endsWith(".png") && !f.startsWith("UNIT_3D_"),
	);
	for (const filename of pngs) {
		await copyFile(resolve(src, filename), resolve(dst, filename));
	}
	return pngs.length;
}

async function copyIcons(): Promise<number> {
	const dst = resolve(SPRITES_OUT, "icons");
	await wipeAndRecreate(dst);
	for (const { source, target } of ICON_MAPPINGS) {
		await copyFile(
			resolve(PINACOTHECA_SPRITES, source),
			resolve(dst, target),
		);
	}
	return ICON_MAPPINGS.length;
}

async function main(): Promise<void> {
	const pinacothecaVersion = await readPinacothecaVersion(PINACOTHECA_PYPROJECT);
	const bakedAt = new Date().toISOString();
	console.log(
		`[sprites] pinacotheca ${pinacothecaVersion}, baked at ${bakedAt}`,
	);

	await mkdir(SPRITES_OUT, { recursive: true });

	const counts: Record<string, number> = {};
	for (const cat of MIRROR_CATEGORIES) {
		counts[cat] = await copyMirrorCategory(cat);
	}
	counts[UNITS_CATEGORY] = await copyUnits();
	counts.icons = await copyIcons();

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
