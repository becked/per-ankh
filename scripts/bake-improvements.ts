// Bake improvement sprites pulled from pinacotheca's individual 3D-rendered
// PNGs into per-ankh atlases keyed by save-file zType.
//
// OUTPUTS (all in static/atlases/ + assets/atlas-sources/):
//   improvements-base.{webp,json}        — non-urban-buildable improvements
//                                          (rural, ruins, settlements, wonders),
//                                          plus URBAN_<FAMILY> backgrounds and
//                                          CAPITAL_<FAMILY> per-nation cities.
//   improvements-urban-<FAMILY>.{webp,json} × 10 (one per urban-asset family) —
//                                          per-(improvement, family) urban
//                                          composites pre-baked by pinacotheca.
//   nation-asset-aliases.json            — derived from nation.xml. Maps every
//                                          NATION_* zType to its urban + capital
//                                          family suffix (e.g. NATION_KUSH →
//                                          urban=EGYPT, capital=EGYPT). Source of
//                                          truth at runtime for atlas selection.
//
// SOURCES:
//   ~/Projects/Old World/pinacotheca/extracted/sprites/improvements/
//     IMPROVEMENT_3D_<ICON>.png                     — single render
//     IMPROVEMENT_3D_<FAMILY>_URBAN.png             — empty urban tile
//     IMPROVEMENT_3D_<FAMILY>_CAPITAL.png           — capital city
//     IMPROVEMENT_3D_<ICON>_<FAMILY>_URBAN.png      — composite (urban tile + improvement)
//   ../../Reference/XML/Infos/improvement.xml + improvement-event*.xml + Mods/*/Infos/...
//   ../../Reference/XML/Infos/nation.xml + Mods/*/Infos/nation-{add,change}.xml
//
// Runtime (src/lib/SpriteMap.svelte):
//   1. Loads nation-asset-aliases.json + improvements-base + only the per-family
//      atlases for nations actually present on the loaded map (lazy by family).
//   2. For a tile with owner_nation N and improvement I:
//        family = aliases[N].urban
//        if improvements-urban-<family>.sprites[I] exists → draw composite
//        else                                              → fall back to base
//   3. Capital tiles draw CAPITAL_<aliases[N].capital> from improvements-base
//      directly — pinacotheca's capital renders include their own ground patch,
//      so no URBAN underlay is needed.
//
// The alias map is derived from XML rather than hardcoded so DLC-added nations
// (KEMET, SPARTA, PTOLEMY, etc.) propagate automatically on the next bake.
//
// Run: npm run bake:improvements

import sharp from "sharp";
import {
	readFile,
	writeFile,
	mkdir,
	readdir,
	access,
	rm,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	CELL_W,
	CELL_H,
	FULL_SCALE,
	type AtlasManifest,
	type SpriteRect,
	type BakeCellOptions,
	bakeCell,
	buildHexMask,
	placeCellGrid,
	readPinacothecaVersion,
	writeAtlas,
} from "./lib/atlas-bake.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
// Two layouts in active use: the per-ankh worktree under
// .claude/worktrees/<branch>/ and the main repo at <Old World>/per-ankh/.
// Probe both; first one that exists wins.
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
	"extracted/sprites/improvements",
);
const PINACOTHECA_PYPROJECT = resolve(PINACOTHECA_ROOT, "pyproject.toml");
const REFERENCE_XML_DIR = (() => {
	const candidates = [
		resolve(REPO_ROOT, "../../../Reference/XML"),
		resolve(REPO_ROOT, "Reference/XML"),
	];
	const found = candidates.find((p) => existsSync(p));
	if (!found) {
		throw new Error(
			`could not locate Reference/XML; tried:\n  ${candidates.join("\n  ")}`,
		);
	}
	return found;
})();

const SOURCE_DIR = resolve(REPO_ROOT, "assets/atlas-sources");
const OUTPUT_DIR = resolve(REPO_ROOT, "static/atlases");

// Brightness lift applied to single improvements + capital standalones so the
// focal building reads clearly. Composites are NOT tweaked — pinacotheca
// already balances the lighting in its per-(improvement, nation) renders.
const IMPROVEMENT_BRIGHTEN_TWEAK = { brightness: 1.5 };

