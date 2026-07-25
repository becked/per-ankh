// Shared helpers for the stats chart option builders. Reuses the
// existing chart-theme constants from $lib/config.

import type { ChartOption } from "$lib/echarts";
import { CHART_THEME } from "$lib/config";
import { formatEnum } from "$lib/utils/formatting";

// Strip leaderless enum prefix for axis labels. The stats SQL returns
// raw values (NATION_PERSIA, TRAIT_SCHEMER_ARCHETYPE, etc.); the chart axes
// need humanized text.
export function fmtNation(value: string): string {
	return formatEnum(value, "NATION_");
}
// A character's archetype is stored as the archetype *trait* it maps to
// (TRAIT_SCHEMER_ARCHETYPE) — the game flags those traits bArchetype. Drop the
// suffix for display, matching the game-detail leader cards.
export function fmtArchetype(value: string): string {
	return formatEnum(value.replace(/_ARCHETYPE$/, ""), "TRAIT_");
}
export function fmtTrait(value: string): string {
	return formatEnum(value, "TRAIT_");
}
export function fmtClass(value: string): string {
	// Stored values are FAMILYCLASS_* (e.g. FAMILYCLASS_CHAMPIONS).
	return formatEnum(value, "FAMILYCLASS_");
}
export function fmtTech(value: string): string {
	return formatEnum(value, "TECH_");
}
export function fmtLaw(value: string): string {
	return formatEnum(value, "LAW_");
}

// Win/loss series colors. Copper for wins and a muted dark tone for losses —
// on-theme with the warm palette and distinct from each other without reading
// as a civ color. Shared by every chart that splits a series by outcome (the
// nation win-rate bar, the yields winner/loser split) so the two cohorts mean
// the same thing everywhere. (The tournament standings bar deliberately colors
// per-player instead, so it doesn't use these.)
export const WIN_COLOR = "#C87941";
export const LOSS_COLOR = "#5a4d3f";

// Sentinel selector value for the cross-nation aggregate ("All nations")
// option shared by the nation-selector panels (Families, Opening laws). Not a
// real NATION_* enum, so it never collides with one.
export const ALL_NATIONS = "__all__";
export function nationLabel(value: string): string {
	return value === ALL_NATIONS ? "All nations" : fmtNation(value);
}

// Common option fragments. Each chart starts from CHART_THEME and
// overrides as needed; small helpers cut repetition for the most
// common patterns.
export const COMMON_GRID = { left: 60, right: 30, top: 40, bottom: 60 };

// Container height for a horizontal bar chart: ~34px per row so the
// icon-bearing axis labels (crests, avatars) have breathing room, plus
// padding for the grid margins. Shared by the registry specs and the
// tournament stats charts so the same chart sizes identically everywhere.
export function barChartHeight(rowCount: number): string {
	return `${Math.max(rowCount, 1) * 34 + 90}px`;
}

// Axis-title placement, mirroring the game-detail charts: the title sits
// centered along the axis (x below it, y reading vertically beside it)
// rather than ECharts' default corner placement. Spread alongside `name`.
export const AXIS_NAME_X = { nameLocation: "middle", nameGap: 30 } as const;
export const AXIS_NAME_Y = { nameLocation: "middle", nameGap: 40 } as const;

// Left-aligned category axisLabel that renders each value as its crest icon
// followed by its display name (name only when there's no crest). Spread
// into a category axis's `axisLabel`; the axis `data` must be the raw values
// (not pre-formatted). `crestUrl` maps a raw value to its sprite URL;
// `margin` left-aligns the labels at the grid's left edge (set ≈ grid.left).
// Shared by the nations and families charts.
export function crestAxisLabel(
	values: string[],
	crestUrl: (value: string) => string | undefined,
	name: (value: string) => string,
	margin: number,
	size = 16,
	fontSize?: number,
) {
	const key = (v: string) => v.replace(/^[A-Z]+_/, "").toLowerCase();
	const rich: Record<string, object> = {};
	for (const v of values) {
		const url = crestUrl(v);
		if (url)
			rich[key(v)] = {
				height: size,
				width: size,
				backgroundColor: { image: url },
			};
	}
	return {
		interval: 0,
		align: "left" as const,
		margin,
		// `fontSize` styles the name text (the rich `{crest|}` tag only sizes the
		// icon); color comes from the chart theme's white axis-label default.
		...(fontSize != null ? { fontSize } : {}),
		formatter: (value: string) =>
			crestUrl(value) ? `{${key(value)}|} ${name(value)}` : name(value),
		rich,
	};
}

// One category's outcome tally for a win/loss bar. `rate` is the aggregator's
// wins/games (guarded against a zero-games row there), threaded through rather
// than recomputed here so the bar renders the same value the server persists.
export interface WinLossRow {
	key: string;
	games: number;
	wins: number;
	rate: number;
}

// Horizontal stacked wins/losses bar: bar length = games played, the split
// shows the rate. Sorted by games ascending so the busiest category sits at
// the top (ECharts stacks a category axis bottom-up). One builder behind every
// outcome bar in the catalog — nations, leader archetypes, starting traits —
// so they stay identical by construction rather than by copy.
export function winLossStackedOption(opts: {
	rows: WinLossRow[];
	// Display name for a row key (fmtNation, fmtArchetype, …).
	label: (value: string) => string;
	// Sprite for a row key, when the category has icon art (nation crests,
	// archetype glyphs). Omit for text-only labels.
	iconUrl?: (value: string) => string | undefined;
	// Room reserved for the axis labels; widen for long names.
	labelWidth?: number;
}): ChartOption {
	const { rows, label, iconUrl, labelWidth = 140 } = opts;
	const sorted = [...rows].sort((a, b) => a.games - b.games);
	const keys = sorted.map((r) => r.key);
	return {
		...CHART_THEME,
		tooltip: {
			...CHART_THEME.tooltip,
			axisPointer: { type: "shadow" },
			formatter: (params: unknown) => {
				const p = (params as { dataIndex: number }[])[0];
				const row = sorted[p.dataIndex];
				if (!row) return "";
				return `${label(row.key)}<br/>Wins: ${row.wins} / ${row.games}<br/>Rate: ${Math.round(row.rate * 100)}%`;
			},
		},
		grid: { ...COMMON_GRID, left: labelWidth },
		xAxis: { type: "value" },
		yAxis: {
			type: "category",
			data: keys,
			// Larger icon + name (white from the theme) for the headline charts;
			// an icon-less category renders the name alone at the same inset, so
			// both variants align to the grid edge identically.
			axisLabel: iconUrl
				? crestAxisLabel(keys, iconUrl, label, labelWidth - 8, 20, 14)
				: {
						interval: 0,
						align: "left" as const,
						margin: labelWidth - 8,
						fontSize: 14,
						formatter: label,
					},
		},
		series: [
			{
				name: "Wins",
				type: "bar",
				stack: "outcome",
				data: sorted.map((r) => r.wins),
				itemStyle: { color: WIN_COLOR },
			},
			{
				name: "Losses",
				type: "bar",
				stack: "outcome",
				data: sorted.map((r) => r.games - r.wins),
				itemStyle: { color: LOSS_COLOR },
			},
		],
	};
}

export { CHART_THEME };
