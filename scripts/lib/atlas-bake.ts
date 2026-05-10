// Shared helpers for the per-ankh atlas bakers (bake-improvements.ts and
// bake-resources.ts). The runtime renders all map sprites at a fixed
// 211×181 hex cell with a 2px transparent gutter between cells, and feeds
// the atlas straight to deck.gl IconLayer — so all bakers funnel through
// the same packing geometry, hex mask, and manifest schema.

import sharp from "sharp";
import { createHash } from "node:crypto";
import {
	mkdir,
	readdir,
	readFile,
	rename,
	unlink,
	writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");

// Hex geometry — cell size matches the runtime SpriteMap.svelte hex spacing
// constants. Don't change one without the other.
//
// Aspect tracks the game's actual on-screen hex (per the decompiled
// GameCamera.cs / MapEditor.cs): pointy-top hex with size R = 5 world
// units (8.66 wide × 10 tall) viewed at the camera's fixed 45° pitch,
// projecting to width 8.66 × height 10·sin(45°) = 7.07 — aspect 1.225.
// Pinacotheca renders at the same 45° tilt, so its image hex matches
// per-ankh's cell hex pixel-for-pixel up to scale.
export const CELL_W = 211;
export const CELL_H = 167;
export const HEX_H_SPACING = 199;
export const HEX_V_SPACING = 122;
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
	// Hashed filename of the paired .webp. Set by writeAtlas() during the bake;
	// callers leave it unset.
	atlas?: string;
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
	opacity?: number;
}

// Build a hex-clip alpha mask as a binary-alpha PNG buffer (each pixel is
// either fully opaque or fully transparent — no antialiased gradient at the
// inscribed hex boundary). Why binary: an antialiased SVG-rasterized mask
// produces a one-pixel half-alpha row along the diagonal hex edges. When two
// adjacent baked cells are drawn next to each other on the map, both
// contribute that half-alpha pixel at the same screen position, and standard
// "over" compositing leaves ~25% of the underlying terrain visible — a dark
// seam along every diagonal hex edge. Binary alpha eliminates that: at any
// screen pixel along a shared edge, exactly one tile is fully opaque and the
// other is fully transparent (point-in-polygon test is consistent across
// tiles). The cost is single-pixel staircase aliasing on the diagonals,
// which is invisible at typical zoom and far better than a seam.
//
// Async because the raw RGBA buffer is converted to PNG via sharp; callers
// should call this once per bake and reuse the resulting buffer across
// every cell of a given size.
export async function buildHexMask(
	cellW: number,
	cellH: number,
): Promise<Buffer> {
	const cx = cellW / 2;
	const cy = cellH / 2;
	const vertices: [number, number][] = [];
	for (let i = 0; i < 6; i++) {
		const angle = (Math.PI / 3) * i - Math.PI / 2;
		vertices.push([
			cx + HEX_RADIUS_X * Math.cos(angle),
			cy + HEX_RADIUS_Y * Math.sin(angle),
		]);
	}

	// Standard ray-casting point-in-polygon test, evaluated at the center of
	// each pixel. Edge-case ties on horizontal scans are handled by the
	// strict-inequality `yi > py !== yj > py` predicate.
	const insideHex = (px: number, py: number): boolean => {
		let inside = false;
		for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
			const [xi, yi] = vertices[i];
			const [xj, yj] = vertices[j];
			const crosses =
				yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
			if (crosses) inside = !inside;
		}
		return inside;
	};

	const data = Buffer.alloc(cellW * cellH * 4);
	for (let y = 0; y < cellH; y++) {
		for (let x = 0; x < cellW; x++) {
			const idx = (y * cellW + x) * 4;
			data[idx] = 255;
			data[idx + 1] = 255;
			data[idx + 2] = 255;
			data[idx + 3] = insideHex(x + 0.5, y + 0.5) ? 255 : 0;
		}
	}
	return sharp(data, {
		raw: { width: cellW, height: cellH, channels: 4 },
	})
		.png()
		.toBuffer();
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

	const clipped = await sharp(toned)
		.composite([{ input: hexMask, blend: "dest-in" }])
		.png()
		.toBuffer();

	if (options.opacity != null && options.opacity < 1) {
		return sharp(clipped)
			.ensureAlpha()
			.linear([1, 1, 1, options.opacity], [0, 0, 0, 0])
			.png()
			.toBuffer();
	}
	return clipped;
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
	name: string; // e.g. "improvements-base"; outputs are content-hashed as ${name}.${hash}.{webp,json}
	manifest: AtlasManifest;
	composites: sharp.OverlayOptions[];
	width: number;
	height: number;
	sourceDir: string;
	outputDir: string;
}

// ─── Content hashing + sidecar manifests ────────────────────────────
//
// Atlas outputs are content-hashed: the webp/json filename embeds the first
// 8 hex chars of sha256(webpBuffer). Each bake registers its outputs in a
// JSON sidecar at .bake/<asset-class>-manifest.json. A separate finalize
// step (scripts/build-manifests.ts) reads the sidecars to emit the runtime
// TypeScript modules at src/lib/generated/{atlas,sprite}-manifest.ts and to
// reconcile orphan files. Sidecars are gitignored (.bake/); the TS modules
// they generate are committed.

export interface AtlasManifestEntry {
	webp?: string; // public URL — paired .webp for atlases, omitted for json-only assets
	json: string; // public URL — paired .json for atlases, standalone for assets like nation-asset-aliases
}
export type AtlasSidecar = Record<string, AtlasManifestEntry>;
export type SpriteSidecar = Record<string, string>; // "<category>/<basename>" → public URL

