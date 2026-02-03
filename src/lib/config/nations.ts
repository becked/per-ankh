/**
 * Nation and Tribe Colors
 *
 * This module defines color mappings for Old World nations and tribes.
 * These colors are used in charts and visualizations to represent different civilizations.
 *
 * Nations represent the major playable civilizations in Old World, while tribes
 * represent minor factions that players interact with throughout the game.
 */

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
	PERSIA: "#C04E4A", // Red
	ROME: "#880D56", // Purple/Burgundy
} as const;

/**
 * Color palette for Old World tribes
 *
 * Tribes are minor factions with distinct colors separate from major nations.
 */
export const TRIBE_COLORS = {
	GAULS: "#C84732", // Red-Orange
	VANDALS: "#87DB40", // Lime Green
	DANES: "#9C5DFF", // Purple
	THRACIANS: "#3CCDC2", // Teal
	SCYTHIANS: "#D89A18", // Orange/Gold
	NUMIDIANS: "#E6E1CA", // Beige/Light Tan
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
 * Combined mapping of all nations and tribes for convenience
 */
export const ALL_CIVILIZATION_COLORS = {
	...NATION_COLORS,
	...TRIBE_COLORS,
} as const;
