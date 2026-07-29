// Bake each family's colour from the OW reference XML, so the Families tab
// can colour a family's opinion line and name the way the game does.
//
// SOURCES (local-only, via the Reference/ symlink resolved by paths.ts):
//   Reference/XML/Infos/family.xml — <TeamColor> + <iColorIndex> per family.
//   Reference/XML/Infos/teamColor.xml — <aePlayerColors>, the nation's family
//     palette; the family's colour is entry [iColorIndex] (zero-based —
//     City.cs:3264 `maePlayerColors[family().miColorIndex]`).
//   Reference/XML/Infos/playerColor.xml — <AssetColor> per palette entry.
//   Reference/XML/Infos/color.xml — <zHexValue> per colour.
//   Mods/*/Infos/{family,teamColor,playerColor,color}-{add,change}.xml — the
//     campaign/scenario content (Thebes, Hyksos, Kush, …), merged last-wins
//     by zType with per-field updates, the bake-improvements Mods pattern.
//     Uploaded campaign saves carry these families.
//
// Each family belongs to exactly one nation, so the family zType alone keys
// the family × nation colour the game shows.
//
// OUTPUT: src/lib/generated/family-colors.ts (checked in, self-contained).
//
// Run: npm run bake:family-colors

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { XMLParser } from "fast-xml-parser";
import { format as prettierFormat, resolveConfig } from "prettier";

import { resolveReferenceXml } from "./lib/paths.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const OUTPUT_TS = resolve(REPO_ROOT, "src/lib/generated/family-colors.ts");

interface Entry {
	zType?: string;
	TeamColor?: string;
	iColorIndex?: string;
	aePlayerColors?: { zValue?: string | string[] };
	AssetColor?: string;
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

// Base Infos/<stem>.xml plus every Mods/*/Infos/<stem>-{add,change}.xml, in
// that order — later entries override earlier ones per field, so scenario
// content lands on top of the base definitions. Each entry carries `fromMod`
// so resolution failures in unaudited scenario content warn instead of
// failing the bake.
async function loadEntriesWithMods(
	stem: string,
): Promise<(Entry & { fromMod?: boolean })[]> {
	const xmlDir = resolveReferenceXml();
	const out: (Entry & { fromMod?: boolean })[] = parseEntries(
		await readFile(resolve(xmlDir, "Infos", `${stem}.xml`), "utf-8"),
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
			for (const e of parseEntries(await readFile(path, "utf-8"))) {
				out.push({ ...e, fromMod: true });
			}
		}
	}
	return out;
}

// Collapse an entry list by zType with per-field merge — a -change entry
// that only touches gameplay fields keeps the earlier colour assignment.
function mergeByZType(
	entries: (Entry & { fromMod?: boolean })[],
): Map<string, Entry & { fromMod?: boolean }> {
	const map = new Map<string, Entry & { fromMod?: boolean }>();
	for (const e of entries) {
		if (!e.zType) continue;
		const prev = map.get(e.zType);
		map.set(e.zType, prev == null ? e : { ...prev, ...definedFields(e) });
	}
	return map;
}

function definedFields<T extends object>(o: T): Partial<T> {
	return Object.fromEntries(
		Object.entries(o).filter(([, v]) => v !== undefined),
	) as Partial<T>;
}

async function main(): Promise<void> {
	const [families, teamColors, playerColors, colors] = await Promise.all([
		loadEntriesWithMods("family"),
		loadEntriesWithMods("teamColor"),
		loadEntriesWithMods("playerColor"),
		loadEntriesWithMods("color"),
	]);

	const paletteByTeam = new Map(
		[...mergeByZType(teamColors).values()].map((t) => {
			const v = t.aePlayerColors?.zValue;
			return [t.zType, v == null ? [] : Array.isArray(v) ? v : [v]];
		}),
	);
	const assetByPlayerColor = new Map(
		[...mergeByZType(playerColors).values()].map((p) => [p.zType, p.AssetColor]),
	);
	const hexByColor = new Map(
		[...mergeByZType(colors).values()].map((c) => [c.zType, c.zHexValue]),
	);

	const familyColors: Record<string, string> = {};
	for (const f of mergeByZType(families).values()) {
		if (!f.zType || !f.TeamColor || f.iColorIndex == null) continue;
		const palette = paletteByTeam.get(f.TeamColor) ?? [];
		const playerColor = palette[Number(f.iColorIndex)];
		const hex = hexByColor.get(assetByPlayerColor.get(playerColor) ?? "");
		if (!hex) {
			// A BASE family with a palette assignment that doesn't resolve is a
			// parse drift, not a missing feature — fail the bake. Unresolvable
			// scenario content we haven't audited only warns (the UI has a
			// per-family fallback), matching bake-improvements' stance on mod
			// assets.
			if (!f.fromMod) {
				throw new Error(
					`bake-family-colors: ${f.zType} → ${f.TeamColor}[${f.iColorIndex}] did not resolve to a hex colour`,
				);
			}
			console.warn(`bake-family-colors: WARN unresolved mod family ${f.zType}`);
			continue;
		}
		familyColors[f.zType] = hex;
	}
	if (Object.keys(familyColors).length < 20) {
		throw new Error(
			`bake-family-colors: only ${Object.keys(familyColors).length} families resolved`,
		);
	}

	const sorted = Object.fromEntries(
		Object.keys(familyColors)
			.sort()
			.map((k) => [k, familyColors[k]]),
	);
	const lines: string[] = [];
	lines.push("// AUTO-GENERATED by scripts/bake-family-colors.ts. Do not edit.");
	lines.push(
		"// Run `npm run bake:family-colors` to refresh from Reference/XML.",
	);
	lines.push("");
	lines.push("// Family → the game's colour for it (family.xml TeamColor +");
	lines.push("// iColorIndex → teamColor.xml palette → playerColor.xml");
	lines.push("// AssetColor → color.xml hex). Families are per-nation, so the");
	lines.push("// zType alone keys the family × nation colour.");
	lines.push(
		`export const FAMILY_COLORS: Readonly<Record<string, string>> = ${JSON.stringify(sorted)};`,
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
			console.log("bake-family-colors: no changes");
			return;
		}
	}
	await writeFile(OUTPUT_TS, formatted);
	console.log(
		`bake-family-colors: ${Object.keys(sorted).length} families → ${OUTPUT_TS.replace(REPO_ROOT + "/", "")}`,
	);
}

await main();
