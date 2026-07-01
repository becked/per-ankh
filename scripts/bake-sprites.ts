// Bake the loose 2D sprite PNGs that the runtime serves directly from
// /sprites/<category>/<name>.<hash>.png. These don't get packed into atlases
// — they ship as individual files under static/sprites/, content-hashed by
// their own bytes for safe long-cache HTTP serving.
//
// SOURCES (all under <pinacotheca>/extracted/sprites/):
//   crests/, techs/, laws/, religions/, yields/  → 1:1 copy by category dir
//   techs/ (2nd pass)                            → techs-cropped/ inset-cropped
//                                                  copy, Military-rail only
//   traits/ (2nd pass)                           → traits-trimmed/ content-
//                                                  trimmed+squared, rail only
//   units/                                       → UNIT_*.png minus UNIT_3D_*
//   portraits/                                   → leader ADULT portraits, keyed
//                                                  by portrait zType (see below)
//   improvements/IMPROVEMENT_FINISHED.png        → icons/IMPROVEMENT_FINISHED.png
//   other/Cycle_Military_Normal.png              → icons/MILITARY.png
//   other/VICTORY_Normal.png                     → icons/VICTORY_NORMAL.png
//   other/MAP_OVERVIEW_Normal.png                → icons/MAP_OVERVIEW.png
//   other/Cycle_Normal_EndTurn.png               → icons/TURN.png
//   other/STATS_Normal.png                       → icons/STATS.png
//   other/GAME_HELP.png                          → icons/GAME_HELP.png
//   other/MultiplayerLogo.png                    → icons/MULTIPLAYER.png
//   events_images/TURN_SUMMARY_PLAYER_DIPLOMACY.png → icons/PLAYER_DIPLOMACY.png
//   city/CITY_FOUNDED.png                        → icons/CITY_FOUNDED.png
//   achievements/ACHIEVEMENT_WIN.png             → icons/ACHIEVEMENT_WIN.png
//   achievements/ACHIEVEMENT.png                 → icons/ACHIEVEMENT.png
//   other/PENDING_CRITICAL.png                   → icons/PENDING_CRITICAL.png
//   tools/TOOL_SETTINGS.png                      → icons/TOOL_SETTINGS.png
//   other/GOAL_STARTED.png                       → icons/GOAL_STARTED.png
//   other/GOAL_FAILED.png                        → icons/GOAL_FAILED.png
//   mods/dynamic-unit/sprites/EFFECTUNIT_ENLIST_ICON.png → icons/EFFECTUNIT_ENLIST_ICON.png
//
// PORTRAITS also read the OW Reference XML (Reference/XML/Infos/
// characterPortrait*.xml) — like bake-improvements, this baker needs BOTH a
// pinacotheca checkout and a Reference/XML tree. A save stores a character's
// portrait as a zType (CHARACTER_PORTRAIT_<base>), which is NOT always the art
// filename: e.g. CHARACTER_PORTRAIT_ROMAN_LEADER_MALE_06 → art ROME_LEADER_
// MALE_06 (ROMAN vs ROME), and one Hittite portrait → lowercase Hittite_* art.
// The zType→art mapping is the entry's <azAgeGroupSpriteNames> (per age group),
// so we key the manifest by zType base and the runtime's strip-prefix lookup
// resolves every portrait id the game can emit.
//
// OUTPUT:
//   static/sprites/<category>/<basename>.<hash>.png
//   static/sprites/.bake-info.json   (pinacotheca version + bakedAt stamp)
//   .bake/sprite-manifest.json       (registered for build-manifests.ts)
//
// Each target category dir is wiped and repopulated per run, so this is
// idempotent — running it twice produces identical bytes (and identical
// hashes, so the generated TS module is byte-stable).
//
// Run: npm run bake:sprites

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

import sharp from "sharp";
import { XMLParser } from "fast-xml-parser";

import {
	readPinacothecaVersion,
	writeSpriteSidecar,
	type SpriteSidecar,
} from "./lib/atlas-bake.js";
import { resolvePinacotheca, resolveReferenceXml } from "./lib/paths.js";

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
	// Leader-archetype icons (TRAIT_SCHOLAR, TRAIT_HERO, …). The save records a
	// character's archetype as a TRAIT_<X>_ARCHETYPE trait; the icon drops the
	// _ARCHETYPE suffix. Powers the Leaders-tab succession chips.
	"traits",
] as const;

// Pinacotheca's units/ holds both 2D icons (UNIT_*.png) and 3D renders
// (UNIT_3D_*.png). The runtime tech-fallback path requests UNIT_<NAME>.png
// (the 2D set) — the 3D variants are unused.
const UNITS_CATEGORY = "units";

