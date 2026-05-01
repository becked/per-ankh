// Bake 3D resource sprites pulled from pinacotheca's individual renders into
// a single per-ankh atlas keyed by save-file resource zType + variant suffix.
//
// OUTPUT: assets/atlas-sources/resources.{webp,json} + static/atlases/...
//
// SOURCE: ~/Projects/Old World/pinacotheca/extracted/sprites/resources/
//   RESOURCE_3D_<NAME>_HERD.png             — multi-figure herd
//   RESOURCE_3D_<NAME>_HERD_<RIG>.png       — multi-rig herd: pick the
//                                              resource-specific RIG (starts
//                                              with NAME); skip alternates
//                                              (BIRD_SEAGULL).
//   RESOURCE_3D_<NAME>_SOLO.png             — single figure / artist rig
//   RESOURCE_3D_<NAME>_SOLO_<RIG>.png       — multi-rig solo: same RIG-pick
//                                              rule.
//
// Sprite keys: RESOURCE_<NAME>_HERD and RESOURCE_<NAME>_SOLO. The runtime
// picks SOLO when the tile carries a rural improvement (Pasture/Camp/Mine/etc.
// — the SOLO figure fits cleanly next to the structure), and HERD when the
// tile is bare (the herd reads as the wild resource itself). 20 resources × 2
// variants = 40 cells, packed in a 7×6 grid.
//
// Some resources (Iron, Gold, Gem, Silver, Barley, Sorghum, Wheat, Honey,
// Lavender, Olive, Wine) await ClutterSpawner support upstream and don't have
// a render yet. The bake silently skips them and they'll appear automatically
// on the next pinacotheca refresh — no per-ankh code change needed.
//
// Run: npm run bake:resources

import { mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	CELL_W,
	CELL_H,
	SAFE_SCALE,
	type AtlasManifest,
	type SpriteRect,
	bakeCell,
	buildHexMask,
	placeCellGrid,
	readPinacothecaVersion,
	writeAtlas,
} from "./lib/atlas-bake.js";
import sharp from "sharp";

// SOLO resources sit alongside a rural improvement (Pasture/Camp/Mine) which
// itself bakes at SAFE_SCALE. Baking SOLO at the same scale makes the single
// animal/figure read as a peer to the structure; shrinking it produces the
// "accessory next to the building" look the game has.
const SOLO_SCALE = 0.4;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
// Resolve pinacotheca's checkout. Two layouts in active use: the per-ankh
// worktree under .claude/worktrees/<branch>/ (4 up) and the main repo at
// <Old World>/per-ankh/ (1 up). Probe both; first one that exists wins.
const PINACOTHECA_ROOT = (() => {
	const candidates = [
		resolve(REPO_ROOT, "../../../../pinacotheca"),
		resolve(REPO_ROOT, "../pinacotheca"),
	];
	const found = candidates.find((p) => existsSync(p));
	if (!found) {
		throw new Error(
			`could not locate pinacotheca; tried:\n  ${candidates.join("\n  ")}`,
		);
	}
	return found;
})();
const PINACOTHECA_3D_DIR = resolve(
	PINACOTHECA_ROOT,
	"extracted/sprites/resources",
);
const PINACOTHECA_PYPROJECT = resolve(PINACOTHECA_ROOT, "pyproject.toml");
const SOURCE_DIR = resolve(REPO_ROOT, "assets/atlas-sources");
const OUTPUT_DIR = resolve(REPO_ROOT, "static/atlases");

type Variant = "HERD" | "SOLO";

interface ResourcePick {
	name: string;
	variant: Variant;
	path: string;
}

