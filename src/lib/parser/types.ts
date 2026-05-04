// FullGameData envelope — the cloud-rewrite R2 blob shape.
//
// Composes:
//   1. Auto-generated wire-format types from src/lib/types/ (the existing
//      SharedGameData sub-types — re-exported here so Phase 4 derivations
//      can target a single source of truth).
//   2. New snake_case interfaces for entity arrays not in SharedGameData
//      (characters, families, diplomacy, units, etc. — direct snake-case
//      mirrors of each parser's *ToRow output).
//   3. MatchMetadata + WinnerInfo (the envelope-level metadata).
//   4. The FullGameData envelope itself (spec §3).
//
// References: docs/cloud-rewrite-spec.md §3 ("Data Model" / "R2 Blob Schema").

// ---------- Re-exported wire types (existing SharedGameData fields) ----------

export type { GameDetails } from "../types/GameDetails.js";
export type { PlayerHistory } from "../types/PlayerHistory.js";
export type { PlayerHistoryPoint } from "../types/PlayerHistoryPoint.js";
export type { PlayerInfo } from "../types/PlayerInfo.js";
export type { YieldHistory } from "../types/YieldHistory.js";
export type { YieldDataPoint } from "../types/YieldDataPoint.js";
export type { EventLog } from "../types/EventLog.js";
export type { LawAdoptionHistory } from "../types/LawAdoptionHistory.js";
export type { LawAdoptionDataPoint } from "../types/LawAdoptionDataPoint.js";
export type { PlayerLaw } from "../types/PlayerLaw.js";
export type { TechDiscoveryHistory } from "../types/TechDiscoveryHistory.js";
export type { TechDiscoveryDataPoint } from "../types/TechDiscoveryDataPoint.js";
export type { PlayerTech } from "../types/PlayerTech.js";
export type { PlayerUnitProduced } from "../types/PlayerUnitProduced.js";
export type { CityInfo } from "../types/CityInfo.js";
export type { CityStatistics } from "../types/CityStatistics.js";
export type { ImprovementInfo } from "../types/ImprovementInfo.js";
export type { ImprovementData } from "../types/ImprovementData.js";
export type { MapTile } from "../types/MapTile.js";
export type { ReligionInfo } from "../types/ReligionInfo.js";
export type { GameReligion } from "../types/GameReligion.js";
export type { PlayerWonder } from "../types/PlayerWonder.js";
export type { StoryEvent } from "../types/StoryEvent.js";

// Local imports for use in FullGameData below.
import type { GameDetails } from "../types/GameDetails.js";
import type { PlayerHistory } from "../types/PlayerHistory.js";
import type { YieldHistory } from "../types/YieldHistory.js";
import type { EventLog } from "../types/EventLog.js";
import type { LawAdoptionHistory } from "../types/LawAdoptionHistory.js";
import type { PlayerLaw } from "../types/PlayerLaw.js";
import type { TechDiscoveryHistory } from "../types/TechDiscoveryHistory.js";
import type { PlayerTech } from "../types/PlayerTech.js";
import type { PlayerUnitProduced } from "../types/PlayerUnitProduced.js";
import type { CityStatistics } from "../types/CityStatistics.js";
import type { ImprovementData } from "../types/ImprovementData.js";
import type { MapTile } from "../types/MapTile.js";
import type { GameReligion } from "../types/GameReligion.js";
import type { PlayerWonder } from "../types/PlayerWonder.js";
import type { StoryEvent } from "../types/StoryEvent.js";

// ---------- Match metadata ----------

/**
 * Resolved winner — `winner_player_xml_id` is the resolved player; the team
 * id is preserved alongside for reference but consumers should prefer the
 * player id.
 */
export interface WinnerInfo {
	winner_player_xml_id: number;
	winner_team_id: number | null;
	victory_type: string;
}

/**
 * Intermediate winner info pulled from `<TeamVictories>` or `<Victory>` before
 * mapping the team id back to a player. Internal to the match-metadata
 * parser — not part of the FullGameData blob.
 */
export interface RawWinnerInfo {
	team_id: number | null;
	victory_type: string;
}

export interface MatchMetadata {
	xml_game_id: string;
	total_turns: number;
	game_name: string | null;
	save_date: string | null;
	game_version: string | null;
	map_width: number | null;
	map_height: number | null;
	map_size: string | null;
	map_class: string | null;
	game_mode: string | null;
	difficulty: string | null;
	opponent_level: string | null;
	victory_conditions: string | null;
	enabled_mods: string | null;
	enabled_dlc: string | null;
	winner: WinnerInfo | null;
}

// ---------- New entity wire types (snake_case mirrors of *ToRow output) ----------

export interface CharacterInfo {
	xml_id: number;
	first_name: string | null;
	gender: string | null;
	player_xml_id: number | null;
	tribe: string | null;
	family: string | null;
	nation: string | null;
	religion: string | null;
	birth_turn: number;
	death_turn: number | null;
	death_reason: string | null;
	birth_father_xml_id: number | null;
	birth_mother_xml_id: number | null;
	birth_city_xml_id: number | null;
	cognomen: string | null;
	archetype: string | null;
	portrait: string | null;
	xp: number;
	level: number;
	is_royal: boolean;
	is_infertile: boolean;
	became_leader_turn: number | null;
	abdicated_turn: number | null;
	was_religion_head: boolean;
	was_family_head: boolean;
	nation_joined_turn: number | null;
	// i64 — encoded as a JSON string when present.
	seed: string | null;
}

export interface CharacterTraitInfo {
	character_xml_id: number;
	trait_name: string;
	acquired_turn: number;
	removed_turn: number | null;
}

