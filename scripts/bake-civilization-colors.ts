// Bake each nation's and tribe's colour from the OW reference XML, so a
// civilization renders in the colour the game gives it rather than one a hand
// table remembered to list.
//
// SOURCES (local-only, via the Reference/ symlink resolved by paths.ts):
//   Reference/XML/Infos/nation.xml — <TeamColor> per nation.
//   Reference/XML/Infos/tribe.xml — <TeamColor> per tribe.
//   Reference/XML/Infos/teamColor.xml — <TeamPlayerColor> (the civ's own
//     colour) and <aePlayerColors> (its family palette).
//   Reference/XML/Infos/playerColor.xml — <AssetColor> / <CrestColor>.
//   Reference/XML/Infos/color.xml — <zHexValue> per colour.
//   Mods/*/Infos/{nation,tribe,teamColor,playerColor,color}-{add,change}.xml —
//     the campaign/scenario content, merged last-wins by zType with per-field
//     updates, the bake-family-colors Mods pattern. Uploaded campaign saves
//     carry these civs.
//
// THE TWO CHAINS ARE NOT THE SAME CHAIN:
//
//   Tribes — InfoHelpers.getTribeColor (InfoHelpers.cs:3214) reads
//     maePlayerColors[0] and then meCrestColor:
//       tribe <TeamColor> → teamColor <aePlayerColors>[0]
//         → playerColor <CrestColor> → color <zHexValue>
//     NOT <TeamPlayerColor>, which is PLAYERCOLOR_BARBARIANS for every single
//     tribe — one shared near-black, not the per-tribe colour the game shows.
//
//   Nations — Game.getNationColor (Game.cs:21765) resolves through the live
//     Player (getPlayerNameColor), so it has no static answer. The static
//     analogue is the nation's own team colour:
//       nation <TeamColor> → teamColor <TeamPlayerColor>
//         → playerColor <AssetColor> → color <zHexValue>
//     which reproduces the hand-maintained table this baker replaces.
//
// BASE vs CAMPAIGN: nothing in nation.xml flags a campaign nation — the Mods
// entries carry exactly the base entries' fields — so the only derivable split
// is which file an entry came from. An entry is base if it appears in
// Infos/<stem>.xml at all; a -change overlay from a campaign does not make a
// base nation campaign content, which is why this is tracked separately from
// bake-family-colors' `fromMod` (that flag is true for any entry a mod
// touched, and campaign -change files touch Egypt, Rome, Greece, the Gauls and
// the Huns). BASE_NATIONS is what the /stats nation facet offers: a campaign
// nation there would be an option resolving to an empty corpus.
//
// ALPHA IS NORMALISED, NOT PASSED THROUGH: the app's hex parsers (`toRgba` in
// src/lib/utils/color.ts, `hexToRgb` in SpriteMap.svelte) both parse the whole
// string as one integer and shift 16/8/0, so an 8-digit value renders as a
// silently wrong colour (#bc6304ff → r=0x63 g=0x04 b=0xff). We emit #rrggbb
// and fail on an alpha that isn't ff, rather than dropping real transparency:
// of color.xml's 344 entries 60 are 8-digit and 16 carry a real alpha, but on
// these two legs only COLOR_NATION_EGYPT is 8-digit and its alpha is ff.
//
// OUTPUT: src/lib/generated/civilization-colors.ts (checked in, self-contained).
//
// Run: npm run bake:civilization-colors

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { XMLParser } from "fast-xml-parser";
import { format as prettierFormat, resolveConfig } from "prettier";

import { resolveReferenceXml } from "./lib/paths.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const OUTPUT_TS = resolve(
	REPO_ROOT,
	"src/lib/generated/civilization-colors.ts",
);

// The base rosters, as a floor on what must resolve — a parse drift that
// silently halves a table is the failure this catches.
const BASE_NATION_COUNT = 13;
const BASE_TRIBE_COUNT = 11;

interface Entry {
	zType?: string;
	TeamColor?: string;
	TeamPlayerColor?: string;
	aePlayerColors?: { zValue?: string | string[] };
	AssetColor?: string;
	CrestColor?: string;
	zHexValue?: string;
}

// `inBase` is presence in Infos/<stem>.xml — see BASE vs CAMPAIGN above.
type Merged = Entry & { inBase: boolean };

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

