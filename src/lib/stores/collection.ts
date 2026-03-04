import { writable } from "svelte/store";

/**
 * Store for the active collection filter.
 * - null means "show all collections"
 * - number means filter to that specific collection
 * - "shared" means show only shared games (virtual filter)
 *
 * This is used by GameSidebar to filter the game list.
 */
export const activeCollectionId = writable<number | "shared" | null>(null);