// Three icons sourced from disparate Pinacotheca subdirs, with renames where
// the runtime expects a different name than Pinacotheca emits.
interface IconMapping {
	readonly source: string; // relative to extracted/sprites/
	readonly target: string; // filename under static/sprites/icons/ (with .png suffix)
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
	{
		source: "other/MAP_OVERVIEW_Normal.png",
		target: "MAP_OVERVIEW.png",
	},
	{
		source: "other/Cycle_Normal_EndTurn.png",
		target: "TURN.png",
	},
	{
		source: "achievements/ACHIEVEMENT_WIN.png",
		target: "ACHIEVEMENT_WIN.png",
	},
	// Tournament header hero icons: champion trophy, active-state pulse, and
	// setup gear (see TournamentHeader.svelte).
	{ source: "achievements/ACHIEVEMENT.png", target: "ACHIEVEMENT.png" },
	{ source: "other/PENDING_CRITICAL.png", target: "PENDING_CRITICAL.png" },
	{ source: "tools/TOOL_SETTINGS.png", target: "TOOL_SETTINGS.png" },
	{ source: "other/GOAL_STARTED.png", target: "GOAL_STARTED.png" },
	// Failed-ambition marker in the Leaders-tab detail panel (replaces the
	// generic ambition glyph when a goal's failed_turn is set).
	{ source: "other/GOAL_FAILED.png", target: "GOAL_FAILED.png" },
	{
		source: "city/CITY_FOUNDED.png",
		target: "CITY_FOUNDED.png",
	},
	{
		source: "other/STATS_Normal.png",
		target: "STATS.png",
	},
	{
		source: "other/GAME_HELP.png",
		target: "GAME_HELP.png",
	},
	{
		source: "other/MultiplayerLogo.png",
		target: "MULTIPLAYER.png",
	},
	{
		source: "events_images/TURN_SUMMARY_PLAYER_DIPLOMACY.png",
		target: "PLAYER_DIPLOMACY.png",
	},
	// City culture-level icons (used by the Cities-tab Culture column). Names
	// match the culture.xml zIconName values; copied 1:1 from other/.
	{ source: "other/CULTURE_WEAK.png", target: "CULTURE_WEAK.png" },
	{ source: "other/CULTURE_DEVELOPING.png", target: "CULTURE_DEVELOPING.png" },
	{ source: "other/CULTURE_STRONG.png", target: "CULTURE_STRONG.png" },
	{ source: "other/CULTURE_LEGENDARY.png", target: "CULTURE_LEGENDARY.png" },
	// Unclaimed-slot stand-in for tournament player avatars (see
	// PlayerAvatar.svelte): shown in front of a slot's name when no logged-in
	// user has claimed it yet, so there's no Discord avatar to display.
	{
		source: "mods/dynamic-unit/sprites/EFFECTUNIT_ENLIST_ICON.png",
		target: "EFFECTUNIT_ENLIST_ICON.png",
	},
	// Leaders-tab detail panel: the four character ratings (shown next to each
	// rating value) and the ambition marker (replaces the checkbox glyph).
	{ source: "other/RATING_WISDOM.png", target: "RATING_WISDOM.png" },
	{ source: "other/RATING_CHARISMA.png", target: "RATING_CHARISMA.png" },
	{ source: "other/RATING_COURAGE.png", target: "RATING_COURAGE.png" },
	{ source: "other/RATING_DISCIPLINE.png", target: "RATING_DISCIPLINE.png" },
	{
		source: "events_images/TURN_SUMMARY_AMBITION.png",
		target: "TURN_SUMMARY_AMBITION.png",
	},
];

function contentHash(buf: Buffer): string {
	return createHash("sha256").update(buf).digest("hex").slice(0, 8);
}

async function wipeAndRecreate(dir: string): Promise<void> {
	await rm(dir, { recursive: true, force: true });
	await mkdir(dir, { recursive: true });
}

// Read source PNG, write a content-hashed copy to dst, register in the
// sidecar under "<category>/<basename>" → public URL. `basename` is the
// stem without .png (e.g., "CREST_NATION_EGYPT") so manifest keys mirror
// what callers in helpers.ts construct.
async function bakeOne(
	srcPath: string,
	dstDir: string,
	category: string,
	basename: string,
	sidecar: SpriteSidecar,
): Promise<void> {
	const buf = await readFile(srcPath);
	const hash = contentHash(buf);
	const filename = `${basename}.${hash}.png`;
	await writeFile(resolve(dstDir, filename), buf);
	sidecar[`${category}/${basename}`] = `/sprites/${category}/${filename}`;
}

