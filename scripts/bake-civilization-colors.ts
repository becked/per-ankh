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
//     updates (scripts/lib/reference-xml.ts, shared with bake-crest-sprites).
//     Uploaded campaign saves carry these civs.
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
//   Nations — ClientRenderer.drawTileOnTurn (ClientRenderer.cs:1137) paints a
//     player's territory with playerColor(player.getPrimaryPlayerColor(..))
//     .meAssetColor (:1160), and getPrimaryPlayerColor is getTeamPlayerColor
//     (Player.cs:7347 → :7315), the nation's own team colour. So the static
//     chain is:
//       nation <TeamColor> → teamColor <TeamPlayerColor>
//         → playerColor <AssetColor> → color <zHexValue>
//     which reproduces the hand-maintained table this baker replaces, hex for
//     hex on all 13 base nations.
//
//     Game.getNationColor (Game.cs:21765) is a different ROLE, not a different
//     chain: it walks the same TeamPlayerColor leg through the live Player
//     (getPlayerNameColor, Player.cs:4969) and then reads meTextColor where the
//     renderer reads meAssetColor. The two roles disagree for 7 of the 13 base
//     nations — Egypt #bc6304 vs #f88f1f, and Rome, Greece, Babylonia, Kush,
//     Aksum, Maurya — so the pick is load-bearing. AssetColor is the one to
//     bake: it paints the civ's territory and its units' primary colour
//     (Unit.getAssetColors, Unit.cs:3761), which is what a reader recognises a
//     civ by on the map, where TextColor writes the player's NAME and its
//     minimap city dot (Game.cs:21744).
//
//   The BORDER a city nobody holds draws in — one leg, one value, shared.
//     Game.getBorderColors (Game.cs:21782) colours territory from the CITY
//     rather than from the tile's owning player, and for a city whose tribe is
//     set it reads City.getPrimaryPlayerColor (City.cs:3279) and then
//     meBorderColor:
//       tribe <TeamColor> → teamColor <TeamPlayerColor>
//         → playerColor <BorderColor> → color <zHexValue>
//     This is the TeamPlayerColor leg the tribe note above warns off for a
//     tribe's own colour — and here that is the point: the value is the same
//     near-black for every tribe, which is what the game paints a captured
//     city's border. So it is emitted as ONE constant, and the bake fails if
//     the tribes ever stop agreeing rather than silently picking one.
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

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { format as prettierFormat, resolveConfig } from "prettier";

import { loadMergedEntries, type WithBase } from "./lib/reference-xml.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const OUTPUT_TS = resolve(
	REPO_ROOT,
	"src/lib/generated/civilization-colors.ts",
);

interface Entry {
	zType?: string;
	TeamColor?: string;
	TeamPlayerColor?: string;
	aePlayerColors?: { zValue?: string | string[] };
	AssetColor?: string;
	BorderColor?: string;
	CrestColor?: string;
	zHexValue?: string;
}

