// Bake the atlas map-caveat table (src/lib/generated/map-caveats.ts) from a
// local owtournamentatlas checkout (resolveAtlas in scripts/lib/paths.ts):
//
//   npx tsx scripts/bake-map-caveats.ts
//
// For every map in the atlas' published pool it records the minimum city-site
// count observed across that config's generations (atlas src/data/atlas-dist
// .json, dist.sites.min), keyed by the map's atlas URL anchor. The frontend
// uses the table two ways: `mapInAtlas` (a map is linkable iff its anchor is a
// key here) and the "can spawn with 10 or fewer city sites" caveat in the
// admin scheduling DM (mapCaveatNote).
//
// The anchor is the atlas' own `slugify(cfgLabel(short))` — the compact label
// ("Sq Duel Sm Seas AridP PS") lowercased with non-alphanumerics collapsed to
// hyphens. That logic is replicated below from the atlas' index.astro and MUST
// stay in sync with both the atlas and per-ankh's atlasAnchor()
// (src/lib/tournament/map-script-options.ts); the pool (which slugs are
// published, and therefore which variant options are "distinguishing") is
// parsed out of the atlas' index.astro rather than duplicated here.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAtlas } from "./lib/paths";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const OUT = resolve(REPO_ROOT, "src/lib/generated/map-caveats.ts");

interface AtlasConfig {
	slug: string;
	group: string;
	variant: string;
	setting: string;
	dist: { sites?: { min: number } };
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

const slugify = (s: string): string =>
	s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");

// --- Bake ---

async function main(): Promise<void> {
	const atlasDir = resolveAtlas();
	const dist = JSON.parse(
		readFileSync(join(atlasDir, "src/data/atlas-dist.json"), "utf-8"),
	) as { configs: AtlasConfig[] };

	// The published pool, parsed from the atlas index page's POOL array so the
	// list isn't duplicated here. Fails loudly if the source shape changes.
	const indexSrc = readFileSync(
		join(atlasDir, "src/pages/index.astro"),
		"utf-8",
	);
	const poolBlock = indexSrc.match(
		/const POOL: string\[\] = \[([\s\S]*?)\];/,
	)?.[1];
	if (!poolBlock) {
		throw new Error(
			"could not find `const POOL: string[] = [...]` in the atlas index.astro — its shape changed; update bake-map-caveats.ts",
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

	const rows = pool.map((c) => {
		const min = c.dist.sites?.min;
		if (min == null) {
			throw new Error(`config ${c.slug} has no dist.sites.min`);
		}
		return { anchor: slugify(cfgLabelShort(c, multiVariant)), min };
	});

	const body = rows
		.map((r) => `\t${JSON.stringify(r.anchor)}: ${r.min},`)
		.join("\n");
	const out =
		`// Generated by scripts/bake-map-caveats.ts — do not edit by hand.\n` +
		`// Source: owtournamentatlas src/data/atlas-dist.json (dist.sites.min per\n` +
		`// published pool config), keyed by the map's atlas URL anchor (the same\n` +
		`// slug atlasAnchor() in $lib/tournament/map-script-options produces).\n` +
		`// Re-run when the atlas pool or its generation stats change.\n\n` +
		`// Minimum city sites observed across a map's generations. A map "can\n` +
		`// sometimes spawn with 10 or fewer city sites" when its minimum is at or\n` +
		`// below LOW_CITY_SITES_THRESHOLD — surfaced in the admin scheduling DM so\n` +
		`// players know a low-site roll may be rerolled. Maps absent here are not\n` +
		`// in the atlas (no caveat, no link).\n` +
		`export const MAP_MIN_CITY_SITES: Record<string, number> = {\n${body}\n};\n\n` +
		`// A map can spawn few city sites when its observed minimum is at or below\n` +
		`// this.\n` +
		`export const LOW_CITY_SITES_THRESHOLD = 10;\n`;

	writeFileSync(OUT, out);
	console.log(`wrote ${OUT} (${rows.length} maps)`);
}

main().catch((err: unknown) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
