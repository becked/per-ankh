// Shared helpers for the stats chart option builders. Reuses the
// existing chart-theme constants from $lib/config.

import type { ChartOption } from "$lib/echarts";
import { CHART_THEME } from "$lib/config";
import {
	MILITARY_POWER_COLOR,
	YIELD_COLORS,
} from "$lib/generated/yield-colors";
import { formatEnum, nationName, traitName } from "$lib/utils/formatting";

// Strip leaderless enum prefix for axis labels. The stats SQL returns
// raw values (NATION_PERSIA, TRAIT_INTELLIGENT, etc.); the chart axes
// need humanized text.

// Nations are the exception: two of them aren't their token (NATION_HITTITE is
// Hatti, NATION_TAMIL is Tamilakam), so axis labels take the shared helper.
export function fmtNation(value: string): string {
	return nationName(value);
}
// Traits are the other exception, and a wider one — 105 of the 306 aren't
// their token either (TRAIT_CLERGY_JEWISH is "Kohen").
export function fmtTrait(value: string): string {
	return traitName(value);
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

// Win/loss series colors — Growth against the combat rating's red.
//
// Green against red, the split most readers already know how to read. Both
// clear the contrast floor the yield bake enforces on the chart ground (5.23:1
// and 4.57:1) and they hold 0.256 apart in OKLab.
//
// The cost is red-green color blindness, where hue is exactly what this pair
// spends its distance on: 0.073 apart under deuteranopic simulation and 0.125
// protanopic, against the 0.140 floor the palette holds elsewhere. What
// carries the reading there is position and text, not hue — the stacked bars
// put wins first and losses second in a fixed order, and every one of these
// charts names the cohort in its tooltip ("Wins: n / games"). Legends are off
// chart-wide (CHART_THEME.legend.show), so the tooltip is the whole of it.
//
// The loss tone has no YIELD_* token of its own: it is COLOR_RATING_COURAGE,
// which the bake exports only under the name the Military Power series gave
// it. On that one chart the same red is the pooled median in pooled mode and
// the losers' line in split mode — never both at once, since color names the
// yield only when there is no cohort to name.
//
// Shared by every chart that splits a series by outcome (the nation win-rate
// bar, the leader and family bars, the yields winner/loser split) so the two
// cohorts mean the same thing everywhere. The nation average-points bar colors
// per nation and the tournament standings bar per player, so neither uses
// these — in both, a row is only ever itself.
export const WIN_COLOR = YIELD_COLORS.YIELD_GROWTH;
export const LOSS_COLOR = MILITARY_POWER_COLOR;

// The middle fill for a chart that buckets an outcome three ways rather than
// splitting it two (the wonders bars). The outer two buckets are WIN_COLOR and
// LOSS_COLOR above: a bucket that means "mostly won" and a stack segment that
// means "won" are the same claim, so they read in the same green and red
// everywhere. Culture sits between them for the bucket that is neither.
//
// Culture clears the same contrast floor on the chart ground (5.53:1). The
// three-way separation is tighter than the two-way pair it extends — 0.107 in
// OKLab at the worst pair (Growth/Culture) against the 0.256 of green-to-red —
// and under deuteranopic simulation the worst pair is still green-to-red at
// 0.073. What carries the reading is the same thing that carries it on the
// two-way charts: fixed order (won, mixed, lost, top to bottom) plus text —
// here a legend the wonders chart turns on and a tooltip that spells the rate
// out with its sample.
export const OUTCOME_MIXED = YIELD_COLORS.YIELD_CULTURE;

// The app's body-text tan (--color-tan, what `text-tan` renders), spelled as a
// literal because ECharts options can't read a CSS variable.
export const TEXT_TAN = "#D2B48C";

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

// Bar thickness, as a share of the category band. ECharts' default leaves a
// 20% category gap, so a bar fills ~80% of its band; 52% is 65% of that. The
// band itself is untouched — the row pitch above and the grid margins stay
// where they are, so slimming the marks never pulls the axis labels together.
// Spread into every bar series here (all of them stacked or single, one mark
// per category), so the whole catalog keeps one thickness.
export const BAR_WIDTH = "52%";

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

// One category's outcome tally for a win/loss bar. `rate` is the server's
// own wins/games — passed through rather than recomputed here, so the value
// the tooltip shows is the one the aggregator guarded against a zero
// denominator.
export interface WinLossRow {
	key: string;
	games: number;
	wins: number;
	rate: number;
}

// Horizontal stacked wins/losses bar: bar length = games played, the split
// shows the rate. Sorted by games ascending so the busiest category sits at
// the top (ECharts stacks a category axis bottom-up). One builder behind every
// outcome bar in the catalog — nations, leader archetypes, starting traits,
// family classes — so they stay identical by construction rather than by copy.
//
// Generic over the row so a caller can hang its own fields off `WinLossRow`
// (pick rate, city share, founding-order slots) and read them back in
// `tooltipFormatter` / `barLabel`. Those callbacks receive the *sorted* row
// rather than an index, so a caller can't mis-index against the pre-sort order.
export function winLossStackedOption<R extends WinLossRow>(opts: {
	rows: R[];
	// Display name for a row key (fmtNation, fmtTrait, …).
	label: (value: string) => string;
	// Sprite for a row key, when the category has icon art (nation crests,
	// archetype glyphs). Omit for text-only labels.
	iconUrl?: (value: string) => string | undefined;
	// Room reserved for the axis labels; widen for long names.
	labelWidth?: number;
	// In-chart ECharts title, for the panels that stack several of these with
	// no HTML heading of their own (Families). The registry-driven charts leave
	// it off — StatsView titles those from the spec.
	title?: string;
	// Replaces the default name / wins / rate tooltip body, for a category with
	// more to say than the outcome split.
	tooltipFormatter?: (row: R) => string;
	// Per-row annotation hung off the end of the bar.
	barLabel?: (row: R) => string;
}): ChartOption {
	const {
		rows,
		label,
		iconUrl,
		labelWidth = 140,
		title,
		tooltipFormatter,
		barLabel,
	} = opts;
	const sorted = [...rows].sort((a, b) => a.games - b.games);
	const keys = sorted.map((r) => r.key);
	return {
		...CHART_THEME,
		...(title ? { title: { ...CHART_THEME.title, text: title } } : {}),
		tooltip: {
			...CHART_THEME.tooltip,
			axisPointer: { type: "shadow" },
			formatter: (params: unknown) => {
				const p = (params as { dataIndex: number }[])[0];
				const row = sorted[p.dataIndex];
				if (!row) return "";
				if (tooltipFormatter) return tooltipFormatter(row);
				return `${label(row.key)}<br/>Wins: ${row.wins} / ${row.games}<br/>Rate: ${Math.round(row.rate * 100)}%`;
			},
		},
		grid: {
			...COMMON_GRID,
			left: labelWidth,
			// A title needs headroom (the same 64 the titled charts elsewhere
			// use), a bar label needs room past the end of the longest bar.
			...(title ? { top: 64 } : {}),
			...(barLabel ? { right: 120 } : {}),
		},
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
				barWidth: BAR_WIDTH,
				data: sorted.map((r) => r.wins),
				itemStyle: { color: WIN_COLOR },
			},
			{
				name: "Losses",
				type: "bar",
				stack: "outcome",
				barWidth: BAR_WIDTH,
				data: sorted.map((r) => r.games - r.wins),
				itemStyle: { color: LOSS_COLOR },
				// Hung off the loss segment so it lands past the end of the whole
				// bar, whatever the split.
				...(barLabel
					? {
							label: {
								show: true,
								position: "right" as const,
								color: CHART_THEME.textStyle.color,
								fontSize: 11,
								formatter: (p: { dataIndex: number }) => {
									const row = sorted[p.dataIndex];
									return row ? barLabel(row) : "";
								},
							},
						}
					: {}),
			},
		],
	};
}

export { CHART_THEME };