// `inBase` is presence in Infos/<stem>.xml — see BASE vs CAMPAIGN above.
// The merge itself is shared (scripts/lib/reference-xml.ts).
type Merged = WithBase<Entry>;

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
	const [nations, tribes, teamColors, playerColors, colors] = await Promise.all(
		[
			loadMergedEntries<Entry>("nation"),
			loadMergedEntries<Entry>("tribe"),
			loadMergedEntries<Entry>("teamColor"),
			loadMergedEntries<Entry>("playerColor"),
			loadMergedEntries<Entry>("color"),
		],
	);

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
		// The structural floor is that Infos/<stem>.xml yielded a base roster at
		// all. A base civ that doesn't resolve already threw above, so what is
		// left to catch here is a total parse miss — a renamed root element,
		// where parseEntries returns [] and the table comes out empty rather
		// than wrong. Deliberately not a roster size: Old World shipping a 14th
		// nation is new content, not drift, and BASE_NATIONS is a facet list
		// (src/lib/stats/global-facets.ts) where one more nation is one more
		// option.
		const baseResolved = [...civs].filter(
			([zType, civ]) => civ.inBase && out[zType] != null,
		).length;
		if (baseResolved === 0) {
			throw new Error(
				`bake-civilization-colors: no base ${label} resolved — did Infos/ parse?`,
			);
		}
		return out;
	}

	const nationColors = table("nation", nations, (zType, n) =>
		resolve_(
			zType,
			n.TeamColor,
			(t) => t.TeamPlayerColor,
			(p) => p.AssetColor,
		),
	);
	const tribeColors = table("tribe", tribes, (zType, t) =>
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
	);
	// The one border primary every tribe shares — see the BORDER note in the
	// header. Resolved per tribe and then collapsed, so a tribe that stops
	// agreeing fails the bake instead of letting one hex stand in for the
	// others.
	const borderByTribe = new Map<string, string>();
	for (const [zType, tribe] of tribes) {
		const hex = resolve_(
			zType,
			tribe.TeamColor,
			(team) => team.TeamPlayerColor,
			(p) => p.BorderColor,
		);
		if (hex == null) {
			if (tribe.inBase) {
				throw new Error(
					`bake-civilization-colors: ${zType} → ${tribe.TeamColor ?? "(no TeamColor)"} did not resolve to a border colour`,
				);
			}
			console.warn(
				`bake-civilization-colors: WARN unresolved campaign tribe border ${zType}`,
			);
			continue;
		}
		borderByTribe.set(zType, hex);
	}
	const distinctBorders = [...new Set(borderByTribe.values())].sort();
	if (distinctBorders.length !== 1) {
		throw new Error(
			`bake-civilization-colors: the tribes' border primary is no longer one shared colour — ${distinctBorders.join(", ")} across ${borderByTribe.size} tribes. It is emitted as a single constant; split it per tribe, or fix the chain.`,
		);
	}
	const tribeBorderColor = distinctBorders[0];

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
	lines.push(
		"// teamColor.xml aePlayerColors[0] → playerColor.xml CrestColor →",
	);
	lines.push("// color.xml hex). Not TeamPlayerColor, which is");
	lines.push("// PLAYERCOLOR_BARBARIANS for every tribe.");
	lines.push(
		`export const TRIBE_COLORS: Readonly<Record<string, string>> = ${JSON.stringify(sortKeys(tribeColors))};`,
	);
	lines.push("");
	lines.push(
		"// The nations Infos/nation.xml defines, as opposed to the ones a",
	);
	lines.push(
		"// campaign's Mods/*/Infos/nation-add.xml adds. Nothing in the XML",
	);
	lines.push(
		"// flags a campaign nation, so the file an entry came from is the",
	);
	lines.push("// only derivable split.");
	lines.push(
		`export const BASE_NATIONS: readonly string[] = ${JSON.stringify(baseNations)};`,
	);
	lines.push("");
	lines.push("// The border colour the game paints a city no player holds:");
	lines.push("// Game.getBorderColors reads the CITY's primary player colour");
	lines.push("// (City.getPrimaryPlayerColor → the tribe's TeamPlayerColor,");
	lines.push("// which is PLAYERCOLOR_BARBARIANS for every tribe) and then");
	lines.push("// its BorderColor. One value, shared by all");
	lines.push(
		`// ${borderByTribe.size} tribes — the bake fails if they ever disagree.`,
	);
	lines.push(
		`export const TRIBE_BORDER_COLOR = ${JSON.stringify(tribeBorderColor)};`,
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
		`bake-civilization-colors: ${Object.keys(nationColors).length} nations (${baseNations.length} base) + ${Object.keys(tribeColors).length} tribes, border ${tribeBorderColor} → ${OUTPUT_TS.replace(REPO_ROOT + "/", "")}`,
	);
}

await main();
