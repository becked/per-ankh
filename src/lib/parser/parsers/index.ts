// Orchestrator. Calls every entity parser, then every derivation, and
// assembles a FullGameData blob ready to gzip + upload.
//
// Sequence: parsers run first (camelCase TS objects), then derivations
// consume those objects + match metadata to produce snake_case wire shapes.
// The final envelope mixes:
//   - the match_metadata result directly,
//   - derived view-ready aggregates (game_details, player_history, …),
//   - per-entity *ToRow projections of the new cloud-only fields.

import {
	parseCharacterMarriages,
	parseCharacterRelationships,
	parseCharacterTraits,
	characterMarriageToRow,
	characterRelationshipToRow,
	characterTraitToRow,
} from "./character-data.js";
import { parseCharacters, characterToRow } from "./characters.js";
import { parseCities, parseCityCulture, parseCityReligions } from "./cities.js";
import {
	parseDiplomacyRelations,
	diplomacyRelationToRow,
} from "./diplomacy.js";
import {
	parseEventLogs,
	parseEventStories,
	parseMemoryData,
	memoryDataToRow,
} from "./events.js";
import { parseFamilies, familyToRow } from "./families.js";
import { parseMatchMetadata } from "./match-metadata.js";
import {
	parseLaws,
	parsePlayerGoals,
	parsePlayerResources,
	playerGoalToRow,
	playerResourceToRow,
} from "./player-data.js";
import { parsePlayers } from "./players.js";
import { parseReligions } from "./religions.js";
import {
	parseFamilyOpinionHistory,
	parseLegitimacyHistory,
	parseMilitaryPowerHistory,
	parsePointsHistory,
	parseReligionOpinionHistory,
	parseYieldPriceHistory,
	parseYieldRateHistory,
	parseYieldTotalHistory,
	familyOpinionHistoryToRow,
	religionOpinionHistoryToRow,
	yieldPriceHistoryToRow,
} from "./timeseries.js";
import {
	parseTileOwnershipHistory,
	parseTileVisibility,
	parseTiles,
	tileOwnershipToRow,
	tileVisibilityToRow,
} from "./tiles.js";
import {
	parsePlayerUnitsProduced,
	parseUnitPromotions,
	parseUnits,
	unitPromotionToRow,
	unitToRow,
} from "./units.js";

import {
	deriveCityStatistics,
	deriveCompletedTechs,
	deriveCurrentLaws,
	deriveEventLogs,
	deriveGameDetails,
	deriveGameReligions,
	deriveImprovementData,
	deriveLawAdoptionHistory,
	deriveMapTiles,
	derivePlayerHistory,
	derivePlayerWonders,
	deriveStoryEvents,
	deriveTechDiscoveryHistory,
	deriveUnitsProduced,
	deriveYieldHistory,
} from "../derive/index.js";

import {
	type CharacterInfo,
	type CharacterMarriageInfo,
	type CharacterRelationshipInfo,
	type CharacterTraitInfo,
	type DiplomacyRelation,
	type FamilyInfo,
	type FamilyOpinionEntry,
	type FullGameData,
	type MemoryInfo,
	type PlayerGoalInfo,
	type PlayerNationEntry,
	type PlayerRosterEntry,
	type PlayerResourceInfo,
	type ReligionOpinionEntry,
	type TileOwnershipEntry,
	type TileVisibilityInfo,
	type UnitInfo,
	type UnitPromotionInfo,
	type YieldPriceEntry,
	PARSER_VERSION,
} from "../types.js";

