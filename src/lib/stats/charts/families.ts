// Families tab option builders.

import type { ChartOption } from "$lib/echarts";
import { SPRITE_MANIFEST } from "$lib/generated/sprite-manifest";
import type { ChartBundleCore } from "../types";
import {
	ALL_NATIONS,
	COMMON_GRID,
	type WinLossRow,
	crestAxisLabel,
	fmtClass,
	nationLabel,
	winLossStackedOption,
} from "./helpers";
import { CHART_THEME } from "$lib/config";
import type { FamilyKeepRow } from "../types";

// Founding-order slots, in order. A player runs three families; which one
// seeded the first city is a different commitment from the third.
const SLOT_LABELS = ["1st family", "2nd", "3rd"] as const;

// Family classes reuse the ARCHETYPE crest art (FAMILYCLASS_CHAMPIONS →
// crests/CREST_ARCHETYPE_CHAMPIONS).
function classCrestUrl(familyClass: string): string | undefined {
	const name = familyClass.replace(/^FAMILYCLASS_/, "");
	return SPRITE_MANIFEST[`crests/CREST_ARCHETYPE_${name}`];
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

// Nations that have any family-class data, most-played first — drives the
// selector in FamilyStatsPanel.
export function familyNations(bundle: ChartBundleCore): string[] {
	const games = new Map(bundle.nationWinRate.map((r) => [r.nation, r.games]));
	return Array.from(new Set(bundle.familyByNation.map((r) => r.nation))).sort(
		(a, b) => (games.get(b) ?? 0) - (games.get(a) ?? 0),
	);
}

// One family class as the shared outcome bar plus the extras only this chart
// shows: `games`/`wins`/`rate` are the picks and how they ended, the rest ride
// along for the tooltip and the trailing label.
interface ClassRow extends WinLossRow {
	pickRate: number;
	avgShare: number | null;
	slots: [number, number, number];
}

// Per-class rows for one nation (or the cross-nation aggregate), plus the game
// count the pick rate is taken over. Shared by the option builder and the
// panel's container height so the two can't disagree on the row count.
function nationPickRows(
	bundle: ChartBundleCore,
	nation: string,
): { games: number; rows: ClassRow[] } {
	const isAll = nation === ALL_NATIONS;
	// "All nations": aggregate counts/wins per class across every nation; pick
	// rate is over total games in the corpus. (Across-pool aggregate — handy as
	// an overview, but not availability-normalized.) Otherwise restrict to the
	// chosen nation and use that nation's game count as the pick-rate base.
	const games = isAll
		? bundle.nationWinRate.reduce((s, r) => s + r.games, 0)
		: (bundle.nationWinRate.find((r) => r.nation === nation)?.games ?? 0);
	// City share is a per-nation mean, so recombining across nations weights
	// each nation by how often the class was picked there — the same weighting
	// the pick/win counts already carry. Slot counts are plain sums.
	const byClass = new Map<
		string,
		{
			count: number;
			wins: number;
			shareSum: number;
			shareCount: number;
			slots: [number, number, number];
		}
	>();
	for (const r of bundle.familyByNation) {
		if (!isAll && r.nation !== nation) continue;
		const e = byClass.get(r.class) ?? {
			count: 0,
			wins: 0,
			shareSum: 0,
			shareCount: 0,
			slots: [0, 0, 0] as [number, number, number],
		};
		e.count += r.count;
		e.wins += r.wins;
		if (r.avg_share != null && r.share_samples > 0) {
			e.shareSum += r.avg_share * r.share_samples;
			e.shareCount += r.share_samples;
		}
		for (let i = 0; i < 3; i++) e.slots[i] += r.slot_counts[i] ?? 0;
		byClass.set(r.class, e);
	}
	const rows = [...byClass.entries()].map(([cls, e]) => ({
		key: cls,
		games: e.count,
		wins: e.wins,
		rate: e.count > 0 ? e.wins / e.count : 0,
		pickRate: games > 0 ? e.count / games : 0,
		avgShare: e.shareCount > 0 ? e.shareSum / e.shareCount : null,
		slots: e.slots,
	}));
	return { games, rows };
}

// Rows the per-nation chart actually draws — the panel sizes the container off
// the same count, so the chart never scrolls past its box.
export function familyClassRowCount(
	bundle: ChartBundleCore,
	nation: string,
): number {
	return nationPickRows(bundle, nation).rows.length;
}

// For one nation: the shared wins/losses stack per family class its players
// picked — bar length is how often the class was picked, the split how those
// games ended — with the share of the empire it ran as a trailing label and the
// pick rate and founding-order split in the tooltip. Restricting to one nation
// holds the family pool constant, so the classes are comparable to each other.
export function familyNationPicksOption(
	bundle: ChartBundleCore,
	nation: string,
): ChartOption {
	const { games, rows } = nationPickRows(bundle, nation);
	return winLossStackedOption({
		rows,
		label: fmtClass,
		iconUrl: classCrestUrl,
		title: `${nationLabel(nation)} families`,
		tooltipFormatter: (r) => {
			const lines = [
				fmtClass(r.key),
				`Picked in ${r.games} of ${games} games (${pct(r.pickRate)})`,
				`Wins: ${r.wins} / ${r.games} (${pct(r.rate)})`,
			];
			if (r.avgShare != null) {
				lines.push(`Avg share of cities: ${pct(r.avgShare)}`);
			}
			// Founding order — which of the player's three families this was,
			// by the turn its first city landed.
			const slotTotal = r.slots.reduce((a, b) => a + b, 0);
			if (slotTotal > 0) {
				lines.push(
					SLOT_LABELS.map(
						(label, i) => `${label} ${pct(r.slots[i] / slotTotal)}`,
					).join(" · "),
				);
			}
			return lines.join("<br/>");
		},
		// How much of the empire this class ran, at the end of its bar. The
		// founding-order split is in the tooltip — three percentages would
		// crowd the axis.
		barLabel: (r) => (r.avgShare == null ? "" : `${pct(r.avgShare)} of cities`),
	});
}

// Which family class ran the capital, as a stacked wins/losses bar: length is
// how often that class held the capital, the split how those games ended. The
// same encoding as the nation win-rate bar, and the same reason — one bar
// answers both "how often" and "how well".
//
// Nation-agnostic on purpose: a family class means the same thing whichever
// nation fields it, and splitting by nation here would shred the sample.
// Typed against ChartBundleCore (only reads capitalFamilyWinRate) so it renders
// unchanged at tournament scope.
export function capitalFamilyWinLossOption(
	bundle: ChartBundleCore,
): ChartOption {
	return winLossStackedOption({
		rows: bundle.capitalFamilyWinRate.map((r) => ({
			key: r.family_class,
			games: r.games,
			wins: r.wins,
			rate: r.rate,
		})),
		label: fmtClass,
		iconUrl: classCrestUrl,
		// Titled in-chart like the per-nation bars beside it, so the two charts
		// in the Families panel are self-describing.
		title: "Capital family",
		labelWidth: 150,
	});
}

// The ECharts rendering of Families fielded.
//
// The numbers sit in a column on the right rather than riding the end of each
// bar: on the bar they start at a different x on every row, so reading "which
// gaps are big" means tracking a ragged edge instead of scanning a column. A
// second category axis pinned right, sharing the series' categories, is how
// ECharts does an aligned column — the rich-text segments give it fixed widths
// and let Δ take its colour per row.
export function familyKeepsOption(rows: FamilyKeepRow[]): ChartOption {
	// Category axes run bottom-up, so ascending puts the most-kept at the top.
	const sorted = [...rows].sort((a, b) => a.kept_pct - b.kept_pct);
	const keys = sorted.map((r) => r.family_class);
	const labelWidth = 150;
	// Colour means the gap cleared the significance gate, and which colour means
	// which way — the same rule the bar follows, so the two can't disagree.
	const KEPT_MORE = "#8cc878";
	const KEPT_LESS = "#c86e5a";
	const NEUTRAL = "#6b6257";

	return {
		...CHART_THEME,
		title: {
			...CHART_THEME.title,
			text: "Families fielded",
			// The columns name themselves, from the right axis — see its `name`.
		},
		tooltip: {
			...CHART_THEME.tooltip,
			axisPointer: { type: "shadow" },
			formatter: (params: unknown) => {
				const p = (params as { dataIndex: number }[])[0];
				const r = sorted[p.dataIndex];
				if (!r) return "";
				return (
					`${fmtClass(r.family_class)}<br/>` +
					`Fielded in ${r.kept} of ${r.eligible} games where it was available<br/>` +
					`Chance alone: ${r.baseline_pct.toFixed(0)}%<br/>` +
					(r.significant
						? "Further from chance than luck explains"
						: "Not distinguishable from chance")
				);
			},
		},
		grid: { ...COMMON_GRID, left: labelWidth, top: 78, right: 162 },
		xAxis: { type: "value", max: 100, axisLabel: { formatter: "{value}%" } },
		yAxis: [
			{
				type: "category",
				data: keys,
				axisLabel: crestAxisLabel(
					keys,
					classCrestUrl,
					fmtClass,
					labelWidth - 8,
					20,
					14,
				),
			},
			{
				// The value column. Same categories, pinned right, chrome off — it
				// is a label track, not an axis anyone reads as one.
				type: "category",
				position: "right",
				data: keys,
				// Column headings, sat at the top of the value column. The axis
				// `name` is the only thing ECharts anchors to the end of an axis,
				// and giving it the same rich-text widths as the labels below is
				// what lines the three headings up over the three columns instead
				// of floating them somewhere near.
				name: "{hk|fielded}{hc|vs chance}{hg|games}",
				nameLocation: "end",
				nameGap: 16,
				nameTextStyle: {
					rich: {
						// Widths match the value columns below exactly, so the
						// headings sit over what they name. A point smaller than the
						// values, because "vs chance" is the widest string here and
						// at 10px it spills out of its cell into "kept".
						hk: { width: 48, align: "right", color: "#7a6a55", fontSize: 9 },
						hc: { width: 52, align: "right", color: "#7a6a55", fontSize: 9 },
						hg: { width: 40, align: "right", color: "#7a6a55", fontSize: 9 },
					},
				},
				axisTick: { show: false },
				axisLine: { show: false },
				axisLabel: {
					formatter: (_value: string, index: number) => {
						const r = sorted[index];
						if (!r) return "";
						const tone = !r.significant ? "dim" : r.delta >= 0 ? "up" : "down";
						const sign = r.delta >= 0 ? "+" : "";
						return `{pct|${r.kept_pct.toFixed(0)}%}{${tone}|${sign}${r.delta.toFixed(0)}}{n|${r.eligible}g}`;
					},
					rich: {
						// Widths are shared with the headings above (nameTextStyle
						// .rich) so the two line up; "vs chance" is the widest string
						// in the block and sets the middle column.
						pct: { width: 48, align: "right", color: "#FFFFFF" },
						up: { width: 52, align: "right", color: KEPT_MORE },
						down: { width: 52, align: "right", color: KEPT_LESS },
						dim: { width: 52, align: "right", color: "#7a6a55" },
						n: { width: 40, align: "right", color: "#7a6a55" },
					},
				},
			},
		],
		series: [
			{
				type: "bar",
				yAxisIndex: 0,
				data: sorted.map((r) => ({
					value: r.kept_pct,
					itemStyle: {
						color: r.significant
							? r.delta >= 0
								? KEPT_MORE
								: KEPT_LESS
							: NEUTRAL,
					},
				})),
				barWidth: 18,
			},
			{
				// The chance notch, one per row at that row's own level.
				//
				// z above the bars, explicitly. Both series default to the same z
				// and fall back to declaration order, which is a thin thing to rest
				// on for the one mark the whole chart is read against — and when a
				// bar runs past its own chance level, the notch sits inside the
				// fill, which is exactly where losing the tie makes it vanish.
				type: "custom",
				z: 10,
				yAxisIndex: 0,
				silent: true,
				data: sorted.map((r, i) => [r.baseline_pct, i]),
				renderItem: (_params, api) => {
					const [x, y] = api.coord([api.value(0), api.value(1)]);
					// Taller than the 18px bar so it reads as a mark laid across it
					// rather than a gap in it.
					const height = (api.size?.([0, 1]) as number[])[1] * 0.85;
					return {
						type: "rect",
						shape: { x: x - 1.5, y: y - height / 2, width: 3, height },
						style: { fill: "#FFFFFF" },
					};
				},
			},
		],
	};
}
