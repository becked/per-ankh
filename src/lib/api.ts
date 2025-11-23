import { invoke } from "@tauri-apps/api/core";
import type { GameStatistics } from "$lib/types/GameStatistics";
import type { GameDetails } from "$lib/types/GameDetails";
import type { PlayerHistory } from "$lib/types/PlayerHistory";
import type { YieldHistory } from "$lib/types/YieldHistory";
import type { BatchImportResult } from "$lib/types/BatchImportResult";
import type { NationDynastyRow } from "$lib/types/NationDynastyRow";
import type { PlayerDebugRow } from "$lib/types/PlayerDebugRow";
import type { MatchDebugRow } from "$lib/types/MatchDebugRow";
import type { StoryEvent } from "$lib/types/StoryEvent";
import type { EventLog } from "$lib/types/EventLog";
import type { LawAdoptionHistory } from "$lib/types/LawAdoptionHistory";
import type { KnownOnlineId } from "$lib/types/KnownOnlineId";
import type { SaveDateEntry } from "$lib/types/SaveDateEntry";

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
  getGameStatistics: () =>
    invoke<GameStatistics>("get_game_statistics"),

  getSaveDates: () =>
    invoke<SaveDateEntry[]>("get_save_dates"),

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
} as const;
