// TypeScript-side parity dump CLI.
//
// Counterpart to src-tauri/src/bin/dump_parsed.rs. Imports TS parser modules
// from src/lib/parser/parsers/*.ts (no Worker — runs directly in Node) and
// emits the same envelope shape, but only for entities listed in
// manifest.implemented.
//
// While the implemented list is empty (the typical state at the start of the
// port), this CLI emits the bare metadata envelope and exits 0. The diff
// CLI's per-entity logic correctly classifies un-listed entities as
// `not_ported`, so an empty TS dump is a valid input for `rust-vs-ts`
// runs from day one.
//
// Usage:
//   tsx scripts/parity/dump.ts \
//     --save <save.zip> \
//     --out <ts-dump.json> \
//     --manifest scripts/parity/parity.config.json

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { sha256File } from "./cache.js";
import type { ParityConfig } from "./types.js";
import { extractXmlFromZip } from "../../src/lib/parser/extract-zip.js";
import { parseSaveXml } from "../../src/lib/parser/parse-xml.js";
import {
	characterMarriageToRow,
	characterRelationshipToRow,
	characterStatToRow,
	characterTraitToRow,
	parseCharacterMarriages,
	parseCharacterRelationships,
	parseCharacterStats,
	parseCharacterTraits,
} from "../../src/lib/parser/parsers/character-data.js";
import {
	characterToRow,
	parseCharacters,
} from "../../src/lib/parser/parsers/characters.js";
import {
	cityCultureToRow,
	cityEnemyAgentToRow,
	cityLuxuryToRow,
	cityProductionItemToRow,
	cityProjectCompletedToRow,
	cityProjectCountToRow,
	cityReligionToRow,
	cityToRow,
	cityYieldToRow,
	parseCities,
	parseCityCulture,
	parseCityEnemyAgents,
	parseCityLuxuries,
	parseCityProductionQueue,
	parseCityProjectCounts,
	parseCityProjectsCompleted,
	parseCityReligions,
	parseCityYields,
} from "../../src/lib/parser/parsers/cities.js";
import {
	diplomacyRelationToRow,
	parseDiplomacyRelations,
} from "../../src/lib/parser/parsers/diplomacy.js";
import {
	eventLogToRow,
	eventStoryToRow,
	memoryDataToRow,
	parseEventLogs,
	parseEventStories,
	parseMemoryData,
} from "../../src/lib/parser/parsers/events.js";
import {
	familyToRow,
	parseFamilies,
} from "../../src/lib/parser/parsers/families.js";
import {
	parsePlayers,
	playerToRow,
} from "../../src/lib/parser/parsers/players.js";
import {
	lawToRow,
	parseLaws,
	parsePlayerCouncil,
	parsePlayerGoals,
	parsePlayerResources,
	parseTechnologiesCompleted,
	parseTechnologyProgress,
	parseTechnologyStates,
	playerCouncilToRow,
	playerGoalToRow,
	playerResourceToRow,
	technologyCompletedToRow,
	technologyProgressToRow,
	technologyStateToRow,
} from "../../src/lib/parser/parsers/player-data.js";
import {
	parseReligions,
	religionToRow,
} from "../../src/lib/parser/parsers/religions.js";
import {
	familyOpinionHistoryToRow,
	legitimacyHistoryToRow,
	militaryPowerHistoryToRow,
	parseFamilyOpinionHistory,
	parseLegitimacyHistory,
	parseMilitaryPowerHistory,
	parsePointsHistory,
	parseReligionOpinionHistory,
	parseYieldPriceHistory,
	parseYieldRateHistory,
	parseYieldTotalHistory,
	pointsHistoryToRow,
	religionOpinionHistoryToRow,
	yieldPriceHistoryToRow,
	yieldRateHistoryToRow,
	yieldTotalHistoryToRow,
} from "../../src/lib/parser/parsers/timeseries.js";
import {
	parseTiles,
	parseTileChanges,
	parseTileVisibility,
	tileChangeToRow,
	tileToRow,
	tileVisibilityToRow,
} from "../../src/lib/parser/parsers/tiles.js";
import {
	parseTribes,
	tribeToRow,
} from "../../src/lib/parser/parsers/tribes.js";
import {
	cityUnitProductionToRow,
	parseCityUnitsProduced,
	parsePlayerUnitsProduced,
	parseUnitEffects,
	parseUnitFamilies,
	parseUnitPromotions,
	parseUnits,
	playerUnitProductionToRow,
	unitEffectToRow,
	unitFamilyToRow,
	unitPromotionToRow,
	unitToRow,
} from "../../src/lib/parser/parsers/units.js";

