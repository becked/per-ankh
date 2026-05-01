// Bake the source map atlases (assets/atlas-sources/) into runtime-ready
// atlases at static/atlases/ by applying the hex-clip + upscale transform
// that masks the dark beveled edges baked into the game's 3D-rendered sprites.
//
// One-shot script. Run via `npm run bake:atlases` after pulling fresh sprites
// from Pinacotheca or after re-tuning SPRITE_SCALE_X/Y below. The runtime
// (src/lib/SpriteMap.svelte) feeds the baked atlas directly to deck.gl
// IconLayer, which samples it as-is — no per-draw clip, scale, or flip.
//
// To re-tune the bevel trim:
//   1. Adjust SPRITE_SCALE_X / SPRITE_SCALE_Y here.
//   2. `npm run bake:atlases`.
//   3. Reload the dev server and inspect the Map Beta tab.

import sharp from "sharp";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readPinacothecaVersion } from "./lib/atlas-bake.js";

interface SpriteRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

interface SourceManifest {
	atlas: string;
	cellWidth: number;
	cellHeight: number;
	sprites: Record<string, SpriteRect>;
}

interface OutputManifest extends SourceManifest {
	bakedAt: string;
	pinacothecaVersion: string;
}

// Pointy-top hex inscribed at game-accurate 1.225 aspect (8.66 wide ×
// 7.07 tall after 45° tilt). Mirrors scripts/lib/atlas-bake.ts and
// src/lib/SpriteMap.svelte — keep all three in sync.
const HEX_H_SPACING = 199;
const HEX_V_SPACING = 122;
const HEX_RADIUS_X = HEX_H_SPACING / Math.sqrt(3);
const HEX_RADIUS_Y = HEX_V_SPACING / 1.5;
const SPRITE_SCALE_X = 1.13;
const SPRITE_SCALE_Y = 1.32;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const SOURCE_DIR = resolve(REPO_ROOT, "assets/atlas-sources");
const OUTPUT_DIR = resolve(REPO_ROOT, "static/atlases");
const PINACOTHECA_PYPROJECT = resolve(
	REPO_ROOT,
	"../../../../pinacotheca/pyproject.toml",
);

function buildHexMaskSvg(cellW: number, cellH: number): string {
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

async function bakeCell(
	source: Buffer,
	sx: number,
	sy: number,
	sw: number,
	sh: number,
	cellW: number,
	cellH: number,
	hexMask: Buffer,
): Promise<Buffer> {
	const upscaledW = Math.round(sw * SPRITE_SCALE_X);
	const upscaledH = Math.round(sh * SPRITE_SCALE_Y);

	// Extract → upscale (lanczos3). No Y-flip: deck.gl IconLayer's billboard
	// mode samples the atlas in screen-natural orientation (top-of-image at
	// top-of-screen), bypassing the OrthographicView flipY. Pre-flipping
	// would render every sprite upside-down at runtime.
	const upscaled = await sharp(source)
		.extract({ left: sx, top: sy, width: sw, height: sh })
		.resize(upscaledW, upscaledH, { kernel: "lanczos3" })
		.toBuffer();

	// Center-crop back to the cell size; the bevel rows have been pushed past
	// the cell boundary by the upscale and are dropped here.
	const cropLeft = Math.round((upscaledW - cellW) / 2);
	const cropTop = Math.round((upscaledH - cellH) / 2);
	const cropped = await sharp(upscaled)
		.extract({ left: cropLeft, top: cropTop, width: cellW, height: cellH })
		.toBuffer();

	// Apply the hex alpha mask: dest-in keeps the underlay where the mask is
	// opaque (inside the hex) and clears it elsewhere.
	return sharp(cropped)
		.composite([{ input: hexMask, blend: "dest-in" }])
		.toBuffer();
}

async function bakeAtlas(
	name: string,
	bakedAt: string,
	pinacothecaVersion: string,
): Promise<void> {
	const sourceWebp = resolve(SOURCE_DIR, `${name}.webp`);
	const sourceJson = resolve(SOURCE_DIR, `${name}.json`);
	const outputWebp = resolve(OUTPUT_DIR, `${name}.webp`);
	const outputJson = resolve(OUTPUT_DIR, `${name}.json`);

	const manifestText = await readFile(sourceJson, "utf-8");
	const manifest: SourceManifest = JSON.parse(manifestText);
	const source = await readFile(sourceWebp);
	const meta = await sharp(source).metadata();
	if (!meta.width || !meta.height) {
		throw new Error(`[${name}] could not read source atlas dimensions`);
	}
	const cellCount = Object.keys(manifest.sprites).length;
	console.log(
		`[${name}] source ${meta.width}×${meta.height}, ${cellCount} cells`,
	);

	const hexMaskSvg = buildHexMaskSvg(manifest.cellWidth, manifest.cellHeight);
	const hexMask = Buffer.from(hexMaskSvg);

	const composites: sharp.OverlayOptions[] = [];
	for (const [spriteName, sprite] of Object.entries(manifest.sprites)) {
		const baked = await bakeCell(
			source,
			sprite.x,
			sprite.y,
			sprite.width,
			sprite.height,
			manifest.cellWidth,
			manifest.cellHeight,
			hexMask,
		);
		composites.push({ input: baked, left: sprite.x, top: sprite.y });
		console.log(`  ${spriteName} → (${sprite.x},${sprite.y})`);
	}

	await sharp({
		create: {
			width: meta.width,
			height: meta.height,
			channels: 4,
			background: { r: 0, g: 0, b: 0, alpha: 0 },
		},
	})
		.composite(composites)
		.webp({ lossless: true })
		.toFile(outputWebp);

	const outputManifest: OutputManifest = {
		...manifest,
		bakedAt,
		pinacothecaVersion,
	};
	await writeFile(outputJson, JSON.stringify(outputManifest, null, 2) + "\n");
	console.log(`[${name}] wrote ${outputWebp}`);
}

async function main(): Promise<void> {
	await mkdir(OUTPUT_DIR, { recursive: true });
	const pinacothecaVersion = await readPinacothecaVersion(PINACOTHECA_PYPROJECT);
	const bakedAt = new Date().toISOString();
	console.log(
		`[atlases] pinacotheca ${pinacothecaVersion}, baked at ${bakedAt}`,
	);
	await bakeAtlas("terrain", bakedAt, pinacothecaVersion);
	await bakeAtlas("height", bakedAt, pinacothecaVersion);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
