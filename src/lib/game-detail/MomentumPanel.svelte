<script lang="ts">
	// Momentum chart + detail panel, the owglick momentum viewer's interaction
	// rebuilt per-ankh: one line for P(first player), the area between the line
	// and the 50% midline filled in whoever-leads' colour, and the numbers for
	// the hovered turn in a stable panel below the chart — hover explores,
	// click pins. No tooltip, no commentary: the panel is the data.
	import type { ChartOption, ECharts } from "$lib/echarts";
	import type { EventLog } from "$lib/types/EventLog";
	import { CHART_THEME } from "$lib/config";
	import Chart from "$lib/Chart.svelte";
	import { formatEnum, stripMarkup } from "$lib/utils/formatting";
	import type { MomentumCurve } from "./momentum";
	import type { DetailPlayer } from "./helpers";

	let {
		curve,
		a,
		b,
		eventLogs = [],
	}: {
		curve: MomentumCurve;
		/** The two duellists, curve orientation: p = P(`a` wins). */
		a: DetailPlayer;
		b: DetailPlayer;
		eventLogs?: EventLog[];
	} = $props();

	// Hover explores, click pins; the panel always shows *some* turn, so it
	// starts pinned on the last point (the finished position).
	let pinned = $state<number | null>(null);
	let hovered = $state<number | null>(null);
	const shown = $derived(
		hovered ?? pinned ?? Math.max(0, curve.points.length - 1),
	);

	const DIM_LABELS: Record<string, string> = {
		cities: "cities",
		growth: "growth",
		orders: "orders",
		science: "science",
		eco: "eco",
		mil: "military",
	};

	// ─── Chart ────────────────────────────────────────────────────────
	// The owglick look: one line, and the area between it and the 50% midline
	// filled in whoever-leads' colour — above the midline `a`'s fill, below it
	// `b`'s. Two silent clamped series carry the fills (max(p,50) / min(p,50)
	// with the area anchored at 50), so no visualMap is needed.
	const chartOption = $derived<ChartOption>({
		...CHART_THEME,
		title: { ...CHART_THEME.title, text: "Momentum" },
		tooltip: { show: false },
		grid: { left: 44, right: 16, top: 44, bottom: 32 },
		xAxis: {
			type: "category",
			data: curve.points.map((pt) => pt.turn),
			axisPointer: { show: true, snap: true, type: "line" },
		},
		yAxis: {
			type: "value",
			min: 0,
			max: 100,
			axisLabel: { formatter: "{value}%" },
		},
		series: [
			{
				type: "line",
				silent: true,
				showSymbol: false,
				data: curve.points.map((pt) =>
					Math.max(50, Math.round(pt.p * 1000) / 10),
				),
				lineStyle: { opacity: 0 },
				areaStyle: { origin: 50, color: a.color, opacity: 0.22 },
			},
			{
				type: "line",
				silent: true,
				showSymbol: false,
				data: curve.points.map((pt) =>
					Math.min(50, Math.round(pt.p * 1000) / 10),
				),
				lineStyle: { opacity: 0 },
				areaStyle: { origin: 50, color: b.color, opacity: 0.22 },
			},
			{
				type: "line",
				showSymbol: false,
				data: curve.points.map((pt) => Math.round(pt.p * 1000) / 10),
				lineStyle: { width: 2, color: a.color },
				itemStyle: { color: a.color },
				markLine: {
					silent: true,
					symbol: "none",
					label: { show: false },
					lineStyle: { color: "#6b6459", type: "dashed" },
					data: [{ yAxis: 50 }],
				},
			},
		],
	});

	function wireChart(chart: ECharts): void {
		chart.on("updateAxisPointer", (e) => {
			const info = (e as { axesInfo?: { value: number }[] }).axesInfo?.[0];
			if (info != null) hovered = info.value;
		});
		chart.getZr().on("click", () => {
			if (hovered != null) pinned = hovered;
		});
		chart.getZr().on("globalout", () => {
			hovered = null;
		});
	}

	// ─── Panel data for the shown turn ────────────────────────────────
	const pt = $derived(curve.points[shown]);
	const prev = $derived(shown > 0 ? curve.points[shown - 1] : null);
	const aLeads = $derived(pt.p >= 0.5);
	const leader = $derived(aLeads ? a : b);
	const leadPct = $derived(Math.round((aLeads ? pt.p : 1 - pt.p) * 100));

	type BarRow = { dim: string; v: number };

	// Contributions flipped toward the named player, so positive always means
	// "helped them"; split into helping and working-against.
	function bars(
		vals: number[],
		towardA: boolean,
	): {
		pos: BarRow[];
		neg: BarRow[];
		max: number;
	} {
		const sgn = towardA ? 1 : -1;
		const rows = curve.dims
			.map((dim, j) => ({ dim, v: Math.round(vals[j] * sgn * 100) / 100 }))
			.filter((r) => Math.abs(r.v) >= 0.03);
		return {
			pos: rows.filter((r) => r.v > 0).sort((x, y) => y.v - x.v),
			neg: rows.filter((r) => r.v < 0).sort((x, y) => x.v - y.v),
			max: Math.max(...rows.map((r) => Math.abs(r.v)), 0.2),
		};
	}

	const levelBars = $derived(bars(pt.lv, aLeads));
	const delta = $derived(prev ? pt.p - prev.p : 0);
	const gainerIsA = $derived(delta >= 0);
	const gainer = $derived(gainerIsA ? a : b);
	const changeBars = $derived(prev ? bars(pt.ch, gainerIsA) : null);

	// Key stats: each side's own numbers, leader-per-row coloured.
	const STAT_ROWS: { label: string; index: number; dp: number }[] = [
		{ label: "cities", index: 0, dp: 0 },
		{ label: "growth", index: 1, dp: 1 },
		{ label: "orders", index: 2, dp: 1 },
		{ label: "science", index: 3, dp: 1 },
		{ label: "power", index: 4, dp: 0 },
	];
	const fmtStat = (v: number, dp: number): string =>
		dp ? v.toFixed(1) : Math.round(v).toLocaleString("en-US");

	// Battles aren't in the event log — derive them the owglick way, from
	// military-power drops across the window. Both sides bleeding hard is a
	// trade (named for who lost less); one side collapsing alone is an army
	// destroyed.
	const battleEvents = $derived.by(() => {
		if (!prev) return [];
		const da = pt.sa[4] - prev.sa[4];
		const db = pt.sb[4] - prev.sb[4];
		const out: { kind: string; who: string | null; text: string }[] = [];
		const f = (v: number): string => `${v > 0 ? "+" : ""}${Math.round(v)}`;
		if (da < -25 && db < -25) {
			if (Math.abs(da - db) < 15) {
				out.push({
					kind: "battle",
					who: null,
					text: `battle, even trade (${a.label} ${f(da)} · ${b.label} ${f(db)} power)`,
				});
			} else {
				const [winner, wl, ll] =
					da > db ? [a.label, da, db] : [b.label, db, da];
				out.push({
					kind: "battle",
					who: winner,
					text: `won the trade (${f(wl)} vs ${f(ll)} power)`,
				});
			}
		} else if (da < -60 || db < -60) {
			out.push({
				kind: "battle",
				who: da < db ? a.label : b.label,
				text: `army destroyed (${f(Math.min(da, db))} power)`,
			});
		}
		return out;
	});

	// Events logged in the window since the previous scored turn — data, not
	// attribution.
	const KIND: Record<string, string> = {
		CITY_FOUNDED: "city",
		WONDER_ACTIVITY: "wonder",
		LAW_ADOPTED: "law",
		TECH_DISCOVERED: "tech",
		RELIGION_FOUNDED: "religion",
		THEOLOGY_ESTABLISHED: "theology",
		CHARACTER_SUCCESSION: "succession",
		TEAM_DIPLOMACY: "war",
		OCCURRENCE: "event",
	};
	const windowEvents = $derived.by(() => {
		const from = prev ? prev.turn : pt.turn - 1;
		return eventLogs
			.filter(
				(e) => e.turn > from && e.turn <= pt.turn && KIND[e.log_type] != null,
			)
			.slice(0, 4)
			.map((e) => ({
				kind: KIND[e.log_type],
				who: e.player_name as string | null,
				text: stripMarkup(e.description) || formatEnum(e.log_type, ""),
			}));
	});
	const shownEvents = $derived([...battleEvents, ...windowEvents]);

	const playerFor = (name: string | null): DetailPlayer | null =>
		name === a.player_name || name === a.label
			? a
			: name === b.player_name || name === b.label
				? b
				: null;
