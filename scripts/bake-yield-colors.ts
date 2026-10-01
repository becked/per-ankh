// Bake each yield's chart colour from the OW reference data, so the aggregate
// yields panel can colour a series the way the game colours it. Before this,
// all sixteen yield charts drew in getChartColor(0) — one copper for every
// series, so colour carried no information down the page.
//
// SOURCES (local-only, via the Reference/ and pinacotheca resolvers in paths.ts):
//   Reference/XML/Infos/yield.xml  — <Entry> with <zType> (YIELD_*) and <Color>
//                                    (COLOR_YIELD_*). 14 yields carry a colour.
//   Reference/XML/Infos/color.xml  — <zHexValue> per colour zType.
//   <pinacotheca>/extracted/sprites/yields/YIELD_*.png — the icon art, read for
//                                    the yields color.xml declines to colour
//                                    (below) and for YIELD_LEGITIMACY, which the
//                                    game draws but yield.xml has no entry for.
//
// THREE YIELDS ARE #ffffff IN color.xml — Money, Orders and Maintenance. That is
// the table saying "no colour of its own", not a colour choice: shipped as-is it
// would render three identical white charts. The icon art does distinguish them,
// and it carries the meaning the table drops — Maintenance is a cost, and the
// game draws it red. So an exactly-#ffffff entry falls through to its sprite.
// The test is exact, NOT "near-white": YIELD_IRON is #DBDCDB, a deliberate
// light-metal grey, and its sprite is achromatic enough that sampling would
// replace it with a muddy dark grey.
//
// MILITARY POWER IS NOT A YIELD. It has no yield.xml entry, no sprite, and no
// COLORCLASS_YIELDS colour; "MILITARY_POWER" appears nowhere in the game XML at
// all — it is a per-ankh series over a derived stat. It takes
// COLOR_RATING_COURAGE, the combat rating's colour, and is exported separately
// rather than under a fabricated YIELD_MILITARY_POWER key, because inventing a
// game token the game does not have is exactly the thing to avoid here.
//
// THE CONTRAST LIFT. The game paints yields on its own UI, not on the app's
// chart ground (#211A12), and six of its colours do not survive the move: as a
// 2px line, Science (2.34:1), Discontent (2.38:1), Training (2.76:1), Wood
// (3.11:1), Stone (3.72:1) and the sampled Maintenance red (3.45:1) are close to
// invisible. Each is lifted to a contrast floor by raising OKLCh lightness alone
// — hue is held exactly and chroma is clamped only where the sRGB gamut demands
// it (it never did: every lift retained 100% chroma). Anything already clearing
// its floor is passed through untouched, so ten of the sixteen series carry the
// game's colour verbatim.
//
// OUTPUT: src/lib/generated/yield-colors.ts (checked in, self-contained).
//
// Run: npm run bake:yield-colors

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { XMLParser } from "fast-xml-parser";
import { format as prettierFormat, resolveConfig } from "prettier";
import sharp from "sharp";

import { resolvePinacotheca, resolveReferenceXml } from "./lib/paths.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const OUTPUT_TS = resolve(REPO_ROOT, "src/lib/generated/yield-colors.ts");

// The app's chart background (CHART_THEME.backgroundColor in
// src/lib/config/charts.ts). Every contrast figure below is against this.
const CHART_BG = "#211A12";

// Default floor for a median line. For scale, the copper every yield chart used
// before this bake is 5.13:1 on the same ground.
const DEFAULT_FLOOR = 4.5;

// Discontent and Stone are both the game's low-chroma slates, and lifting each
// to exactly 4.5:1 lands them 0.022 apart in OKLab — one colour, effectively,
// on two charts that sit two apart in YIELD_SERIES order. Lifting Discontent
// alone to 5.5:1 takes the separation to 0.058 for one extra step of lightness.
const FLOOR_OVERRIDES: Readonly<Record<string, number>> = {
	YIELD_DISCONTENT: 5.5,
};

// Yields the game draws but yield.xml cannot colour. A value here is only used
// when the XML lookup yields #ffffff or nothing at all — the XML stays
// authoritative wherever it actually expresses a colour.
const SPRITE_FALLBACKS = [
	"YIELD_MONEY",
	"YIELD_ORDERS",
	"YIELD_MAINTENANCE",
	"YIELD_LEGITIMACY",
] as const;

// Military Power's stand-in, and where it comes from.
const MILITARY_POWER_SOURCE = "COLOR_RATING_COURAGE";
// GDP is likewise not a yield — no yield.xml entry, no token in the game XML
// at all. It borrows the charisma rating's colour, which is the rating Old
// World ties to money, rather than YIELD_MONEY's own: GDP and money are two
// charts on the same tab and sharing a colour would merge them by eye.
const GDP_SOURCE = "COLOR_RATING_CHARISMA";