async function copyMirrorCategory(
	category: string,
	sidecar: SpriteSidecar,
): Promise<number> {
	const src = resolve(PINACOTHECA_SPRITES, category);
	const dst = resolve(SPRITES_OUT, category);
	await wipeAndRecreate(dst);
	const entries = await readdir(src);
	const pngs = entries.filter((f) => f.endsWith(".png"));
	for (const filename of pngs) {
		const basename = filename.slice(0, -".png".length);
		await bakeOne(resolve(src, filename), dst, category, basename, sidecar);
	}
	return pngs.length;
}

// The Military-tab event rail (src/lib/game-detail/MilitaryTab.svelte) renders
// tech icons next to law and archetype icons at a uniform size. A tech glyph
// fills only ~55% of its opaque ~219² plate, so it reads noticeably smaller than
// a law disc (fills its box) or an archetype glyph (~90% fill). We keep the
// full-bleed gold plate — it's an opaque gradient, so it can't be trimmed to
// content deterministically — and instead shave a fixed inset off every edge,
// enlarging the glyph toward the law/archetype size. 10% is from a rendered
// sweep and is clip-safe: the tightest glyph (TECH_ARCHITECTURE's compass)
// reaches the tile edge only past ~18%. Rail-only, so it can't affect any other
// sprite surface.
const TECH_CROP_INSET = 0.1;

// Emit a second, inset-cropped copy of every tech sprite under techs-cropped/,
// leaving the raw techs/ mirror byte-identical. Only the Military rail reads this
// category (via the "techs-cropped" SpriteCategory); every other tech-icon
// consumer keeps the uncropped techs/ set.
async function copyCroppedTechs(sidecar: SpriteSidecar): Promise<number> {
	const src = resolve(PINACOTHECA_SPRITES, "techs");
	const dst = resolve(SPRITES_OUT, "techs-cropped");
	await wipeAndRecreate(dst);
	const entries = await readdir(src);
	const pngs = entries.filter((f) => f.endsWith(".png"));
	for (const filename of pngs) {
		const basename = filename.slice(0, -".png".length);
		const input = await readFile(resolve(src, filename));
		const { width, height } = await sharp(input).metadata();
		if (width == null || height == null) {
			throw new Error(`[sprites] techs-cropped: no dimensions for ${filename}`);
		}
		// Symmetric, bounds-safe window: width = w - 2*left guarantees
		// left + width <= w for any rounding of the inset (same for height).
		const left = Math.round(width * TECH_CROP_INSET);
		const top = Math.round(height * TECH_CROP_INSET);
		const buf = await sharp(input)
			.extract({
				left,
				top,
				width: width - 2 * left,
				height: height - 2 * top,
			})
			.png()
			.toBuffer();
		const hash = contentHash(buf);
		const outName = `${basename}.${hash}.png`;
		await writeFile(resolve(dst, outName), buf);
		sidecar[`techs-cropped/${basename}`] = `/sprites/techs-cropped/${outName}`;
	}
	return pngs.length;
}

// The archetype (trait) glyphs are bare line-art on a transparent field with
// inconsistent padding — e.g. TRAIT_SCHOLAR fills 96% of a 28² box, TRAIT_SCHEMER
// only 75% of a 64² box — so at a fixed render size they read smaller than the
// solid, box-filling law/tech/crest markers on the Military rail, and
// inconsistently versus each other (#85). Trim each glyph to its content bounds,
// then pad back to a centered square so SpriteIcon's square render box can't
// stretch a non-square glyph. Every archetype then fills its box on its long
// axis, so one rail render size makes them uniform. Rail-only; the raw traits/
// set (Leaders-tab succession chips) is left byte-identical.
async function copyTrimmedTraits(sidecar: SpriteSidecar): Promise<number> {
	const src = resolve(PINACOTHECA_SPRITES, "traits");
	const dst = resolve(SPRITES_OUT, "traits-trimmed");
	await wipeAndRecreate(dst);
	const entries = await readdir(src);
	const pngs = entries.filter((f) => f.endsWith(".png"));
	for (const filename of pngs) {
		const basename = filename.slice(0, -".png".length);
		const input = await readFile(resolve(src, filename));
		// Trim the transparent border down to the glyph's content bounds.
		const { data, info } = await sharp(input)
			.trim({ threshold: 10 })
			.toBuffer({ resolveWithObject: true });
		// Pad back to a centered square (side = the longer content edge) so the
		// square render box never distorts a non-square glyph.
		const side = Math.max(info.width, info.height);
		const padX = side - info.width;
		const padY = side - info.height;
		const left = Math.floor(padX / 2);
		const top = Math.floor(padY / 2);
		let pipeline = sharp(data);
		if (padX > 0 || padY > 0) {
			pipeline = pipeline.extend({
				left,
				right: padX - left,
				top,
				bottom: padY - top,
				background: { r: 0, g: 0, b: 0, alpha: 0 },
			});
		}
		const buf = await pipeline.png().toBuffer();
		const hash = contentHash(buf);
		const outName = `${basename}.${hash}.png`;
		await writeFile(resolve(dst, outName), buf);
		sidecar[`traits-trimmed/${basename}`] = `/sprites/traits-trimmed/${outName}`;
	}
	return pngs.length;
}