function definedFields<T extends object>(o: T): Partial<T> {
	return Object.fromEntries(
		Object.entries(o).filter(([, v]) => v !== undefined),
	) as Partial<T>;
}

// Base Infos/<stem>.xml plus every Mods/*/Infos/<stem>-{add,change}.xml, in
// that order, collapsed by zType with a per-field merge — a -change entry that
// only touches gameplay fields keeps the earlier colour assignment. Each
// merged entry records whether the base file defined it.
async function loadMerged(stem: string): Promise<Map<string, Merged>> {
	const xmlDir = resolveReferenceXml();
	const merged = new Map<string, Merged>();

	const absorb = (entries: Entry[], inBase: boolean): void => {
		for (const e of entries) {
			if (!e.zType) continue;
			const prev = merged.get(e.zType);
			merged.set(
				e.zType,
				prev == null
					? { ...e, inBase }
					: { ...prev, ...definedFields(e), inBase: prev.inBase || inBase },
			);
		}
	};

	absorb(
		parseEntries(await readFile(resolve(xmlDir, "Infos", `${stem}.xml`), "utf-8")),
		true,
	);
	const modsRoot = resolve(xmlDir, "Mods");
	const mods = (await readdir(modsRoot, { withFileTypes: true }))
		.filter((e) => e.isDirectory())
		.map((e) => e.name)
		.sort();
	for (const mod of mods) {
		for (const suffix of ["add", "change"]) {
			const path = resolve(modsRoot, mod, "Infos", `${stem}-${suffix}.xml`);
			if (!existsSync(path)) continue;
			absorb(parseEntries(await readFile(path, "utf-8")), false);
		}
	}
	return merged;
}