export interface CharacterRelationshipInfo {
	character_xml_id: number;
	related_character_xml_id: number;
	relationship_type: string;
	relationship_value: number | null;
	started_turn: number | null;
	ended_turn: number | null;
}

export interface CharacterMarriageInfo {
	character_xml_id: number;
	spouse_xml_id: number;
	married_turn: number;
	divorced_turn: number | null;
}

export interface FamilyInfo {
	family_name: string;
	family_class: string;
	player_xml_id: number;
	head_character_xml_id: number | null;
	seat_city_xml_id: number | null;
	turns_without_leader: number;
}

/**
 * Snake-case wire shape of a diplomatic relation. Distinct from the camelCase
 * parser type with the same name in `parsers/diplomacy.ts` — when the
 * orchestrator needs both, it imports the parser type with an alias.
 */
export interface DiplomacyRelation {
	entity1_type: string;
	entity1_id: string;
	entity2_type: string;
	entity2_id: string;
	relation: string;
	war_score: number | null;
	last_conflict_turn: number | null;
	last_diplomacy_turn: number | null;
	diplomacy_blocked_until_turn: number | null;
}

export interface UnitInfo {
	xml_id: number;
	tile_xml_id: number;
	unit_type: string;
	player_xml_id: number | null;
	tribe: string | null;
	xp: number | null;
	level: number | null;
	create_turn: number | null;
	facing: string | null;
	original_player_xml_id: number | null;
	turns_since_last_move: number | null;
	gender: string | null;
	is_sleeping: boolean;
	current_formation: string | null;
	// i64 — encoded as a JSON string when present.
	seed: string | null;
}

export interface UnitPromotionInfo {
	unit_xml_id: number;
	promotion: string;
	is_acquired: boolean;
}

export interface PlayerResourceInfo {
	player_xml_id: number;
	yield_type: string;
	amount: number;
}

export interface PlayerGoalInfo {
	player_xml_id: number;
	goal_xml_id: number;
	goal_type: string;
	leader_character_xml_id: number | null;
	started_turn: number;
	completed_turn: number | null;
	failed_turn: number | null;
	max_turns: number | null;
	progress: number;
	goal_state: string | null;
}

export interface MemoryInfo {
	player_xml_id: number;
	memory_type: string;
	turn: number;
	target_player_xml_id: number | null;
	target_character_xml_id: number | null;
	target_family: string | null;
	target_tribe: string | null;
	target_religion: string | null;
}

export interface TileVisibilityInfo {
	tile_xml_id: number;
	team_id: number;
	revealed_turn: number;
	visible_owner_player_xml_id: number | null;
}

export interface FamilyOpinionEntry {
	player_xml_id: number;
	family_name: string;
	turn: number;
	opinion: number;
}

export interface ReligionOpinionEntry {
	player_xml_id: number;
	religion_name: string;
	turn: number;
	opinion: number;
}

export interface YieldPriceEntry {
	turn: number;
	yield_type: string;
	price: number;
}

/**
 * One entry per (tile, turn-of-ownership-change). Drives the map replay.
 * Derived from `<OwnerHistory>` on each Tile element; see Phase 4
 * `derive/tile-ownership-history.ts`.
 */
export interface TileOwnershipEntry {
	tile_xml_id: number;
	turn: number;
	owner_player_xml_id: number | null;
}

/**
 * Player xml_id → nation lookup, sparse. Cloud-only sidecar consumed by the
 * runtime map-turn-slider reconstruction (see
 * `src/lib/game-detail/reconstruct-map-tiles.ts`) to resolve
 * `tile_ownership_history.owner_player_xml_id` → owning nation. The wire
 * `PlayerInfo` does not carry xml_id (it's a desktop-shared type), so this
 * sidecar fills the gap.
 */
export interface PlayerNationEntry {
	player_xml_id: number;
	nation: string | null;
}

// ---------- The envelope ----------

export interface FullGameData {
	version: 2;
	parser_version: string;
	created_at: string;

	match_metadata: MatchMetadata;

	// SharedGameData fields (present in the existing share blob).
	game_details: GameDetails;
	player_history: PlayerHistory[];
	yield_history: YieldHistory[];
	event_logs: EventLog[];
	law_adoption_history: LawAdoptionHistory[];
	current_laws: PlayerLaw[];
	tech_discovery_history: TechDiscoveryHistory[];
	completed_techs: PlayerTech[];
	units_produced: PlayerUnitProduced[];
	city_statistics: CityStatistics;
	improvement_data: ImprovementData;
	map_tiles: MapTile[];
	game_religions: GameReligion[];
	player_wonders: PlayerWonder[];

	// New cloud-only fields (spec §3 lines 790–806).
	tile_ownership_history: TileOwnershipEntry[];
	player_nations: PlayerNationEntry[];
	characters: CharacterInfo[];
	character_traits: CharacterTraitInfo[];
	character_relationships: CharacterRelationshipInfo[];
	character_marriages: CharacterMarriageInfo[];
	families: FamilyInfo[];
	family_opinion_history: FamilyOpinionEntry[];
	religion_opinion_history: ReligionOpinionEntry[];
	diplomacy: DiplomacyRelation[];
	units: UnitInfo[];
	unit_promotions: UnitPromotionInfo[];
	player_resources: PlayerResourceInfo[];
	player_goals: PlayerGoalInfo[];
	story_events: StoryEvent[];
	memory_data: MemoryInfo[];
	yield_price_history: YieldPriceEntry[];
	tile_visibility: TileVisibilityInfo[];
}

/**
 * Build-time constant. Bumped per §10 rules: PATCH for value-changing bug
 * fixes, MINOR for additive fields, MAJOR for breaking schema changes.
 * Initial value `2.0.0` mirrors `FullGameData.version: 2`.
 */
export const PARSER_VERSION = "2.1.0";