interface Entry {
	zType?: string;
	Color?: string | Record<string, unknown>;
	zHexValue?: string;
}

const parser = new XMLParser({
	ignoreAttributes: true,
	parseTagValue: false,
	ignoreDeclaration: true,
	ignorePiTags: true,
});

function parseEntries(xml: string): Entry[] {
	const parsed = parser.parse(xml) as { Root?: { Entry?: Entry | Entry[] } };
	const raw = parsed.Root?.Entry;
	return raw == null ? [] : Array.isArray(raw) ? raw : [raw];
}

/* ------------------------------------------------------------------ colour */

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
	const h = hex.replace("#", "");
	return [
		parseInt(h.slice(0, 2), 16) / 255,
		parseInt(h.slice(2, 4), 16) / 255,
		parseInt(h.slice(4, 6), 16) / 255,
	];
}

function rgbToHex(rgb: Rgb): string {
	return (
		"#" +
		rgb
			.map((v) =>
				Math.max(0, Math.min(255, Math.round(v * 255)))
					.toString(16)
					.padStart(2, "0"),
			)
			.join("")
	);
}

const toLinear = (c: number): number =>
	c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

const toSrgb = (c: number): number =>
	c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

function relativeLuminance(hex: string): number {
	const [r, g, b] = hexToRgb(hex).map(toLinear);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// WCAG contrast ratio between two opaque colours.
function contrast(a: string, b: string): number {
	const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort(
		(x, y) => y - x,
	);
	return (hi + 0.05) / (lo + 0.05);
}

// sRGB → OKLab (Björn Ottosson's matrices).
function rgbToOklab(rgb: Rgb): [number, number, number] {
	const [r, g, b] = rgb.map(toLinear);
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
	];
}

// OKLab → sRGB, reporting whether the colour was in gamut before clamping.
function oklabToRgb(lab: [number, number, number]): {
	rgb: Rgb;
	inGamut: boolean;
} {
	const [L, A, B] = lab;
	const l = Math.pow(L + 0.3963377774 * A + 0.2158037573 * B, 3);
	const m = Math.pow(L - 0.1055613458 * A - 0.0638541728 * B, 3);
	const s = Math.pow(L - 0.0894841775 * A - 1.291485548 * B, 3);
	const lin: Rgb = [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
	];
	const inGamut = lin.every((v) => v >= -1e-4 && v <= 1 + 1e-4);
	return {
		rgb: lin.map((v) => toSrgb(Math.max(0, Math.min(1, v)))) as Rgb,
		inGamut,
	};
}

function toLch(hex: string): { L: number; C: number; H: number } {
	const [L, A, B] = rgbToOklab(hexToRgb(hex));
	return { L, C: Math.hypot(A, B), H: Math.atan2(B, A) };
}

function fromLch(
	L: number,
	C: number,
	H: number,
): { rgb: Rgb; inGamut: boolean } {
	return oklabToRgb([L, C * Math.cos(H), C * Math.sin(H)]);
}

// Largest in-gamut chroma at this lightness and hue, never exceeding `ceiling`
// (the source chroma — the lift brightens, it never saturates).
function maxChroma(L: number, H: number, ceiling: number): number {
	let lo = 0;
	let hi = ceiling;
	for (let i = 0; i < 40; i++) {
		const mid = (lo + hi) / 2;
		if (fromLch(L, mid, H).inGamut) lo = mid;
		else hi = mid;
	}
	return lo;
}

interface Lift {
	hex: string;
	contrastBefore: number;
	contrastAfter: number;
	lifted: boolean;
	chromaKept: number;
}

// Raise OKLCh lightness until the colour clears `floor` against the chart
// ground. Hue is held exactly; chroma only drops if the gamut forces it.
function liftToFloor(hex: string, floor: number): Lift {
	const before = contrast(hex, CHART_BG);
	if (before >= floor) {
		return {
			hex,
			contrastBefore: before,
			contrastAfter: before,
			lifted: false,
			chromaKept: 1,
		};
	}
	const { L: L0, C: C0, H } = toLch(hex);
	let lo = L0;
	let hi = 1;
	for (let i = 0; i < 60; i++) {
		const mid = (lo + hi) / 2;
		const candidate = rgbToHex(fromLch(mid, maxChroma(mid, H, C0), H).rgb);
		if (contrast(candidate, CHART_BG) >= floor) hi = mid;
		else lo = mid;
	}
	const C1 = maxChroma(hi, H, C0);
	const out = rgbToHex(fromLch(hi, C1, H).rgb);
	return {
		hex: out,
		contrastBefore: before,
		contrastAfter: contrast(out, CHART_BG),
		lifted: true,
		chromaKept: C0 === 0 ? 1 : C1 / C0,
	};
}

/* ------------------------------------------------------------------ sprite */

