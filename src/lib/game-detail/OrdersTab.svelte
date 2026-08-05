<script lang="ts">
	// Orders tab — the action economy. Two charts (orders/turn and
	// legitimacy, every player, nation colours) over per-player itemizations
	// of where both come from at end of game, anchored on the game's own
	// calculation (see orders.ts). Works for any player count — cards render
	// per player, duel or FFA.
	import type { ChartOption } from "$lib/echarts";
	import { CHART_THEME, getNationChartColor } from "$lib/config";
	import Chart from "$lib/Chart.svelte";
	import type { GameDetails } from "$lib/types/GameDetails";
	import type { PlayerHistory } from "$lib/types/PlayerHistory";
	import type { YieldHistory } from "$lib/types/YieldHistory";
	import type { PlayerLaw } from "$lib/types/PlayerLaw";
	import type {
		CharacterInfo,
		CharacterTraitInfo,
		PlayerGoalInfo,
	} from "$lib/parser/types";
	import {
		dynastyLeaders,
		legitimacyEndBreakdown,
		ordersEndBreakdown,
		type EndBreakdown,
	} from "./orders";
	import type { DetailPlayer } from "./helpers";

	let {
		players,
		gameDetails,
		allYields,
		playerHistory,
		characters = [],
		characterTraits = [],
		currentLaws,
		playerGoals = [],
	}: {
		players: DetailPlayer[];
		gameDetails: GameDetails;
		allYields: YieldHistory[];
		playerHistory: PlayerHistory[];
		characters?: CharacterInfo[];
		characterTraits?: CharacterTraitInfo[];
		currentLaws: PlayerLaw[];
		playerGoals?: PlayerGoalInfo[];
	} = $props();

	const colorOf = (p: DetailPlayer, i: number) =>
		getNationChartColor(p.nation, i);

	// ─── Charts ───────────────────────────────────────────────────────

	const ordersSeries = $derived(
		players.map((p, i) => {
			const rows =
				allYields.find(
					(y) => y.player_id === p.player_id && y.yield_type === "YIELD_ORDERS",
				)?.data ?? [];
			return {
				player: p,
				color: colorOf(p, i),
				data: rows
					.filter((d) => d.rate != null)
					.map((d) => [d.turn, d.rate] as [number, number]),
			};
		}),
	);

	const legitimacySeries = $derived(
		players.map((p, i) => {
			const rows =
				playerHistory.find((h) => h.player_id === p.player_id)?.history ?? [];
			return {
				player: p,
				color: colorOf(p, i),
				data: rows
					.filter((d) => d.legitimacy != null)
					.map((d) => [d.turn, d.legitimacy] as [number, number]),
			};
		}),
	);

	function lineChart(
		title: string,
		yAxisLabel: string,
		series: { player: DetailPlayer; color: string; data: [number, number][] }[],
	): ChartOption {
		return {
			...CHART_THEME,
			title: { ...CHART_THEME.title, text: title },
			tooltip: { trigger: "axis" },
			legend: {
				top: 8,
				right: 16,
				left: undefined,
				textStyle: { color: "#c4b998" },
				data: series.map((s) => s.player.label),
			},
			grid: { left: 48, right: 16, top: 56, bottom: 32 },
			xAxis: { type: "value", min: 1, name: "Turn" },
			yAxis: { type: "value", name: yAxisLabel },
			series: series.map((s) => ({
				type: "line" as const,
				name: s.player.label,
				showSymbol: false,
				lineStyle: { width: 2, color: s.color },
				itemStyle: { color: s.color },
				data: s.data,
			})),
		};
	}

	const ordersChart = $derived(
		lineChart("Orders per turn", "Orders", ordersSeries),
	);
	const legitimacyChart = $derived(
		lineChart("Legitimacy", "Legitimacy", legitimacySeries),
	);

	// ─── Per-player breakdowns ────────────────────────────────────────

	const breakdowns = $derived(
		players.map((p, i) => {
			const info = gameDetails.players.find(
				(gp) => gp.player_id === p.player_id,
			);
			const history =
				playerHistory.find((h) => h.player_id === p.player_id)?.history ?? [];
			const lastLegit = [...history]
				.reverse()
				.find((d) => d.legitimacy != null)?.legitimacy;
			const finalLegitimacy = info?.legitimacy ?? lastLegit ?? null;
			const ordersRows =
				allYields.find(
					(y) => y.player_id === p.player_id && y.yield_type === "YIELD_ORDERS",
				)?.data ?? [];
			const finalOrdersRate =
				[...ordersRows].reverse().find((d) => d.rate != null)?.rate ?? null;
			const leaders = dynastyLeaders(characters, p.player_id ?? -1);
			const rulerId = info?.leader_character_xml_id;
			const ruler =
				(rulerId != null
					? characters.find((c) => c.xml_id === rulerId)
					: null) ??
				leaders[leaders.length - 1] ??
				null;

			const orders: EndBreakdown | null =
				finalOrdersRate != null
					? ordersEndBreakdown({
							finalOrdersRate,
							finalLegitimacy,
							difficulty: info?.difficulty ?? null,
							laws: currentLaws.filter((l) => l.player_id === p.player_id),
							ruler,
							characterTraits,
						})
					: null;
			const legitimacy: EndBreakdown | null =
				finalLegitimacy != null
					? legitimacyEndBreakdown({
							finalLegitimacy,
							leaders,
							goals: playerGoals.filter((g) => g.player_xml_id === p.player_id),
						})
					: null;
			return { player: p, color: colorOf(p, i), orders, legitimacy };
		}),
	);

	const fmt = (v: number, dp: number): string =>
		(v < 0 ? "−" : "") + Math.abs(v).toFixed(dp);