// #rrggbbaa → #rrggbb, rejecting an alpha that carries meaning. See ALPHA IS
// NORMALISED above for why a pass-through 8-digit value is a rendering bug.
function toOpaqueHex(hex: string, context: string): string {
	const bare = hex.replace(/^#/, "");
	if (bare.length === 6) return `#${bare}`;
	if (bare.length === 8) {
		const alpha = bare.slice(6).toLowerCase();
		if (alpha !== "ff") {
			throw new Error(
				`bake-civilization-colors: ${context} resolved ${hex}, whose alpha ${alpha} is not ff — the app's hex parsers would render it as a wrong colour, and dropping a real alpha would be a lie`,
			);
		}
		return `#${bare.slice(0, 6)}`;
	}
	throw new Error(
		`bake-civilization-colors: ${context} resolved ${hex}, which is neither 6 nor 8 hex digits`,
	);
}

async function main(): Promise<void> {
	const [nations, tribes, teamColors, playerColors, colors] = await Promise.all([
		loadMerged("nation"),
		loadMerged("tribe"),
		loadMerged("teamColor"),
		loadMerged("playerColor"),
		loadMerged("color"),
	]);

	const hexByColor = new Map(
		[...colors.values()].map((c) => [c.zType, c.zHexValue]),
	);

	// The leg from a civ's <TeamColor> to a hex, given how that civ's team
	// colour names its player colour and which of that player colour's roles
	// the game reads.
	function resolve_(
		zType: string,
		teamColor: string | undefined,
		playerColorOf: (t: Merged) => string | undefined,
		roleOf: (p: Merged) => string | undefined,
	): string | undefined {
		const team = teamColor == null ? undefined : teamColors.get(teamColor);
		if (team == null) return undefined;
		const playerColorType = playerColorOf(team);
		const playerColor =
			playerColorType == null ? undefined : playerColors.get(playerColorType);
		if (playerColor == null) return undefined;
		const colorType = roleOf(playerColor);
		const hex = colorType == null ? undefined : hexByColor.get(colorType);
		return hex == null
			? undefined
			: toOpaqueHex(hex, `${zType} → ${teamColor} → ${colorType}`);
	}

	// A BASE civ whose colour doesn't resolve is a parse drift, not a missing
	// feature — fail the bake. Unresolvable scenario content we haven't audited
	// only warns (the accessors have a per-civ fallback), matching
	// bake-family-colors' stance on mod assets.
	function table(
		label: string,
		civs: Map<string, Merged>,
		resolveOne: (zType: string, civ: Merged) => string | undefined,
		floor: number,
	): Record<string, string> {
		const out: Record<string, string> = {};
		for (const [zType, civ] of civs) {
			const hex = resolveOne(zType, civ);
			if (hex == null) {
				if (civ.inBase) {
					throw new Error(
						`bake-civilization-colors: ${zType} → ${civ.TeamColor ?? "(no TeamColor)"} did not resolve to a hex colour`,
					);
				}
				console.warn(
					`bake-civilization-colors: WARN unresolved campaign ${label} ${zType}`,
				);
				continue;
			}
			out[zType] = hex;
		}
		const baseResolved = [...civs].filter(
			([zType, civ]) => civ.inBase && out[zType] != null,
		).length;
		if (baseResolved !== floor) {
			throw new Error(
				`bake-civilization-colors: ${baseResolved} base ${label}s resolved, expected ${floor}`,
			);
		}
		return out;
	}

	const nationColors = table(
		"nation",
		nations,
		(zType, n) =>
			resolve_(
				zType,
				n.TeamColor,
				(t) => t.TeamPlayerColor,
				(p) => p.AssetColor,
			),
		BASE_NATION_COUNT,
	);
	const tribeColors = table(
		"tribe",
		tribes,
		(zType, t) =>
			resolve_(
				zType,
				t.TeamColor,
				(team) => {
					const v = team.aePlayerColors?.zValue;
					const palette = v == null ? [] : Array.isArray(v) ? v : [v];
					return palette[0];
				},
				(p) => p.CrestColor,
			),
		BASE_TRIBE_COUNT,
	);
	const baseNations = [...nations]
		.filter(([zType, n]) => n.inBase && nationColors[zType] != null)
		.map(([zType]) => zType)
		.sort();

	function sortKeys(t: Record<string, string>): Record<string, string> {
		return Object.fromEntries(
			Object.keys(t)
				.sort()
				.map((k) => [k, t[k]]),
		);
	}

	const lines: string[] = [];
	lines.push(
		"// AUTO-GENERATED by scripts/bake-civilization-colors.ts. Do not edit.",
	);
	lines.push(
		"// Run `npm run bake:civilization-colors` to refresh from Reference/XML.",
	);
	lines.push("");
	lines.push("// Nation → the game's colour for it (nation.xml TeamColor →");
	lines.push("// teamColor.xml TeamPlayerColor → playerColor.xml AssetColor →");
	lines.push("// color.xml hex). Covers the base roster and the campaign");
	lines.push("// nations, which reuse base colours — duplicate hexes across");
	lines.push("// civs are what the game does.");
	lines.push(
		`export const NATION_COLORS: Readonly<Record<string, string>> = ${JSON.stringify(sortKeys(nationColors))};`,
	);
	lines.push("");
	lines.push("// Tribe → the game's colour for it, the chain");
	lines.push("// InfoHelpers.getTribeColor reads (tribe.xml TeamColor →");
	lines.push("// teamColor.xml aePlayerColors[0] → playerColor.xml CrestColor →");
	lines.push("// color.xml hex). Not TeamPlayerColor, which is");
	lines.push("// PLAYERCOLOR_BARBARIANS for every tribe.");
	lines.push(
		`export const TRIBE_COLORS: Readonly<Record<string, string>> = ${JSON.stringify(sortKeys(tribeColors))};`,
	);
	lines.push("");
	lines.push("// The nations Infos/nation.xml defines, as opposed to the ones a");
	lines.push("// campaign's Mods/*/Infos/nation-add.xml adds. Nothing in the XML");
	lines.push("// flags a campaign nation, so the file an entry came from is the");
	lines.push("// only derivable split.");
	lines.push(
		`export const BASE_NATIONS: readonly string[] = ${JSON.stringify(baseNations)};`,
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
			console.log("bake-civilization-colors: no changes");
			return;
		}
	}
	await writeFile(OUTPUT_TS, formatted);
	console.log(
		`bake-civilization-colors: ${Object.keys(nationColors).length} nations (${baseNations.length} base) + ${Object.keys(tribeColors).length} tribes → ${OUTPUT_TS.replace(REPO_ROOT + "/", "")}`,
	);
}

await main();
