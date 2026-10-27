// Bake everything that grants a victory point, so `victoryPointsByPlayer`
// (src/lib/game-detail/victory-points.ts) can recompute `Player.countVP`
// (Player.cs:19230) over a save's end state instead of reading the game's
// turn-start sample.
//
// `countVP` sums three terms, and each one reaches its value through a table
// baked here:
//
//   - every owned city's culture tier, worth `culture.xml` <iVP>
//     (`Player.countCultureCities`, Player.cs:18540), plus one per culture
//     step past the top tier (`Player.countCultureStepVPs`, Player.cs:18556)
//   - every active effect player worth `effectPlayer.xml` <iVP>
//     (`Player.getEffectPlayerCount`)
//
// Nothing names an effect player as "the VP one" — the <iVP> is on the effect
// player and the grant is on whatever carries <EffectPlayer>. So the bake
// resolves the second term the way the game does: collect the effect players
// with a non-zero <iVP>, then invert every table that names one. 38 effect
// players carry a VP, and they resolve to 34 improvements, 3 techs and 1
// project — nothing else in the XML grants one, which is why those three are
// the only inverted tables and why `main` fails if an effect player is left
// unreferenced.
//
// SOURCES (local-only, via the Reference/ resolver — set OLD_WORLD_REFERENCE_DIR
// to an OW install or an XML checkout such as the owtournamentatlas repo), each
// merged with its campaign/scenario Mods overlays the way the game assembles it
// (scripts/lib/reference-xml.ts), because uploaded campaign saves name content
// those Mods add:
//   Infos/culture.xml       — <zType>, <iVP>
//   Infos/effectPlayer.xml  — <zType>, <iVP>
//   Infos/improvement.xml   — <zType>, <EffectPlayer>
//   Infos/tech.xml          — <zType>, <EffectPlayer>
//   Infos/project.xml       — <zType>, <EffectPlayer>
// The shipped Mods add no VP of their own — the merged tables are the same 38
// / 34 / 3 / 1 the base files alone produce — but a campaign that added one
// would be a seat whose total came out short, so the merge is what the bake
// reads rather than Infos/ alone.
//
// OUTPUT: src/lib/generated/victory-points.ts (checked in, self-contained — no
// .bake sidecar, so bake:finalize never wipes it when this hasn't run). One
// module rather than the wonders dual-emit: the Worker reaches the table
// through the shared helper, which it imports across the package boundary the
// way cloud/src/games.ts imports gdp-basket.ts.
//
// Deterministic — re-running with the same XML is byte-identical.
//
// Run: npm run bake:victory-points

import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { format as prettierFormat, resolveConfig } from "prettier";

import { loadMergedEntries, type ReferenceEntry } from "./lib/reference-xml.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const OUTPUT_TS = resolve(REPO_ROOT, "src/lib/generated/victory-points.ts");

interface VpEntry extends ReferenceEntry {
	iVP?: string;
}

interface GranterEntry extends ReferenceEntry {
	EffectPlayer?: string;
}

/** The three tables whose entries can carry a VP-bearing <EffectPlayer>. */
const GRANTER_TABLES = ["improvement", "tech", "project"] as const;

// Emit through Prettier so the committed file matches `npm run format`.
async function formatTs(path: string, source: string): Promise<string> {
	return prettierFormat(source, {
		...(await resolveConfig(path)),
		parser: "typescript",
		filepath: path,
	});
}

/** `<iVP>` as a positive integer, or 0 when the entry carries none. */
function vpOf(entry: VpEntry, label: string): number {
	if (entry.iVP == null || entry.iVP === "") return 0;
	const vp = Number(entry.iVP);
	if (!Number.isInteger(vp)) {
		throw new Error(`bake-victory-points: ${label} has a non-integer iVP`);
	}
	return vp;
}

function emitTable(
	name: string,
	comment: string[],
	table: Map<string, number>,
) {
	const body = [...table.keys()]
		.sort()
		.map((k) => `\t${JSON.stringify(k)}: ${table.get(k)},`)
		.join("\n");
	return [
		...comment.map((c) => `// ${c}`),
		`export const ${name}: Readonly<Record<string, number>> = {`,
		body,
		"};",
		"",
	].join("\n");
}

