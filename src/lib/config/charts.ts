/**
 * Chart Configuration
 *
 * This module defines color palettes and theme configuration for data visualization
 * using Apache ECharts. The colors use warm, earthy tones consistent with the
 * Old World/Egyptian theme.
 */

/**
 * Chart color palette for multi-series data visualization
 *
 * These colors are optimized for:
 * - Visual distinction between different data series (players, metrics)
 * - Warm, earthy aesthetic matching the Old World theme
 * - Sufficient contrast for readability
 *
 * Color names reference standard web color naming:
 * - Copper (#C87941)
 * - Saddle Brown (#8B4513)
 * - Peru (#CD853F)
 * - Sienna (#A0522D)
 * - Chocolate (#D2691E)
 * - Dark Goldenrod (#B8860B)
 */
export const CHART_COLORS = [
  "#C87941", // Copper
  "#8B4513", // Saddle Brown
  "#CD853F", // Peru
  "#A0522D", // Sienna
  "#D2691E", // Chocolate
  "#B8860B", // Dark Goldenrod
] as const;

/**
 * Default ECharts theme configuration
 *
 * Provides consistent styling across all charts in the application.
 */
export const CHART_THEME = {
  colors: CHART_COLORS,
  backgroundColor: "transparent",
  textStyle: {
    fontFamily: "inherit",
  },
  title: {
    left: "center",
    textStyle: {
      color: "#1a1a1a",
      fontWeight: "bold",
    },
  },
  tooltip: {
    trigger: "axis",
  },
} as const;

/**
 * Get a chart color by index, with automatic wrapping for datasets
 * with more series than available colors.
 *
 * @param index - Zero-based index of the data series
 * @returns Hex color code
 */
export function getChartColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length];
}
