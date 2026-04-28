// Bake improvement sprites pulled from pinacotheca's individual 3D-rendered
// PNGs into a hex-clipped per-ankh atlas keyed by save-file zType. Save files
// emit zType values (gameplay enum, e.g. IMPROVEMENT_BATHS_2) into
// tiles.improvement; pinacotheca renders each icon as
// IMPROVEMENT_3D_<zIconName>.png (e.g. IMPROVEMENT_3D_WARM_BATHS.png). The
// translation from zType to zIconName comes from improvement.xml's paired
// <zType>/<zIconName> fields. Many zTypes share one zIconName by design (e.g.
// every sun-god shrine maps to IMPROVEMENT_SHRINE_SUN), so multiple manifest
// entries can point at the same packed cell.
//
// Pinacotheca also ships a pre-baked atlas at output/atlases/improvement.* —
// that one is the 2D icon set, not the 3D renders. We deliberately consume the
// individual 3D PNGs instead. zIconNames without a 3D variant (typically small
// resource extractors pinacotheca hasn't rendered in 3D yet) are skipped with
// a log line; we don't fall back to 2D, since mixing 2D and 3D in the same
// atlas would look inconsistent.
//
// Sources:
//   ~/Projects/Old World/pinacotheca/extracted/sprites/improvements/IMPROVEMENT_3D_*.png
//   ../../Reference/XML/Infos/improvement.xml (+ Mods/*/Infos/improvement-{add,change}.xml)
// Output:
//   assets/atlas-sources/improvements.{webp,json}
//   static/atlases/improvements.{webp,json}
//
// Run: npm run bake:improvements

import sharp from "sharp";
import { readFile, writeFile, mkdir, readdir, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
// Worktree-relative paths: REPO_ROOT is .claude/worktrees/<branch>/, so
// pinacotheca is 4 up (sibling of per-ankh) and Reference is 3 up (inside
// per-ankh).
const PINACOTHECA_3D_DIR = resolve(
	REPO_ROOT,
	"../../../../pinacotheca/extracted/sprites/improvements",
);
const REFERENCE_XML_DIR = resolve(REPO_ROOT, "../../../Reference/XML");

const CELL_W = 211;
const CELL_H = 181;
const HEX_H_SPACING = 199;
const HEX_V_SPACING = 132;
const HEX_RADIUS_X = HEX_H_SPACING / Math.sqrt(3);
const HEX_RADIUS_Y = HEX_V_SPACING / 1.5;

// Scale factor applied before center-placing each 3D PNG inside the per-ankh
// hex cell. The cell rectangle (211×181) is bigger than the inscribed
// pointy-top hex, so fitting to full cell lets content reach hex corners and
// visibly spill into neighbours. 0.77 ≈ inscribed-rectangle width for asset
// aspect ~1.5.
const SAFE_SCALE = 0.77;

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
	sourcePath: string,
	hexMask: Buffer,
): Promise<Buffer> {
	const safeW = Math.round(CELL_W * SAFE_SCALE);
	const safeH = Math.round(CELL_H * SAFE_SCALE);

	const fitted = await sharp(sourcePath)
		.resize(safeW, safeH, { fit: "inside" })
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

	return sharp(centered)
		.composite([{ input: hexMask, blend: "dest-in" }])
		.png()
		.toBuffer();
}

// Parse an improvement XML file and add discovered <zType>→<zIconName> pairs
// to the given map. Existing entries are not overwritten — base
// improvement.xml wins, mod adds fill gaps.
function parseImprovementXml(xml: string, map: Map<string, string>): void {
	const entryRe = /<Entry>([\s\S]*?)<\/Entry>/g;
	let entryMatch: RegExpExecArray | null;
	while ((entryMatch = entryRe.exec(xml)) !== null) {
		const body = entryMatch[1];
		const zTypeMatch = /<zType>([^<]+)<\/zType>/.exec(body);
		const zIconMatch = /<zIconName>([^<]+)<\/zIconName>/.exec(body);
		if (zTypeMatch && zIconMatch && !map.has(zTypeMatch[1])) {
			map.set(zTypeMatch[1], zIconMatch[1]);
		}
	}
}

