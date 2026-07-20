// Laws tab option builders.

import type { ChartOption } from "$lib/echarts";
import { getChartColor } from "$lib/config";
import type { ChartBundle } from "../types";
import {
	ALL_NATIONS,
	AXIS_NAME_X,
	CHART_THEME,
	COMMON_GRID,
	fmtLaw,
	nationLabel,
} from "./helpers";

// Nations present in the law data, most-played first — drives the selector in
// LawsStatsPanel (and its default, after the ALL_NATIONS entry). lawTiming has
// the broadest coverage (any civic law), so derive from it.
export function lawNations(bundle: ChartBundle): string[] {
	const games = new Map(bundle.nationWinRate.map((r) => [r.nation, r.games]));
	const set = new Set<string>();
	for (const r of bundle.lawTiming)
		if (r.nation !== ALL_NATIONS) set.add(r.nation);
	return [...set].sort((a, b) => (games.get(b) ?? 0) - (games.get(a) ?? 0));
}

export function lawTimingOption(
	bundle: ChartBundle,
	nation: string,
): ChartOption {
	const rows = bundle.lawTiming
		.filter((r) => r.nation === nation)
		.sort((a, b) => a.median_turn - b.median_turn)
		.slice(0, 25);
	return {
		...CHART_THEME,
		title: { ...CHART_THEME.title, text: "Law adoption" },
		tooltip: {
			...CHART_THEME.tooltip,
			axisPointer: { type: "shadow" },
			formatter: (params: unknown) => {
				const p = (params as { dataIndex: number }[])[0];
				const row = rows[p.dataIndex];
				if (!row) return "";
				const iqr =
					row.p25_turn != null && row.p75_turn != null
						? ` (IQR ${Math.round(row.p25_turn)}–${Math.round(row.p75_turn)})`
						: "";
				return `${fmtLaw(row.law)}<br/>Median turn ${Math.round(row.median_turn)}${iqr}<br/>n = ${row.count}`;
			},
		},
		grid: { ...COMMON_GRID, left: 160, top: 64 },
		xAxis: { type: "value", name: "Median turn", ...AXIS_NAME_X },
		yAxis: {
			type: "category",
			data: rows.map((r) => fmtLaw(r.law)),
			// Left-align labels at the grid's left edge (margin ≈ grid.left),
			// matching the Nations/Families convention.
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

// For one nation: the most common order-insensitive four-law openings as
// horizontal bars, most common at the top. The label is the four law names
// joined with "+" (order dropped); the tooltip carries the sample size.
export function openingLawsOption(
	bundle: ChartBundle,
	nation: string,
): ChartOption {
	const isAll = nation === ALL_NATIONS;
	// "All nations": collapse the same four-law set across nations (order is
	// already dropped) and sum counts. Otherwise restrict to the chosen nation.
	const grouped = new Map<string, { laws: string[]; count: number }>();
	for (const o of bundle.openingLaws) {
		if (!isAll && o.nation !== nation) continue;
		const key = o.laws.join("|");
		const e = grouped.get(key) ?? { laws: o.laws, count: 0 };
		e.count += o.count;
		grouped.set(key, e);
	}
	const rows = [...grouped.values()]
		.sort((a, b) => b.count - a.count)
		.slice(0, 15);
	const label = (laws: string[]) => laws.map(fmtLaw).join(" + ");
	return {
		...CHART_THEME,
		title: {
			...CHART_THEME.title,
			text: `${nationLabel(nation)} opening law sequence`,
		},
		tooltip: {
			...CHART_THEME.tooltip,
			axisPointer: { type: "shadow" },
			formatter: (params: unknown) => {
				const p = (params as { dataIndex: number }[])[0];
				const row = rows[p.dataIndex];
				if (!row) return "";
				return `${label(row.laws)}<br/>n = ${row.count}`;
			},
		},
		grid: { ...COMMON_GRID, left: 360, top: 64 },
		xAxis: { type: "value", name: "Count", ...AXIS_NAME_X },
		yAxis: {
			type: "category",
			data: rows.map((r) => label(r.laws)),
			// Left-align labels at the grid's left edge (margin ≈ grid.left).
			axisLabel: { interval: 0, align: "left", margin: 352 },
			// Sorted by count desc; inverse puts the most common at the top.
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
