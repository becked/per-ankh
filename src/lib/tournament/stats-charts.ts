// Tournament-native (Plane A) chart option builders. These consume the
// competition response shape (standings + caster leaderboard), not a
// ChartBundle — no save-content, so they live with the tournament UI code
// rather than in $lib/stats. Both are simple bar charts; they render through
// the shared ChartContainer, reusing the chart theme + grid helpers.

import type { ChartOption } from "$lib/echarts";
import { CHART_THEME, getChartColor, getNationChartColor } from "$lib/config";
import { toRgba } from "$lib/utils/color";
import {
	COMMON_GRID,
	crestAxisLabel,
	fmtNation,
} from "$lib/stats/charts/helpers";
import { escapeHtml } from "$lib/utils/formatting";
import type { CasterLeaderboardEntry, PlayerPicksEntry } from "$lib/api-cloud";

// Fields the standings chart reads — the common subset of CombinedQualifier
// (the cross-division ranking) and SlotStanding (per-division), so either
// source feeds the same option.
interface StandingRow {
	slot_id: string;
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

// Label gutter (px) reserved left of the plot for the avatar + name labels:
// the grid starts at LABEL_GUTTER, labels left-align 8px in from the container
// edge, and names truncate to what fits before the plot starts (the full name
// is in the tooltip). Wider than the nation chart's 140 — usernames run longer
// than nation names.
const LABEL_GUTTER = 180;
const CATEGORY_AXIS_LABEL = {
	width: LABEL_GUTTER - 20,
	overflow: "truncate" as const,
};

// Avatar box size (CSS px) in the axis labels — 20px circle + 14px name,
// matching the nation win-rate chart's crest labels so the page's charts read
// consistently. The page's avatar loader rasterizes at this size.
export const AVATAR_LABEL_SIZE = 20;

// Participant rows are keyed on the category axis under positional sentinels
// ("p0", "p1", …) rather than display names: crestAxisLabel derives rich-text
// style keys from the axis values, and usernames are unsafe there (rich-tag
// delimiters, case-folding collisions). The resolvers map a key back to its
// row; tooltips are unaffected (they read dataIndex).
const rowKey = (i: number) => `p${i}`;
const rowIndex = (key: string) => Number(key.slice(1));

// Category axisLabel rendering each row as its circular avatar + name — the
// crest idiom pointed at pre-rasterized avatar images (aligned to the rows;
// undefined while the page is still loading them, which renders name-only).
function avatarAxisLabel(
	keys: string[],
	labels: string[],
	avatarImages: (string | undefined)[] | undefined,
) {
	return {
		...crestAxisLabel(
			keys,
			(k) => avatarImages?.[rowIndex(k)],
			(k) => labels[rowIndex(k)] ?? "",
			LABEL_GUTTER - 8,
			AVATAR_LABEL_SIZE,
			14,
		),
		...CATEGORY_AXIS_LABEL,
	};
}

// Standings visualization — a horizontal stacked Wins|Losses bar per player,
// ranked (rank 1 at top). Bar length = games played; the split shows the
// record, and the tooltip carries status + the tiebreak breakdown. Each player
// gets a distinct palette color: the win segment is the full color, the loss
// segment a muted (translucent) version of it. The caller selects, orders, and
// filters the rows (combined cross-division ranking vs. per-division preview)
// and preloads `avatarImages` (loadCircularAvatars, aligned to the rows).
export function standingsOption(
	rows: StandingRow[],
	avatarImages?: (string | undefined)[],
): ChartOption {
	// Same unclaimed-slot fallback as the overview standings table.
	const labels = rows.map(
		(r) => r.display_name ?? `slot ${r.slot_id.slice(0, 6)}`,
	);
	const keys = rows.map((_, i) => rowKey(i));
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
					`${escapeHtml(labels[p.dataIndex])} — ${status}${withdrawn}<br/>` +
					`W ${row.wins} · L ${row.losses}<br/>` +
					`Buchholz-cut1 ${row.buchholz_cut1} · Opp-Buch ${row.opponents_buchholz}<br/>` +
					`Cumulative ${row.cumulative} · H2H ${row.h2h}`
				);
			},
		},
		grid: { ...COMMON_GRID, left: LABEL_GUTTER },
		xAxis: { type: "value", minInterval: 1 },
		yAxis: {
			type: "category",
			inverse: true,
			data: keys,
			axisLabel: avatarAxisLabel(keys, labels, avatarImages),
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
// caster gets a distinct palette color. The caller preloads `avatarImages`
// (loadCircularAvatars, aligned to the leaderboard).
export function casterLeaderboardOption(
	leaderboard: CasterLeaderboardEntry[],
	avatarImages?: (string | undefined)[],
): ChartOption {
	const labels = leaderboard.map((c) => c.display_name ?? c.name ?? "Unknown");
	const keys = leaderboard.map((_, i) => rowKey(i));
	return {
		...CHART_THEME,
		tooltip: {
			...CHART_THEME.tooltip,
			axisPointer: { type: "shadow" },
			formatter: (params: unknown) => {
				const p = (params as { dataIndex: number; value: number }[])[0];
				const n = p.value;
				return `${escapeHtml(labels[p.dataIndex])}<br/>${n} appearance${n === 1 ? "" : "s"}`;
			},
		},
		grid: { ...COMMON_GRID, left: LABEL_GUTTER },
		xAxis: { type: "value", minInterval: 1 },
		yAxis: {
			type: "category",
			inverse: true,
			data: keys,
			axisLabel: avatarAxisLabel(keys, labels, avatarImages),
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

// Per-player nation picks — one horizontal stacked bar per participant, each
// segment a civ they've fielded (segment width = games with it), civ-colored.
// Rows arrive pre-ordered (standings rank) from the server; the caller preloads
// `avatarImages` (loadCircularAvatars, aligned to the rows). Flat segments — the
// win/loss split lives in the tooltip, not a second visual axis. One ECharts
// series per distinct nation (stacked), so a player's row is the sum of their
// segments; nations a player never fielded contribute a zero-width segment.
export function playerPicksOption(
	players: PlayerPicksEntry[],
	avatarImages?: (string | undefined)[],
): ChartOption {
	const labels = players.map((p) => p.display_name ?? p.name ?? "Unknown");
	const keys = players.map((_, i) => rowKey(i));
	// Union of nations across all players, ordered by total games fielded so
	// segment colors are assigned deterministically (dominant civs first).
	const nationTotals = new Map<string, number>();
	for (const p of players) {
		for (const pk of p.picks) {
			nationTotals.set(
				pk.nation,
				(nationTotals.get(pk.nation) ?? 0) + pk.games,
			);
		}
	}
	const nations = [...nationTotals.entries()]
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.map(([n]) => n);
	return {
		...CHART_THEME,
		tooltip: {
			...CHART_THEME.tooltip,
			axisPointer: { type: "shadow" },
			formatter: (params: unknown) => {
				const p = (params as { dataIndex: number }[])[0];
				const row = players[p.dataIndex];
				if (!row) return "";
				const lines = row.picks
					.map(
						(pk) =>
							`${fmtNation(pk.nation)} — ${pk.games} game${pk.games === 1 ? "" : "s"} (${pk.wins}W ${pk.games - pk.wins}L)`,
					)
					.join("<br/>");
				return `${escapeHtml(labels[p.dataIndex])} — ${row.total_wins}W ${row.total_games - row.total_wins}L<br/>${lines}`;
			},
		},
		grid: { ...COMMON_GRID, left: LABEL_GUTTER },
		xAxis: { type: "value", minInterval: 1 },
		yAxis: {
			type: "category",
			inverse: true,
			data: keys,
			axisLabel: avatarAxisLabel(keys, labels, avatarImages),
		},
		series: nations.map((nation, ni) => ({
			name: fmtNation(nation),
			type: "bar" as const,
			stack: "picks",
			data: players.map(
				(p) => p.picks.find((pk) => pk.nation === nation)?.games ?? 0,
			),
			itemStyle: { color: getNationChartColor(nation, ni) },
		})),
	};
}
