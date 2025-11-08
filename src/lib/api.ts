import { invoke } from "@tauri-apps/api/core";
import type { GameStatistics } from "$lib/types/GameStatistics";
import type { GameDetails } from "$lib/types/GameDetails";
import type { PlayerHistory } from "$lib/types/PlayerHistory";
import type { YieldHistory } from "$lib/types/YieldHistory";

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
} as const;
