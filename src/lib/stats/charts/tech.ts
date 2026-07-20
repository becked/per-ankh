// Tech tab option builders. Both charts are broken down by nation; the bundle
// carries an ALL_NATIONS aggregate row alongside the per-nation rows, so each
// builder just filters to the selected nation.

import type { ChartOption } from "$lib/echarts";
import { getChartColor } from "$lib/config";
import { TECH_NAMES } from "$lib/generated/tech-names";
import type { ChartBundle } from "../types";
import {
	ALL_NATIONS,
	AXIS_NAME_X,
	CHART_THEME,
	COMMON_GRID,
	fmtTech,
} from "./helpers";

function techLabel(value: string): string {
	return TECH_NAMES[value] ?? fmtTech(value);
}

// Nations present in the tech data, most-played first — drives the selector
// in TechStatsPanel (and its default, after the ALL_NATIONS entry).
export function techNations(bundle: ChartBundle): string[] {
	const games = new Map(bundle.nationWinRate.map((r) => [r.nation, r.games]));
	const set = new Set<string>();
	for (const r of bundle.techTiming)
		if (r.nation !== ALL_NATIONS) set.add(r.nation);
	for (const r of bundle.techFirst)
		if (r.nation !== ALL_NATIONS) set.add(r.nation);
	return [...set].sort((a, b) => (games.get(b) ?? 0) - (games.get(a) ?? 0));
}

export function techFirstOption(
	bundle: ChartBundle,
	nation: string,
): ChartOption {
	const rows = bundle.techFirst
		.filter((r) => r.nation === nation)
		.sort((a, b) => b.count - a.count)
		.slice(0, 15);
	return {
		...CHART_THEME,
		title: { ...CHART_THEME.title, text: "First tech researched" },
		tooltip: { ...CHART_THEME.tooltip, axisPointer: { type: "shadow" } },
		grid: { ...COMMON_GRID, left: 160, top: 64 },
		xAxis: { type: "value", name: "Count", ...AXIS_NAME_X },
		yAxis: {
			type: "category",
			data: rows.map((r) => techLabel(r.tech)),
			// Left-align labels at the grid's left edge (margin ≈ grid.left),
			// matching the Laws charts.
			axisLabel: { interval: 0, align: "left", margin: 152 },
			inverse: true,
		},
		series: [
			{
				type: "bar",
				data: rows.map((r, i) => ({
					value: r.count,
					itemStyle: { color: getChartColor(i) },
				})),
			},
		],
	};
}

export function techTimingOption(
	bundle: ChartBundle,
	nation: string,
): ChartOption {
	const rows = bundle.techTiming
		.filter((r) => r.nation === nation)
		.sort((a, b) => a.median_turn - b.median_turn)
		.slice(0, 25);
	return {
		...CHART_THEME,
		title: { ...CHART_THEME.title, text: "Tech timing" },
		tooltip: { ...CHART_THEME.tooltip, axisPointer: { type: "shadow" } },
		grid: { ...COMMON_GRID, left: 160, top: 64 },
		xAxis: { type: "value", name: "Median turn", ...AXIS_NAME_X },
		yAxis: {
			type: "category",
			data: rows.map((r) => techLabel(r.tech)),
			// Left-align labels at the grid's left edge (margin ≈ grid.left),
			// matching the Laws charts.
			axisLabel: { interval: 0, align: "left", margin: 152 },
			inverse: true,
		},
		series: [
			{
				type: "bar",
				data: rows.map((r, i) => ({
					value: r.median_turn,
					itemStyle: { color: getChartColor(i) },
				})),
			},
		],
	};
}
