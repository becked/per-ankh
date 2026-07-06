// Tournament-native (Plane A) chart option builders. These consume the
// competition response shape (standings + caster leaderboard), not a
// ChartBundle — no save-content, so they live with the tournament UI code
// rather than in $lib/stats. Both are simple bar charts; they render through
// the shared ChartContainer, reusing the chart theme + grid helpers.

import type { EChartsOption } from "echarts";
import { CHART_THEME, getChartColor } from "$lib/config";
import {
	AXIS_NAME_X,
	COMMON_GRID,
	OUTCOME_LOSS_COLOR,
	OUTCOME_WIN_COLOR,
} from "$lib/stats/charts/helpers";
import type { CasterLeaderboardEntry, StandingsResponse } from "$lib/api-cloud";

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
// record, and the tooltip carries status + the tiebreak breakdown. Uses the
// cross-division combined ranking when present (swiss onward); falls back to
// concatenated per-division standings for a setup-phase admin preview.
export function standingsOption(standings: StandingsResponse): EChartsOption {
	const rows: StandingRow[] = standings.combined_qualifier_ranking ?? [
		...standings.divisions.A.standings,
		...standings.divisions.B.standings,
	];
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
		xAxis: { type: "value", name: "games", minInterval: 1, ...AXIS_NAME_X },
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
				data: rows.map((r) => r.wins),
				itemStyle: { color: OUTCOME_WIN_COLOR },
				label: { show: true, position: "inside" },
			},
			{
				name: "Losses",
				type: "bar",
				stack: "outcome",
				data: rows.map((r) => r.losses),
				itemStyle: { color: OUTCOME_LOSS_COLOR },
			},
		],
	};
}

// Caster leaderboard — horizontal bar of part-appearances per caster, most
// active at top. The list arrives pre-sorted descending from the server.
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
		xAxis: {
			type: "value",
			name: "appearances",
			minInterval: 1,
			...AXIS_NAME_X,
		},
		yAxis: {
			type: "category",
			inverse: true,
			data: labels,
			axisLabel: CATEGORY_AXIS_LABEL,
		},
		series: [
			{
				type: "bar",
				data: leaderboard.map((c) => c.appearances),
				itemStyle: { color: getChartColor(0) },
				label: { show: true, position: "right" },
			},
		],
	};
}
