/**
 * Configuration Module Index
 *
 * Central export point for all configuration modules including:
 * - Chart colors and themes
 * - Nation and tribe colors
 */

// Re-export chart configuration
export {
	CHART_COLORS,
	CHART_FONT_PROBE,
	CHART_THEME,
	CHART_REFERENCE_LINE_COLOR,
	CHART_ACCENT_COLOR,
	SERIES_COLORS,
	TOOLTIP_TEXT,
	TOOLTIP_MUTED,
	TOOLTIP_SURFACE,
	TOOLTIP_BORDER,
	getChartColor,
	getSeriesColor,
} from "./charts";

// Re-export nation and tribe colors
export {
	UNOWNED_CITY_BORDER_COLOR,
	getNationColor,
	getTribeColor,
	getCivilizationColor,
	getNationChartColor,
} from "./nations";

// Re-export family colors
export { getFamilyChartColor } from "./families";

// Re-export terrain colors
export {
	TERRAIN_COLORS,
	HEIGHT_COLORS,
	VEGETATION_COLORS,
	RESOURCE_COLORS,
	UNOWNED_TILE_COLOR,
	RESOURCE_DEFAULT_COLOR,
	getTerrainColor,
	getHeightColor,
	getVegetationColor,
	getResourceColor,
	getMutedTerrainColor,
} from "./terrain";