async function copyUnits(sidecar: SpriteSidecar): Promise<number> {
	const src = resolve(PINACOTHECA_SPRITES, "units");
	const dst = resolve(SPRITES_OUT, UNITS_CATEGORY);
	await wipeAndRecreate(dst);
	const entries = await readdir(src);
	const pngs = entries.filter(
		(f) =>
			f.startsWith("UNIT_") && f.endsWith(".png") && !f.startsWith("UNIT_3D_"),
	);
	for (const filename of pngs) {
		const basename = filename.slice(0, -".png".length);
		await bakeOne(
			resolve(src, filename),
			dst,
			UNITS_CATEGORY,
			basename,
			sidecar,
		);
	}
	return pngs.length;
}

async function copyIcons(sidecar: SpriteSidecar): Promise<number> {
	const dst = resolve(SPRITES_OUT, "icons");
	await wipeAndRecreate(dst);
	for (const { source, target } of ICON_MAPPINGS) {
		const basename = target.slice(0, -".png".length);
		await bakeOne(
			resolve(PINACOTHECA_SPRITES, source),
			dst,
			"icons",
			basename,
			sidecar,
		);
	}
	return ICON_MAPPINGS.length;
}

// Display size for leader portraits. Sources are 256×256; the Leaders-tab
// detail panel shows them small, so 128px is a comfortable ~2× for sharpness
// while keeping each webp tiny. Bump here if a larger portrait surface appears.
const PORTRAIT_SIZE = 128;

// The age variant we ship — a reigning ruler's natural look. Each portrait
// zType lists one art sprite per age group; we take this one.
const PORTRAIT_AGE_GROUP = "CHARACTER_AGE_GROUP_ADULT";

const portraitXmlParser = new XMLParser({
	ignoreAttributes: true,
	parseTagValue: false,
	ignoreDeclaration: true,
	ignorePiTags: true,
});

interface PortraitAgePair {
	zIndex?: string;
	zValue?: string;
}
interface PortraitEntry {
	zType?: string;
	azAgeGroupSpriteNames?:
		| { Pair?: PortraitAgePair | PortraitAgePair[] }
		| string;
}

// The portrait-definition files: the base table plus hyphenated DLC variants
// (characterPortrait-eoti.xml, …). Deliberately NOT the camelCase siblings
// (characterPortraitOpinion.xml, …FeaturePoints, …AgeInterpolation), which key
// unrelated data and carry no <azAgeGroupSpriteNames>.
function isPortraitDefFile(name: string): boolean {
	return (
		name === "characterPortrait.xml" || /^characterPortrait-.*\.xml$/.test(name)
	);
}

// Map every leader portrait zType (CHARACTER_PORTRAIT_ stripped) → its ADULT-age
// art sprite name, from the Reference XML. Base file loads first so DLC files
// override by zType. This is the bridge that lets us key the manifest by the
// zType a save actually stores, instead of assuming it equals the art filename.
async function loadLeaderPortraitArt(
	infosDir: string,
): Promise<Map<string, string>> {
	const defFiles = (await readdir(infosDir)).filter(isPortraitDefFile);
	const ordered = [
		...defFiles.filter((f) => f === "characterPortrait.xml"),
		...defFiles.filter((f) => f !== "characterPortrait.xml").sort(),
	];

	const artByZType = new Map<string, string>();
	for (const file of ordered) {
		const xml = await readFile(resolve(infosDir, file), "utf-8");
		const parsed = portraitXmlParser.parse(xml) as {
			Root?: { Entry?: PortraitEntry | PortraitEntry[] };
		};
		const entry = parsed.Root?.Entry;
		const entries = Array.isArray(entry) ? entry : entry ? [entry] : [];
		for (const e of entries) {
			const zType = e.zType;
			if (!zType || !zType.includes("_LEADER_")) continue;
			const group = e.azAgeGroupSpriteNames;
			if (!group || typeof group === "string") continue;
			const pairs = Array.isArray(group.Pair)
				? group.Pair
				: group.Pair
					? [group.Pair]
					: [];
			const adult = pairs.find((p) => p.zIndex === PORTRAIT_AGE_GROUP)?.zValue;
			if (!adult) continue;
			artByZType.set(zType.replace(/^CHARACTER_PORTRAIT_/, ""), adult);
		}
	}
	return artByZType;
}

