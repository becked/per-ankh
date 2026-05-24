// Cities tab: expansion-speed win-rate for the corpus.

import type { EChartsOption } from "echarts";
import { getChartColor } from "$lib/config";
import type { ChartBundle } from "../types";
import { AXIS_NAME_X, AXIS_NAME_Y, CHART_THEME, COMMON_GRID } from "./helpers";

// Win rate vs. expansion speed: win rate per 5th-city-founding-turn bucket,
// ordered fastest → slowest (with "never" — fewer than 5 cities — last).
// Empty buckets are dropped so a sparse corpus doesn't show gaps.
export function expansionWinRateOption(bundle: ChartBundle): EChartsOption {
	const order = ["≤25", "26–50", "51–75", "76–100", "101–150", "151+", "never"];
	const rows = order
		.map((b) => bundle.expansionWinRate.find((x) => x.bucket === b))
		.filter((x): x is NonNullable<typeof x> => x != null && x.games > 0);
	const pct = (v: number) => `${Math.round(v * 100)}%`;
	return {
		...CHART_THEME,
		tooltip: {
			...CHART_THEME.tooltip,
			axisPointer: { type: "shadow" },
			formatter: (params: unknown) => {
				const p = (params as { dataIndex: number }[])[0];
				const r = rows[p.dataIndex];
				if (!r) return "";
				return `5th city: ${r.bucket}<br/>Win rate: ${pct(r.rate)}<br/>${r.wins} / ${r.games} games`;
			},
		},
		grid: COMMON_GRID,
		xAxis: {
			type: "category",
			data: rows.map((r) => r.bucket),
			name: "Turn 5th city founded",
			...AXIS_NAME_X,
		},
		yAxis: {
			type: "value",
			name: "Win rate",
			min: 0,
			max: 1,
			axisLabel: { formatter: (v: number) => pct(v) },
			...AXIS_NAME_Y,
		},
		series: [
			{
				type: "bar",
				data: rows.map((r) => r.rate),
				itemStyle: { color: getChartColor(0) },
			},
		],
	};
}
