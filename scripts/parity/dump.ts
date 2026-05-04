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
	parseCharacterMarriages,
	parseCharacterRelationships,
	parseCharacterStats,
	parseCharacterTraits,
	type CharacterMarriage,
	type CharacterRelationship,
	type CharacterStat,
	type CharacterTrait,
} from "../../src/lib/parser/parsers/character-data.js";
import {
	parseCharacters,
	type Character,
} from "../../src/lib/parser/parsers/characters.js";
import {
	parseCities,
	parseCityCulture,
	parseCityEnemyAgents,
	parseCityLuxuries,
	parseCityProductionQueue,
	parseCityProjectCounts,
	parseCityProjectsCompleted,
	parseCityReligions,
	parseCityYields,
	type City,
	type CityCulture,
	type CityEnemyAgent,
	type CityLuxury,
	type CityProductionItem,
	type CityProjectCompleted,
	type CityProjectCount,
	type CityReligion,
	type CityYield,
} from "../../src/lib/parser/parsers/cities.js";
import {
	parseDiplomacyRelations,
	type DiplomacyRelation,
} from "../../src/lib/parser/parsers/diplomacy.js";
import {
	parseFamilies,
	type Family,
} from "../../src/lib/parser/parsers/families.js";
import {
	parsePlayers,
	type Player,
} from "../../src/lib/parser/parsers/players.js";
import {
	parseLaws,
	parsePlayerCouncil,
	parsePlayerGoals,
	parsePlayerResources,
	parseTechnologiesCompleted,
	parseTechnologyProgress,
	parseTechnologyStates,
	type Law,
	type PlayerCouncil,
	type PlayerGoal,
	type PlayerResource,
	type TechnologyCompleted,
	type TechnologyProgress,
	type TechnologyState,
} from "../../src/lib/parser/parsers/player-data.js";
import {
	parseReligions,
	type Religion,
} from "../../src/lib/parser/parsers/religions.js";
import {
	parseTiles,
	parseTileChanges,
	parseTileVisibility,
	type Tile,
	type TileChange,
	type TileVisibility,
} from "../../src/lib/parser/parsers/tiles.js";
import {
	parseTribes,
	type Tribe,
} from "../../src/lib/parser/parsers/tribes.js";
import {
	parseCityUnitsProduced,
	parsePlayerUnitsProduced,
	parseUnitEffects,
	parseUnitFamilies,
	parseUnitPromotions,
	parseUnits,
	type CityUnitProduction,
	type PlayerUnitProduction,
	type Unit,
	type UnitEffect,
	type UnitFamily,
	type UnitPromotion,
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

function characterToRow(c: Character): Record<string, unknown> {
	return {
		xml_id: c.xmlId,
		first_name: c.firstName,
		gender: c.gender,
		player_xml_id: c.playerXmlId,
		tribe: c.tribe,
		family: c.family,
		nation: c.nation,
		religion: c.religion,
		birth_turn: c.birthTurn,
		death_turn: c.deathTurn,
		death_reason: c.deathReason,
		birth_father_xml_id: c.birthFatherXmlId,
		birth_mother_xml_id: c.birthMotherXmlId,
		birth_city_xml_id: c.birthCityXmlId,
		cognomen: c.cognomen,
		archetype: c.archetype,
		portrait: c.portrait,
		xp: c.xp,
		level: c.level,
		is_royal: c.isRoyal,
		is_infertile: c.isInfertile,
		became_leader_turn: c.becameLeaderTurn,
		abdicated_turn: c.abdicatedTurn,
		was_religion_head: c.wasReligionHead,
		was_family_head: c.wasFamilyHead,
		nation_joined_turn: c.nationJoinedTurn,
		// seed is i64 in Rust; emit as JSON string when set, null when unset.
		// Per scripts/parity/dump.ts I64_STRING_FIELDS convention.
		seed: c.seed,
	};
}

function characterStatToRow(s: CharacterStat): Record<string, unknown> {
	return {
		character_xml_id: s.characterXmlId,
		stat_name: s.statName,
		stat_value: s.statValue,
	};
}

function characterTraitToRow(t: CharacterTrait): Record<string, unknown> {
	return {
		character_xml_id: t.characterXmlId,
		trait_name: t.traitName,
		acquired_turn: t.acquiredTurn,
		removed_turn: t.removedTurn,
	};
}

function characterRelationshipToRow(
	r: CharacterRelationship,
): Record<string, unknown> {
	return {
		character_xml_id: r.characterXmlId,
		related_character_xml_id: r.relatedCharacterXmlId,
		relationship_type: r.relationshipType,
		relationship_value: r.relationshipValue,
		started_turn: r.startedTurn,
		ended_turn: r.endedTurn,
	};
}

function characterMarriageToRow(
	m: CharacterMarriage,
): Record<string, unknown> {
	return {
		character_xml_id: m.characterXmlId,
		spouse_xml_id: m.spouseXmlId,
		married_turn: m.marriedTurn,
		divorced_turn: m.divorcedTurn,
	};
}

function cityToRow(c: City): Record<string, unknown> {
	return {
		xml_id: c.xmlId,
		city_name: c.cityName,
		founded_turn: c.foundedTurn,
		player_xml_id: c.playerXmlId,
		tile_xml_id: c.tileXmlId,
		family: c.family,
		first_owner_player_xml_id: c.firstOwnerPlayerXmlId,
		last_owner_player_xml_id: c.lastOwnerPlayerXmlId,
		is_capital: c.isCapital,
		citizens: c.citizens,
		governor_xml_id: c.governorXmlId,
		governor_turn: c.governorTurn,
		hurry_civics_count: c.hurryCivicsCount,
		hurry_money_count: c.hurryMoneyCount,
		hurry_training_count: c.hurryTrainingCount,
		hurry_population_count: c.hurryPopulationCount,
		specialist_count: c.specialistCount,
		growth_count: c.growthCount,
		unit_production_count: c.unitProductionCount,
		buy_tile_count: c.buyTileCount,
	};
}

function cityProductionItemToRow(
	i: CityProductionItem,
): Record<string, unknown> {
	return {
		city_xml_id: i.cityXmlId,
		queue_position: i.queuePosition,
		build_type: i.buildType,
		item_type: i.itemType,
		progress: i.progress,
		is_repeat: i.isRepeat,
	};
}

function cityProjectCompletedToRow(
	p: CityProjectCompleted,
): Record<string, unknown> {
	return {
		city_xml_id: p.cityXmlId,
		project_type: p.projectType,
		count: p.count,
	};
}

function cityProjectCountToRow(
	p: CityProjectCount,
): Record<string, unknown> {
	return {
		city_xml_id: p.cityXmlId,
		project_type: p.projectType,
		count: p.count,
	};
}

function cityEnemyAgentToRow(a: CityEnemyAgent): Record<string, unknown> {
	return {
		city_xml_id: a.cityXmlId,
		enemy_player_xml_id: a.enemyPlayerXmlId,
		agent_character_xml_id: a.agentCharacterXmlId,
		placed_turn: a.placedTurn,
		agent_tile_xml_id: a.agentTileXmlId,
	};
}

function cityLuxuryToRow(l: CityLuxury): Record<string, unknown> {
	return {
		city_xml_id: l.cityXmlId,
		resource: l.resource,
		imported_turn: l.importedTurn,
	};
}

function cityYieldToRow(y: CityYield): Record<string, unknown> {
	return {
		city_xml_id: y.cityXmlId,
		yield_type: y.yieldType,
		progress: y.progress,
	};
}

function cityReligionToRow(r: CityReligion): Record<string, unknown> {
	return {
		city_xml_id: r.cityXmlId,
		religion: r.religion,
	};
}

function cityCultureToRow(c: CityCulture): Record<string, unknown> {
	return {
		city_xml_id: c.cityXmlId,
		team_id: c.teamId,
		culture_level: c.cultureLevel,
		happiness_level: c.happinessLevel,
	};
}

function diplomacyRelationToRow(
	d: DiplomacyRelation,
): Record<string, unknown> {
	return {
		entity1_type: d.entity1Type,
		entity1_id: d.entity1Id,
		entity2_type: d.entity2Type,
		entity2_id: d.entity2Id,
		relation: d.relation,
		war_score: d.warScore,
		last_conflict_turn: d.lastConflictTurn,
		last_diplomacy_turn: d.lastDiplomacyTurn,
		diplomacy_blocked_until_turn: d.diplomacyBlockedUntilTurn,
	};
}

function familyToRow(f: Family): Record<string, unknown> {
	return {
		family_name: f.familyName,
		family_class: f.familyClass,
		player_xml_id: f.playerXmlId,
		head_character_xml_id: f.headCharacterXmlId,
		seat_city_xml_id: f.seatCityXmlId,
		turns_without_leader: f.turnsWithoutLeader,
	};
}

function playerToRow(p: Player): Record<string, unknown> {
	return {
		xml_id: p.xmlId,
		player_name: p.playerName,
		nation: p.nation,
		dynasty: p.dynasty,
		team_id: p.teamId,
		is_human: p.isHuman,
		is_save_owner: p.isSaveOwner,
		online_id: p.onlineId,
		email: p.email,
		ai_controlled_to_turn: p.aiControlledToTurn,
		difficulty: p.difficulty,
		last_turn_completed: p.lastTurnCompleted,
		turn_ended: p.turnEnded,
		legitimacy: p.legitimacy,
		succession_gender: p.successionGender,
		state_religion: p.stateReligion,
		founder_character_xml_id: p.founderCharacterXmlId,
		chosen_heir_xml_id: p.chosenHeirXmlId,
		original_capital_city_xml_id: p.originalCapitalCityXmlId,
		time_stockpile: p.timeStockpile,
		tech_researching: p.techResearching,
		ambition_delay: p.ambitionDelay,
		tiles_purchased: p.tilesPurchased,
		state_religion_changes: p.stateReligionChanges,
		tribe_mercenaries_hired: p.tribeMercenariesHired,
	};
}

function lawToRow(l: Law): Record<string, unknown> {
	return {
		player_xml_id: l.playerXmlId,
		law_category: l.lawCategory,
		law: l.law,
		adopted_turn: l.adoptedTurn,
		change_count: l.changeCount,
	};
}

function playerCouncilToRow(c: PlayerCouncil): Record<string, unknown> {
	return {
		player_xml_id: c.playerXmlId,
		position: c.position,
		character_xml_id: c.characterXmlId,
		appointed_turn: c.appointedTurn,
	};
}

function playerGoalToRow(g: PlayerGoal): Record<string, unknown> {
	return {
		player_xml_id: g.playerXmlId,
		goal_xml_id: g.goalXmlId,
		goal_type: g.goalType,
		leader_character_xml_id: g.leaderCharacterXmlId,
		started_turn: g.startedTurn,
		completed_turn: g.completedTurn,
		failed_turn: g.failedTurn,
		max_turns: g.maxTurns,
		progress: g.progress,
		goal_state: g.goalState,
	};
}

function playerResourceToRow(r: PlayerResource): Record<string, unknown> {
	return {
		player_xml_id: r.playerXmlId,
		yield_type: r.yieldType,
		amount: r.amount,
	};
}

function technologyCompletedToRow(
	t: TechnologyCompleted,
): Record<string, unknown> {
	return {
		player_xml_id: t.playerXmlId,
		tech: t.tech,
		completed_turn: t.completedTurn,
	};
}

function technologyProgressToRow(
	t: TechnologyProgress,
): Record<string, unknown> {
	return {
		player_xml_id: t.playerXmlId,
		tech: t.tech,
		progress: t.progress,
	};
}

function technologyStateToRow(t: TechnologyState): Record<string, unknown> {
	return {
		player_xml_id: t.playerXmlId,
		tech: t.tech,
		state: t.state,
	};
}

function religionToRow(r: Religion): Record<string, unknown> {
	return {
		religion_name: r.religionName,
		founded_turn: r.foundedTurn,
		founder_player_xml_id: r.founderPlayerXmlId,
		head_character_xml_id: r.headCharacterXmlId,
		holy_city_xml_id: r.holyCityXmlId,
	};
}

function tileToRow(t: Tile): Record<string, unknown> {
	return {
		xml_id: t.xmlId,
		x: t.x,
		y: t.y,
		terrain: t.terrain,
		height: t.height,
		vegetation: t.vegetation,
		river_w: t.riverW,
		river_sw: t.riverSw,
		river_se: t.riverSe,
		resource: t.resource,
		improvement: t.improvement,
		improvement_pillaged: t.improvementPillaged,
		improvement_disabled: t.improvementDisabled,
		improvement_turns_left: t.improvementTurnsLeft,
		specialist: t.specialist,
		has_road: t.hasRoad,
		owner_player_xml_id: t.ownerPlayerXmlId,
		tribe_site: t.tribeSite,
		religion: t.religion,
		// i64 fields: pre-stringified by the parser (optI64Str).
		// Per I64_STRING_FIELDS at top of this file.
		init_seed: t.initSeed,
		turn_seed: t.turnSeed,
	};
}

function tileVisibilityToRow(v: TileVisibility): Record<string, unknown> {
	return {
		tile_xml_id: v.tileXmlId,
		team_id: v.teamId,
		revealed_turn: v.revealedTurn,
		visible_owner_player_xml_id: v.visibleOwnerPlayerXmlId,
	};
}

function tileChangeToRow(c: TileChange): Record<string, unknown> {
	return {
		tile_xml_id: c.tileXmlId,
		turn: c.turn,
		change_type: c.changeType,
		new_value: c.newValue,
	};
}

function tribeToRow(t: Tribe): Record<string, unknown> {
	return {
		tribe_id: t.tribeId,
		leader_character_xml_id: t.leaderCharacterXmlId,
		allied_player_xml_id: t.alliedPlayerXmlId,
		religion: t.religion,
	};
}

function unitToRow(u: Unit): Record<string, unknown> {
	return {
		xml_id: u.xmlId,
		tile_xml_id: u.tileXmlId,
		unit_type: u.unitType,
		player_xml_id: u.playerXmlId,
		tribe: u.tribe,
		xp: u.xp,
		level: u.level,
		create_turn: u.createTurn,
		facing: u.facing,
		original_player_xml_id: u.originalPlayerXmlId,
		turns_since_last_move: u.turnsSinceLastMove,
		gender: u.gender,
		is_sleeping: u.isSleeping,
		current_formation: u.currentFormation,
		// i64 seed: pre-stringified by the parser via optI64Str.
		seed: u.seed,
	};
}

function unitPromotionToRow(p: UnitPromotion): Record<string, unknown> {
	return {
		unit_xml_id: p.unitXmlId,
		promotion: p.promotion,
		is_acquired: p.isAcquired,
	};
}

function unitEffectToRow(e: UnitEffect): Record<string, unknown> {
	return {
		unit_xml_id: e.unitXmlId,
		effect: e.effect,
		stacks: e.stacks,
	};
}

function unitFamilyToRow(f: UnitFamily): Record<string, unknown> {
	return {
		unit_xml_id: f.unitXmlId,
		player_xml_id: f.playerXmlId,
		family_name: f.familyName,
	};
}

function playerUnitProductionToRow(
	p: PlayerUnitProduction,
): Record<string, unknown> {
	return {
		player_xml_id: p.playerXmlId,
		unit_type: p.unitType,
		count: p.count,
	};
}

function cityUnitProductionToRow(
	c: CityUnitProduction,
): Record<string, unknown> {
	return {
		city_xml_id: c.cityXmlId,
		unit_type: c.unitType,
		count: c.count,
	};
}

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
