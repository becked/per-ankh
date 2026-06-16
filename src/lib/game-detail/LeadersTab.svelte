<script lang="ts">
	import type { EChartsOption } from "echarts";
	import type {
		CharacterInfo,
		CharacterTraitInfo,
		PlayerGoalInfo,
	} from "$lib/parser/types";
	import type { GameDetails } from "$lib/types/GameDetails";
	import type { PlayerHistory } from "$lib/types/PlayerHistory";
	import ChartContainer from "$lib/ChartContainer.svelte";
	import SpriteIcon from "./SpriteIcon.svelte";
	import { formatEnum } from "$lib/utils/formatting";
	import { CHART_THEME } from "$lib/config";
	import type { DetailPlayer } from "./helpers";

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

	type Reign = {
		ruler: CharacterInfo;
		start: number;
		end: number;
		years: number;
		legitStart: number | null;
		legitEnd: number | null;
		netLegitimacy: number | null;
		traits: CharacterTraitInfo[];
		ambitions: PlayerGoalInfo[];
	};
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

	let selectedRulerId = $state<number | null>(null);

	// Falls back to the most recent ruler of the first dynasty so the detail
	// panel always shows something without needing an effect to seed state.
	const selectedReign = $derived.by<Reign | null>(() => {
		const all = dynasties.flatMap((d) => d.reigns);
		if (all.length === 0) return null;
		if (selectedRulerId != null) {
			const found = all.find((r) => r.ruler.xml_id === selectedRulerId);
			if (found) return found;
		}
		const first = dynasties[0];
		return first.reigns[first.reigns.length - 1];
	});

	const selectedPlayer = $derived(
		selectedReign
			? (playerById.get(selectedReign.ruler.player_xml_id ?? -1) ?? null)
			: null,
	);

	// ─── Display helpers ──────────────────────────────────────────────
	const rulerName = (c: CharacterInfo): string =>
		formatEnum(c.first_name, "NAME_") || "Unknown";

	const cognomen = (c: CharacterInfo): string | null =>
		c.cognomen ? formatEnum(c.cognomen, "COGNOMEN_") : null;

	const archetypeLabel = (c: CharacterInfo): string | null =>
		c.archetype
			? formatEnum(c.archetype.replace(/_ARCHETYPE$/, ""), "TRAIT_")
			: null;

	// Archetype icon key for the `traits` sprite category: the save's
	// TRAIT_<X>_ARCHETYPE trait maps to the icon file TRAIT_<X> (suffix dropped).
	const archetypeIcon = (c: CharacterInfo): string | null =>
		c.archetype ? c.archetype.replace(/_ARCHETYPE$/, "") : null;

	const deathLabel = (reason: string | null): string | null =>
		reason
			? formatEnum(
					reason.replace(/^TEXT_(TRAIT_)?/, "").replace(/_(F|M)$/, ""),
					"",
				)
			: null;

	const traitLabel = (t: CharacterTraitInfo): string =>
		formatEnum(t.trait_name, "TRAIT_");

	const goalLabel = (g: PlayerGoalInfo): string =>
		formatEnum(g.goal_type, "GOAL_");

	const pct = (turns: number): number => (turns / totalTurns) * 100;

	const signed = (n: number): string => (n > 0 ? `+${n}` : `${n}`);

	const ratingBlocks = $derived(
		selectedReign
			? [
					{
						label: "Wisdom",
						value: selectedReign.ruler.wisdom,
						icon: "RATING_WISDOM",
					},
					{
						label: "Charisma",
						value: selectedReign.ruler.charisma,
						icon: "RATING_CHARISMA",
					},
					{
						label: "Courage",
						value: selectedReign.ruler.courage,
						icon: "RATING_COURAGE",
					},
					{
						label: "Discipline",
						value: selectedReign.ruler.discipline,
						icon: "RATING_DISCIPLINE",
					},
				]
			: [],
	);

	// Traits excluding the archetype marker (shown separately as the archetype).
	const selectedTraits = $derived(
		selectedReign
			? selectedReign.traits.filter((t) => !t.trait_name.endsWith("_ARCHETYPE"))
			: [],
	);

	// ─── Legitimacy chart (relocated from the Events tab) ─────────────
	const legitimacyChartOption = $derived<EChartsOption | null>(
		playerHistory
			? {
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
						type: "category",
						name: "Turn",
						nameLocation: "middle",
						nameGap: 30,
						data: playerHistory[0]?.history.map((h) => h.turn) ?? [],
					},
					yAxis: {
						type: "value",
						name: "Legitimacy",
						nameLocation: "middle",
						nameGap: 40,
					},
					series: playerHistory.map((player) => {
						const rp = playerById.get(player.player_id);
						return {
							name: rp?.label ?? formatEnum(player.nation, "NATION_"),
							type: "line",
							data: player.history.map((h) => h.legitimacy),
							itemStyle: { color: rp?.color },
						};
					}),
				}
			: null,
	);