// Improvement <Entry>s live across several XML files: improvement.xml is the
// main catalogue, but improvement-event.xml and improvement-event-sap.xml
// define event-spawned variants (cult shrines, special tile improvements like
// LAURION_MINE, etc.) that also appear in save data. Mod directories may add
// or change entries via improvement-{add,change}.xml.
const BASE_XML_FILENAMES = [
	"improvement.xml",
	"improvement-event.xml",
	"improvement-event-sap.xml",
];
const MOD_XML_FILENAMES = [
	"improvement-add.xml",
	"improvement-change.xml",
	"improvement-event-add.xml",
	"improvement-event-change.xml",
];

async function loadModImprovementXmlPaths(modsRoot: string): Promise<string[]> {
	const entries = await readdir(modsRoot, { withFileTypes: true });
	const paths: string[] = [];
	for (const e of entries) {
		if (!e.isDirectory()) continue;
		for (const name of MOD_XML_FILENAMES) {
			const path = resolve(modsRoot, e.name, "Infos", name);
			try {
				await access(path);
				paths.push(path);
			} catch {
				// Mod doesn't define this file; skip.
			}
		}
	}
	return paths.sort();
}

async function buildZTypeMap(): Promise<Map<string, string>> {
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- one-off bake script, not Svelte runtime
	const map = new Map<string, string>();
	for (const name of BASE_XML_FILENAMES) {
		const path = resolve(REFERENCE_XML_DIR, "Infos", name);
		try {
			const xml = await readFile(path, "utf-8");
			parseImprovementXml(xml, map);
		} catch {
			console.warn(`[improvements] WARN: missing base XML ${name}`);
		}
	}
	const modPaths = await loadModImprovementXmlPaths(
		resolve(REFERENCE_XML_DIR, "Mods"),
	);
	for (const path of modPaths) {
		const xml = await readFile(path, "utf-8");
		parseImprovementXml(xml, map);
	}
	return map;
}

function threeDPathFor(zIconName: string): string {
	return resolve(PINACOTHECA_3D_DIR, `IMPROVEMENT_3D_${zIconName.replace(/^IMPROVEMENT_/, "")}.png`);
}

async function fileExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