const SCHEMA_VERSION = 1;

interface CliArgs {
	save: string;
	out: string;
	manifest: string;
}

function parseArgs(argv: string[]): CliArgs {
	const a = { save: "", out: "", manifest: "" };
	const it = argv[Symbol.iterator]();
	for (let next = it.next(); !next.done; next = it.next()) {
		const arg = next.value;
		const need = (label: string): string => {
			const v = it.next();
			if (v.done) throw new Error(`${label} requires a value`);
			return v.value;
		};
		switch (arg) {
			case "--save":
				a.save = need("--save");
				break;
			case "--out":
				a.out = need("--out");
				break;
			case "--manifest":
				a.manifest = need("--manifest");
				break;
			case "-h":
			case "--help":
				console.error(
					"usage: dump.ts --save <save.zip> --out <ts-dump.json> --manifest <path>",
				);
				process.exit(0);
			default:
				throw new Error(`unknown argument: ${arg}`);
		}
	}
	for (const k of ["save", "out", "manifest"] as const) {
		if (!a[k]) throw new Error(`--${k} is required`);
	}
	return a;
}

/**
 * Registry of (entity key) → (parser function). Each parser takes the
 * unwrapped root element object (children of `<Root>`) and returns an array
 * of plain-JSON rows in snake_case form, matching the Rust serde dump.
 *
 * Per-entity i64 fields that need JSON-string serialization (rather than
 * number) live in I64_STRING_FIELDS below — when porting an entity that has
 * any, the corresponding `toRow` mapper must emit those fields as strings.
 */
type ParserFn = (root: Record<string, unknown>) => Record<string, unknown>[];

const PARSERS: Record<string, ParserFn> = {
	character_marriages: (root) =>
		parseCharacterMarriages(root).map(characterMarriageToRow),
	character_relationships: (root) =>
		parseCharacterRelationships(root).map(characterRelationshipToRow),
	character_stats: (root) =>
		parseCharacterStats(root).map(characterStatToRow),
	character_traits: (root) =>
		parseCharacterTraits(root).map(characterTraitToRow),
	characters: (root) => parseCharacters(root).map(characterToRow),
	cities: (root) => parseCities(root).map(cityToRow),
	city_culture: (root) => parseCityCulture(root).map(cityCultureToRow),
	city_enemy_agents: (root) =>
		parseCityEnemyAgents(root).map(cityEnemyAgentToRow),
	city_luxuries: (root) => parseCityLuxuries(root).map(cityLuxuryToRow),
	city_production_queue: (root) =>
		parseCityProductionQueue(root).map(cityProductionItemToRow),
	city_project_counts: (root) =>
		parseCityProjectCounts(root).map(cityProjectCountToRow),
	city_projects_completed: (root) =>
		parseCityProjectsCompleted(root).map(cityProjectCompletedToRow),
	city_religions: (root) => parseCityReligions(root).map(cityReligionToRow),
	city_yields: (root) => parseCityYields(root).map(cityYieldToRow),
	diplomacy_relations: (root) =>
		parseDiplomacyRelations(root).map(diplomacyRelationToRow),
	families: (root) => parseFamilies(root).map(familyToRow),
	laws: (root) => parseLaws(root).map(lawToRow),
	player_council: (root) =>
		parsePlayerCouncil(root).map(playerCouncilToRow),
	player_goals: (root) => parsePlayerGoals(root).map(playerGoalToRow),
	player_resources: (root) =>
		parsePlayerResources(root).map(playerResourceToRow),
	players: (root) => parsePlayers(root).map(playerToRow),
	religions: (root) => parseReligions(root).map(religionToRow),
	technologies_completed: (root) =>
		parseTechnologiesCompleted(root).map(technologyCompletedToRow),
	technology_progress: (root) =>
		parseTechnologyProgress(root).map(technologyProgressToRow),
	technology_states: (root) =>
		parseTechnologyStates(root).map(technologyStateToRow),
	yield_price_history: (root) =>
		parseYieldPriceHistory(root).map(yieldPriceHistoryToRow),
	military_power_history: (root) =>
		parseMilitaryPowerHistory(root).map(militaryPowerHistoryToRow),
	points_history: (root) =>
		parsePointsHistory(root).map(pointsHistoryToRow),
	legitimacy_history: (root) =>
		parseLegitimacyHistory(root).map(legitimacyHistoryToRow),
	yield_rate_history: (root) =>
		parseYieldRateHistory(root).map(yieldRateHistoryToRow),
	yield_total_history: (root) =>
		parseYieldTotalHistory(root).map(yieldTotalHistoryToRow),
	family_opinion_history: (root) =>
		parseFamilyOpinionHistory(root).map(familyOpinionHistoryToRow),
	religion_opinion_history: (root) =>
		parseReligionOpinionHistory(root).map(religionOpinionHistoryToRow),
	event_stories: (root) => parseEventStories(root).map(eventStoryToRow),
	event_logs: (root) => parseEventLogs(root).map(eventLogToRow),
	memory_data: (root) => parseMemoryData(root).map(memoryDataToRow),
	tile_changes: (root) => parseTileChanges(root).map(tileChangeToRow),
	tile_visibility: (root) =>
		parseTileVisibility(root).map(tileVisibilityToRow),
	tiles: (root) => parseTiles(root).map(tileToRow),
	tribes: (root) => parseTribes(root).map(tribeToRow),
	units: (root) => parseUnits(root).map(unitToRow),
	unit_promotions: (root) =>
		parseUnitPromotions(root).map(unitPromotionToRow),
	unit_effects: (root) => parseUnitEffects(root).map(unitEffectToRow),
	unit_families: (root) => parseUnitFamilies(root).map(unitFamilyToRow),
	player_units_produced: (root) =>
		parsePlayerUnitsProduced(root).map(playerUnitProductionToRow),
	city_units_produced: (root) =>
		parseCityUnitsProduced(root).map(cityUnitProductionToRow),
};

