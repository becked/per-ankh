/**
 * Chart Configuration
 *
 * This module defines color palettes and theme configuration for data
 * visualization using Apache ECharts. Two palettes live here and are not
 * interchangeable: CHART_COLORS, a warm fallback ramp for a civilization with
 * no color of its own, and SERIES_COLORS, the categorical rotation taken from
 * Old World's own yield palette. Each says which it is below.
 */

import { YIELD_COLORS } from "$lib/generated/yield-colors";

/**
 * Warm fallback ramp, indexed by series ordinal.
 *
 * This is the palette a *civilization* falls back to when it has no color of
 * its own — an unrecognized nation or family, or a mirror match where two
 * players share one nation and need telling apart (see `getNationChartColor`,
 * `getFamilyChartColor`). Its six tones sit inside a 37-degree hue arc, which
 * is what makes it read as one family of browns rather than six categories;
 * for a rotation that has to keep N series apart, use `SERIES_COLORS` below.
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
 * The UI font stack, mirroring `html, body` in src/app.css — which is the
 * source of truth, and where the @font-face and the reasoning live. ECharts
 * draws to a canvas rather than to the DOM, so it can't inherit the stack and
 * needs its own copy; a change there belongs here too.
 */
const CHART_FONT_FAMILY =
	'"Inter Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/**
 * Font shorthand for probing `document.fonts` in Chart.svelte, which redraws
 * a chart that painted before the webfont arrived. Inter ships as a single
 * variable face, so any one size settles whether the face itself has landed.
 */
export const CHART_FONT_PROBE = '12px "Inter Variable"';

/**
 * Default ECharts theme configuration
 *
 * Provides consistent styling across all charts in the application.
 */
export const CHART_THEME = {
	colors: CHART_COLORS,
	backgroundColor: "#211A12", // Blue-gray background matches main UI
	animation: false, // Disable initial animation for smoother page transitions
	textStyle: {
		fontFamily: CHART_FONT_FAMILY,
		color: "#FFFFFF", // White text for dark background
	},
	title: {
		left: "center",
		textStyle: {
			color: "#FFFFFF",
			fontSize: 20,
		},
	},
	legend: {
		show: false, // Hide legend - colors consistently represent nations, info available in tooltips
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

/**
 * Categorical rotation, drawn from Old World's own yield palette.
 *
 * Where `CHART_COLORS` is a fallback ramp of six browns, this is the palette
 * for a chart that needs its rows told apart — one color per bar on the laws,
 * tech and cities charts, one per person on the tournament standings and
 * caster bars. It is a subset of `YIELD_COLORS`: the eight that survive a pairwise
 * separation floor, taking each pair's distance as the *worse* of normal and
 * deuteranopic vision, so a red-green viewer sees the same eight categories.
 *
 * Closest surviving pair is Stone/Discontent at 0.056 in OKLab; the seven
 * dropped (Culture, Growth, Legitimacy, Maintenance, Money, Orders, Training)
 * each collided with a survivor below that. For scale, `CHART_COLORS`
 * bottoms out at 0.017 (Chocolate/Dark Goldenrod, deuteranopic) — close
 * enough to read as a repeat.
 *
 * The order is cyclic, not the yields' own: it maximizes the distance between
 * *neighbouring* indices, including the wrap from the last back to the first.
 * That matters most on the charts that outrun it — a 25-row tech or law chart
 * laps the palette three times — because it means a bar never sits next to a
 * near-twin of itself, and the seam where the rotation restarts contrasts as
 * hard as any other step. Adjacent separation never drops below 0.187.
 * Reordering this array is a design change, not a cosmetic one.
 */
export const SERIES_COLORS = [
	YIELD_COLORS.YIELD_HAPPINESS,
	YIELD_COLORS.YIELD_WOOD,
	YIELD_COLORS.YIELD_IRON,
	YIELD_COLORS.YIELD_STONE,
	YIELD_COLORS.YIELD_CIVICS,
	YIELD_COLORS.YIELD_SCIENCE,
	YIELD_COLORS.YIELD_FOOD,
	YIELD_COLORS.YIELD_DISCONTENT,
] as const;

/**
 * Get a categorical series color by index, wrapping past the end of the
 * palette. The wrap is a real repeat — see `SERIES_COLORS` on why the order
 * is chosen so the seam contrasts.
 *
 * @param index - Zero-based index of the data series
 * @returns Hex color code
 */
export function getSeriesColor(index: number): string {
	return SERIES_COLORS[index % SERIES_COLORS.length];
}

/**
 * Subdued reference line (e.g. the momentum chart's 50% midline):
 * warm gray between the theme's surface browns and its text creams, so the
 * line reads as furniture rather than another data series.
 */
export const CHART_REFERENCE_LINE_COLOR = "#6b6459";

/**
 * The app's orange accent (`--color-orange`), for chart chrome that marks
 * where the reader is pointing — the axis pointer's turn label. Hex rather
 * than the CSS variable because charts paint to canvas, which can't resolve
 * `rgb(var(--color-orange))`.
 */
export const CHART_ACCENT_COLOR = "#FFA500";