</script>

{#snippet breakdownTable(b: EndBreakdown, dp: number, otherNote: string)}
	<table class="w-full text-xs">
		<tbody>
			{#each b.rows as row (row.label)}
				<tr>
					<td class="py-0.5 pr-2 text-tan">
						{row.label}
						{#if row.detail}
							<div class="text-[10px] text-tan opacity-60">{row.detail}</div>
						{/if}
					</td>
					<td
						class="py-0.5 text-right align-top font-mono tabular-nums text-gray-200"
						>+{fmt(row.value, dp)}</td
					>
				</tr>
			{/each}
			<tr>
				<td class="py-0.5 pr-2 text-tan" title={otherNote}>
					Other <span class="text-[10px] opacity-60">(?)</span>
				</td>
				<td
					class="py-0.5 text-right font-mono tabular-nums {b.other < 0
						? 'text-red-400'
						: 'text-gray-200'}">{b.other >= 0 ? "+" : ""}{fmt(b.other, dp)}</td
				>
			</tr>
			<tr class="border-t border-border-subtle font-bold">
				<td class="py-1 pr-2 text-gray-200">Total</td>
				<td class="py-1 text-right font-mono tabular-nums text-white"
					>{fmt(b.total, dp)}</td
				>
			</tr>
		</tbody>
	</table>
{/snippet}

<div class="space-y-4">
	<div
		class="rounded-lg p-4"
		style="background-color: rgb(var(--color-surface));"
	>
		<Chart option={ordersChart} height="300px" />
	</div>

	<div
		class="rounded-lg p-4"
		style="background-color: rgb(var(--color-surface));"
	>
		<Chart option={legitimacyChart} height="300px" />
	</div>

	<!-- End-of-game itemization, one card per player: where the orders come
	     from, and where the legitimacy powering them came from. -->
	<div class="grid gap-4 md:grid-cols-2">
		{#each breakdowns as b (b.player.label)}
			<div
				class="rounded-lg p-4"
				style="background-color: rgb(var(--color-surface));"
			>
				<h3 class="mb-3 text-sm font-bold" style="color: {b.color};">
					{b.player.label}
				</h3>
				<div class="grid gap-4 sm:grid-cols-2">
					<div>
						<div class="mb-1 text-[10px] uppercase tracking-wide text-tan">
							Orders per turn, at end
						</div>
						{#if b.orders}
							{@render breakdownTable(
								b.orders,
								1,
								"Everything the save can't itemize: council and court ratings, wonders and city yields, agents, trade and tribute, events, and the orders tied up in fortifying or tile-improving units (which can pull this negative).",
							)}
						{:else}
							<div class="text-xs text-tan opacity-70">no orders data</div>
						{/if}
					</div>
					<div>
						<div class="mb-1 text-[10px] uppercase tracking-wide text-tan">
							Legitimacy, at end
						</div>
						{#if b.legitimacy}
							{@render breakdownTable(
								b.legitimacy,
								0,
								"Event and bonus rewards, legacy-ambition differences, and anything else the save doesn't itemize.",
							)}
						{:else}
							<div class="text-xs text-tan opacity-70">no legitimacy data</div>
						{/if}
					</div>
				</div>
			</div>
		{/each}
	</div>
</div>
