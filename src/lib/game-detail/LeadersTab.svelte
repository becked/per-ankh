<script lang="ts">
	import type { ChartOption } from "$lib/echarts";
	import type {
		CharacterInfo,
		CharacterTraitInfo,
		PlayerGoalInfo,
	} from "$lib/parser/types";
	import type { GameDetails } from "$lib/types/GameDetails";
	import type { PlayerHistory } from "$lib/types/PlayerHistory";
	import ChartContainer from "$lib/ChartContainer.svelte";
	import SpriteIcon from "./SpriteIcon.svelte";
	import LeaderCard from "./LeaderCard.svelte";
	import { formatEnum } from "$lib/utils/formatting";
	import { CHART_THEME, getNationChartColor } from "$lib/config";
	import { filledLineStyle } from "./helpers";
	import type { DetailPlayer, Reign } from "./helpers";

	let {
		characters,
		characterTraits,
		playerGoals,
		playerHistory,
		players,
		gameDetails,
		legitimacyChartFilter = $bindable<Record<string, boolean>>({}),
	}: {
		characters: CharacterInfo[];
		characterTraits: CharacterTraitInfo[];
		playerGoals: PlayerGoalInfo[];
		playerHistory: PlayerHistory[];
		players: DetailPlayer[];
		gameDetails: GameDetails;
		legitimacyChartFilter?: Record<string, boolean>;
	} = $props();

	const totalTurns = $derived(gameDetails.total_turns || 1);
	const playerById = $derived(new Map(players.map((p) => [p.playerId, p])));
	const histByPlayer = $derived(
		new Map(playerHistory.map((ph) => [ph.player_id, ph])),
	);

	// ─── Indexes ──────────────────────────────────────────────────────
	// Keyed by character xml_id; plain records (not Maps) since they're rebuilt
	// each derivation and mutated in place during the group-by.
	const traitsByChar = $derived.by(() => {
		const groups: Record<number, CharacterTraitInfo[]> = {};
		for (const t of characterTraits) {
			(groups[t.character_xml_id] ??= []).push(t);
		}
		return groups;
	});

	const goalsByLeader = $derived.by(() => {
		const groups: Record<number, PlayerGoalInfo[]> = {};
		for (const g of playerGoals) {
			if (g.leader_character_xml_id == null) continue;
			(groups[g.leader_character_xml_id] ??= []).push(g);
		}
		return groups;
	});

	// Legitimacy at a given turn for a player, from the forward-filled history.
	// Clamps to the available range so reign-edge turns always resolve.
	function legitAt(playerId: number, turn: number): number | null {
		const hist = histByPlayer.get(playerId);
		if (!hist || hist.history.length === 0) return null;
		const h = hist.history;
		const t = Math.max(h[0].turn, Math.min(turn, h[h.length - 1].turn));
		return h.find((p) => p.turn === t)?.legitimacy ?? null;
	}

	type Dynasty = { player: DetailPlayer; reigns: Reign[] };

	// One dynasty per player that has at least one ruler. Reign window:
	// [accession, next accession ?? abdication ?? death ?? game end].
	const dynasties = $derived.by<Dynasty[]>(() => {
		const out: Dynasty[] = [];
		for (const player of players) {
			const rulers = characters
				.filter(
					(c) =>
						c.player_xml_id === player.playerId && c.became_leader_turn != null,
				)
				.sort(
					(a, b) => (a.became_leader_turn ?? 0) - (b.became_leader_turn ?? 0),
				);
			if (rulers.length === 0) continue;

			const reigns: Reign[] = rulers.map((ruler, i) => {
				const start = ruler.became_leader_turn ?? 1;
				const next = rulers[i + 1];
				const end =
					next?.became_leader_turn ??
					ruler.abdicated_turn ??
					ruler.death_turn ??
					totalTurns;
				const legitStart = legitAt(player.playerId, start);
				const legitEnd = legitAt(player.playerId, end);
				return {
					ruler,
					start,
					end,
					years: Math.max(0, end - start),
					legitStart,
					legitEnd,
					netLegitimacy:
						legitStart != null && legitEnd != null
							? legitEnd - legitStart
							: null,
					traits: (traitsByChar[ruler.xml_id] ?? [])
						.slice()
						.sort((a, b) => a.acquired_turn - b.acquired_turn),
					ambitions: goalsByLeader[ruler.xml_id] ?? [],
				};
			});
			out.push({ player, reigns });
		}
		return out;
	});

	// ─── Legitimacy chart (relocated from the Events tab) ─────────────
	const legitimacyChartOption = $derived.by<ChartOption | null>(() => {
		if (!playerHistory) return null;
		// Value x-axis with a small pad so the area fill doesn't clip at the edges.
		const turns = playerHistory[0]?.history.map((h) => h.turn) ?? [];
		const minTurn = turns[0] ?? 0;
		const maxTurn = turns[turns.length - 1] ?? 0;
		const pad = Math.max(1, (maxTurn - minTurn) * 0.02);
		return {
			...CHART_THEME,
			title: {
				...CHART_THEME.title,
				text: "Legitimacy",
			},
			legend: {
				show: false,
				data: playerHistory.map(
					(p) =>
						playerById.get(p.player_id)?.label ??
						formatEnum(p.nation, "NATION_"),
				),
				selected: legitimacyChartFilter,
			},
			grid: { left: 60, right: 40, top: 80, bottom: 60 },
			xAxis: {
				type: "value",
				name: "Turn",
				nameLocation: "middle",
				nameGap: 30,
				min: minTurn - pad,
				max: maxTurn + pad,
				minInterval: 1,
				splitLine: { show: false },
			},
			yAxis: {
				type: "value",
				name: "Legitimacy",
				nameLocation: "middle",
				nameGap: 40,
				axisLine: { onZero: false },
			},
			series: playerHistory.map((player, i) => {
				const rp = playerById.get(player.player_id);
				const color = rp?.color ?? getNationChartColor(player.nation, i);
				return {
					name: rp?.label ?? formatEnum(player.nation, "NATION_"),
					type: "line",
					data: player.history.map((h) => [h.turn, h.legitimacy]),
					itemStyle: { color },
					...filledLineStyle(color),
				};
			}),
		};
	});