export function extractAllGameData(
	root: Record<string, unknown>,
	activePlayerIndex: number | null,
): FullGameData {
	// 1. Parse all entities. Order matches the parity dump's PARSERS map.
	const players = parsePlayers(root, activePlayerIndex);
	const characters = parseCharacters(root);
	const characterTraits = parseCharacterTraits(root);
	const characterRelationships = parseCharacterRelationships(root);
	const characterMarriages = parseCharacterMarriages(root);
	const cities = parseCities(root);
	const cityCulture = parseCityCulture(root);
	const cityReligions = parseCityReligions(root);
	const diplomacy = parseDiplomacyRelations(root);
	const eventStories = parseEventStories(root);
	const eventLogs = parseEventLogs(root);
	const memoryData = parseMemoryData(root);
	const families = parseFamilies(root);
	const familyOpinionHistory = parseFamilyOpinionHistory(root);
	const laws = parseLaws(root);
	const playerGoals = parsePlayerGoals(root);
	const playerResources = parsePlayerResources(root);
	const religions = parseReligions(root);
	const religionOpinionHistory = parseReligionOpinionHistory(root);
	const yieldPriceHistory = parseYieldPriceHistory(root);
	const yieldRateHistory = parseYieldRateHistory(root);
	const yieldTotalHistory = parseYieldTotalHistory(root);
	const pointsHistory = parsePointsHistory(root);
	const militaryPowerHistory = parseMilitaryPowerHistory(root);
	const legitimacyHistory = parseLegitimacyHistory(root);
	const tiles = parseTiles(root);
	const tileVisibility = parseTileVisibility(root);
	const tileOwnership = parseTileOwnershipHistory(root);
	const units = parseUnits(root);
	const unitPromotions = parseUnitPromotions(root);
	const playerUnitsProduced = parsePlayerUnitsProduced(root);

	// 2. Match metadata (depends on parsed players for winner resolution).
	const matchMetadata = parseMatchMetadata(root, players);

	// 3. Derivations — view-ready aggregates that consumers (game-detail
	//    tabs) read directly.
	const gameDetails = deriveGameDetails(matchMetadata, players);
	const playerHistory = derivePlayerHistory(
		pointsHistory,
		militaryPowerHistory,
		legitimacyHistory,
		players,
		matchMetadata.total_turns,
	);
	const yieldHistory = deriveYieldHistory(
		yieldRateHistory,
		yieldTotalHistory,
		players,
		matchMetadata.total_turns,
	);
	const derivedEventLogs = deriveEventLogs(eventLogs, players);
	const lawAdoptionHistory = deriveLawAdoptionHistory(
		eventLogs,
		players,
		matchMetadata.total_turns,
	);
	const currentLaws = deriveCurrentLaws(laws, eventLogs, players);
	const techDiscoveryHistory = deriveTechDiscoveryHistory(
		eventLogs,
		players,
		matchMetadata.total_turns,
	);
	const completedTechs = deriveCompletedTechs(eventLogs, players);
	const unitsProduced = deriveUnitsProduced(playerUnitsProduced, players);
	const cityStatistics = deriveCityStatistics(
		cities,
		cityCulture,
		families,
		characters,
		players,
	);
	const improvementData = deriveImprovementData(tiles, cities, players);
	const mapTiles = deriveMapTiles(
		tiles,
		cities,
		cityReligions,
		religions,
		players,
	);
	const gameReligions = deriveGameReligions(religions, players);
	const playerWonders = derivePlayerWonders(eventLogs, tiles, players);
	const storyEvents = deriveStoryEvents(
		eventStories,
		players,
		characters,
		cities,
	);

	// 4. Snake-case projections of the new cloud-only entity fields.
	const charactersWire: CharacterInfo[] = characters.map(
		(c) => characterToRow(c) as unknown as CharacterInfo,
	);
	const characterTraitsWire: CharacterTraitInfo[] = characterTraits.map(
		(t) => characterTraitToRow(t) as unknown as CharacterTraitInfo,
	);
	const characterRelationshipsWire: CharacterRelationshipInfo[] =
		characterRelationships.map(
			(r) =>
				characterRelationshipToRow(r) as unknown as CharacterRelationshipInfo,
		);
	const characterMarriagesWire: CharacterMarriageInfo[] =
		characterMarriages.map(
			(m) => characterMarriageToRow(m) as unknown as CharacterMarriageInfo,
		);
	const familiesWire: FamilyInfo[] = families.map(
		(f) => familyToRow(f) as unknown as FamilyInfo,
	);
	const familyOpinionWire: FamilyOpinionEntry[] = familyOpinionHistory.map(
		(h) => familyOpinionHistoryToRow(h) as unknown as FamilyOpinionEntry,
	);
	const religionOpinionWire: ReligionOpinionEntry[] =
		religionOpinionHistory.map(
			(h) => religionOpinionHistoryToRow(h) as unknown as ReligionOpinionEntry,
		);
	const diplomacyWire: DiplomacyRelation[] = diplomacy.map(
		(d) => diplomacyRelationToRow(d) as unknown as DiplomacyRelation,
	);
	const unitsWire: UnitInfo[] = units.map(
		(u) => unitToRow(u) as unknown as UnitInfo,
	);
	const unitPromotionsWire: UnitPromotionInfo[] = unitPromotions.map(
		(p) => unitPromotionToRow(p) as unknown as UnitPromotionInfo,
	);
	const playerResourcesWire: PlayerResourceInfo[] = playerResources.map(
		(r) => playerResourceToRow(r) as unknown as PlayerResourceInfo,
	);
	const playerGoalsWire: PlayerGoalInfo[] = playerGoals.map(
		(g) => playerGoalToRow(g) as unknown as PlayerGoalInfo,
	);
	const memoryDataWire: MemoryInfo[] = memoryData.map(
		(m) => memoryDataToRow(m) as unknown as MemoryInfo,
	);
	const yieldPriceWire: YieldPriceEntry[] = yieldPriceHistory.map(
		(h) => yieldPriceHistoryToRow(h) as unknown as YieldPriceEntry,
	);
	const tileVisibilityWire: TileVisibilityInfo[] = tileVisibility.map(
		(v) => tileVisibilityToRow(v) as unknown as TileVisibilityInfo,
	);
	const tileOwnershipWire: TileOwnershipEntry[] = tileOwnership.map(
		(o) => tileOwnershipToRow(o) as unknown as TileOwnershipEntry,
	);
	const playerNations: PlayerNationEntry[] = players.map((p) => ({
		player_xml_id: p.xmlId,
		nation: p.nation,
	}));
	const playerRoster: PlayerRosterEntry[] = players.map((p) => ({
		player_index: p.xmlId,
		player_name: p.playerName,
		nation: p.nation,
		is_human: p.isHuman,
		online_id: p.onlineId,
	}));

	return {
		version: 2,
		parser_version: PARSER_VERSION,
		created_at: new Date().toISOString(),
		match_metadata: matchMetadata,

		game_details: gameDetails,
		player_history: playerHistory,
		yield_history: yieldHistory,
		event_logs: derivedEventLogs,
		law_adoption_history: lawAdoptionHistory,
		current_laws: currentLaws,
		tech_discovery_history: techDiscoveryHistory,
		completed_techs: completedTechs,
		units_produced: unitsProduced,
		city_statistics: cityStatistics,
		improvement_data: improvementData,
		map_tiles: mapTiles,
		game_religions: gameReligions,
		player_wonders: playerWonders,

		tile_ownership_history: tileOwnershipWire,
		player_nations: playerNations,
		player_roster: playerRoster,
		characters: charactersWire,
		character_traits: characterTraitsWire,
		character_relationships: characterRelationshipsWire,
		character_marriages: characterMarriagesWire,
		families: familiesWire,
		family_opinion_history: familyOpinionWire,
		religion_opinion_history: religionOpinionWire,
		diplomacy: diplomacyWire,
		units: unitsWire,
		unit_promotions: unitPromotionsWire,
		player_resources: playerResourcesWire,
		player_goals: playerGoalsWire,
		story_events: storyEvents,
		memory_data: memoryDataWire,
		yield_price_history: yieldPriceWire,
		tile_visibility: tileVisibilityWire,
	};
}
