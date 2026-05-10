// Bake pinacotheca's per-(biome, height) 3D terrain renders into a single
// packed atlas keyed by TERRAIN_3D_<BIOME>_<HEIGHT>.
//
// OUTPUT (in static/atlases/ + assets/atlas-sources/):
//   terrain-3d.{webp,json} — 28 cells: 6 land biomes (ARID, LUSH, MARSH, SAND,
//                            TEMPERATE, TUNDRA) × 4 heights (FLAT, HILL,
//                            MOUNTAIN, VOLCANO) + URBAN_FLAT + 3 WATER_*.
//
// SOURCES:
//   ~/Projects/Old World/pinacotheca/extracted/sprites/terrains/
//     TERRAIN_3D_<BIOME>_<HEIGHT>.png + matching .json sidecar with
//     world.groundHex.pixelBbox (the source's hex base in image pixels).
//
//   The pinacotheca dir also contains 9 orphan 2D PNGs (TERRAIN_<BIOME>.png
//   without _3D_) that we skip — those were the legacy biome-only icons used
//   by the now-removed terrain.webp bake.
//
// FRAMING:
//   FLAT and WATER_* renders use pinacotheca's padding=0 autocrop, so
//   groundHex covers 100% of the source image — cover-fit lands the hex at
//   per-ankh's full hex extent.
//
//   HILL/MOUNTAIN/VOLCANO renders include peak/spire content extending past
//   the hex bbox (groundHex is 78–98% of source image; the rest is peak above
//   and lateral mountain spread). Naive cover-fit on these shrinks the hex
//   base AND the peak content together, making mountains read as small hills
//   inside the cell. Instead we anchor on the sidecar's groundHex.pixelBbox:
//   scale so groundHex_height = per-ankh hex extent (2 × HEX_RADIUS_Y), then
//   place the scaled source so groundHex bottom-center sits at the cell hex
//   bottom-center. The hex base fills per-ankh's hex; lateral mountain
//   spread overflows the cell sides and is hex-clipped; peak content above
//   the hex top apex extends into the ~2 px margin above the inscribed hex
//   and is naturally cropped at the cell top.
//
// Runtime (src/lib/SpriteMap.svelte):
//   1. Loads terrain-3d.{webp,json}.
//   2. Stacks two layers per tile via terrain3dBaseKey + terrain3dReliefKey:
//      base <BIOME>_FLAT (always), then HILL/MOUNTAIN/VOLCANO relief on top
//      where applicable. Base provides the edge-to-edge hex backstop;
//      relief contributes the actual elevation content.
//
// Run: npm run bake:terrain-3d

import sharp from "sharp";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	CELL_W,
	CELL_H,
	HEX_RADIUS_Y,
	FULL_SCALE,
	type AtlasManifest,
	type SpriteRect,
	bakeCell,
	buildHexMask,
	placeCellGrid,
	readPinacothecaVersion,
	writeAtlas,
} from "./lib/atlas-bake.js";
import { resolvePinacotheca } from "./lib/paths.js";

interface TerrainSidecar {
	world: {
		groundHex: {
			pixelBboxMin: [number, number];
			pixelBboxMax: [number, number];
		};
	};
}

