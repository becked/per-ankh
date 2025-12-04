import { invoke } from "@tauri-apps/api/core";
import type { GameStatistics } from "$lib/types/GameStatistics";
import type { GameDetails } from "$lib/types/GameDetails";
import type { GameInfo } from "$lib/types/GameInfo";
import type { PlayerHistory } from "$lib/types/PlayerHistory";
import type { YieldHistory } from "$lib/types/YieldHistory";
import type { BatchImportResult } from "$lib/types/BatchImportResult";
import type { NationDynastyRow } from "$lib/types/NationDynastyRow";
import type { PlayerDebugRow } from "$lib/types/PlayerDebugRow";
import type { MatchDebugRow } from "$lib/types/MatchDebugRow";
import type { StoryEvent } from "$lib/types/StoryEvent";
import type { EventLog } from "$lib/types/EventLog";
import type { LawAdoptionHistory } from "$lib/types/LawAdoptionHistory";
import type { CityStatistics } from "$lib/types/CityStatistics";
import type { KnownOnlineId } from "$lib/types/KnownOnlineId";
import type { SaveDateEntry } from "$lib/types/SaveDateEntry";
import type { Collection } from "$lib/types/Collection";

/**
 * Centralized API layer for all Tauri backend commands.
 *
 * This provides:
 * - Single source of truth for command names
 * - Type-safe function signatures
 * - Easy refactoring when backend commands change
 * - Documentation of all available backend commands
 *
 * Add new commands here as you build features.
 * When this file grows to 30-40+ functions, consider splitting into domain modules.
 */
export const api = {
  /**
   * Get game statistics (total games, games by nation).
   * Optionally filters by collection_id (null = all games).
   */
  getGameStatistics: (collectionId?: number | null) =>
    invoke<GameStatistics>("get_game_statistics", { collectionId: collectionId ?? null }),

  /**
   * Get save dates with nation info for calendar chart.
   * Optionally filters by collection_id (null = all games).
   */
  getSaveDates: (collectionId?: number | null) =>
    invoke<SaveDateEntry[]>("get_save_dates", { collectionId: collectionId ?? null }),

  /**
   * Get list of all games, optionally filtered by collection.
   * Returns games sorted by save date (newest first).
   */
  getGamesList: (collectionId?: number | null) =>
    invoke<GameInfo[]>("get_games_list", { collectionId: collectionId ?? null }),

  getGameDetails: (matchId: number) =>
    invoke<GameDetails>("get_game_details", { matchId }),

  getPlayerHistory: (matchId: number) =>
    invoke<PlayerHistory[]>("get_player_history", { matchId }),

  getYieldHistory: (matchId: number, yieldTypes: string[]) =>
    invoke<YieldHistory[]>("get_yield_history", { matchId, yieldTypes }),

  getStoryEvents: (matchId: number) =>
    invoke<StoryEvent[]>("get_story_events", { matchId }),

  getEventLogs: (matchId: number) =>
    invoke<EventLog[]>("get_event_logs", { matchId }),

  getLawAdoptionHistory: (matchId: number) =>
    invoke<LawAdoptionHistory[]>("get_law_adoption_history", { matchId }),

  /**
   * Get city statistics for a match.
   * Returns all cities with their metrics for comparison charts.
   */
  getCityStatistics: (matchId: number) =>
    invoke<CityStatistics>("get_city_statistics", { matchId }),

  /**
   * Get nation and dynasty data for debugging.
   * Returns all unique combinations of nation/dynasty values from the database.
   */
  getNationDynastyData: () =>
    invoke<NationDynastyRow[]>("get_nation_dynasty_data"),

  /**
   * Get player data per match for debugging.
   * Returns match_id, nation, and dynasty for all players.
   */
  getPlayerDebugData: () =>
    invoke<PlayerDebugRow[]>("get_player_debug_data"),

  /**
   * Get match data for debugging.
   * Returns basic info about all matches in the database.
   */
  getMatchDebugData: () =>
    invoke<MatchDebugRow[]>("get_match_debug_data"),

  /**
   * Import save files from a directory.
   * Opens a directory picker and imports all .zip files with progress tracking.
   * Returns immediately and emits 'import-progress' and 'import-complete' events.
   */
  importDirectory: () =>
    invoke<string>("import_directory_cmd"),

  /**
   * Import selected save files.
   * Opens a file picker (multi-select) and imports selected .zip files with progress tracking.
   * Returns immediately and emits 'import-progress' and 'import-complete' events.
   */
  importFiles: () =>
    invoke<string>("import_files_cmd"),

  /**
   * Test event emission from backend to frontend.
   * Emits 'test-event' every 5 seconds for 60 seconds (12 events total).
   */
  runEventTest: () =>
    invoke<string>("run_event_test"),

  /**
   * Reset the database by dropping all tables and recreating the schema.
   * WARNING: This will delete all imported game data.
   */
  resetDatabase: () =>
    invoke<string>("reset_database_cmd"),

  /**
   * Recover from database corruption by deleting all database files and reinitializing.
   * More aggressive than resetDatabase - removes files rather than just dropping tables.
   * Use when database is corrupted and cannot be opened.
   */
  recoverDatabase: () =>
    invoke<string>("recover_database"),

  /**
   * Debug command to investigate player_id mismatch in event_logs.
   */
  debugEventLogPlayerIds: (matchId: number) =>
    invoke<string>("debug_event_log_player_ids", { matchId }),

  // ===== User Settings =====

  /**
   * Get the primary user's OnlineID for save owner identification.
   * Returns null if not yet configured.
   */
  getPrimaryUserOnlineId: () =>
    invoke<string | null>("get_primary_user_online_id"),

  /**
   * Set the primary user's OnlineID for save owner identification.
   */
  setPrimaryUserOnlineId: (onlineId: string) =>
    invoke<void>("set_primary_user_online_id", { onlineId }),

  /**
   * Get all known OnlineIDs from imported saves.
   * Returns distinct OnlineID/player_name combinations with save counts.
   * Used for primary user selection UI.
   */
  getKnownOnlineIds: () =>
    invoke<KnownOnlineId[]>("get_known_online_ids"),

  // ===== Collections =====

  /**
   * Get all collections with match counts.
   */
  getCollections: () =>
    invoke<Collection[]>("get_collections"),

  /**
   * Create a new collection.
   */
  createCollection: (name: string) =>
    invoke<Collection>("create_collection", { name }),

  /**
   * Rename an existing collection.
   */
  renameCollection: (collectionId: number, name: string) =>
    invoke<void>("rename_collection", { collectionId, name }),

  /**
   * Delete a collection. Matches are moved to the default collection.
   */
  deleteCollection: (collectionId: number) =>
    invoke<void>("delete_collection", { collectionId }),

  /**
   * Set a collection as the default (used for Primary User detection).
   */
  setDefaultCollection: (collectionId: number) =>
    invoke<void>("set_default_collection", { collectionId }),

  /**
   * Move specific matches to a collection.
   * Returns the number of matches moved.
   */
  moveMatchesToCollection: (matchIds: number[], collectionId: number) =>
    invoke<number>("move_matches_to_collection", { matchIds, collectionId }),

  /**
   * Move matches by game name pattern (SQL LIKE syntax).
   * Example: "Challenge Map%" moves all games starting with "Challenge Map".
   * Returns the number of matches moved.
   */
  moveMatchesByGameName: (pattern: string, collectionId: number) =>
    invoke<number>("move_matches_by_game_name", { pattern, collectionId }),
} as const;
