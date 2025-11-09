import { invoke } from "@tauri-apps/api/core";
import type { GameStatistics } from "$lib/types/GameStatistics";
import type { GameDetails } from "$lib/types/GameDetails";
import type { PlayerHistory } from "$lib/types/PlayerHistory";
import type { YieldHistory } from "$lib/types/YieldHistory";
import type { BatchImportResult } from "$lib/types/BatchImportResult";
import type { NationDynastyRow } from "$lib/types/NationDynastyRow";
import type { PlayerDebugRow } from "$lib/types/PlayerDebugRow";
import type { MatchDebugRow } from "$lib/types/MatchDebugRow";

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

  getGameDetails: (matchId: number) =>
    invoke<GameDetails>("get_game_details", { matchId }),

  getPlayerHistory: (matchId: number) =>
    invoke<PlayerHistory[]>("get_player_history", { matchId }),

  getYieldHistory: (matchId: number, yieldTypes: string[]) =>
    invoke<YieldHistory[]>("get_yield_history", { matchId, yieldTypes }),

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
} as const;
