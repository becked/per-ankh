// Yields charts — one chart per series, stacked (mirrors the game-detail
// YieldsTab). Each chart shows the corpus median line with an optional
// P25–P75 band and an optional sample-size overlay, in either per-turn-rate
// or cumulative mode, pooled or split into winners vs losers. The bundle
// ships every band for all 16 series so the page-level toggles are instant.
//
// Typed against ChartBundleCore (only reads yieldCurves) so it renders
// unchanged at tournament scope, where the bundle has no Overview — same
// reason nationWinLossStackedOption is.

import type { ChartOption, LineSeriesOption } from "$lib/echarts";
import { getChartColor } from "$lib/config";
import {
	GDP_COLOR,
	MILITARY_POWER_COLOR,
	YIELD_COLORS,
} from "$lib/generated/yield-colors";
import type { ChartBundleCore, YieldBand } from "../types";
import {
	AXIS_NAME_Y,
	CHART_THEME,
	COMMON_GRID,
	LOSS_COLOR,
	WIN_COLOR,
} from "./helpers";

// User-facing labels for the toggle. Order matters — the leading items
// are the most-used yields.
//
// `key` is the bundle's series key (a game_player_turn column name), which is
// a different vocabulary from the game's YIELD_* tokens — this table is where
// the two meet. Military Power is the one series with no YIELD_* token at all:
// it is a derived stat, not a yield, so it borrows the combat rating's colour
// (see src/lib/generated/yield-colors.ts).
export const YIELD_SERIES = [
	{
		key: "science_per_turn",
		label: "Science",
		color: YIELD_COLORS.YIELD_SCIENCE,
	},
	// Not a yield — per-ankh's own series over money income plus commodity
	// income at that turn's market price, the one number that puts the rest of
	// this list on a common scale. Sits with the economic block rather than at
	// the head of it: it is an aggregate of these, not a replacement for them.
	{ key: "gdp_per_turn", label: "GDP", color: GDP_COLOR },
	{ key: "money_per_turn", label: "Money", color: YIELD_COLORS.YIELD_MONEY },
	{
		key: "training_per_turn",
		label: "Training",
		color: YIELD_COLORS.YIELD_TRAINING,
	},
	{ key: "civics_per_turn", label: "Civics", color: YIELD_COLORS.YIELD_CIVICS },
	{
		key: "culture_per_turn",
		label: "Culture",
		color: YIELD_COLORS.YIELD_CULTURE,
	},
	{ key: "orders_per_turn", label: "Orders", color: YIELD_COLORS.YIELD_ORDERS },
	{ key: "food_per_turn", label: "Food", color: YIELD_COLORS.YIELD_FOOD },
	{ key: "growth_per_turn", label: "Growth", color: YIELD_COLORS.YIELD_GROWTH },
	{
		key: "happiness_per_turn",
		label: "Happiness",
		color: YIELD_COLORS.YIELD_HAPPINESS,
	},
	{
		key: "discontent_per_turn",
		label: "Discontent",
		color: YIELD_COLORS.YIELD_DISCONTENT,
	},
	{ key: "iron_per_turn", label: "Iron", color: YIELD_COLORS.YIELD_IRON },
	{ key: "stone_per_turn", label: "Stone", color: YIELD_COLORS.YIELD_STONE },
	{ key: "wood_per_turn", label: "Wood", color: YIELD_COLORS.YIELD_WOOD },
	{
		key: "maintenance_per_turn",
		label: "Maintenance",
		color: YIELD_COLORS.YIELD_MAINTENANCE,
	},
	{
		key: "military_power",
		label: "Military Power",
		color: MILITARY_POWER_COLOR,
	},
	{
		key: "legitimacy",
		label: "Legitimacy",
		color: YIELD_COLORS.YIELD_LEGITIMACY,
	},
] as const;

// Resolved by the same key the band is resolved by, so the builder stays
// callable with a bare series key rather than needing the whole entry.
const COLOR_BY_KEY = new Map<string, string>(
	YIELD_SERIES.map((s) => [s.key, s.color]),
);

const EMPTY_BAND: YieldBand = { p25: [], p50: [], p75: [] };

// Bands are drawn per cohort, so two overlapping interquartile ranges in
// split mode would double up to near-opaque. Split mode uses the lighter
// alpha; pooled mode keeps the original.
const BAND_ALPHA_POOLED = 0.18;
const BAND_ALPHA_SPLIT = 0.12;

export interface YieldChartOpts {
	mode: "rate" | "cumulative";
	showBand: boolean;
	showCount: boolean;
	// Split the curves into winners vs losers. Ignored when the corpus has
	// no decided games (yieldCurves.outcome === null).
	split: boolean;
	// What one unsplit sample is. At user scope each focal row is one game
	// ("Games"); at tournament scope focal widens to every human, so a row
	// is one player-game ("Players"). Split cohorts are always games — one
	// winner and one loser row per decided game — so this only applies when
	// split is off.
	countLabel?: string;
}

// One cohort's contribution to the chart: its band, median line, and the
// label/color they share.
interface CohortLayer {
	name: string;
	color: string;
	band: YieldBand;
	counts: number[];
}

