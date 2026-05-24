/**
 * Nation and Tribe Colors
 *
 * This module defines color mappings for Old World nations and tribes.
 * These colors are used in charts and visualizations to represent different civilizations.
 *
 * Nations represent the major playable civilizations in Old World, while tribes
 * represent minor factions that players interact with throughout the game.
 */

import { getChartColor } from "./charts";

/**
 * Color palette for Old World nations
 *
 * Each nation has a distinct color optimized for:
 * - Visual distinction in multi-nation charts
 * - Thematic appropriateness to the civilization
 * - Sufficient contrast for readability
 */
export const NATION_COLORS = {
	AKSUM: "#F8A3B4", // Pink/Rose
	ASSYRIA: "#FADC3B", // Yellow
	BABYLONIA: "#82C83E", // Green
	CARTHAGE: "#F6EFE1", // Beige/Off-white
	EGYPT: "#BC6304", // Dark Orange/Brown
	GREECE: "#2360BC", // Dark Blue
	HITTITE: "#80E3E8", // Cyan
	KUSH: "#FFFFB6", // Light Yellow
	MAURYA: "#A749FF", // Purple
	PERSIA: "#C04E4A", // Red
	ROME: "#880D56", // Purple/Burgundy
	TAMIL: "#00B281", // Teal/Green
	YUEZHI: "#AD7E00", // Mustard/Gold
} as const;

/**
 * Color palette for Old World tribes
 *
 * Tribes are minor factions with distinct colors separate from major nations.
 */
export const TRIBE_COLORS = {
	GAULS: "#87DB40", // Lime Green
	VANDALS: "#9C5DFF", // Purple
	DANES: "#3CCDC2", // Teal
	THRACIANS: "#D89A18", // Orange/Gold
	SCYTHIANS: "#E6E1CA", // Beige/Light Tan
	NUMIDIANS: "#FFDD67", // Light Yellow
	HUNS: "#AB3157", // Dark Pink/Magenta
} as const;

/**
 * Union type of all valid nation keys
 */
export type NationKey = keyof typeof NATION_COLORS;

/**
 * Union type of all valid tribe keys
 */
export type TribeKey = keyof typeof TRIBE_COLORS;

/**
 * Get color for a nation by its enum key (e.g., "EGYPT", "ROME")
 *
 * @param nation - The nation key (matching backend enum values)
 * @returns Hex color code, or undefined if nation not found
 */
export function getNationColor(nation: string): string | undefined {
	const key = nation.toUpperCase() as NationKey;
	return NATION_COLORS[key];
}

/**
 * Get color for a tribe by its enum key (e.g., "GAULS", "DANES")
 *
 * @param tribe - The tribe key (matching backend enum values)
 * @returns Hex color code, or undefined if tribe not found
 */
export function getTribeColor(tribe: string): string | undefined {
	const key = tribe.toUpperCase() as TribeKey;
	return TRIBE_COLORS[key];
}

/**
 * Get color for either a nation or tribe
 *
 * Convenience function that checks both nation and tribe colors.
 * Prioritizes nation colors if there's a key collision.
 *
 * @param civilization - The nation or tribe key
 * @returns Hex color code, or undefined if not found
 */
export function getCivilizationColor(civilization: string): string | undefined {
	return getNationColor(civilization) ?? getTribeColor(civilization);
}

/**
 * Color for a nation in a chart series: the nation's civilization color,
 * or a palette color by index when the nation is unknown/missing. Strips
 * the `NATION_` prefix the backend stores. Single source of truth shared
 * by the game-detail and aggregate-stats charts so a nation renders in
 * the same color everywhere.
 *
 * @param nation - Nation key, with or without the `NATION_` prefix
 * @param fallbackIndex - Series index used for the palette fallback
 */
export function getNationChartColor(
	nation: string | null | undefined,
	fallbackIndex: number,
): string {
	if (nation) {
		const color = getCivilizationColor(nation.replace(/^NATION_/, ""));
		if (color) return color;
	}
	return getChartColor(fallbackIndex);
}

/**
 * Combined mapping of all nations and tribes for convenience
 */
export const ALL_CIVILIZATION_COLORS = {
	...NATION_COLORS,
	...TRIBE_COLORS,
} as const;
