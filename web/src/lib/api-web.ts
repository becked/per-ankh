/**
 * Web API layer for the shared game viewer.
 *
 * Fetches the entire shared game blob once from the API,
 * caches it in memory, then exposes the same data shape
 * as the desktop api.ts — but as synchronous slices of the cached blob.
 */

import type { GameDetails } from "$lib/types/GameDetails";
import type { PlayerHistory } from "$lib/types/PlayerHistory";
import type { YieldHistory } from "$lib/types/YieldHistory";
import type { EventLog } from "$lib/types/EventLog";
import type { LawAdoptionHistory } from "$lib/types/LawAdoptionHistory";
import type { PlayerLaw } from "$lib/types/PlayerLaw";
import type { TechDiscoveryHistory } from "$lib/types/TechDiscoveryHistory";
import type { PlayerTech } from "$lib/types/PlayerTech";
import type { PlayerUnitProduced } from "$lib/types/PlayerUnitProduced";
import type { CityStatistics } from "$lib/types/CityStatistics";
import type { ImprovementData } from "$lib/types/ImprovementData";
import type { MapTile } from "$lib/types/MapTile";

const API_BASE = "https://api.per-ankh.app/v1";

/** The full shared game data blob. */
interface SharedGameData {
	version: number;
	created_at: string;
	app_version: string;
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
}

export type ShareError = "SHARE_NOT_FOUND" | "NETWORK_ERROR" | "CORRUPT_DATA";

// In-memory cache: one blob per share ID
const cache = new Map<string, SharedGameData>();

/**
 * Fetch and cache the shared game data blob.
 * Subsequent calls with the same shareId return the cached data.
 */
async function getSharedData(shareId: string): Promise<SharedGameData> {
	const cached = cache.get(shareId);
	if (cached) return cached;

	let response: Response;
	try {
		response = await fetch(`${API_BASE}/share/${shareId}`);
	} catch {
		throw "NETWORK_ERROR" as ShareError;
	}

	if (response.status === 404) {
		throw "SHARE_NOT_FOUND" as ShareError;
	}

	if (!response.ok) {
		throw "NETWORK_ERROR" as ShareError;
	}

	let data: SharedGameData;
	try {
		data = await response.json();
	} catch {
		throw "CORRUPT_DATA" as ShareError;
	}

	if (!data.game_details || !data.version) {
		throw "CORRUPT_DATA" as ShareError;
	}

	cache.set(shareId, data);
	return data;
}

/**
 * Web API — same function signatures as the desktop api.ts
 * but returning slices of the cached shared game blob.
 */
export const webApi = {
	getGameDetails: async (shareId: string): Promise<GameDetails> =>
		(await getSharedData(shareId)).game_details,

	getPlayerHistory: async (shareId: string): Promise<PlayerHistory[]> =>
		(await getSharedData(shareId)).player_history,

	getYieldHistory: async (shareId: string): Promise<YieldHistory[]> =>
		(await getSharedData(shareId)).yield_history,

	getEventLogs: async (shareId: string): Promise<EventLog[]> =>
		(await getSharedData(shareId)).event_logs,

	getLawAdoptionHistory: async (shareId: string): Promise<LawAdoptionHistory[]> =>
		(await getSharedData(shareId)).law_adoption_history,

	getCurrentLaws: async (shareId: string): Promise<PlayerLaw[]> =>
		(await getSharedData(shareId)).current_laws,

	getTechDiscoveryHistory: async (shareId: string): Promise<TechDiscoveryHistory[]> =>
		(await getSharedData(shareId)).tech_discovery_history,

	getCompletedTechs: async (shareId: string): Promise<PlayerTech[]> =>
		(await getSharedData(shareId)).completed_techs,

	getUnitsProduced: async (shareId: string): Promise<PlayerUnitProduced[]> =>
		(await getSharedData(shareId)).units_produced,

	getCityStatistics: async (shareId: string): Promise<CityStatistics> =>
		(await getSharedData(shareId)).city_statistics,

	getImprovementData: async (shareId: string): Promise<ImprovementData> =>
		(await getSharedData(shareId)).improvement_data,

	getMapTiles: async (shareId: string): Promise<MapTile[]> =>
		(await getSharedData(shareId)).map_tiles,
} as const;