async function main(): Promise<void> {
	const zTypeMap = await buildZTypeMap();
	console.log(
		`[improvements] loaded ${zTypeMap.size} zType→zIconName mappings from XML`,
	);

	// zIconNames without a 3D render fall back to FALLBACK_ICON so the map
	// always shows *something* on a developed tile, even if the specific
	// improvement art isn't available yet. The fallback is the generic city
	// sprite — a reasonable visual stand-in for "developed tile of unknown
	// type" since most missing renders are settlement-adjacent (FARM, MINE,
	// FORT, CITY_SITE, OUTPOST_RUINS, etc.).
	const FALLBACK_ICON = "IMPROVEMENT_CITY";
	const fallbackAvailable = await fileExists(threeDPathFor(FALLBACK_ICON));
	if (!fallbackAvailable) {
		console.warn(
			`[improvements] WARN: fallback icon ${FALLBACK_ICON} has no 3D PNG; missing zIconNames will be skipped instead`,
		);
	}

	// Group zTypes by zIconName so multiple zTypes sharing one icon point at
	// the same packed cell. zTypes whose mapped zIconName has no 3D render get
	// remapped to FALLBACK_ICON.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- one-off bake script, not Svelte runtime
	const iconToZTypes = new Map<string, string[]>();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- one-off bake script, not Svelte runtime
	const fallbackByIcon = new Map<string, string[]>();
	const skipped: { zType: string; zIconName: string }[] = [];
	for (const [zType, zIconName] of zTypeMap) {
		let resolvedIcon = zIconName;
		if (!(await fileExists(threeDPathFor(zIconName)))) {
			if (!fallbackAvailable) {
				skipped.push({ zType, zIconName });
				continue;
			}
			resolvedIcon = FALLBACK_ICON;
			const list = fallbackByIcon.get(zIconName);
			if (list) list.push(zType);
			else fallbackByIcon.set(zIconName, [zType]);
		}
		const list = iconToZTypes.get(resolvedIcon);
		if (list) list.push(zType);
		else iconToZTypes.set(resolvedIcon, [zType]);
	}

	if (fallbackByIcon.size > 0) {
		const total = Array.from(fallbackByIcon.values()).reduce(
			(n, arr) => n + arr.length,
			0,
		);
		console.log(
			`[improvements] ${total} zType(s) across ${fallbackByIcon.size} zIconName(s) have no 3D render — falling back to ${FALLBACK_ICON}:`,
		);
		for (const [icon, zTypes] of fallbackByIcon) {
			console.log(
				`  FALLBACK ${icon} (no 3D PNG) — ${zTypes.length} zType(s): ${zTypes.join(", ")}`,
			);
		}
	}

	if (skipped.length > 0) {
		console.log(
			`[improvements] ${skipped.length} zType(s) skipped (fallback unavailable):`,
		);
		for (const s of skipped) {
			console.log(`  SKIP ${s.zType} → ${s.zIconName}`);
		}
	}

	// Grid layout: a single-row atlas at this cell count would exceed
	// GL_MAX_TEXTURE_SIZE (typically 16384). Roughly square keeps both
	// dimensions well under.
	const numCells = iconToZTypes.size;
	const cols = Math.ceil(Math.sqrt(numCells));
	const rows = Math.ceil(numCells / cols);

	const hexMaskSvg = buildHexMaskSvg(CELL_W, CELL_H);
	const hexMask = Buffer.from(hexMaskSvg);

	const cells: Buffer[] = [];
	const sprites: Record<
		string,
		{ x: number; y: number; width: number; height: number }
	> = {};

	// Captured during the loop so the manifest can carry an explicit
	// fallbackSprite for runtime use — the runtime draws this cell on any
	// tile whose improvement isn't in the sprites map (e.g. zTypes from mod
	// content not vendored into Reference).
	let fallbackSprite: {
		x: number;
		y: number;
		width: number;
		height: number;
	} | null = null;

	let cellIndex = 0;
	for (const [zIconName, zTypes] of iconToZTypes) {
		const path = threeDPathFor(zIconName);
		const baked = await bakeCell(path, hexMask);
		cells.push(baked);

		const col = cellIndex % cols;
		const row = Math.floor(cellIndex / cols);
		const cell = {
			x: col * CELL_W,
			y: row * CELL_H,
			width: CELL_W,
			height: CELL_H,
		};
		for (const zType of zTypes) {
			sprites[zType] = cell;
		}
		if (zIconName === FALLBACK_ICON) {
			fallbackSprite = cell;
		}
		if (zTypes.length === 1) {
			console.log(
				`[improvements] ${zTypes[0]} → ${zIconName} (cell ${cellIndex})`,
			);
		} else {
			console.log(
				`[improvements] ${zIconName} ← ${zTypes.length} zTypes share cell ${cellIndex}: ${zTypes.join(", ")}`,
			);
		}
		cellIndex++;
	}

	if (cells.length === 0) {
		console.log("[improvements] no cells to bake");
		return;
	}

	const atlasW = cols * CELL_W;
	const atlasH = rows * CELL_H;
	const composites: sharp.OverlayOptions[] = cells.map((buf, i) => ({
		input: buf,
		left: (i % cols) * CELL_W,
		top: Math.floor(i / cols) * CELL_H,
	}));

	const atlasBuffer = await sharp({
		create: {
			width: atlasW,
			height: atlasH,
			channels: 4,
			background: { r: 0, g: 0, b: 0, alpha: 0 },
		},
	})
		.composite(composites)
		.webp({ lossless: true })
		.toBuffer();

	const manifest = {
		atlas: "improvements.webp",
		cellWidth: CELL_W,
		cellHeight: CELL_H,
		sprites,
		// Optional: present when FALLBACK_ICON is bakeable. The runtime draws
		// this cell on any tile whose `improvement` value isn't a key in
		// `sprites` — e.g. zTypes from mod content not vendored into
		// Reference/XML. Absent if no 3D render exists for FALLBACK_ICON.
		...(fallbackSprite ? { fallbackSprite } : {}),
	};
	const manifestText = JSON.stringify(manifest, null, 2) + "\n";

	const sourceDir = resolve(REPO_ROOT, "assets/atlas-sources");
	const outputDir = resolve(REPO_ROOT, "static/atlases");
	await mkdir(sourceDir, { recursive: true });
	await mkdir(outputDir, { recursive: true });

	await writeFile(resolve(sourceDir, "improvements.webp"), atlasBuffer);
	await writeFile(resolve(sourceDir, "improvements.json"), manifestText);
	await writeFile(resolve(outputDir, "improvements.webp"), atlasBuffer);
	await writeFile(resolve(outputDir, "improvements.json"), manifestText);
	console.log(
		`[improvements] wrote ${atlasW}×${atlasH} atlas (${cols}×${rows} grid, ${cells.length} cells, ${Object.keys(sprites).length} zTypes) to assets/ and static/`,
	);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
