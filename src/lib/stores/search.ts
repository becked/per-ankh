import { writable } from "svelte/store";

/**
 * Store for the global game search query.
 * Shared between Header (input) and GameSidebar (filtering).
 */
export const searchQuery = writable("");
