// Nations tab option builders.

import type { ChartOption } from "$lib/echarts";
import { SPRITE_MANIFEST } from "$lib/generated/sprite-manifest";
import type { ChartBundle, ChartBundleCore } from "../types";
import {
	CHART_THEME,
	COMMON_GRID,
	WIN_COLOR,
	crestAxisLabel,
	fmtNation,
	winLossStackedOption,
} from "./helpers";

function nationCrestUrl(nation: string): string | undefined {
	return SPRITE_MANIFEST[`crests/CREST_${nation}`];
}

// Win rate by nation — the shared stacked wins/losses bar: bar length = games
// played, the split shows the rate. Typed against ChartBundleCore (only reads
// nationWinRate) so it renders unchanged at tournament scope, where the bundle
// has no Overview.
export function nationWinLossStackedOption(
	bundle: ChartBundleCore,
): ChartOption {
	return winLossStackedOption({
		rows: bundle.nationWinRate.map((r) => ({
			key: r.nation,
			games: r.games,
			wins: r.wins,
			rate: r.rate,
		})),
		label: fmtNation,
		iconUrl: nationCrestUrl,
	});
}

// Average final points by nation — horizontal bar sorted by points, best
// at top (mirrors the win-rate bar's orientation, no rotated labels).
export function nationAvgPointsOption(bundle: ChartBundle): ChartOption {
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