// The icon's representative hue: an alpha- AND chroma-weighted mean over the
// opaque pixels. A plain alpha mean washes an icon out toward its own shading
// (the Money coins average to a dull brown); weighting by chroma asks what
// colour the icon is *about* rather than what its average pixel is.
async function sampleSprite(path: string): Promise<string> {
	const { data, info } = await sharp(path)
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	const channels = info.channels;
	let acc: [number, number, number] = [0, 0, 0];
	let total = 0;
	for (let i = 0; i < data.length; i += channels) {
		const r = data[i];
		const g = data[i + 1];
		const b = data[i + 2];
		const a = channels === 4 ? data[i + 3] : 255;
		if (a < 40) continue;
		const chroma = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
		const weight = (a / 255) * chroma;
		if (weight === 0) continue;
		acc = [acc[0] + r * weight, acc[1] + g * weight, acc[2] + b * weight];
		total += weight;
	}
	if (total === 0) {
		throw new Error(
			`bake-yield-colors: ${path} has no chromatic pixels to sample`,
		);
	}
	return rgbToHex(acc.map((v) => v / total / 255) as Rgb);
}

/* -------------------------------------------------------------------- main */

interface Resolved {
	key: string;
	hex: string;
	source: string;
	lift: Lift;
}

async function main(): Promise<void> {
	const xmlDir = resolveReferenceXml();
	const spriteDir = resolve(resolvePinacotheca(), "extracted/sprites/yields");

	const [yieldXml, colorXml] = await Promise.all([
		readFile(resolve(xmlDir, "Infos", "yield.xml"), "utf-8"),
		readFile(resolve(xmlDir, "Infos", "color.xml"), "utf-8"),
	]);

	const hexByColor = new Map<string, string>();
	for (const c of parseEntries(colorXml)) {
		if (c.zType && typeof c.zHexValue === "string") {
			hexByColor.set(c.zType, c.zHexValue);
		}
	}

	// yield.xml order is the game's own; sorting happens at emit time.
	const xmlColorByYield = new Map<string, string | null>();
	for (const y of parseEntries(yieldXml)) {
		if (!y.zType || !y.zType.startsWith("YIELD_")) continue;
		// An empty <Color/> parses to {} rather than a string.
		const colorType = typeof y.Color === "string" ? y.Color : "";
		xmlColorByYield.set(
			y.zType,
			colorType ? (hexByColor.get(colorType) ?? null) : null,
		);
	}

	if (xmlColorByYield.size < 14) {
		throw new Error(
			`bake-yield-colors: only ${xmlColorByYield.size} yields found in yield.xml`,
		);
	}

	const keys = new Set<string>([
		...xmlColorByYield.keys(),
		...SPRITE_FALLBACKS,
	]);

	const resolved: Resolved[] = [];
	for (const key of keys) {
		const fromXml = xmlColorByYield.get(key) ?? null;
		// #ffffff is the table declining to colour the yield, not a colour —
		// see the header. Exact match only.
		const declined = fromXml === null || fromXml.toLowerCase() === "#ffffff";
		let hex: string;
		let source: string;
		if (!declined) {
			hex = fromXml as string;
			source = `color.xml ${hex}`;
		} else {
			if (!(SPRITE_FALLBACKS as readonly string[]).includes(key)) {
				// A yield the table declines to colour and we have no sprite
				// fallback declared for is new content, not a known gap.
				throw new Error(
					`bake-yield-colors: ${key} has no usable color.xml value (${fromXml ?? "no entry"}) and no sprite fallback declared`,
				);
			}
			const path = resolve(spriteDir, `${key}.png`);
			if (!existsSync(path)) {
				throw new Error(`bake-yield-colors: missing sprite ${path}`);
			}
			hex = await sampleSprite(path);
			source =
				fromXml === null
					? `sprite ${hex} (no yield.xml entry)`
					: `sprite ${hex} (xml #ffffff)`;
		}
		const lift = liftToFloor(hex, FLOOR_OVERRIDES[key] ?? DEFAULT_FLOOR);
		resolved.push({ key, hex: lift.hex, source, lift });
	}
	resolved.sort((a, b) => a.key.localeCompare(b.key));

	const militarySourceHex = hexByColor.get(MILITARY_POWER_SOURCE);
	if (!militarySourceHex) {
		throw new Error(
			`bake-yield-colors: ${MILITARY_POWER_SOURCE} not found in color.xml`,
		);
	}
	const militaryLift = liftToFloor(militarySourceHex, DEFAULT_FLOOR);

	const gdpSourceHex = hexByColor.get(GDP_SOURCE);
	if (!gdpSourceHex) {
		throw new Error(`bake-yield-colors: ${GDP_SOURCE} not found in color.xml`);
	}
	const gdpLift = liftToFloor(gdpSourceHex, DEFAULT_FLOOR);

	// Nothing may ship below its floor — the lift is the whole point of the bake.
	for (const r of resolved) {
		const floor = FLOOR_OVERRIDES[r.key] ?? DEFAULT_FLOOR;
		if (r.lift.contrastAfter < floor - 1e-6) {
			throw new Error(
				`bake-yield-colors: ${r.key} lifted to ${r.lift.contrastAfter.toFixed(2)}:1, below its ${floor}:1 floor`,
			);
		}
	}

	const note = (l: Lift, source: string): string =>
		l.lifted
			? `${source} · lifted ${l.contrastBefore.toFixed(2)} → ${l.contrastAfter.toFixed(2)}:1` +
				(l.chromaKept < 0.999
					? ` · chroma ${(l.chromaKept * 100).toFixed(0)}%`
					: "")
			: `${source} · ${l.contrastAfter.toFixed(2)}:1`;

	const lines: string[] = [];
	lines.push("// AUTO-GENERATED by scripts/bake-yield-colors.ts. Do not edit.");
	lines.push(
		"// Run `npm run bake:yield-colors` to refresh from Reference/XML.",
	);
	lines.push("");
	lines.push(
		"// Yield → the game's colour for it (yield.xml <Color> → color.xml",
	);
	lines.push(
		"// <zHexValue>), raised in OKLCh lightness where the game's colour",
	);
	lines.push(
		`// could not carry a 2px line on the chart ground (${CHART_BG}).`,
	);
	lines.push(
		"// Hue is held exactly. The trailing comment on each entry is its",
	);
	lines.push("// source and its contrast on that ground.");
	lines.push("//");
	lines.push(
		"// A yield color.xml leaves #ffffff is coloured from its icon art",
	);
	lines.push("// instead — the table means 'no colour of its own' there, and");
	lines.push("// shipping it would draw three identical white charts.");
	lines.push("export const YIELD_COLORS = {");
	for (const r of resolved) {
		lines.push(`\t${r.key}: "${r.hex}", // ${note(r.lift, r.source)}`);
	}
	// `as const satisfies` rather than a Record annotation: every consumer
	// reaches these by a literal key, so literal key types turn a mistyped
	// YIELD_* into a compile error instead of an undefined that silently
	// falls back to the theme palette. (family-colors.ts keeps the Record
	// shape — it is indexed by a runtime zType, where an index signature is
	// what you want.)
	lines.push("} as const satisfies Readonly<Record<string, string>>;");
	lines.push("");
	lines.push(
		"// Military Power is not a yield: no yield.xml entry, no sprite, and",
	);
	lines.push(
		"// no COLORCLASS_YIELDS colour — the token appears nowhere in the",
	);
	lines.push(
		"// game XML. It is a per-ankh series over a derived stat, and it",
	);
	lines.push(
		`// borrows ${MILITARY_POWER_SOURCE}, the combat rating's colour.`,
	);
	lines.push("// Kept out of YIELD_COLORS so the map above stays exactly the");
	lines.push("// game's yield palette, keyed by tokens the game actually has.");
	lines.push(
		`export const MILITARY_POWER_COLOR = "${militaryLift.hex}"; // ${note(militaryLift, `color.xml ${militarySourceHex}`)}`,
	);
	lines.push("");
	lines.push("// GDP is not a yield either: the game does not model it, so no");
	lines.push(
		"// yield.xml entry and no token of its own. It is per-ankh's own",
	);
	lines.push(
		"// series — money income plus commodity income at market price —",
	);
	lines.push(`// and it borrows ${GDP_SOURCE}, the rating Old World ties to`);
	lines.push(
		"// money. Not YIELD_MONEY's colour: GDP and money are two charts",
	);
	lines.push("// on one tab, and sharing a colour would merge them by eye.");
	lines.push(
		`export const GDP_COLOR = "${gdpLift.hex}"; // ${note(gdpLift, `color.xml ${gdpSourceHex}`)}`,
	);
	lines.push("");

	const config = await resolveConfig(OUTPUT_TS);
	const formatted = await prettierFormat(lines.join("\n"), {
		...config,
		parser: "typescript",
		filepath: OUTPUT_TS,
	});
	await mkdir(dirname(OUTPUT_TS), { recursive: true });
	if (existsSync(OUTPUT_TS)) {
		const existing = await readFile(OUTPUT_TS, "utf-8");
		if (existing === formatted) {
			console.log("bake-yield-colors: no changes");
			return;
		}
	}
	await writeFile(OUTPUT_TS, formatted);
	const liftedCount = resolved.filter((r) => r.lift.lifted).length;
	console.log(
		`bake-yield-colors: ${resolved.length} yields (${liftedCount} lifted) + Military Power + GDP → ${OUTPUT_TS.replace(REPO_ROOT + "/", "")}`,
	);
}

await main();