</script>

{#if dynasties.length === 0}
	<p class="p-8 text-center italic text-tan">No leader data recorded</p>
{:else}
	<!-- ─── Succession ribbons ─────────────────────────────────────── -->
	<div
		class="mb-4 rounded-lg p-4"
		style="background-color: rgb(var(--color-surface));"
	>
		<h3 class="mb-3 text-base font-bold text-tan">Succession</h3>
		<div class="flex flex-col gap-4">
			{#each dynasties as dynasty (dynasty.player.playerId)}
				<div>
					<!-- Nation name (colored), tight to the ribbon below it -->
					<div
						class="mb-1 flex items-center gap-1.5 text-sm font-bold"
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

					<!-- Thin proportional reign bar (color only; names live below) -->
					<div class="relative h-3 w-full">
						{#each dynasty.reigns as reign (reign.ruler.xml_id)}
							{@const isSel =
								selectedReign?.ruler.xml_id === reign.ruler.xml_id}
							<button
								type="button"
								aria-label={rulerName(reign.ruler)}
								class="absolute top-0 h-full overflow-hidden rounded-sm transition-all hover:opacity-90 {isSel
									? 'z-10'
									: ''}"
								style="left: {pct(reign.start - 1)}%; width: {pct(
									reign.years,
								)}%; min-width: 4px; background-color: {dynasty.player
									.color};{isSel
									? ' filter: brightness(1.35) saturate(1.25);'
									: ''}"
								title="{rulerName(reign.ruler)}{cognomen(reign.ruler)
									? ' ' + cognomen(reign.ruler)
									: ''} · turns {reign.start}–{reign.end}{reign.netLegitimacy !=
								null
									? ' · legitimacy ' + signed(reign.netLegitimacy)
									: ''}"
								onclick={() => (selectedRulerId = reign.ruler.xml_id)}
							></button>
						{/each}
					</div>

					<!-- Leader chips: full names + archetype icon, no cutoff.
					     Left-packed; selected chip lightens to the active-tab color. -->
					<div class="mt-1.5 flex flex-wrap gap-2.5">
						{#each dynasty.reigns as reign (reign.ruler.xml_id)}
							{@const isSel =
								selectedReign?.ruler.xml_id === reign.ruler.xml_id}
							<button
								type="button"
								class="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-tan transition-colors {isSel
									? 'bg-surface-raised'
									: 'bg-surface-sunken hover:bg-surface-sunken-hover'}"
								onclick={() => (selectedRulerId = reign.ruler.xml_id)}
							>
								{#if archetypeIcon(reign.ruler)}
									<SpriteIcon
										category="traits"
										value={archetypeIcon(reign.ruler) ?? ""}
										size={14}
										alt={archetypeLabel(reign.ruler) ?? ""}
									/>
								{/if}
								<span class="font-semibold">{rulerName(reign.ruler)}</span>
								{#if cognomen(reign.ruler)}
									<span class="text-gray-400">the {cognomen(reign.ruler)}</span>
								{/if}
							</button>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	</div>

	<!-- ─── Selected ruler detail ──────────────────────────────────── -->
	{#if selectedReign}
		<div
			class="mb-4 rounded-lg p-4"
			style="background-color: rgb(var(--color-surface));"
		>
			<div class="mb-4 flex flex-wrap items-center gap-3">
				{#if selectedPlayer?.nation}
					<SpriteIcon
						category="crests"
						value={selectedPlayer.nation}
						size={28}
						alt={formatEnum(selectedPlayer.nation, "NATION_")}
					/>
				{/if}
				<div>
					<div class="flex items-center gap-1.5 text-base font-bold text-tan">
						{#if archetypeIcon(selectedReign.ruler)}
							<SpriteIcon
								category="traits"
								value={archetypeIcon(selectedReign.ruler) ?? ""}
								size={18}
								alt={archetypeLabel(selectedReign.ruler) ?? ""}
							/>
						{/if}
						<span>
							{rulerName(selectedReign.ruler)}
							{#if cognomen(selectedReign.ruler)}
								<span class="font-normal text-gray-400"
									>the {cognomen(selectedReign.ruler)}</span
								>
							{/if}
						</span>
					</div>
					<div class="text-xs text-gray-400">
						{#if archetypeLabel(selectedReign.ruler)}
							{archetypeLabel(selectedReign.ruler)} ·
						{/if}
						Reign {selectedReign.start}–{selectedReign.end} ({selectedReign.years}
						{selectedReign.years === 1 ? "year" : "years"})
						{#if deathLabel(selectedReign.ruler.death_reason)}
							· Died: {deathLabel(selectedReign.ruler.death_reason)}
						{/if}
					</div>
				</div>
			</div>

			<!-- Headline stats -->
			<div class="mb-4 flex flex-wrap gap-1.5">
				<div
					class="flex items-center gap-1.5 rounded px-2 py-1"
					style="background-color: rgb(var(--color-surface-raised));"
				>
					<span class="text-xs font-bold text-gray-400">Legitimacy</span>
					<span class="text-sm font-bold text-tan">
						{selectedReign.netLegitimacy != null
							? signed(selectedReign.netLegitimacy)
							: "—"}
					</span>
				</div>
				{#each ratingBlocks as block (block.label)}
					<div
						class="flex items-center gap-1 rounded px-2 py-1"
						style="background-color: rgb(var(--color-surface-raised));"
						title={block.label}
					>
						<span class="text-sm font-bold text-tan">{block.value ?? "—"}</span>
						<SpriteIcon
							category="icons"
							value={block.icon}
							size={16}
							alt={block.label}
						/>
					</div>
				{/each}
			</div>

			<!-- Traits -->
			<div class="mb-4">
				<div class="mb-1 text-xs font-bold text-gray-400">Traits</div>
				{#if selectedTraits.length > 0}
					<div class="flex flex-wrap gap-1.5">
						{#each selectedTraits as trait (trait.trait_name + trait.acquired_turn)}
							<span
								class="rounded px-2 py-0.5 text-xs text-tan"
								style="background-color: rgb(var(--color-surface-raised));"
								title="Acquired turn {trait.acquired_turn}"
							>
								{traitLabel(trait)}
							</span>
						{/each}
					</div>
				{:else}
					<p class="text-xs italic text-gray-400">None recorded</p>
				{/if}
			</div>

			<!-- Ambitions -->
			<div>
				<div class="mb-1 text-xs font-bold text-gray-400">Ambitions</div>
				{#if selectedReign.ambitions.length > 0}
					<ul class="flex flex-col gap-1">
						{#each selectedReign.ambitions as ambition (ambition.goal_xml_id)}
							{@const done = ambition.completed_turn != null}
							<li class="flex items-center gap-2 text-sm text-tan">
								<span class={done ? "" : "opacity-40"}>
									<SpriteIcon
										category="icons"
										value="TURN_SUMMARY_AMBITION"
										size={16}
										alt="Ambition"
									/>
								</span>
								<span>{goalLabel(ambition)}</span>
								<span class="text-xs text-gray-400">
									{done ? "completed" : "in progress"}
								</span>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="text-xs italic text-gray-400">None pursued</p>
				{/if}
			</div>
		</div>
	{/if}

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