// Walk the resources directory and pick one rendered PNG per (resource,
// variant) pair. For each filename matching `RESOURCE_3D_<NAME>_<VARIANT>` or
// `RESOURCE_3D_<NAME>_<VARIANT>_<RIG>`: VARIANT must be HERD or SOLO; if
// multi-rig, the RIG must start with NAME (resource-specific) rather than a
// generic alternate (BIRD_SEAGULL). The first sorted match per (name,
// variant) wins; later duplicates are logged.
async function pickResourceRenders(): Promise<ResourcePick[]> {
	const filenames = await readdir(PINACOTHECA_3D_DIR);
	const picks = new Map<string, ResourcePick>();
	const skipped: string[] = [];
	for (const filename of filenames.sort()) {
		if (!filename.startsWith("RESOURCE_3D_") || !filename.endsWith(".png")) {
			continue;
		}
		const stem = filename.slice(0, -".png".length);
		// Strip RESOURCE_3D_ prefix → "<NAME>_<HERD|SOLO>[_<RIG>]". Use a
		// non-greedy NAME match anchored on the variant token so multi-word
		// resource names parse correctly (none today, but cheap insurance).
		const rest = stem.slice("RESOURCE_3D_".length);
		const m = /^(.+?)_(HERD|SOLO)(?:_(.+))?$/.exec(rest);
		if (!m) continue;
		const [, name, variant, rig] = m;
		if (rig != null && !rig.startsWith(name)) {
			skipped.push(filename);
			continue;
		}
		const key = `${name}_${variant}`;
		if (picks.has(key)) {
			console.warn(
				`[resources] duplicate ${key}: keeping ${picks.get(key)?.path}, ignoring ${filename}`,
			);
			continue;
		}
		picks.set(key, {
			name,
			variant: variant as Variant,
			path: resolve(PINACOTHECA_3D_DIR, filename),
		});
	}
	if (skipped.length > 0) {
		console.log(
			`[resources] skipped ${skipped.length} alternate-rig render(s): ${skipped.join(", ")}`,
		);
	}
	// Stable ordering: NAME alphabetical, HERD before SOLO. Manifest cells
	// land in the same order, which keeps diffs readable when re-baking.
	return Array.from(picks.values()).sort((a, b) => {
		if (a.name !== b.name) return a.name < b.name ? -1 : 1;
		return a.variant < b.variant ? -1 : 1;
	});
}

async function main(): Promise<void> {
	await mkdir(SOURCE_DIR, { recursive: true });
	await mkdir(OUTPUT_DIR, { recursive: true });

	const pinacothecaVersion = await readPinacothecaVersion(PINACOTHECA_PYPROJECT);
	const bakedAt = new Date().toISOString();
	const hexMask = await buildHexMask(CELL_W, CELL_H);
	console.log(
		`[resources] pinacotheca ${pinacothecaVersion}, baked at ${bakedAt}`,
	);

	const picks = await pickResourceRenders();
	if (picks.length === 0) {
		console.log("[resources] no resource renders found, nothing to bake");
		return;
	}

	const grid = placeCellGrid(picks.length);
	const sprites: Record<string, SpriteRect> = {};
	const composites: sharp.OverlayOptions[] = [];
	for (let i = 0; i < picks.length; i++) {
		const pick = picks[i];
		const rect = grid.cellAt(i);
		// No brightness tweak. Resources are typically clusters of small
		// figures (animals, fish, etc.); brightening washes them out and the
		// improvement layer drawn on top already carries its own lift.
		const scale = pick.variant === "SOLO" ? SOLO_SCALE : SAFE_SCALE;
		const baked = await bakeCell(pick.path, hexMask, { scale });
		composites.push({ input: baked, left: rect.x, top: rect.y });
		const key = `RESOURCE_${pick.name}_${pick.variant}`;
		sprites[key] = rect;
		console.log(`[resources] ${key} → cell ${i}`);
	}

	const manifest: AtlasManifest = {
		atlas: "resources.webp",
		cellWidth: CELL_W,
		cellHeight: CELL_H,
		bakedAt,
		pinacothecaVersion,
		sprites,
	};

	await writeAtlas({
		name: "resources",
		manifest,
		composites,
		width: grid.atlasWidth,
		height: grid.atlasHeight,
		sourceDir: SOURCE_DIR,
		outputDir: OUTPUT_DIR,
	});
	console.log(
		`[resources] wrote ${grid.atlasWidth}×${grid.atlasHeight} (${grid.cols}×${grid.rows}, ${picks.length} cells)`,
	);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
