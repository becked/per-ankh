// Bake the source map atlases (assets/atlas-sources/) into runtime-ready
// atlases at static/atlases/ by applying the hex-clip + upscale transform
// that masks the dark beveled edges baked into the game's 3D-rendered sprites.
//
// One-shot script. Run via `npm run bake:atlases` after pulling fresh sprites
// from Pinacotheca or after re-tuning SPRITE_SCALE_X/Y below. The runtime
// (src/lib/SpriteMap.svelte) just blits cells from the baked atlas — no clip,
// no scale, no flip.
//
// To re-tune the bevel trim:
//   1. Adjust SPRITE_SCALE_X / SPRITE_SCALE_Y here.
//   2. `npm run bake:atlases`.
//   3. Reload the dev server and inspect the Map Beta tab.

import sharp from "sharp";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface AtlasManifest {
	atlas: string;
	cellWidth: number;
	cellHeight: number;
	sprites: Record<
		string,
		{ x: number; y: number; width: number; height: number }
	>;
}

const HEX_H_SPACING = 199;
const HEX_V_SPACING = 132;
const HEX_RADIUS_X = HEX_H_SPACING / Math.sqrt(3);
const HEX_RADIUS_Y = HEX_V_SPACING / 1.5;
const SPRITE_SCALE_X = 1.13;
const SPRITE_SCALE_Y = 1.32;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const SOURCE_DIR = resolve(REPO_ROOT, "assets/atlas-sources");
const OUTPUT_DIR = resolve(REPO_ROOT, "static/atlases");

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

	// Extract → upscale (lanczos3) → vertical flip. The flip matches the
	// runtime's ctx.scale(1, -1) — source sprites are right-side-up, but the
	// runtime offscreen-canvas / deck.gl pipeline consumes flipped content.
	// Baking the flip lets the runtime drop the per-sprite transform.
	const upscaled = await sharp(source)
		.extract({ left: sx, top: sy, width: sw, height: sh })
		.resize(upscaledW, upscaledH, { kernel: "lanczos3" })
		.flip()
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

async function bakeAtlas(name: string): Promise<void> {
	const sourceWebp = resolve(SOURCE_DIR, `${name}.webp`);
	const sourceJson = resolve(SOURCE_DIR, `${name}.json`);
	const outputWebp = resolve(OUTPUT_DIR, `${name}.webp`);
	const outputJson = resolve(OUTPUT_DIR, `${name}.json`);

	const manifestText = await readFile(sourceJson, "utf-8");
	const manifest: AtlasManifest = JSON.parse(manifestText);
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

	await writeFile(outputJson, manifestText);
	console.log(`[${name}] wrote ${outputWebp}`);
}

async function main(): Promise<void> {
	await mkdir(OUTPUT_DIR, { recursive: true });
	await bakeAtlas("terrain");
	await bakeAtlas("height");
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