// Downscale + re-encode an art PNG to webp, content-hash the *output* bytes, and
// write it. Returns the public URL. `stem` names the file (the art sprite name).
async function bakePortrait(
	srcPath: string,
	dstDir: string,
	stem: string,
): Promise<string> {
	const png = await readFile(srcPath);
	const webp = await sharp(png)
		.resize(PORTRAIT_SIZE, PORTRAIT_SIZE)
		.webp({ quality: 80 })
		.toBuffer();
	const hash = contentHash(webp);
	const filename = `${stem}.${hash}.webp`;
	await writeFile(resolve(dstDir, filename), webp);
	return `/sprites/portraits/${filename}`;
}

// Loose webp files (like units/crests), NOT a packed atlas — a game page must
// download only the handful of leader portraits it references, never all ~500.
// Keyed by portrait zType (resolved through the Reference XML, above), so e.g.
// CHARACTER_PORTRAIT_ROMAN_LEADER_MALE_06 resolves to the ROME_* art it names.
async function copyPortraits(sidecar: SpriteSidecar): Promise<number> {
	const src = resolve(PINACOTHECA_SPRITES, "portraits");
	const dst = resolve(SPRITES_OUT, "portraits");
	await wipeAndRecreate(dst);

	const artByZType = await loadLeaderPortraitArt(
		resolve(resolveReferenceXml(), "Infos"),
	);

	// Several zTypes can name the same art sprite — encode each art file once
	// (cache by name) but register a manifest key per zType.
	const urlByArt = new Map<string, string>();
	let baked = 0;
	const missing: string[] = [];
	for (const [zBase, artName] of artByZType) {
		let url = urlByArt.get(artName);
		if (url == null) {
			const srcPath = resolve(src, `${artName}.png`);
			if (!existsSync(srcPath)) {
				// zType names art not present in this pinacotheca build — skip it;
				// the runtime falls back to no portrait. Reported in the summary.
				missing.push(artName);
				continue;
			}
			url = await bakePortrait(srcPath, dst, artName);
			urlByArt.set(artName, url);
			baked += 1;
		}
		sidecar[`portraits/${zBase}`] = url;
	}
	if (missing.length > 0) {
		const uniq = [...new Set(missing)].sort();
		console.log(
			`[sprites] portraits: ${uniq.length} art file(s) missing from pinacotheca, skipped: ${uniq.slice(0, 8).join(", ")}${uniq.length > 8 ? " …" : ""}`,
		);
	}
	return baked;
}

async function main(): Promise<void> {
	const pinacothecaVersion = await readPinacothecaVersion(
		PINACOTHECA_PYPROJECT,
	);
	const bakedAt = new Date().toISOString();
	console.log(
		`[sprites] pinacotheca ${pinacothecaVersion}, baked at ${bakedAt}`,
	);

	await mkdir(SPRITES_OUT, { recursive: true });

	// All sprite-bake outputs are owned by this script, so the sidecar is
	// rewritten wholesale rather than read-merged. (Atlas bakes use
	// updateAtlasSidecar() because multiple scripts contribute to the atlas
	// sidecar.)
	const sidecar: SpriteSidecar = {};
	const counts: Record<string, number> = {};

	for (const cat of MIRROR_CATEGORIES) {
		counts[cat] = await copyMirrorCategory(cat, sidecar);
	}
	counts["techs-cropped"] = await copyCroppedTechs(sidecar);
	counts["traits-trimmed"] = await copyTrimmedTraits(sidecar);
	counts[UNITS_CATEGORY] = await copyUnits(sidecar);
	counts.icons = await copyIcons(sidecar);
	counts.portraits = await copyPortraits(sidecar);

	// Sort keys so the resulting JSON is deterministic across runs.
	const sortedSidecar: SpriteSidecar = {};
	for (const key of Object.keys(sidecar).sort()) {
		sortedSidecar[key] = sidecar[key];
	}
	await writeSpriteSidecar(sortedSidecar);

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
