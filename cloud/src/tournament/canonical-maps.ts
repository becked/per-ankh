// Canonical map_script values accepted by the API.
//
// Mirror of the `value` strings in src/lib/tournament/map-scripts.ts
// KNOWN_MAP_SCRIPTS. Keep these two lists in sync when a new DLC ships
// or Mohawk renames an entry.
//
// Why duplicated: cloud/ is a separate package with its own tsconfig
// (cloud/tsconfig.json), bundled by wrangler/esbuild — importing from
// ../../../src/lib/tournament/map-scripts would pull in SvelteKit-shaped
// modules ($lib/utils/formatting and friends) that the Worker bundle
// doesn't need to ship.
//
// Drift safety nets: the create-tournament integration test (which
// exercises the strict schema) will fail if a value here doesn't exist
// in the lookup table, and the admin CLI does its own validation against
// the SvelteKit list (scripts/admin/commands/tournament.ts).

export const CANONICAL_MAP_SCRIPTS: readonly string[] = [
	// Base game
	"MAPCLASS_MapScriptArchipelago",
	"MAPCLASS_MapScriptAridPlateau",
	"MAPCLASS_MapScriptBay",
	"MAPCLASS_MapScriptCoastalRainBasin",
	"MAPCLASS_MapScriptContinent",
	"MAPCLASS_MapScriptDesert",
	"MAPCLASS_MapScriptDisjunction",
	"MAPCLASS_MapScriptDonut",
	"MAPCLASS_MapScriptHardwoodForest",
	"MAPCLASS_MapScriptHighlands",
	"MAPCLASS_MapScriptInlandSea2",
	"MAPCLASS_MapScripLakesAndGulfs",
	"MAPCLASS_MapScriptMediterrancean",
	"MAPCLASS_MapScriptContinents",
	"MAPCLASS_MapScriptNorthernOcean",
	"MAPCLASS_MapScriptPlayerIslands",
	"MAPCLASS_MapScriptSeaside",

	// Wrath of Gods DLC
	"MAPCLASS_MapScriptDesolation",
	"MAPCLASS_MapScriptEbbingSea",
	"MAPCLASS_MapScriptRejuvenation",
	"MAPCLASS_MapScriptTumblingMountain",

	// Empires of the Indus DLC
	"MAPCLASS_MapscriptJungle",
	"MAPCLASS_MapScriptDota",
	"MAPCLASS_MapscriptMountainPass",
	"MAPCLASS_MapscriptWetlands",
];

export const CANONICAL_MAP_SCRIPTS_SET: ReadonlySet<string> = new Set(
	CANONICAL_MAP_SCRIPTS,
);
