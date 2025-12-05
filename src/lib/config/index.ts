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
  CHART_THEME,
  getChartColor,
} from "./charts";

// Re-export nation and tribe colors
export {
  NATION_COLORS,
  TRIBE_COLORS,
  ALL_CIVILIZATION_COLORS,
  getNationColor,
  getTribeColor,
  getCivilizationColor,
  type NationKey,
  type TribeKey,
} from "./nations";

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
