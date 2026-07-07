// Tournament-native (Plane A) chart option builders. These consume the
// competition response shape (standings + caster leaderboard), not a
// ChartBundle — no save-content, so they live with the tournament UI code
// rather than in $lib/stats. Both are simple bar charts; they render through
// the shared ChartContainer, reusing the chart theme + grid helpers.

import type { EChartsOption } from "echarts";
import { CHART_THEME, getChartColor } from "$lib/config";
import { toRgba } from "$lib/utils/color";
import { COMMON_GRID } from "$lib/stats/charts/helpers";
import type { CasterLeaderboardEntry } from "$lib/api-cloud";

// Fields the standings chart reads — the common subset of CombinedQualifier
// (the cross-division ranking) and SlotStanding (per-division), so either
// source feeds the same option.
interface StandingRow {
	wins: number;
	losses: number;
	status: "active" | "advanced" | "eliminated";
	withdrawn: boolean;
	buchholz_cut1: number;
	opponents_buchholz: number;
	cumulative: number;
	h2h: number;
	display_name: string | null;
}

const STATUS_LABEL: Record<StandingRow["status"], string> = {
	active: "Active",
	advanced: "Advanced",
	eliminated: "Eliminated",
};

// Truncate long labels on a category axis so a wide entity name can't blow out
// the grid; the full name is in the tooltip.
const CATEGORY_AXIS_LABEL = { width: 120, overflow: "truncate" as const };

// Standings visualization — a horizontal stacked Wins|Losses bar per player,
// ranked (rank 1 at top). Bar length = games played; the split shows the
// record, and the tooltip carries status + the tiebreak breakdown. Each player
// gets a distinct palette color: the win segment is the full color, the loss
// segment a muted (translucent) version of it. The caller selects, orders, and
// filters the rows (combined cross-division ranking vs. per-division preview).
export function standingsOption(rows: StandingRow[]): EChartsOption {
	const labels = rows.map((r, i) => r.display_name ?? `Slot ${i + 1}`);
	return {
		...CHART_THEME,
		tooltip: {
			...CHART_THEME.tooltip,
			axisPointer: { type: "shadow" },
			formatter: (params: unknown) => {
				const p = (params as { dataIndex: number }[])[0];
				const row = rows[p.dataIndex];
				if (!row) return "";
				const status = STATUS_LABEL[row.status] ?? row.status;
				const withdrawn = row.withdrawn ? " · withdrawn" : "";
				return (
					`${labels[p.dataIndex]} — ${status}${withdrawn}<br/>` +
					`W ${row.wins} · L ${row.losses}<br/>` +
					`Buchholz-cut1 ${row.buchholz_cut1} · Opp-Buch ${row.opponents_buchholz}<br/>` +
					`Cumulative ${row.cumulative} · H2H ${row.h2h}`
				);
			},
		},
		grid: { ...COMMON_GRID, left: 140 },
		xAxis: { type: "value", minInterval: 1 },
		yAxis: {
			type: "category",
			inverse: true,
			data: labels,
			axisLabel: CATEGORY_AXIS_LABEL,
		},
		series: [
			{
				name: "Wins",
				type: "bar",
				stack: "outcome",
				data: rows.map((r, i) => ({
					value: r.wins,
					itemStyle: { color: getChartColor(i) },
				})),
			},
			{
				name: "Losses",
				type: "bar",
				stack: "outcome",
				data: rows.map((r, i) => ({
					value: r.losses,
					itemStyle: { color: toRgba(getChartColor(i), 0.35) },
				})),
			},
		],
	};
}

// Caster leaderboard — horizontal bar of part-appearances per caster, most
// active at top. The list arrives pre-sorted descending from the server; each
// caster gets a distinct palette color.
export function casterLeaderboardOption(
	leaderboard: CasterLeaderboardEntry[],
): EChartsOption {
	const labels = leaderboard.map((c) => c.display_name ?? c.name ?? "Unknown");
	return {
		...CHART_THEME,
		tooltip: {
			...CHART_THEME.tooltip,
			axisPointer: { type: "shadow" },
			formatter: (params: unknown) => {
				const p = (params as { dataIndex: number; value: number }[])[0];
				const n = p.value;
				return `${labels[p.dataIndex]}<br/>${n} appearance${n === 1 ? "" : "s"}`;
			},
		},
		grid: { ...COMMON_GRID, left: 140 },
		xAxis: { type: "value", minInterval: 1 },
		yAxis: {
			type: "category",
			inverse: true,
			data: labels,
			axisLabel: CATEGORY_AXIS_LABEL,
		},
		series: [
			{
				type: "bar",
				data: leaderboard.map((c, i) => ({
					value: c.appearances,
					itemStyle: { color: getChartColor(i) },
				})),
			},
		],
	};
}