const ATLAS_SIDECAR_PATH = resolve(REPO_ROOT, ".bake/atlas-manifest.json");
const SPRITE_SIDECAR_PATH = resolve(REPO_ROOT, ".bake/sprite-manifest.json");

function contentHash(buf: Buffer): string {
	return createHash("sha256").update(buf).digest("hex").slice(0, 8);
}

async function readSidecar<T extends object>(path: string): Promise<T> {
	try {
		const text = await readFile(path, "utf-8");
		return JSON.parse(text) as T;
	} catch (err: unknown) {
		if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return {} as T;
		throw err;
	}
}

// Atomic temp-file + rename. Bakes run serially under bake:all, so atomic
// write is sufficient — no file lock needed. The temp suffix includes the
// pid so concurrent ad-hoc invocations don't collide.
async function writeSidecar(path: string, data: unknown): Promise<void> {
	const text = JSON.stringify(data, null, 2) + "\n";
	await mkdir(dirname(path), { recursive: true });
	const tmp = `${path}.tmp.${process.pid}`;
	await writeFile(tmp, text);
	await rename(tmp, path);
}

export async function readAtlasSidecar(): Promise<AtlasSidecar> {
	return readSidecar<AtlasSidecar>(ATLAS_SIDECAR_PATH);
}

export async function readSpriteSidecar(): Promise<SpriteSidecar> {
	return readSidecar<SpriteSidecar>(SPRITE_SIDECAR_PATH);
}

export async function writeSpriteSidecar(data: SpriteSidecar): Promise<void> {
	await writeSidecar(SPRITE_SIDECAR_PATH, data);
}

// Read-merge-write a single atlas-sidecar entry. Atlas bakes call this once
// per atlas (≈14 calls per bake:all), so the per-call read+write overhead
// is fine. Sprite bakes update ~360 entries; bake-sprites builds the sidecar
// in memory and writes once via writeSpriteSidecar() instead.
export async function updateAtlasSidecar(
	name: string,
	entry: AtlasManifestEntry,
): Promise<void> {
	const data = await readAtlasSidecar();
	data[name] = entry;
	await writeSidecar(ATLAS_SIDECAR_PATH, data);
}

// Remove stale hashed outputs for `name` in the given dirs. The anchored
// regex `^${name}\.[0-9a-f]{8}\.<ext>$` deliberately doesn't accept other
// hash lengths or hyphenated extensions — it only matches outputs this
// helper itself produced. Avoids cross-name collisions like "improvements"
// matching "improvements-base".
async function wipeStaleHashedFiles(
	dirs: readonly string[],
	name: string,
	exts: readonly string[],
): Promise<void> {
	const extPattern = exts.join("|");
	const pattern = new RegExp(`^${name}\\.[0-9a-f]{8}\\.(${extPattern})$`);
	for (const dir of dirs) {
		let entries: string[];
		try {
			entries = await readdir(dir);
		} catch {
			continue; // dir doesn't exist yet on a fresh checkout
		}
		await Promise.all(
			entries
				.filter((e) => pattern.test(e))
				.map((e) => unlink(resolve(dir, e))),
		);
	}
}

// Writes the atlas WebP + manifest JSON to BOTH source dir (versioned with
// the repo so the bake is reproducible without re-running pinacotheca) and
// output dir (served at runtime). Both copies are byte-identical and content-
// hashed. Stale outputs for the same logical name are pruned before writing
// so the dir never accumulates old hashes.
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

	const hash = contentHash(buffer);
	const webpFilename = `${out.name}.${hash}.webp`;
	const jsonFilename = `${out.name}.${hash}.json`;

	// Single owner of the hashed filename in the manifest's self-reference
	// field — callers can leave manifest.atlas unset.
	out.manifest.atlas = webpFilename;
	const manifestText = JSON.stringify(out.manifest, null, 2) + "\n";

	await wipeStaleHashedFiles(
		[out.sourceDir, out.outputDir],
		out.name,
		["webp", "json"],
	);

	await writeFile(resolve(out.sourceDir, webpFilename), buffer);
	await writeFile(resolve(out.sourceDir, jsonFilename), manifestText);
	await writeFile(resolve(out.outputDir, webpFilename), buffer);
	await writeFile(resolve(out.outputDir, jsonFilename), manifestText);

	await updateAtlasSidecar(out.name, {
		webp: `/atlases/${webpFilename}`,
		json: `/atlases/${jsonFilename}`,
	});
}

// Hashed write for standalone JSON assets that live alongside atlases but
// aren't atlases themselves (e.g. nation-asset-aliases.json). Same dual-dir,
// same hash-and-rename, registered in the same sidecar with `webp` omitted.
export async function writeJsonAsset(
	name: string,
	payload: unknown,
	sourceDir: string,
	outputDir: string,
): Promise<void> {
	const text = JSON.stringify(payload, null, 2) + "\n";
	const buffer = Buffer.from(text, "utf-8");
	const hash = contentHash(buffer);
	const filename = `${name}.${hash}.json`;

	await wipeStaleHashedFiles([sourceDir, outputDir], name, ["json"]);

	await writeFile(resolve(sourceDir, filename), buffer);
	await writeFile(resolve(outputDir, filename), buffer);

	await updateAtlasSidecar(name, { json: `/atlases/${filename}` });
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