async function main(): Promise<void> {
	// Culture tier → its own VP, one per owned city at that tier. Every tier
	// carries one, which is also what makes `countCultureStepVPs`' own
	// `culture().miVP > 0` gate equivalent to "the city has a tier at all".
	const cultureVp = new Map<string, number>();
	for (const [zType, entry] of await loadMergedEntries<VpEntry>("culture")) {
		const vp = vpOf(entry, zType);
		if (vp !== 0) cultureVp.set(zType, vp);
	}
	if (cultureVp.size === 0) {
		throw new Error("bake-victory-points: culture.xml yielded no <iVP> tiers");
	}

	// The effect players a VP rides on — the intermediate the three granter
	// tables are inverted against, never emitted itself.
	const effectPlayerVp = new Map<string, number>();
	for (const [zType, entry] of await loadMergedEntries<VpEntry>(
		"effectPlayer",
	)) {
		const vp = vpOf(entry, zType);
		if (vp !== 0) effectPlayerVp.set(zType, vp);
	}
	if (effectPlayerVp.size === 0) {
		throw new Error(
			"bake-victory-points: effectPlayer.xml yielded no <iVP> entries",
		);
	}

	const granted = new Map<string, Map<string, number>>();
	const resolved = new Set<string>();
	for (const table of GRANTER_TABLES) {
		const out = new Map<string, number>();
		for (const [zType, entry] of await loadMergedEntries<GranterEntry>(table)) {
			const vp =
				entry.EffectPlayer != null
					? effectPlayerVp.get(entry.EffectPlayer)
					: undefined;
			if (vp == null) continue;
			out.set(zType, vp);
			resolved.add(entry.EffectPlayer as string);
		}
		granted.set(table, out);
	}

	// A VP-bearing effect player nothing names is a term `countVP` would add
	// and this bake would miss — either a new granter table or a parse drift.
	const orphans = [...effectPlayerVp.keys()]
		.filter((z) => !resolved.has(z))
		.sort();
	if (orphans.length > 0) {
		throw new Error(
			`bake-victory-points: ${orphans.length} VP effect player(s) named by no ${GRANTER_TABLES.join("/")}: ${orphans.join(", ")}`,
		);
	}

	const out =
		`// AUTO-GENERATED by scripts/bake-victory-points.ts from Reference/XML\n` +
		`// (culture.xml, effectPlayer.xml, improvement.xml, tech.xml, project.xml,\n` +
		`// each merged with its Mods overlays). Do not edit by hand — re-run\n` +
		`// \`npm run bake:victory-points\`.\n` +
		`//\n` +
		`// Every term of \`Player.countVP\` (Player.cs:19230). The improvement, tech\n` +
		`// and project tables are \`effectPlayer.xml\`'s <iVP> resolved through each\n` +
		`// table's <EffectPlayer>, so a zType absent from one grants nothing.\n` +
		`\n` +
		emitTable(
			"CULTURE_VP",
			[
				"A city's culture tier, worth this much to the player holding it",
				"(`Player.countCultureCities`, Player.cs:18540). A city past the top",
				"tier adds one more per culture step (`countCultureStepVPs`,",
				"Player.cs:18556).",
			],
			cultureVp,
		) +
		"\n" +
		emitTable(
			"IMPROVEMENT_VP",
			[
				"An improvement standing on a player's own tile, worth this much —",
				"wonders, holy sites, minor cities, the Stupa and the Hill Fort.",
				"Credited to the TILE's owner, for the tile's ACTIVE improvement:",
				"`Tile.changeImprovement` (Tile.cs:6550) reads `getActiveImprovement`",
				"(Tile.cs:5167), which excludes a pillaged or unfinished one, and",
				"grants nothing at all on a tile outside a city's territory.",
			],
			granted.get("improvement") as Map<string, number>,
		) +
		"\n" +
		emitTable(
			"TECH_VP",
			[
				"A completed tech, worth this much for as long as the player has it",
				"(`Player.setTechCount`, Player.cs:8452) — nothing takes the grant",
				"back, so it outlives the seat's last city. Keyed on the blob's",
				"`completed_techs`, which derives from TECH_DISCOVERED event logs",
				"rather than from <TechCount>; across test-data/saves the two name",
				"the same 60 VP-tech holdings, with 0 seats disagreeing.",
			],
			granted.get("tech") as Map<string, number>,
		) +
		"\n" +
		emitTable(
			"PROJECT_VP",
			[
				"A project, worth this much per city holding it",
				"(`City.loadProjectCount`, City.cs:5086), re-credited to the new owner",
				"on capture (`City.resetProjectCount`, City.cs:5131).",
			],
			granted.get("project") as Map<string, number>,
		);

	await writeFile(OUTPUT_TS, await formatTs(OUTPUT_TS, out), "utf-8");
	console.log(
		`[victory-points] ${cultureVp.size} culture tiers, ` +
			GRANTER_TABLES.map((t) => `${granted.get(t)?.size ?? 0} ${t}s`).join(
				", ",
			) +
			` from ${effectPlayerVp.size} effect players → ${OUTPUT_TS.replace(`${REPO_ROOT}/`, "")}`,
	);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
