// Game length tab: how long this corpus's games ran, as a histogram of turn
// counts.
//
// A histogram rather than a bar per statistic, because the statistics are
// already beside it as numbers (GameLengthPanel) and they are the part a bar
// chart reads worst — four marks of wildly different height, three of which
// are single games. The shape is what only a chart can show: the public duel
// corpus is a clear mound at 60–79 with a long thin right tail, and "average
// 74" says none of that.
//
// One series, one color: this is a single distribution, not categories. The
// per-bucket rotation `expansionWinRateOption` uses is right there, where each
// bucket is its own cohort with its own rate.

import type { ChartOption } from "$lib/echarts";
import { getSeriesColor } from "$lib/config";
import type { TurnLengthStats } from "../types";
import {
	AXIS_NAME_X,
	AXIS_NAME_Y,
	BAR_WIDTH,
	CHART_THEME,
	COMMON_GRID,
} from "./helpers";

// A bucket's axis label — "60–79" for a 20-turn bucket starting at 60. Both
// ends come from the bundle's own `bucket_turns`, so a bundle cached under a
// different width labels its own buckets rather than the deployed constant's.
function bucketLabel(start: number, bucketTurns: number): string {
	return `${start}–${start + bucketTurns - 1}`;
}

export function gameLengthHistogramOption(
	turnLength: TurnLengthStats,
): ChartOption {
	const { histogram, bucket_turns: bucketTurns, games } = turnLength;
	const labels = histogram.map((b) => bucketLabel(b.start, bucketTurns));
	// Share of the corpus, so a reader of one surface's mound can compare it
	// with another's without holding both sample sizes in their head.
	const share = (count: number) => Math.round((count / games) * 100);
	return {
		...CHART_THEME,
		tooltip: {
			...CHART_THEME.tooltip,
			axisPointer: { type: "shadow" },
			formatter: (params: unknown) => {
				const p = (params as { dataIndex: number }[])[0];
				const bucket = histogram[p.dataIndex];
				if (!bucket) return "";
				return `${bucketLabel(bucket.start, bucketTurns)} turns<br/>${bucket.count} of ${games} games<br/>${share(bucket.count)}%`;
			},
		},
		grid: COMMON_GRID,
		xAxis: {
			type: "category",
			data: labels,
			name: "Turns",
			...AXIS_NAME_X,
		},
		yAxis: {
			type: "value",
			name: "Games",
			minInterval: 1,
			...AXIS_NAME_Y,
		},
		series: [
			{
				type: "bar",
				barWidth: BAR_WIDTH,
				data: histogram.map((b) => b.count),
				itemStyle: { color: getSeriesColor(0) },
			},
		],
	};
}