</script>

{#if dynasties.length === 0}
	<p class="p-8 text-center italic text-tan">No leader data recorded</p>
{:else}
	<!-- ─── Succession ─────────────────────────────────────────────── -->
	<div
		class="mb-4 rounded-lg p-4"
		style="background-color: rgb(var(--color-surface));"
	>
		<h3 class="mb-3 text-base font-bold text-tan">Succession</h3>
		<div class="flex flex-col gap-6">
			{#each dynasties as dynasty (dynasty.player.playerId)}
				<div>
					<!-- Nation name (colored), tight to the leader cards below it -->
					<div
						class="mb-1.5 flex items-center gap-1.5 text-sm font-bold"
						style="color: {dynasty.player.color};"
					>
						{#if dynasty.player.nation}
							<SpriteIcon
								category="crests"
								value={dynasty.player.nation}
								size={16}
								alt={formatEnum(dynasty.player.nation, "NATION_")}
							/>
						{/if}
						<span class="truncate">{dynasty.player.label}</span>
					</div>

					<!-- Compact leader cards; each opens its full detail in a popover -->
					<div class="flex flex-wrap gap-1.5">
						{#each dynasty.reigns as reign (reign.ruler.xml_id)}
							<LeaderCard {reign} player={dynasty.player} {totalTurns} />
						{/each}
					</div>
				</div>
			{/each}
		</div>
	</div>

	<!-- ─── Legitimacy chart ───────────────────────────────────────── -->
	{#if legitimacyChartOption}
		<div
			class="rounded-lg p-4"
			style="background-color: rgb(var(--color-surface));"
		>
			<ChartContainer
				option={legitimacyChartOption}
				height="400px"
				title="Legitimacy"
			/>
		</div>
	{/if}
{/if}