// Anchor a relief render on its groundHex pixel bbox: scale so groundHex
// height matches per-ankh's hex extent, then position so the groundHex
// bottom-center lands at the cell hex bottom-center. Lateral overflow gets
// hex-clipped; peak content above the hex apex extends into the small cell
// margin and is naturally cropped at the cell top.
async function bakeReliefCell(
	sourcePath: string,
	sidecarPath: string,
	hexMask: Buffer,
): Promise<Buffer> {
	const sidecarText = await readFile(sidecarPath, "utf-8");
	const sidecar = JSON.parse(sidecarText) as TerrainSidecar;
	const [ghMinX, ghMinY] = sidecar.world.groundHex.pixelBboxMin;
	const [ghMaxX, ghMaxY] = sidecar.world.groundHex.pixelBboxMax;
	const ghH = ghMaxY - ghMinY;
	const ghCenterX = (ghMinX + ghMaxX) / 2;

	const meta = await sharp(sourcePath).metadata();
	if (!meta.width || !meta.height) {
		throw new Error(`could not read dimensions for ${sourcePath}`);
	}

	const hexPixelHeight = 2 * HEX_RADIUS_Y;
	const scale = hexPixelHeight / ghH;
	const scaledW = Math.round(meta.width * scale);
	const scaledH = Math.round(meta.height * scale);

	const cellHexBottomY = CELL_H / 2 + HEX_RADIUS_Y;
	const offsetY = Math.round(cellHexBottomY - ghMaxY * scale);
	const offsetX = Math.round(CELL_W / 2 - ghCenterX * scale);

	const scaled = await sharp(sourcePath)
		.resize(scaledW, scaledH, { fit: "fill" })
		.png()
		.toBuffer();

	// Sharp's composite rejects inputs that extend off-canvas, so extract the
	// visible portion of the scaled source first, then place it at the
	// matching cell offset. Lateral mountain spread typically overflows on
	// each side; peak content typically overflows above; nothing should
	// overflow below.
	const visibleLeft = Math.max(0, offsetX);
	const visibleTop = Math.max(0, offsetY);
	const visibleRight = Math.min(CELL_W, offsetX + scaledW);
	const visibleBottom = Math.min(CELL_H, offsetY + scaledH);
	const visibleW = visibleRight - visibleLeft;
	const visibleH = visibleBottom - visibleTop;
	if (visibleW <= 0 || visibleH <= 0) {
		throw new Error(
			`relief bake produced no visible content for ${sourcePath}`,
		);
	}
	const srcExtract = await sharp(scaled)
		.extract({
			left: visibleLeft - offsetX,
			top: visibleTop - offsetY,
			width: visibleW,
			height: visibleH,
		})
		.png()
		.toBuffer();

	const placed = await sharp({
		create: {
			width: CELL_W,
			height: CELL_H,
			channels: 4,
			background: { r: 0, g: 0, b: 0, alpha: 0 },
		},
	})
		.composite([{ input: srcExtract, left: visibleLeft, top: visibleTop }])
		.png()
		.toBuffer();

	return sharp(placed)
		.composite([{ input: hexMask, blend: "dest-in" }])
		.png()
		.toBuffer();
}

function isReliefKey(key: string): boolean {
	return (
		key.endsWith("_HILL") ||
		key.endsWith("_MOUNTAIN") ||
		key.endsWith("_VOLCANO")
	);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const PINACOTHECA_ROOT = resolvePinacotheca();
const PINACOTHECA_3D_DIR = resolve(
	PINACOTHECA_ROOT,
	"extracted/sprites/terrains",
);
const PINACOTHECA_PYPROJECT = resolve(PINACOTHECA_ROOT, "pyproject.toml");

const SOURCE_DIR = resolve(REPO_ROOT, "assets/atlas-sources");
const OUTPUT_DIR = resolve(REPO_ROOT, "static/atlases");

async function main(): Promise<void> {
	await mkdir(SOURCE_DIR, { recursive: true });
	await mkdir(OUTPUT_DIR, { recursive: true });

	const pinacothecaVersion = await readPinacothecaVersion(
		PINACOTHECA_PYPROJECT,
	);
	const bakedAt = new Date().toISOString();
	console.log(
		`[terrain-3d] pinacotheca ${pinacothecaVersion}, baked at ${bakedAt}`,
	);

	const hexMask = await buildHexMask(CELL_W, CELL_H);

	const entries = (await readdir(PINACOTHECA_3D_DIR))
		.filter((f) => f.startsWith("TERRAIN_3D_") && f.endsWith(".png"))
		.map((f) => ({
			key: f.slice(0, -".png".length),
			path: resolve(PINACOTHECA_3D_DIR, f),
		}))
		.sort((a, b) => a.key.localeCompare(b.key));

	if (entries.length === 0) {
		throw new Error(
			`[terrain-3d] no TERRAIN_3D_*.png found in ${PINACOTHECA_3D_DIR}`,
		);
	}

	const grid = placeCellGrid(entries.length);
	const sprites: Record<string, SpriteRect> = {};
	const composites: sharp.OverlayOptions[] = [];

	for (let i = 0; i < entries.length; i++) {
		const cell = entries[i];
		const rect = grid.cellAt(i);
		const baked = isReliefKey(cell.key)
			? await bakeReliefCell(
					cell.path,
					cell.path.slice(0, -".png".length) + ".json",
					hexMask,
				)
			: await bakeCell(cell.path, hexMask, {
					scale: FULL_SCALE,
					fit: "cover",
				});
		composites.push({ input: baked, left: rect.x, top: rect.y });
		sprites[cell.key] = rect;
		console.log(`[terrain-3d] ${cell.key} → cell ${i}`);
	}

	const manifest: AtlasManifest = {
		cellWidth: CELL_W,
		cellHeight: CELL_H,
		bakedAt,
		pinacothecaVersion,
		sprites,
	};

	await writeAtlas({
		name: "terrain-3d",
		manifest,
		composites,
		width: grid.atlasWidth,
		height: grid.atlasHeight,
		sourceDir: SOURCE_DIR,
		outputDir: OUTPUT_DIR,
	});
	console.log(
		`[terrain-3d] wrote ${grid.atlasWidth}×${grid.atlasHeight} (${entries.length} cells)`,
	);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
