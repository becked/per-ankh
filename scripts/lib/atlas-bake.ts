// Shared helpers for the per-ankh atlas bakers (bake-improvements.ts and
// bake-resources.ts). The runtime renders all map sprites at a fixed
// 211×181 hex cell with a 2px transparent gutter between cells, and feeds
// the atlas straight to deck.gl IconLayer — so all bakers funnel through
// the same packing geometry, hex mask, and manifest schema.

import sharp from "sharp";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Hex geometry — cell size matches the runtime SpriteMap.svelte hex spacing
// constants. Don't change one without the other.
export const CELL_W = 211;
export const CELL_H = 181;
export const HEX_H_SPACING = 199;
export const HEX_V_SPACING = 132;
export const HEX_RADIUS_X = HEX_H_SPACING / Math.sqrt(3);
export const HEX_RADIUS_Y = HEX_V_SPACING / 1.5;

// Transparent gutter between cells in the packed atlas. Stops bilinear
// filter taps from picking up color from neighboring cells when an
// IconLayer samples near a cell boundary — the visible-seam fix that
// hex-mask alpha alone doesn't cover (the alpha goes to zero at the hex
// edge but the underlying RGB was still bleeding from the next cell over).
export const GUTTER_PX = 2;

// Default scale for "focal building" cells: assets sit inside the hex cell
// with margin around them so they don't reach the corners and visibly
// spill into neighbors. 0.77 ≈ inscribed-rectangle width for asset aspect
// ~1.5.
export const SAFE_SCALE = 0.77;

// Full-cell scale for cells that ARE the entire hex (urban backgrounds,
// composites). Combined with fit:"cover" it ensures hex corners are filled.
export const FULL_SCALE = 1.0;

export interface SpriteRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface AtlasManifest {
	atlas: string;
	cellWidth: number;
	cellHeight: number;
	bakedAt: string;
	pinacothecaVersion: string;
	sprites: Record<string, SpriteRect>;
	fallbackSprite?: SpriteRect;
}

export interface BakeCellOptions {
	scale?: number;
	fit?: "inside" | "cover";
	tweak?: { brightness?: number; saturation?: number };
}

export function buildHexMaskSvg(cellW: number, cellH: number): string {
	const cx = cellW / 2;
	const cy = cellH / 2;
	const points: string[] = [];
	for (let i = 0; i < 6; i++) {
		const angle = (Math.PI / 3) * i - Math.PI / 2;
		const x = cx + HEX_RADIUS_X * Math.cos(angle);
		const y = cy + HEX_RADIUS_Y * Math.sin(angle);
		points.push(`${x.toFixed(3)},${y.toFixed(3)}`);
	}
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${cellW}" height="${cellH}"><polygon points="${points.join(" ")}" fill="white"/></svg>`;
}

// Resize the source PNG to fit the cell, optionally apply a brightness /
// saturation tweak, then hex-clip via alpha mask. Returns a CELL_W×CELL_H
// PNG buffer ready to drop into a packed atlas.
export async function bakeCell(
	sourcePath: string,
	hexMask: Buffer,
	options: BakeCellOptions = {},
): Promise<Buffer> {
	const scale = options.scale ?? SAFE_SCALE;
	const fit = options.fit ?? "inside";
	const targetW = Math.round(CELL_W * scale);
	const targetH = Math.round(CELL_H * scale);

	const fitted = await sharp(sourcePath)
		.resize(targetW, targetH, { fit, position: "center" })
		.png()
		.toBuffer();
	const fittedMeta = await sharp(fitted).metadata();
	if (!fittedMeta.width || !fittedMeta.height) {
		throw new Error(`could not read fitted dimensions for ${sourcePath}`);
	}

	const offsetX = Math.round((CELL_W - fittedMeta.width) / 2);
	const offsetY = Math.round((CELL_H - fittedMeta.height) / 2);
	const centered = await sharp({
		create: {
			width: CELL_W,
			height: CELL_H,
			channels: 4,
			background: { r: 0, g: 0, b: 0, alpha: 0 },
		},
	})
		.composite([{ input: fitted, left: offsetX, top: offsetY }])
		.png()
		.toBuffer();

	let toned = centered;
	if (options.tweak) {
		toned = await sharp(toned).modulate(options.tweak).png().toBuffer();
	}

	return sharp(toned)
		.composite([{ input: hexMask, blend: "dest-in" }])
		.png()
		.toBuffer();
}

export interface CellGrid {
	cols: number;
	rows: number;
	atlasWidth: number;
	atlasHeight: number;
	cellAt(i: number): SpriteRect;
}

// Pack `numCells` cells into a roughly-square grid with GUTTER_PX between
// cells. Atlas dimensions exclude the trailing gutter on the right/bottom
// edges. Sprite rects describe the inner CELL_W×CELL_H region; the gutter
// pixels stay transparent and zero out filter taps that cross cell
// boundaries.
export function placeCellGrid(numCells: number): CellGrid {
	const cols = Math.max(1, Math.ceil(Math.sqrt(numCells)));
	const rows = Math.max(1, Math.ceil(numCells / cols));
	const stride = (n: number, dim: number) =>
		n * (dim + GUTTER_PX) - (n > 0 ? GUTTER_PX : 0);
	const atlasWidth = stride(cols, CELL_W);
	const atlasHeight = stride(rows, CELL_H);
	return {
		cols,
		rows,
		atlasWidth,
		atlasHeight,
		cellAt(i: number): SpriteRect {
			return {
				x: (i % cols) * (CELL_W + GUTTER_PX),
				y: Math.floor(i / cols) * (CELL_H + GUTTER_PX),
				width: CELL_W,
				height: CELL_H,
			};
		},
	};
}

export interface AtlasOutput {
	name: string; // e.g. "improvements-base", written as ${name}.{webp,json}
	manifest: AtlasManifest;
	composites: sharp.OverlayOptions[];
	width: number;
	height: number;
	sourceDir: string;
	outputDir: string;
}

// Writes the atlas WebP + manifest JSON to BOTH source dir (versioned with
// the repo so the bake is reproducible without re-running pinacotheca) and
// output dir (served at runtime). Both copies are byte-identical.
export async function writeAtlas(out: AtlasOutput): Promise<void> {
	const buffer = await sharp({
		create: {
			width: out.width,
			height: out.height,
			channels: 4,
			background: { r: 0, g: 0, b: 0, alpha: 0 },
		},
	})
		.composite(out.composites)
		.webp({ lossless: true })
		.toBuffer();
	const manifestText = JSON.stringify(out.manifest, null, 2) + "\n";

	await writeFile(resolve(out.sourceDir, `${out.name}.webp`), buffer);
	await writeFile(resolve(out.sourceDir, `${out.name}.json`), manifestText);
	await writeFile(resolve(out.outputDir, `${out.name}.webp`), buffer);
	await writeFile(resolve(out.outputDir, `${out.name}.json`), manifestText);
}

// Read pinacotheca's pyproject.toml to stamp its version into manifests.
// Cheap parse — we only need the line `version = "x.y.z"` under [project].
// Returns "unknown" if the file is missing or malformed; the bake still
// succeeds and the manifest just records the unknown.
export async function readPinacothecaVersion(
	pyprojectPath: string,
): Promise<string> {
	try {
		const text = await readFile(pyprojectPath, "utf-8");
		const m = text.match(/^version\s*=\s*"([^"]+)"/m);
		return m?.[1] ?? "unknown";
	} catch {
		return "unknown";
	}
}
