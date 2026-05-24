// Chart registry — declarative source of truth for the catalog.
// Adding a chart means: write its option builder under charts/,
// add a ChartSpec entry here, render via StatsView.
//
// Order within a category drives the visual order in the grid.

import type { ChartSpec, StatsCategory } from "../types";

export const CATEGORIES: Array<{ id: StatsCategory; label: string }> = [
	{ id: "yields", label: "Yields" },
	{ id: "nations", label: "Nations" },
	{ id: "families", label: "Families" },
	{ id: "laws", label: "Laws" },
	{ id: "cities", label: "Cities" },
	{ id: "tech", label: "Tech" },
];

export const CHART_SPECS: ChartSpec[] = [
	// Nations
	{
		id: "nation-winloss-stacked",
		category: "nations",
		title: "Win rate",
		hasData: (b) => b.nationWinRate.length > 0,
		// ~34px per nation row so the enlarged crest labels have breathing room.
		height: (b) => `${Math.max(b.nationWinRate.length, 1) * 34 + 90}px`,
	},
	{
		id: "nation-avg-points",
		category: "nations",
		title: "Average final points",
		hasData: (b) => b.nationAvgPoints.length > 0,
		height: (b) => `${Math.max(b.nationAvgPoints.length, 1) * 34 + 90}px`,
	},
	// Families — category anchor only; rendered by FamilyStatsPanel
	// (per-nation pick/win bars), not the generic spec loop.
	{
		id: "families",
		category: "families",
		title: "Families",
		hasData: (b) => b.familyByNation.length > 0,
	},
	// Yields — category anchor only. The Yields tab is rendered by
	// YieldsStatsPanel (one chart per series), not the generic spec loop,
	// so this entry exists solely to surface the subtab.
	{
		id: "yields",
		category: "yields",
		title: "Yields",
		hasData: (b) => b.yieldCurves.turns.length > 0,
	},
	// Laws — category anchor only; rendered by LawsStatsPanel (one nation
	// selector driving both the law-adoption and opening-sequence charts).
	{
		id: "laws",
		category: "laws",
		title: "Laws",
		hasData: (b) => b.lawTiming.length > 0 || b.openingLaws.length > 0,
	},
	// Cities
	{
		id: "city-expansion-winrate",
		category: "cities",
		title: "Win rate by expansion speed",
		hasData: (b) => b.expansionWinRate.length > 0,
	},
	// Tech — category anchor only; rendered by TechStatsPanel (nation selector
	// driving both the first-tech and tech-timing charts), not the spec loop.
	{
		id: "tech",
		category: "tech",
		title: "Tech",
		hasData: (b) => b.techTiming.length > 0 || b.techFirst.length > 0,
	},
];
