// Families tab option builders.

import type { ChartOption } from "$lib/echarts";
import { getChartColor } from "$lib/config";
import { SPRITE_MANIFEST } from "$lib/generated/sprite-manifest";
import type { ChartBundle } from "../types";
import {
	ALL_NATIONS,
	CHART_THEME,
	COMMON_GRID,
	crestAxisLabel,
	fmtClass,
	nationLabel,
} from "./helpers";

// Family classes reuse the ARCHETYPE crest art (FAMILYCLASS_CHAMPIONS →
// crests/CREST_ARCHETYPE_CHAMPIONS).
function classCrestUrl(familyClass: string): string | undefined {
	const name = familyClass.replace(/^FAMILYCLASS_/, "");
	return SPRITE_MANIFEST[`crests/CREST_ARCHETYPE_${name}`];
}

// Nations that have any family-class data, most-played first — drives the
// selector in FamilyStatsPanel.
export function familyNations(bundle: ChartBundle): string[] {
	const games = new Map(bundle.nationWinRate.map((r) => [r.nation, r.games]));
	return Array.from(new Set(bundle.familyByNation.map((r) => r.nation))).sort(
		(a, b) => (games.get(b) ?? 0) - (games.get(a) ?? 0),
	);
}

// For one nation: paired horizontal bars of pick rate and win rate per
// pool class, sorted by pick rate. Answers "which families do I pick for
// this nation" and "do some win more" in one read, with no cross-nation
// availability confound.
export function familyNationPicksOption(
	bundle: ChartBundle,
	nation: string,
): ChartOption {
	const isAll = nation === ALL_NATIONS;
	// "All nations": aggregate counts/wins per class across every nation; pick
	// rate is over total games in the corpus. (Across-pool aggregate — handy as
	// an overview, but not availability-normalized.) Otherwise restrict to the
	// chosen nation and use that nation's game count as the pick-rate base.
	const games = isAll
		? bundle.nationWinRate.reduce((s, r) => s + r.games, 0)
		: (bundle.nationWinRate.find((r) => r.nation === nation)?.games ?? 0);
	const byClass = new Map<string, { count: number; wins: number }>();
	for (const r of bundle.familyByNation) {
		if (!isAll && r.nation !== nation) continue;
		const e = byClass.get(r.class) ?? { count: 0, wins: 0 };
		e.count += r.count;
		e.wins += r.wins;
		byClass.set(r.class, e);
	}
	const rows = [...byClass.entries()]
		.map(([cls, e]) => ({
			class: cls,
			pickRate: games > 0 ? e.count / games : 0,
			winRate: e.count > 0 ? e.wins / e.count : 0,
			count: e.count,
			wins: e.wins,
		}))
		.sort((a, b) => a.pickRate - b.pickRate);
	const classes = rows.map((r) => r.class);
	const pct = (v: number) => `${Math.round(v * 100)}%`;
	return {
		...CHART_THEME,
		title: {
			...CHART_THEME.title,
			text: `${nationLabel(nation)} families`,
		},
		tooltip: {
			trigger: "axis",
			axisPointer: { type: "shadow" },
			formatter: (params: unknown) => {
				const p = (params as { dataIndex: number }[])[0];
				const r = rows[p.dataIndex];
				if (!r) return "";
				return `${fmtClass(r.class)}<br/>Picked: ${pct(r.pickRate)} (${r.count} games)<br/>Win rate: ${pct(r.winRate)}`;
			},
		},
		grid: { ...COMMON_GRID, left: 140, top: 64 },
		xAxis: {
			type: "value",
			min: 0,
			max: 1,
			axisLabel: { formatter: (v: number) => pct(v) },
		},
		yAxis: {
			type: "category",
			data: classes,
			axisLabel: crestAxisLabel(classes, classCrestUrl, fmtClass, 132, 20, 14),
		},
		series: [
			{
				name: "Pick rate",
				type: "bar",
				data: rows.map((r) => r.pickRate),
				itemStyle: { color: getChartColor(0) },
			},
			{
				name: "Win rate",
				type: "bar",
				data: rows.map((r) => r.winRate),
				itemStyle: { color: getChartColor(5) },
			},
		],
	};
}
