/**
 * Nation and Tribe Colors
 *
 * The game's own colour for each nation and tribe, baked from the reference
 * XML by `npm run bake:civilization-colors` — nations through their team
 * colour's `TeamPlayerColor`, tribes through the `aePlayerColors[0]` +
 * `CrestColor` chain `InfoHelpers.getTribeColor` reads. The tables cover the
 * base roster and the campaign civs, which reuse base colours.
 *
 * Nations represent the major playable civilizations in Old World, while tribes
 * represent minor factions that players interact with throughout the game.
 */

import {
	BASE_NATIONS,
	NATION_COLORS,
	TRIBE_COLORS,
} from "$lib/generated/civilization-colors";

import { getChartColor } from "./charts";

/**
 * The nations the base game defines, as opposed to the ones a campaign adds.
 * Re-exported so the /stats nation facet can offer the base roster without
 * reaching past this module for it.
 */
export { BASE_NATIONS };

/**
 * The baked tables are keyed by full zType. Callers pass either the raw enum
 * value the backend stores (`NATION_EGYPT`) or a bare key (`EGYPT`), so
 * normalise to the zType for the table being read — which also routes a
 * prefixed value to its own table and nowhere else.
 */
function zTypeFor(prefix: "NATION_" | "TRIBE_", civilization: string): string {
	return prefix + civilization.toUpperCase().replace(/^(NATION_|TRIBE_)/, "");
}

/**
 * Get color for a nation by its enum value (e.g., "NATION_EGYPT", "EGYPT")
 *
 * @param nation - The nation key, with or without the `NATION_` prefix
 * @returns Hex color code, or undefined if nation not found
 */
export function getNationColor(nation: string): string | undefined {
	return NATION_COLORS[zTypeFor("NATION_", nation)];
}

/**
 * Get color for a tribe by its enum value (e.g., "TRIBE_GAULS", "GAULS")
 *
 * @param tribe - The tribe key, with or without the `TRIBE_` prefix
 * @returns Hex color code, or undefined if tribe not found
 */
export function getTribeColor(tribe: string): string | undefined {
	return TRIBE_COLORS[zTypeFor("TRIBE_", tribe)];
}

/**
 * Get color for either a nation or tribe
 *
 * Convenience function that checks both nation and tribe colors, so callers
 * can pass the raw enum value the backend stores without knowing which of the
 * two it names.
 *
 * @param civilization - The nation or tribe key, with or without prefix
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
		const color = getCivilizationColor(nation);
		if (color) return color;
	}
	return getChartColor(fallbackIndex);
}
