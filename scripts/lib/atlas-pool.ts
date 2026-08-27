// The community map atlas' published pool, read from a local
// owtournamentatlas checkout (resolveAtlas in ./paths).
//
// Two bakers consume this — bake-map-caveats (city-site caveats, frontend) and
// bake-atlas-pool (the Worker's copy, for suggesting a map to a pair of
// players) — and both need the same three things the atlas doesn't hand over
// directly: which configs are in the published pool, what each one's URL anchor
// is, and which Old World map script it runs. Extracted rather than copied
// because the label rules below mirror the atlas' own index.astro, and two
// copies of a mirror drift in different directions.
//
// Everything here fails loudly. A silent miss would bake a pool that is quietly
// missing a map, or worse, one whose anchors don't resolve.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { KNOWN_MAP_SCRIPTS } from "../../src/lib/tournament/map-scripts";
import { slugify } from "../../src/lib/utils/slug";
import { resolveAtlas } from "./paths";

interface AtlasConfig {
	slug: string;
	group: string;
	variant: string;
	setting: string;
	dist: { sites?: { min: number } };
}

interface AtlasPoolEntry {
	// The map's atlas URL anchor — slugify(compact label), the same value
	// atlasAnchor() produces at runtime in $lib/tournament/map-script-options.
	anchor: string;
	// The Old World map script it runs, e.g. MAPCLASS_MapScriptCoastalRainBasin.
	script: string;
	// What to call this map: the script the atlas groups by, plus the variant
	// when the pool holds more than one of that script and the variant is what
	// tells them apart — "DOTA Jungle" and "DOTA Sand" rather than two maps both
	// called DOTA. Named in the atlas' own vocabulary, abbreviations included
	// ("Desert NoCst"), because the link beside it goes to a page using exactly
	// those words. Two configurations of one script that differ only in their
	// setting (the two Archipelagos) share a name, and the setting tells them
	// apart.
	name: string;
	// "Duel · wide · point-sym off · mirror".
	setting: string;
	// Fewest city sites observed across this config's generations.
	minSites: number;
}

// --- Atlas label logic (mirrors owtournamentatlas src/pages/index.astro) ---

const SCRIPT_SHORT: Record<string, string> = {
	Archipelago: "Arch",
	"Arid Plateau": "AridP",
	"Coastal Rain Basin": "CRB",
	Continent: "Cont",
	Desert: "Desert",
	Donut: "Donut",
	DOTA: "DOTA",
	"Hardwood Forest": "Hardwood",
	Highlands: "Highlands",
	"Inland Sea": "InlSea",
	"Mountain Pass": "MtnPass",
	Wetlands: "Wetlands",
};

const sizeOf = (c: AtlasConfig): string =>
	(c.setting || "").split(" · ")[0] === "Tiny" ? "Tiny" : "Duel";
const symOf = (c: AtlasConfig): string =>
	((c.setting || "").split(" · ")[2] || "").includes("on") ? "Sym" : "No-Sym";
const aspOf = (c: AtlasConfig): string => {
	const a = (c.setting || "").split(" · ")[1] || "";
	return a ? a[0].toUpperCase() + a.slice(1) : "";
};

function optionLabel(c: AtlasConfig, multiVariant: Set<string>): string {
	if (!multiVariant.has(c.group)) return "";
	if (c.group === "Desert") {
		const coast = (c.variant || "").split(" · ")[0];
		return coast === "None" ? "NoCst" : coast;
	}
	if (c.group === "Arid Plateau") {
		if (/large/i.test(c.variant)) return "Lg Seas";
		if (/small/i.test(c.variant)) return "Sm Seas";
	}
	return c.variant || "";
}

function cfgLabelShort(c: AtlasConfig, multiVariant: Set<string>): string {
	const asp = aspOf(c) === "Wide" ? "Wide" : "Sq";
	const script = SCRIPT_SHORT[c.group] ?? c.group;
	const ps = symOf(c) === "Sym" && c.group !== "DOTA" ? "PS" : "";
	return [asp, sizeOf(c), optionLabel(c, multiVariant), script, ps]
		.filter(Boolean)
		.join(" ");
}

// The atlas names a script group the way a player says it out loud ("DOTA",
// "Coastal Rain Basin"); Old World names it MAPCLASS_MapScriptDota. Every group
// in the pool resolves against one of the two names per-ankh already keeps for
// each script — its label or its abbreviation — so the join is derived rather
// than a hand-written alias table that would silently rot.
function scriptForGroup(group: string): string {
	const wanted = group.toLowerCase();
	const match = KNOWN_MAP_SCRIPTS.find(
		(s) =>
			s.label.toLowerCase() === wanted || s.abbrev.toLowerCase() === wanted,
	);
	if (!match) {
		throw new Error(
			`atlas script group "${group}" matches no label or abbrev in ` +
				`src/lib/tournament/map-scripts.ts — the atlas added a script, or ` +
				`renamed one. Add it there first.`,
		);
	}
	return match.value;
}

export function readAtlasPool(): AtlasPoolEntry[] {
	const atlasDir = resolveAtlas();
	const dist = JSON.parse(
		readFileSync(join(atlasDir, "src/data/atlas-dist.json"), "utf-8"),
	) as { configs: AtlasConfig[] };

	// The published pool, parsed from the atlas index page's POOL array so the
	// list isn't duplicated here.
	const indexSrc = readFileSync(
		join(atlasDir, "src/pages/index.astro"),
		"utf-8",
	);
	const poolBlock = indexSrc.match(
		/const POOL: string\[\] = \[([\s\S]*?)\];/,
	)?.[1];
	if (!poolBlock) {
		throw new Error(
			"could not find `const POOL: string[] = [...]` in the atlas index.astro — its shape changed; update scripts/lib/atlas-pool.ts",
		);
	}
	const poolSlugs = [...poolBlock.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
	if (poolSlugs.length === 0) {
		throw new Error("parsed an empty POOL from the atlas index.astro");
	}

	const bySlug = new Map(dist.configs.map((c) => [c.slug, c]));
	const pool = poolSlugs.map((s) => {
		const c = bySlug.get(s);
		if (!c) throw new Error(`pool slug not in atlas-dist.json: ${s}`);
		return c;
	});

	// Script groups with >1 variant in the pool — only their variant appears in
	// labels/anchors (mirrors the atlas' multiVariant computation).
	const variantsByGroup = new Map<string, Set<string>>();
	for (const c of pool) {
		let seen = variantsByGroup.get(c.group);
		if (!seen) {
			seen = new Set();
			variantsByGroup.set(c.group, seen);
		}
		seen.add(c.variant || "");
	}
	const multiVariant = new Set(
		[...variantsByGroup]
			.filter(([, values]) => values.size > 1)
			.map(([group]) => group),
	);

	return pool.map((c) => {
		const minSites = c.dist.sites?.min;
		if (minSites == null) {
			throw new Error(`config ${c.slug} has no dist.sites.min`);
		}
		const variant = optionLabel(c, multiVariant);
		return {
			anchor: slugify(cfgLabelShort(c, multiVariant)),
			script: scriptForGroup(c.group),
			name: variant ? `${c.group} ${variant}` : c.group,
			setting: c.setting,
			minSites,
		};
	});
}
