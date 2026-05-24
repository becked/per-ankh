// Yields charts — one chart per series, stacked (mirrors the game-detail
// YieldsTab). Each chart shows the corpus median line with an optional
// P25–P75 band and an optional sample-size (games-per-turn) overlay, in
// either per-turn-rate or cumulative mode. The bundle ships both bands for
// all 16 series so the page-level toggles are instant.

import type { EChartsOption, LineSeriesOption } from "echarts";
import { getChartColor } from "$lib/config";
import type { ChartBundle } from "../types";
import { AXIS_NAME_Y, CHART_THEME, COMMON_GRID } from "./helpers";

// User-facing labels for the toggle. Order matters — the leading items
// are the most-used yields.
export const YIELD_SERIES = [
	{ key: "science_per_turn", label: "Science" },
	{ key: "money_per_turn", label: "Money" },
	{ key: "training_per_turn", label: "Training" },
	{ key: "civics_per_turn", label: "Civics" },
	{ key: "culture_per_turn", label: "Culture" },
	{ key: "orders_per_turn", label: "Orders" },
	{ key: "food_per_turn", label: "Food" },
	{ key: "growth_per_turn", label: "Growth" },
	{ key: "happiness_per_turn", label: "Happiness" },
	{ key: "discontent_per_turn", label: "Discontent" },
	{ key: "iron_per_turn", label: "Iron" },
	{ key: "stone_per_turn", label: "Stone" },
	{ key: "wood_per_turn", label: "Wood" },
	{ key: "maintenance_per_turn", label: "Maintenance" },
	{ key: "military_power", label: "Military Power" },
	{ key: "legitimacy", label: "Legitimacy" },
] as const;

const EMPTY_BAND = { p25: [], p50: [], p75: [] };

export function yieldChartOption(
	bundle: ChartBundle,
	yieldKey: string,
	label: string,
	opts: { mode: "rate" | "cumulative"; showBand: boolean; showCount: boolean },
): EChartsOption {
	const { turns, counts } = bundle.yieldCurves;
	const entry = bundle.yieldCurves.series[yieldKey];
	const band = entry ? entry[opts.mode] : EMPTY_BAND;

	const series: LineSeriesOption[] = [];

	if (opts.showBand) {
		// Confidence band: a transparent P25 baseline plus a stacked,
		// filled (P75 − P25) area renders the shaded interquartile range.
		series.push({
			name: "p25",
			type: "line",
			data: band.p25,
			stack: "band",
			smooth: true,
			showSymbol: false,
			silent: true,
			lineStyle: { opacity: 0 },
			z: 1,
		});
		series.push({
			name: "iqr",
			type: "line",
			data: band.p25.map((lo, i) => {
				const hi = band.p75[i];
				return lo != null && hi != null ? hi - lo : null;
			}),
			stack: "band",
			smooth: true,
			showSymbol: false,
			silent: true,
			lineStyle: { opacity: 0 },
			areaStyle: { color: getChartColor(0), opacity: 0.18 },
			z: 1,
		});
	}

	// Median line, always drawn on top of the band.
	series.push({
		name: "Median",
		type: "line",
		data: band.p50,
		smooth: true,
		showSymbol: false,
		itemStyle: { color: getChartColor(0) },
		z: 2,
	});

	// Sample-size overlay on a faint secondary axis.
	if (opts.showCount) {
		series.push({
			name: "Games",
			type: "line",
			yAxisIndex: 1,
			data: counts,
			smooth: true,
			showSymbol: false,
			lineStyle: { color: getChartColor(5), opacity: 0.5 },
			areaStyle: { color: getChartColor(5), opacity: 0.1 },
			z: 0,
		});
	}

	const fmt = (v: number | null) =>
		v == null ? "—" : Math.round(v).toString();

	return {
		...CHART_THEME,
		title: { ...CHART_THEME.title, text: label },
		tooltip: {
			trigger: "axis",
			formatter: (params: unknown) => {
				const i = (params as Array<{ dataIndex: number }>)[0]?.dataIndex ?? 0;
				if (band.p50[i] == null) return "";
				return `Turn ${turns[i]}<br/>Median: ${fmt(band.p50[i])}<br/>P25–P75: ${fmt(band.p25[i])}–${fmt(band.p75[i])}<br/>n: ${counts[i] ?? 0}`;
			},
		},
		grid: { ...COMMON_GRID, top: 64 },
		// Axis names omitted: the yield is in the title and the x-axis is
		// turns. The count overlay keeps its "Games" name (a distinct axis).
		xAxis: {
			type: "category",
			data: turns.map(String),
			boundaryGap: false,
		},
		yAxis: opts.showCount
			? [
					{ type: "value" },
					{
						type: "value",
						name: "Games",
						position: "right",
						splitLine: { show: false },
						...AXIS_NAME_Y,
					},
				]
			: { type: "value" },
		series,
	};
}