export function yieldChartOption(
	bundle: ChartBundleCore,
	yieldKey: string,
	label: string,
	opts: YieldChartOpts,
): ChartOption {
	const { turns, counts, series: pooled, outcome } = bundle.yieldCurves;
	const split = opts.split && outcome != null;
	const bandAlpha = split ? BAND_ALPHA_SPLIT : BAND_ALPHA_POOLED;

	const bandOf = (
		src: Record<string, { rate: YieldBand; cumulative: YieldBand }>,
	) => src[yieldKey]?.[opts.mode] ?? EMPTY_BAND;

	const layers: CohortLayer[] =
		split && outcome
			? [
					{
						name: "Winners",
						color: WIN_COLOR,
						band: bandOf(outcome.winners.series),
						counts: outcome.winners.counts,
					},
					{
						name: "Losers",
						color: LOSS_COLOR,
						band: bandOf(outcome.losers.series),
						counts: outcome.losers.counts,
					},
				]
			: [
					{
						name: "Median",
						// The game's own colour for this yield. Split mode above
						// keeps WIN_COLOR / LOSS_COLOR: there, colour means cohort,
						// and it means the same thing on every chart that splits by
						// outcome. Colour only names the yield when there is no
						// cohort to name.
						color: COLOR_BY_KEY.get(yieldKey) ?? getChartColor(0),
						band: bandOf(pooled),
						counts,
					},
				];

	const series: LineSeriesOption[] = [];

	for (const layer of layers) {
		if (opts.showBand) {
			// Confidence band: a transparent P25 baseline plus a stacked,
			// filled (P75 − P25) area renders the shaded interquartile range.
			// The stack id is per cohort — a shared one would pile the second
			// cohort's band on top of the first instead of beside it.
			const stack = `band-${layer.name}`;
			series.push({
				name: `${layer.name} p25`,
				type: "line",
				data: layer.band.p25,
				stack,
				smooth: true,
				showSymbol: false,
				silent: true,
				lineStyle: { opacity: 0 },
				z: 1,
			});
			series.push({
				name: `${layer.name} iqr`,
				type: "line",
				data: layer.band.p25.map((lo, i) => {
					const hi = layer.band.p75[i];
					return lo != null && hi != null ? hi - lo : null;
				}),
				stack,
				// ECharts' default `samesign` only stacks a value onto a
				// baseline of the same sign, so a negative P25 (Happiness, most
				// visibly) drops the band to the zero line instead of sitting on
				// P25 — the fill detaches from the median. The height is always
				// >= 0, so `all` is unconditionally what we want here.
				stackStrategy: "all",
				smooth: true,
				showSymbol: false,
				silent: true,
				lineStyle: { opacity: 0 },
				areaStyle: { color: layer.color, opacity: bandAlpha },
				z: 1,
			});
		}

		// Median line, always drawn on top of the band.
		series.push({
			name: layer.name,
			type: "line",
			data: layer.band.p50,
			smooth: true,
			showSymbol: false,
			itemStyle: { color: layer.color },
			z: 2,
		});
	}

	// Sample-size overlay on a faint secondary axis. Split cohorts get one
	// line each — except where they coincide exactly (both sides of every
	// decided game share a turn range, so at tournament scope they usually
	// do), which would render as one line drawn twice.
	const countLayers =
		layers.length > 1 && sameCounts(layers[0].counts, layers[1].counts)
			? [{ name: "Games", color: getChartColor(5), counts: layers[0].counts }]
			: layers.map((l) => ({
					name:
						layers.length > 1 ? `${l.name} n` : (opts.countLabel ?? "Games"),
					color: layers.length > 1 ? l.color : getChartColor(5),
					counts: l.counts,
				}));
	const countAxisName = countLayers.length > 1 ? "Games" : countLayers[0].name;

	if (opts.showCount) {
		for (const c of countLayers) {
			series.push({
				name: c.name,
				type: "line",
				yAxisIndex: 1,
				data: c.counts,
				smooth: true,
				showSymbol: false,
				lineStyle: { color: c.color, opacity: 0.5 },
				// Two stacked translucent fills read as mud; only the single
				// overlay keeps its area.
				...(countLayers.length === 1
					? { areaStyle: { color: c.color, opacity: 0.1 } }
					: {}),
				z: 0,
			});
		}
	}

	const fmt = (v: number | null | undefined) =>
		v == null ? "—" : Math.round(v).toString();

	return {
		...CHART_THEME,
		title: { ...CHART_THEME.title, text: label },
		// No legend even when split: CHART_THEME's `show: false` carries, and
		// the win/loss colors plus the tooltip's per-cohort rows already name
		// the two curves.
		tooltip: {
			trigger: "axis",
			formatter: (params: unknown) => {
				const i = (params as Array<{ dataIndex: number }>)[0]?.dataIndex ?? 0;
				const rows = layers
					.filter((l) => l.band.p50[i] != null)
					.map(
						(l) =>
							`${l.name}: ${fmt(l.band.p50[i])} (P25–P75: ${fmt(l.band.p25[i])}–${fmt(l.band.p75[i])}, n: ${l.counts[i] ?? 0})`,
					);
				if (rows.length === 0) return "";
				return `Turn ${turns[i]}<br/>${rows.join("<br/>")}`;
			},
		},
		grid: { ...COMMON_GRID, top: 64 },
		// Axis names omitted: the yield is in the title and the x-axis is
		// turns. The count overlay keeps its name (a distinct axis).
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
						name: countAxisName,
						position: "right",
						splitLine: { show: false },
						...AXIS_NAME_Y,
					},
				]
			: { type: "value" },
		series,
	};
}

function sameCounts(a: number[], b: number[]): boolean {
	return a.length === b.length && a.every((v, i) => v === b[i]);
}