// Reference for parser implementers — fields that must be emitted as JSON
// strings rather than numbers (JS Number cannot safely hold i64).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const I64_STRING_FIELDS: Record<string, readonly string[]> = {
	characters: ["seed"],
	tiles: ["init_seed", "turn_seed"],
	units: ["seed"],
};

/**
 * Inject `dump_index: i` into each row at its array position, mirroring the
 * Rust dump's `rows_with_index` helper. The diff CLI uses this as a
 * tiebreaker when sort keys aren't unique.
 */
function withDumpIndex(
	rows: Record<string, unknown>[],
): Record<string, unknown>[] {
	return rows.map((row, i) => ({ ...row, dump_index: i }));
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const manifestRaw = await readFile(args.manifest, "utf8");
	const manifest = JSON.parse(manifestRaw) as ParityConfig;

	const unimplemented = manifest.implemented.filter((k) => !(k in PARSERS));
	if (unimplemented.length > 0) {
		throw new Error(
			`manifest.implemented lists entities with no registered parser: ${unimplemented.join(", ")}. ` +
				`Add an entry to PARSERS in scripts/parity/dump.ts.`,
		);
	}

	const saveSha = await sha256File(args.save);

	const envelope: Record<string, unknown> = {
		schema_version: SCHEMA_VERSION,
		save_path: args.save,
		save_sha256: saveSha,
	};

	// Skip XML load entirely while no parsers are registered — the empty
	// envelope is a valid input for the diff CLI (every entity becomes
	// not_ported).
	if (manifest.implemented.length > 0) {
		const buf = await readFile(args.save);
		const ab = buf.buffer.slice(
			buf.byteOffset,
			buf.byteOffset + buf.byteLength,
		);
		const xml = extractXmlFromZip(ab);
		const root = parseSaveXml(xml);

		for (const key of manifest.implemented) {
			const parser = PARSERS[key];
			const rows = parser(root);
			envelope[key] = withDumpIndex(rows);
		}
	}

	await mkdir(dirname(args.out), { recursive: true });
	await writeFile(args.out, JSON.stringify(envelope));
}

main().catch((err) => {
	console.error(err instanceof Error ? err.stack ?? err.message : String(err));
	process.exit(1);
});
