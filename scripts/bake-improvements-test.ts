// Bake improvement sprites pulled from pinacotheca's 3D-rendered output into a
// hex-clipped atlas. Tiered improvements (Library tier 1/2/3, Market tier 1/2/3,
// etc.) each reference a distinct asset name in improvement.xml's zIconName
// field — captured here as TIER_FAMILIES. When a preferred asset PNG isn't
// available yet (pinacotheca hasn't extracted it), fall back tier-down: tier 3
// → tier 2 → tier 1 → skip. As pinacotheca fills missing assets, this script
// auto-picks them up via existence checks — no config change needed.
//
// Source: ~/Projects/Old World/pinacotheca/extracted/sprites/improvements/IMPROVEMENT_3D_*.png
// Reference: ~/Projects/Old World/pinacotheca/reference/XML/Infos/improvement.xml
//            (zType + zIconName fields drive the TIER_FAMILIES table below)
// Output: assets/atlas-sources/improvements-test.{webp,json}
//         static/atlases/improvements-test.{webp,json}
//
// Run: npx tsx scripts/bake-improvements-test.ts

import sharp from "sharp";
import { writeFile, mkdir, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const PINACOTHECA_DIR = resolve(
	REPO_ROOT,
	"../../../../pinacotheca/extracted/sprites/improvements",
);

const CELL_W = 211;
const CELL_H = 181;
const HEX_H_SPACING = 199;
const HEX_V_SPACING = 132;
const HEX_RADIUS_X = HEX_H_SPACING / Math.sqrt(3);
const HEX_RADIUS_Y = HEX_V_SPACING / 1.5;

// Scale factor applied before center-placing the asset inside the cell. The
// cell rectangle (211×181) is bigger than the inscribed pointy-top hex, so
// fitting to full cell lets content reach hex corners and visibly spill into
// neighbours. 0.77 ≈ inscribed-rectangle width for asset aspect ~1.5.
const SAFE_SCALE = 0.77;

interface ImprovementCrop {
	left: number;
	top: number;
	width: number;
	height: number;
}

// Tier families derived from improvement.xml. Each tier's `assetName` is the
// `zIconName` value, which corresponds to pinacotheca's `IMPROVEMENT_3D_<name>.png`
// extraction filename.
interface TierFamily {
	family: string;
	tiers: { dbType: string; assetName: string }[];
}

const TIER_FAMILIES: TierFamily[] = [
	{
		family: "LIBRARY",
		tiers: [
			{ dbType: "IMPROVEMENT_LIBRARY_1", assetName: "LIBRARY" },
			{ dbType: "IMPROVEMENT_LIBRARY_2", assetName: "ACADEMY" },
			{ dbType: "IMPROVEMENT_LIBRARY_3", assetName: "UNIVERSITY" },
		],
	},
	{
		family: "MARKET",
		tiers: [
			{ dbType: "IMPROVEMENT_MARKET_1", assetName: "MARKET" },
			{ dbType: "IMPROVEMENT_MARKET_2", assetName: "GROCER" },
			{ dbType: "IMPROVEMENT_MARKET_3", assetName: "FAIR" },
		],
	},
	{
		family: "COURTHOUSE",
		tiers: [
			{ dbType: "IMPROVEMENT_COURTHOUSE_1", assetName: "COURTHOUSE" },
			{ dbType: "IMPROVEMENT_COURTHOUSE_2", assetName: "MINISTRIES" },
			{ dbType: "IMPROVEMENT_COURTHOUSE_3", assetName: "PALACE" },
		],
	},
	{
		family: "THEATER",
		tiers: [
			{ dbType: "IMPROVEMENT_THEATER_1", assetName: "ODEON" },
			{ dbType: "IMPROVEMENT_THEATER_2", assetName: "THEATER" },
			{ dbType: "IMPROVEMENT_THEATER_3", assetName: "AMPHITHEATER" },
		],
	},
	{
		family: "BATHS",
		tiers: [
			{ dbType: "IMPROVEMENT_BATHS_1", assetName: "COLD_BATHS" },
			{ dbType: "IMPROVEMENT_BATHS_2", assetName: "WARM_BATHS" },
			{ dbType: "IMPROVEMENT_BATHS_3", assetName: "HEATED_BATHS" },
		],
	},
	{
		family: "GARRISON",
		// XML zIconName is GARRISON_1/2/3 but the in-game display names are
		// Garrison / Stronghold / Citadel — pinacotheca's 3D export uses the
		// display names, not the zIconName.
		tiers: [
			{ dbType: "IMPROVEMENT_GARRISON_1", assetName: "GARRISON" },
			{ dbType: "IMPROVEMENT_GARRISON_2", assetName: "STRONGHOLD" },
			{ dbType: "IMPROVEMENT_GARRISON_3", assetName: "CITADEL" },
		],
	},
	{
		family: "SETTLEMENT",
		tiers: [
			{ dbType: "IMPROVEMENT_SETTLEMENT_1", assetName: "SETTLEMENT_1" },
			{ dbType: "IMPROVEMENT_SETTLEMENT_2", assetName: "SETTLEMENT_2" },
			{ dbType: "IMPROVEMENT_SETTLEMENT_3", assetName: "SETTLEMENT_3" },
			{ dbType: "IMPROVEMENT_SETTLEMENT_4", assetName: "SETTLEMENT_4" },
		],
	},
	{
		family: "RUINS",
		tiers: [
			{ dbType: "IMPROVEMENT_RUINS_1", assetName: "HOVEL_RUINS" },
			{ dbType: "IMPROVEMENT_RUINS_2", assetName: "OUTPOST_RUINS" },
			{ dbType: "IMPROVEMENT_RUINS_3", assetName: "ENCAMPMENT_RUINS" },
			{ dbType: "IMPROVEMENT_RUINS_4", assetName: "BASTION_RUINS" },
		],
	},
];

// Single-tier improvements (no _N suffix in DB).
interface SingleImprovement {
	dbType: string;
	assetName: string;
	aliases?: string[];
	crop?: ImprovementCrop;
}

const SINGLE_IMPROVEMENTS: SingleImprovement[] = [
	{ dbType: "IMPROVEMENT_GRANARY", assetName: "GRANARY" },
	{ dbType: "IMPROVEMENT_WATERMILL", assetName: "WATERMILL" },
	{ dbType: "IMPROVEMENT_BARRACKS", assetName: "BARRACKS" },
	{
		// Pinacotheca filename is singular; DB name is plural. Both keys point
		// to the same cell.
		dbType: "IMPROVEMENT_HANGING_GARDENS",
		assetName: "HANGING_GARDEN",
		aliases: ["IMPROVEMENT_HANGING_GARDEN"],
	},
];

function assetPathForName(name: string): string {
	return resolve(PINACOTHECA_DIR, `IMPROVEMENT_3D_${name}.png`);
}

async function fileExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

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
	crop?: ImprovementCrop,
): Promise<Buffer> {
	let pipeline = sharp(sourcePath);
	if (crop) {
		pipeline = pipeline.extract(crop);
	}

	const safeW = Math.round(CELL_W * SAFE_SCALE);
	const safeH = Math.round(CELL_H * SAFE_SCALE);
	const fitted = await pipeline
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

interface Resolution {
	dbType: string;
	preferredAsset: string;
	resolvedAsset: string | null;
	fallback: boolean;
}

async function resolveTierFamily(family: TierFamily): Promise<Resolution[]> {
	// For each tier, walk down (current → tier 1) to find the highest-available
	// asset. First existing asset wins.
	const results: Resolution[] = [];
	for (let i = 0; i < family.tiers.length; i++) {
		const tier = family.tiers[i];
		let resolvedAsset: string | null = null;
		for (let j = i; j >= 0; j--) {
			const candidate = family.tiers[j].assetName;
			if (await fileExists(assetPathForName(candidate))) {
				resolvedAsset = candidate;
				break;
			}
		}
		results.push({
			dbType: tier.dbType,
			preferredAsset: tier.assetName,
			resolvedAsset,
			fallback: resolvedAsset !== null && resolvedAsset !== tier.assetName,
		});
	}
	return results;
}

async function main(): Promise<void> {
	const hexMaskSvg = buildHexMaskSvg(CELL_W, CELL_H);
	const hexMask = Buffer.from(hexMaskSvg);

	// Build full resolution table: every DB type → resolvedAssetName (or null).
	const resolutions: Resolution[] = [];

	for (const family of TIER_FAMILIES) {
		resolutions.push(...(await resolveTierFamily(family)));
	}

	for (const single of SINGLE_IMPROVEMENTS) {
		const exists = await fileExists(assetPathForName(single.assetName));
		const resolved = exists ? single.assetName : null;
		resolutions.push({
			dbType: single.dbType,
			preferredAsset: single.assetName,
			resolvedAsset: resolved,
			fallback: false,
		});
		if (single.aliases) {
			for (const alias of single.aliases) {
				resolutions.push({
					dbType: alias,
					preferredAsset: single.assetName,
					resolvedAsset: resolved,
					fallback: false,
				});
			}
		}
	}

	console.log("[improvements] resolution table:");
	for (const r of resolutions) {
		if (r.resolvedAsset === null) {
			console.log(
				`  ${r.dbType}: SKIP (no asset for "${r.preferredAsset}", no fallback)`,
			);
		} else if (r.fallback) {
			console.log(
				`  ${r.dbType}: → ${r.resolvedAsset} (fallback from "${r.preferredAsset}")`,
			);
		} else {
			console.log(`  ${r.dbType}: → ${r.resolvedAsset}`);
		}
	}

	// Group DB types by their resolved asset so multiple types share one cell.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- one-off bake script, not Svelte runtime
	const assetToDbTypes = new Map<string, string[]>();
	for (const r of resolutions) {
		if (!r.resolvedAsset) continue;
		const list = assetToDbTypes.get(r.resolvedAsset);
		if (list) list.push(r.dbType);
		else assetToDbTypes.set(r.resolvedAsset, [r.dbType]);
	}

	// Single-improvement crop overrides indexed by asset name (Granary used to
	// have a crop; left as a hook for future per-asset crop config).
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- one-off bake script, not Svelte runtime
	const cropForAsset = new Map<string, ImprovementCrop | undefined>();
	for (const single of SINGLE_IMPROVEMENTS) {
		if (single.crop) cropForAsset.set(single.assetName, single.crop);
	}

	const cells: Buffer[] = [];
	const sprites: Record<
		string,
		{ x: number; y: number; width: number; height: number }
	> = {};

	let cellIndex = 0;
	for (const [assetName, dbTypes] of assetToDbTypes) {
		const sourcePath = assetPathForName(assetName);
		const crop = cropForAsset.get(assetName);
		console.log(
			`[improvements] baking ${assetName} → ${dbTypes.join(", ")}`,
		);
		const baked = await bakeCell(sourcePath, hexMask, crop);
		cells.push(baked);
		const cell = {
			x: cellIndex * CELL_W,
			y: 0,
			width: CELL_W,
			height: CELL_H,
		};
		for (const dbType of dbTypes) {
			sprites[dbType] = cell;
		}
		cellIndex++;
	}

	if (cells.length === 0) {
		console.log("[improvements] no assets resolved — nothing to bake");
		return;
	}

	const atlasW = CELL_W * cells.length;
	const atlasH = CELL_H;
	const composites: sharp.OverlayOptions[] = cells.map((buf, i) => ({
		input: buf,
		left: i * CELL_W,
		top: 0,
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
		atlas: "improvements-test.webp",
		cellWidth: CELL_W,
		cellHeight: CELL_H,
		sprites,
	};
	const manifestText = JSON.stringify(manifest, null, 2) + "\n";

	const sourceDir = resolve(REPO_ROOT, "assets/atlas-sources");
	const outputDir = resolve(REPO_ROOT, "static/atlases");
	await mkdir(sourceDir, { recursive: true });
	await mkdir(outputDir, { recursive: true });

	await writeFile(resolve(sourceDir, "improvements-test.webp"), atlasBuffer);
	await writeFile(resolve(sourceDir, "improvements-test.json"), manifestText);
	await writeFile(resolve(outputDir, "improvements-test.webp"), atlasBuffer);
	await writeFile(resolve(outputDir, "improvements-test.json"), manifestText);
	console.log(
		`[improvements] wrote ${atlasW}×${atlasH} atlas with ${cells.length} cells (${Object.keys(sprites).length} DB types) to assets/ and static/`,
	);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