// Filenames removed from both static/atlases/ and assets/atlas-sources/ at
// the start of every bake. Catches the prior single-atlas layout
// (improvements.webp/json) so it doesn't ship alongside the new split atlases.
const STALE_OUTPUTS = ["improvements.webp", "improvements.json"];

interface NationAliasEntry {
	urban: string;
	capital: string;
}

// Parse <Entry> blocks from any of the improvement XML files and merge their
// <zType>→<zIconName> pairs into the given map. First definition wins so
// improvement.xml's base entries are never clobbered by mod overrides that
// only adjust gameplay fields.
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
const BASE_IMPROVEMENT_XMLS = [
	"improvement.xml",
	"improvement-event.xml",
	"improvement-event-sap.xml",
];
const MOD_IMPROVEMENT_XMLS = [
	"improvement-add.xml",
	"improvement-change.xml",
	"improvement-event-add.xml",
	"improvement-event-change.xml",
];

const BASE_NATION_XML = "nation.xml";
const MOD_NATION_XMLS = ["nation-add.xml", "nation-change.xml"];

async function listModXmls(
	modsRoot: string,
	filenames: readonly string[],
): Promise<string[]> {
	const entries = await readdir(modsRoot, { withFileTypes: true });
	const paths: string[] = [];
	for (const e of entries) {
		if (!e.isDirectory()) continue;
		for (const name of filenames) {
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
	const map = new Map<string, string>();
	for (const name of BASE_IMPROVEMENT_XMLS) {
		const path = resolve(REFERENCE_XML_DIR, "Infos", name);
		try {
			const xml = await readFile(path, "utf-8");
			parseImprovementXml(xml, map);
		} catch {
			console.warn(`[improvements] WARN: missing base XML ${name}`);
		}
	}
	const modPaths = await listModXmls(
		resolve(REFERENCE_XML_DIR, "Mods"),
		MOD_IMPROVEMENT_XMLS,
	);
	for (const path of modPaths) {
		const xml = await readFile(path, "utf-8");
		parseImprovementXml(xml, map);
	}
	return map;
}

// `ASSET_VARIATION_<FAMILY>_URBAN` → `<FAMILY>`. Returns null for anything that
// doesn't match the expected shape (e.g. mod scenarios that point at custom
// asset variations we haven't audited).
function extractUrbanFamily(asset: string): string | null {
	const m = /^ASSET_VARIATION_(.+)_URBAN$/.exec(asset);
	return m ? m[1] : null;
}

// `ASSET_VARIATION_CITY_<FAMILY>_CAPITAL` → `<FAMILY>`. Capital asset tags
// always carry the `CITY_` infix, distinguishing them from urban tags.
function extractCapitalFamily(asset: string): string | null {
	const m = /^ASSET_VARIATION_CITY_(.+)_CAPITAL$/.exec(asset);
	return m ? m[1] : null;
}

// Parse <UrbanAsset>/<CapitalAsset> from a nation.xml-style file and merge the
// resolved family aliases into `map`. Last definition wins so DLC nation-add
// entries override the base; nation-change entries that only tweak gameplay
// fields without touching asset tags don't disturb the alias resolution.
function parseNationXml(
	xml: string,
	map: Map<string, NationAliasEntry>,
): void {
	const entryRe = /<Entry>([\s\S]*?)<\/Entry>/g;
	let entryMatch: RegExpExecArray | null;
	while ((entryMatch = entryRe.exec(xml)) !== null) {
		const body = entryMatch[1];
		const zType = /<zType>([^<]+)<\/zType>/.exec(body)?.[1];
		const urbanAsset = /<UrbanAsset>([^<]+)<\/UrbanAsset>/.exec(body)?.[1];
		const capitalAsset = /<CapitalAsset>([^<]+)<\/CapitalAsset>/.exec(body)?.[1];
		if (!zType) continue;
		const urban = urbanAsset ? extractUrbanFamily(urbanAsset) : null;
		const capital = capitalAsset
			? extractCapitalFamily(capitalAsset)
			: null;
		// nation-change.xml entries often omit asset fields entirely (only
		// adjust gameplay traits). Don't replace an existing alias with nulls.
		const existing = map.get(zType);
		map.set(zType, {
			urban: urban ?? existing?.urban ?? "",
			capital: capital ?? existing?.capital ?? "",
		});
	}
}

async function buildNationAliases(): Promise<Map<string, NationAliasEntry>> {
	const map = new Map<string, NationAliasEntry>();
	const basePath = resolve(REFERENCE_XML_DIR, "Infos", BASE_NATION_XML);
	try {
		const xml = await readFile(basePath, "utf-8");
		parseNationXml(xml, map);
	} catch {
		console.warn(`[improvements] WARN: missing ${BASE_NATION_XML}`);
	}
	const modPaths = await listModXmls(
		resolve(REFERENCE_XML_DIR, "Mods"),
		MOD_NATION_XMLS,
	);
	for (const path of modPaths) {
		const xml = await readFile(path, "utf-8");
		parseNationXml(xml, map);
	}
	// Drop any entry that ended up without both fields (shouldn't happen, but
	// keeps the JSON output strict). Nations missing UrbanAsset would otherwise
	// surface as runtime lookup failures.
	for (const [nation, entry] of map) {
		if (!entry.urban || !entry.capital) {
			console.warn(
				`[improvements] WARN: ${nation} alias incomplete (urban=${entry.urban || "-"}, capital=${entry.capital || "-"}); dropping`,
			);
			map.delete(nation);
		}
	}
	return map;
}

interface PngClassification {
	composites: Map<string, Map<string, string>>; // family -> zIconName -> path
	standaloneUrban: Map<string, string>; // family -> path
	standaloneCapital: Map<string, string>; // family -> path
	singles: Map<string, string>; // zIconName -> path
}

// Walk pinacotheca's improvements directory and bucket each PNG by filename
// shape. The urban-family set (extracted from nation aliases) is the
// authoritative disambiguator: anything ending `_<FAMILY>_URBAN` with FAMILY
// in that set is a composite; `_<FAMILY>_URBAN` (single field) with FAMILY in
// the set is a standalone urban tile; anything else is a single render.
async function classifyPinacothecaPngs(
	urbanFamilies: Set<string>,
	capitalFamilies: Set<string>,
): Promise<PngClassification> {
	const dirEntries = await readdir(PINACOTHECA_3D_DIR);
	const composites = new Map<string, Map<string, string>>();
	const standaloneUrban = new Map<string, string>();
	const standaloneCapital = new Map<string, string>();
	const singles = new Map<string, string>();

	for (const filename of dirEntries) {
		if (!filename.startsWith("IMPROVEMENT_3D_") || !filename.endsWith(".png")) {
			continue;
		}
		const stem = filename.slice(0, -".png".length);
		const path = resolve(PINACOTHECA_3D_DIR, filename);

		const urbanMatch = /^IMPROVEMENT_3D_(.+)_URBAN$/.exec(stem);
		if (urbanMatch) {
			const middle = urbanMatch[1];
			const tokens = middle.split("_");
			const last = tokens[tokens.length - 1];
			if (tokens.length === 1 && urbanFamilies.has(last)) {
				standaloneUrban.set(last, path);
				continue;
			}
			if (tokens.length >= 2 && urbanFamilies.has(last)) {
				const namePart = tokens.slice(0, -1).join("_");
				const zIconName = `IMPROVEMENT_${namePart}`;
				let familyMap = composites.get(last);
				if (!familyMap) {
					familyMap = new Map<string, string>();
					composites.set(last, familyMap);
				}
				familyMap.set(zIconName, path);
				continue;
			}
			// _URBAN with an unrecognised family suffix — fall through to single.
			// Lets us still surface mod content with non-standard naming rather
			// than silently dropping it.
		}

		const capitalMatch = /^IMPROVEMENT_3D_(.+)_CAPITAL$/.exec(stem);
		if (capitalMatch && capitalFamilies.has(capitalMatch[1])) {
			standaloneCapital.set(capitalMatch[1], path);
			continue;
		}

		// Plain single render. Filenames carry the `_3D_` infix as a render-set
		// marker; the manifest key (zIconName, matching XML) drops it. Same
		// transform composites already apply.
		const zIconName = stem.replace(/^IMPROVEMENT_3D_/, "IMPROVEMENT_");
		singles.set(zIconName, path);
	}

	return { composites, standaloneUrban, standaloneCapital, singles };
}

async function removeStaleOutputs(): Promise<void> {
	for (const dir of [SOURCE_DIR, OUTPUT_DIR]) {
		for (const name of STALE_OUTPUTS) {
			const path = resolve(dir, name);
			try {
				await rm(path, { force: true });
			} catch {
				// Already gone.
			}
		}
	}
}

interface BakeContext {
	hexMask: Buffer;
	bakedAt: string;
	pinacothecaVersion: string;
}

async function bakeBaseAtlas(
	ctx: BakeContext,
	zTypeMap: Map<string, string>,
	classification: PngClassification,
	keptIcons: Set<string>,
): Promise<void> {
	// Group zTypes by zIconName so multiple zTypes sharing one icon point at
	// the same packed cell. zTypes whose mapped zIconName has no kept render
	// (it has composites instead, OR it's missing entirely) get remapped to
	// the fallback icon if available.
	const FALLBACK_ICON = "IMPROVEMENT_CITY";
	const fallbackKept = keptIcons.has(FALLBACK_ICON);

	const iconToZTypes = new Map<string, string[]>();
	const fallbackByIcon = new Map<string, string[]>();
	const skipped: { zType: string; zIconName: string }[] = [];
	for (const [zType, zIconName] of zTypeMap) {
		// zIconName has a kept single render: zType maps to that single's cell.
		if (keptIcons.has(zIconName)) {
			const list = iconToZTypes.get(zIconName);
			if (list) list.push(zType);
			else iconToZTypes.set(zIconName, [zType]);
			continue;
		}
		// zIconName has composites instead: per-family atlases own this zType,
		// nothing to do at the base layer. Don't fall back to FALLBACK_ICON
		// here — the runtime composite-then-base layering already handles miss
		// cases via the (always-present) fallbackSprite.
		const hasComposite = Array.from(classification.composites.values()).some(
			(familyMap) => familyMap.has(zIconName),
		);
		if (hasComposite) continue;
		// Truly missing: route to fallback.
		if (fallbackKept) {
			const list = fallbackByIcon.get(zIconName);
			if (list) list.push(zType);
			else fallbackByIcon.set(zIconName, [zType]);
			const flist = iconToZTypes.get(FALLBACK_ICON);
			if (flist) flist.push(zType);
			else iconToZTypes.set(FALLBACK_ICON, [zType]);
		} else {
			skipped.push({ zType, zIconName });
		}
	}

	if (fallbackByIcon.size > 0) {
		const total = Array.from(fallbackByIcon.values()).reduce(
			(n, arr) => n + arr.length,
			0,
		);
		console.log(
			`[improvements-base] ${total} zType(s) across ${fallbackByIcon.size} zIconName(s) missing 3D render — falling back to ${FALLBACK_ICON}:`,
		);
		for (const [icon, zTypes] of fallbackByIcon) {
			console.log(
				`  FALLBACK ${icon} (no 3D PNG) — ${zTypes.length} zType(s): ${zTypes.join(", ")}`,
			);
		}
	}
	if (skipped.length > 0) {
		console.log(
			`[improvements-base] ${skipped.length} zType(s) skipped (no fallback):`,
		);
		for (const s of skipped) {
			console.log(`  SKIP ${s.zType} → ${s.zIconName}`);
		}
	}

	// Compose the cell list: kept singles, then per-family URBAN/CAPITAL
	// standalones. Order is purposeful for predictable manifest layout —
	// singles alphabetical, then URBAN_<family> alphabetical, then
	// CAPITAL_<family> alphabetical. All sprites are CELL_W×CELL_H —
	// pinacotheca's hex-prism clip already constrains content to a hex
	// shape, so cover-fit + hex-clip lands the rendered scene cleanly
	// inside the cell with no anchor offset or spire overflow.
	type Cell = {
		key: string;
		path: string;
		options: BakeCellOptions;
		zTypes: string[];
	};
	const cells: Cell[] = [];

	const sortedIcons = Array.from(iconToZTypes.keys()).sort();
	for (const zIconName of sortedIcons) {
		const path = classification.singles.get(zIconName);
		if (!path) {
			console.warn(
				`[improvements-base] WARN: no PNG for ${zIconName}, skipping`,
			);
			continue;
		}
		cells.push({
			key: zIconName,
			path,
			options: { tweak: IMPROVEMENT_BRIGHTEN_TWEAK },
			zTypes: iconToZTypes.get(zIconName) ?? [],
		});
	}
	for (const family of Array.from(classification.standaloneUrban.keys()).sort()) {
		cells.push({
			key: `URBAN_${family}`,
			path: classification.standaloneUrban.get(family)!,
			options: { scale: FULL_SCALE, fit: "cover" },
			zTypes: [],
		});
	}
	for (const family of Array.from(
		classification.standaloneCapital.keys(),
	).sort()) {
		cells.push({
			key: `CAPITAL_${family}`,
			path: classification.standaloneCapital.get(family)!,
			options: { scale: FULL_SCALE, fit: "cover" },
			zTypes: [],
		});
	}

	const grid = placeCellGrid(cells.length);
	const sprites: Record<string, SpriteRect> = {};
	let fallbackSprite: SpriteRect | undefined;
	const composites: sharp.OverlayOptions[] = [];

	for (let i = 0; i < cells.length; i++) {
		const cell = cells[i];
		const rect = grid.cellAt(i);
		const baked = await bakeCell(cell.path, ctx.hexMask, cell.options);
		composites.push({ input: baked, left: rect.x, top: rect.y });

		if (cell.zTypes.length > 0) {
			for (const zType of cell.zTypes) sprites[zType] = rect;
			if (cell.key === "IMPROVEMENT_CITY") fallbackSprite = rect;
			console.log(
				`[improvements-base] ${cell.key} → cell ${i} (${cell.zTypes.length} zType${cell.zTypes.length === 1 ? "" : "s"})`,
			);
		} else {
			sprites[cell.key] = rect;
			console.log(`[improvements-base] ${cell.key} → cell ${i}`);
		}
	}

	const manifest: AtlasManifest = {
		atlas: "improvements-base.webp",
		cellWidth: CELL_W,
		cellHeight: CELL_H,
		bakedAt: ctx.bakedAt,
		pinacothecaVersion: ctx.pinacothecaVersion,
		sprites,
		...(fallbackSprite ? { fallbackSprite } : {}),
	};

	await writeAtlas({
		name: "improvements-base",
		manifest,
		composites,
		width: grid.atlasWidth,
		height: grid.atlasHeight,
		sourceDir: SOURCE_DIR,
		outputDir: OUTPUT_DIR,
	});
	console.log(
		`[improvements-base] wrote ${grid.atlasWidth}×${grid.atlasHeight} (${cells.length} cells)`,
	);
}

async function bakeFamilyAtlas(
	ctx: BakeContext,
	family: string,
	familyMap: Map<string, string>,
	zTypeMap: Map<string, string>,
): Promise<void> {
	// One cell per zIconName in this family; multiple zTypes resolving
	// to the same zIconName share the cell. Per-(improvement, family)
	// composites are layered renders (biome + PVT + buildings); cover-
	// fit + hex-clip lands them inside the cell. No tweak — pinacotheca
	// already balances composite lighting.
	const iconToZTypes = new Map<string, string[]>();
	for (const [zType, zIconName] of zTypeMap) {
		if (!familyMap.has(zIconName)) continue;
		const list = iconToZTypes.get(zIconName);
		if (list) list.push(zType);
		else iconToZTypes.set(zIconName, [zType]);
	}

	const sortedIcons = Array.from(iconToZTypes.keys()).sort();
	const grid = placeCellGrid(sortedIcons.length);
	const sprites: Record<string, SpriteRect> = {};
	const composites: sharp.OverlayOptions[] = [];

	for (let i = 0; i < sortedIcons.length; i++) {
		const zIconName = sortedIcons[i];
		const path = familyMap.get(zIconName)!;
		const rect = grid.cellAt(i);
		const baked = await bakeCell(path, ctx.hexMask, {
			scale: FULL_SCALE,
			fit: "cover",
		});
		composites.push({ input: baked, left: rect.x, top: rect.y });
		const zTypes = iconToZTypes.get(zIconName) ?? [];
		for (const zType of zTypes) sprites[zType] = rect;
	}

	const name = `improvements-urban-${family}`;
	const manifest: AtlasManifest = {
		atlas: `${name}.webp`,
		cellWidth: CELL_W,
		cellHeight: CELL_H,
		bakedAt: ctx.bakedAt,
		pinacothecaVersion: ctx.pinacothecaVersion,
		sprites,
	};
	await writeAtlas({
		name,
		manifest,
		composites,
		width: grid.atlasWidth,
		height: grid.atlasHeight,
		sourceDir: SOURCE_DIR,
		outputDir: OUTPUT_DIR,
	});
	console.log(
		`[${name}] wrote ${grid.atlasWidth}×${grid.atlasHeight} (${sortedIcons.length} cells, ${Object.keys(sprites).length} zTypes)`,
	);
}

async function writeNationAliases(
	aliases: Map<string, NationAliasEntry>,
	bakedAt: string,
): Promise<void> {
	const sortedNations = Array.from(aliases.keys()).sort();
	const obj: Record<string, NationAliasEntry> = {};
	for (const nation of sortedNations) {
		obj[nation] = aliases.get(nation)!;
	}
	const payload = {
		bakedAt,
		// Each entry is { urban: <family>, capital: <family> }, both required.
		// Runtime treats this as the single source of truth for resolving
		// owner_nation → which atlas / which sprite key.
		aliases: obj,
	};
	const text = JSON.stringify(payload, null, 2) + "\n";
	await writeFile(resolve(SOURCE_DIR, "nation-asset-aliases.json"), text);
	await writeFile(resolve(OUTPUT_DIR, "nation-asset-aliases.json"), text);
	console.log(
		`[nation-aliases] wrote ${sortedNations.length} nation aliases`,
	);
}

async function main(): Promise<void> {
	await mkdir(SOURCE_DIR, { recursive: true });
	await mkdir(OUTPUT_DIR, { recursive: true });
	await removeStaleOutputs();

	const pinacothecaVersion = await readPinacothecaVersion(PINACOTHECA_PYPROJECT);
	const bakedAt = new Date().toISOString();
	const ctx: BakeContext = {
		hexMask: await buildHexMask(CELL_W, CELL_H),
		bakedAt,
		pinacothecaVersion,
	};
	console.log(
		`[improvements] pinacotheca ${pinacothecaVersion}, baked at ${bakedAt}`,
	);

	const aliases = await buildNationAliases();
	const urbanFamilies = new Set<string>();
	const capitalFamilies = new Set<string>();
	for (const entry of aliases.values()) {
		urbanFamilies.add(entry.urban);
		capitalFamilies.add(entry.capital);
	}
	console.log(
		`[improvements] discovered ${aliases.size} nations across ${urbanFamilies.size} urban families and ${capitalFamilies.size} capital families`,
	);
	await writeNationAliases(aliases, bakedAt);

	const zTypeMap = await buildZTypeMap();
	console.log(
		`[improvements] loaded ${zTypeMap.size} zType→zIconName mappings`,
	);

	const classification = await classifyPinacothecaPngs(
		urbanFamilies,
		capitalFamilies,
	);
	const compositeIcons = new Set<string>();
	for (const familyMap of classification.composites.values()) {
		for (const icon of familyMap.keys()) compositeIcons.add(icon);
	}
	const keptIcons = new Set<string>();
	for (const icon of classification.singles.keys()) {
		// Drop singles whose zIconName has any composite — composites supersede
		// them on every nation's urban tile, so the single is dead weight.
		// Singles for non-urban-buildable improvements (rural, ruins,
		// settlements, wonders that don't sit on urban tiles) stay because no
		// composite covers them.
		if (!compositeIcons.has(icon)) keptIcons.add(icon);
	}
	console.log(
		`[improvements] singles: ${classification.singles.size} total, ${keptIcons.size} kept (${classification.singles.size - keptIcons.size} dropped — superseded by composites)`,
	);
	console.log(
		`[improvements] standalones: ${classification.standaloneUrban.size} urban, ${classification.standaloneCapital.size} capital`,
	);
	let totalComposites = 0;
	for (const familyMap of classification.composites.values()) {
		totalComposites += familyMap.size;
	}
	console.log(
		`[improvements] composites: ${totalComposites} across ${classification.composites.size} families`,
	);

	await bakeBaseAtlas(ctx, zTypeMap, classification, keptIcons);

	const sortedFamilies = Array.from(classification.composites.keys()).sort();
	for (const family of sortedFamilies) {
		const familyMap = classification.composites.get(family)!;
		await bakeFamilyAtlas(ctx, family, familyMap, zTypeMap);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
