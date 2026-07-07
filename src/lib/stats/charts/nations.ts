// Nations tab option builders.

import type { EChartsOption } from "echarts";
import { SPRITE_MANIFEST } from "$lib/generated/sprite-manifest";
import type { ChartBundle, ChartBundleCore } from "../types";
import { CHART_THEME, COMMON_GRID, crestAxisLabel, fmtNation } from "./helpers";

function nationCrestUrl(nation: string): string | undefined {
	return SPRITE_MANIFEST[`crests/CREST_${nation}`];
}

// Win/loss colors for the stacked bar. Copper for wins and a muted dark
// tone for losses — on-theme with the warm palette and distinct from each
// other without reading as a civ color. (The tournament standings bar
// deliberately colors per-player instead, so these stay local here.)
const WIN_COLOR = "#C87941";
const LOSS_COLOR = "#5a4d3f";

// Win rate by nation — stacked wins/losses bar (horizontal): bar length =
// games played, the wins/losses split shows the rate. Sorted by games
// played, most at top. Typed against ChartBundleCore (only reads nationWinRate)
// so it renders unchanged at tournament scope, where the bundle has no Overview.
export function nationWinLossStackedOption(
	bundle: ChartBundleCore,
): EChartsOption {
	const rows = [...bundle.nationWinRate].sort((a, b) => a.games - b.games);
	const nations = rows.map((r) => r.nation);
	return {
		...CHART_THEME,
		tooltip: {
			...CHART_THEME.tooltip,
			axisPointer: { type: "shadow" },
			formatter: (params: unknown) => {
				const p = (params as { dataIndex: number }[])[0];
				const row = rows[p.dataIndex];
				if (!row) return "";
				return `${fmtNation(row.nation)}<br/>Wins: ${row.wins} / ${row.games}<br/>Rate: ${Math.round(row.rate * 100)}%`;
			},
		},
		grid: { ...COMMON_GRID, left: 140 },
		xAxis: { type: "value" },
		yAxis: {
			type: "category",
			data: nations,
			// Larger crest + name (white from the theme) for the headline charts.
			axisLabel: crestAxisLabel(
				nations,
				nationCrestUrl,
				fmtNation,
				132,
				20,
				14,
			),
		},
		series: [
			{
				name: "Wins",
				type: "bar",
				stack: "outcome",
				data: rows.map((r) => r.wins),
				itemStyle: { color: WIN_COLOR },
			},
			{
				name: "Losses",
				type: "bar",
				stack: "outcome",
				data: rows.map((r) => r.games - r.wins),
				itemStyle: { color: LOSS_COLOR },
			},
		],
	};
}

// Average final points by nation — horizontal bar sorted by points, best
// at top (mirrors the win-rate bar's orientation, no rotated labels).
export function nationAvgPointsOption(bundle: ChartBundle): EChartsOption {
	const rows = [...bundle.nationAvgPoints].sort(
		(a, b) => a.avg_points - b.avg_points,
	);
	const nations = rows.map((r) => r.nation);
	return {
		...CHART_THEME,
		tooltip: {
			...CHART_THEME.tooltip,
			axisPointer: { type: "shadow" },
			formatter: (params: unknown) => {
				const p = (params as { dataIndex: number }[])[0];
				const row = rows[p.dataIndex];
				if (!row) return "";
				return `${fmtNation(row.nation)}<br/>Avg final points: ${Math.round(row.avg_points)}`;
			},
		},
		grid: { ...COMMON_GRID, left: 140 },
		xAxis: { type: "value" },
		yAxis: {
			type: "category",
			data: nations,
			// Larger crest + name (white from the theme) for the headline charts.
			axisLabel: crestAxisLabel(
				nations,
				nationCrestUrl,
				fmtNation,
				132,
				20,
				14,
			),
		},
		series: [
			{
				type: "bar",
				// Copper, matching the Win rate chart's wins color.
				data: rows.map((r) => Math.round(r.avg_points)),
				itemStyle: { color: WIN_COLOR },
			},
		],
	};
}