</script>

{#snippet barRows(rows: BarRow[], max: number, own: string, other: string)}
	{#each rows as r (r.dim)}
		<div class="flex items-center gap-2 py-0.5 text-xs">
			<span class="w-14 text-tan">{DIM_LABELS[r.dim]}</span>
			<span
				class="h-2 flex-1 overflow-hidden rounded-sm"
				style="background-color: rgb(var(--color-surface));"
			>
				<span
					class="block h-full rounded-sm"
					style="width: {Math.round(
						(Math.abs(r.v) / max) * 100,
					)}%; background-color: {r.v > 0 ? own : other};"
				></span>
			</span>
			<span
				class="w-12 text-right font-mono tabular-nums"
				style="color: {r.v > 0 ? own : other};"
				>{r.v > 0 ? "+" : "−"}{Math.abs(r.v).toFixed(2)}</span
			>
		</div>
	{/each}
{/snippet}

<div
	class="rounded-lg p-4"
	style="background-color: rgb(var(--color-surface));"
>
	<Chart option={chartOption} height="280px" onReady={wireChart} />

	<!-- Detail for the hovered / pinned turn -->
	<div
		class="mt-2 rounded-md border border-border-subtle p-3"
		style="background-color: rgb(var(--color-surface-sunken));"
	>
		<div class="mb-2 flex items-baseline gap-3 text-sm">
			<b class="text-white">T{pt.turn}</b>
			<span class="font-bold" style="color: {leader.color};"
				>{leader.label} {leadPct}%</span
			>
			<span class="ml-auto text-[10px] text-tan">
				{hovered != null ? "click to pin" : "hover the chart to explore"}
			</span>
		</div>

		<div class="grid gap-4 md:grid-cols-3">
			<!-- Key stats -->
			<div>
				<div
					class="mb-1 text-[11px] font-bold uppercase tracking-wide text-tan"
				>
					At T{pt.turn}
				</div>
				<table class="w-full text-xs">
					<thead>
						<tr class="text-left">
							<th></th>
							<th class="pb-1 font-semibold" style="color: {a.color};"
								>{a.label}</th
							>
							<th class="pb-1 font-semibold" style="color: {b.color};"
								>{b.label}</th
							>
						</tr>
					</thead>
					<tbody>
						{#each STAT_ROWS as row (row.label)}
							{@const va = pt.sa[row.index]}
							{@const vb = pt.sb[row.index]}
							<tr>
								<td class="py-0.5 pr-2 text-tan">{row.label}</td>
								<td
									class="py-0.5 pr-2 tabular-nums"
									style={va > vb ? `color: ${a.color}; font-weight: 700;` : ""}
									>{fmtStat(va, row.dp)}</td
								>
								<td
									class="py-0.5 tabular-nums"
									style={vb > va ? `color: ${b.color}; font-weight: 700;` : ""}
									>{fmtStat(vb, row.dp)}</td
								>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<!-- Level: what's behind the lead -->
			<div>
				<div
					class="mb-1 text-[11px] font-bold uppercase tracking-wide text-tan"
				>
					Behind <span style="color: {leader.color};">{leader.label}</span>'s
					{leadPct}%
				</div>
				{@render barRows(
					levelBars.pos,
					levelBars.max,
					leader.color,
					aLeads ? b.color : a.color,
				)}
				{#if levelBars.neg.length > 0}
					<div class="mt-1 text-[10px] italic text-tan">
						against {leader.label}
					</div>
					{@render barRows(
						levelBars.neg,
						levelBars.max,
						leader.color,
						aLeads ? b.color : a.color,
					)}
				{/if}
			</div>

			<!-- Change + events -->
			<div>
				{#if changeBars && prev}
					<div
						class="mb-1 text-[11px] font-bold uppercase tracking-wide text-tan"
					>
						T{prev.turn} → T{pt.turn}:
						<span style="color: {gainer.color};">{gainer.label}</span>
						+{Math.round(Math.abs(delta) * 100)} pts
					</div>
					{#if changeBars.pos.length === 0 && changeBars.neg.length === 0}
						<div class="text-xs italic text-tan">no dimension moved much</div>
					{:else}
						{@render barRows(
							changeBars.pos,
							changeBars.max,
							gainer.color,
							gainerIsA ? b.color : a.color,
						)}
						{@render barRows(
							changeBars.neg,
							changeBars.max,
							gainer.color,
							gainerIsA ? b.color : a.color,
						)}
					{/if}
				{/if}
				{#if shownEvents.length > 0}
					<div
						class="mb-1 mt-2 text-[11px] font-bold uppercase tracking-wide text-tan"
					>
						Logged this window
					</div>
					{#each shownEvents as ev, i (i)}
						<div class="py-0.5 text-xs text-bright">
							<span
								class="mr-1 rounded-sm px-1 text-[9px] uppercase text-tan"
								style="background-color: rgb(var(--color-surface));"
								>{ev.kind}</span
							>{#if ev.who}<b
									style="color: {playerFor(ev.who)?.color ?? 'inherit'};"
									>{ev.who}</b
								>{/if}
							{ev.text.slice(0, 90)}
						</div>
					{/each}
				{/if}
			</div>
		</div>
	</div>
</div>
