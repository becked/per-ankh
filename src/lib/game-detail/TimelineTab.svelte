<script lang="ts">
	import type { GameDetails } from "$lib/types/GameDetails";
	import type { TechDiscoveryHistory } from "$lib/types/TechDiscoveryHistory";
	import type { LawAdoptionHistory } from "$lib/types/LawAdoptionHistory";
	import type { CityStatistics } from "$lib/types/CityStatistics";
	import type { EventLog } from "$lib/types/EventLog";
	import type { PlayerHistory } from "$lib/types/PlayerHistory";
	import { formatEnum, stripMarkup } from "$lib/utils/formatting";
	import {
		type TimelineEvent,
		type TimelineCategory,
		getPlayerColor,
	} from "./helpers";
	import SpriteIcon from "./SpriteIcon.svelte";

	let {
		gameDetails,
		techDiscoveryHistory,
		lawAdoptionHistory,
		cityStatistics,
		eventLogs,
		playerHistory,
		categoryFilters = $bindable<Record<TimelineCategory, boolean>>({
			tech: true,
			law: true,
			city: true,
			religion: false,
			wonder: false,
			military: false,
			other: false,
		}),
	}: {
		gameDetails: GameDetails;
		techDiscoveryHistory: TechDiscoveryHistory[];
		lawAdoptionHistory: LawAdoptionHistory[];
		cityStatistics: CityStatistics;
		eventLogs: EventLog[];
		playerHistory: PlayerHistory[];
		categoryFilters?: Record<TimelineCategory, boolean>;
	} = $props();

	let showMetrics = $state(true);

	// ─── Interesting event log types ─────────────────────────────────
	const EVENT_LOG_CATEGORIES: Record<string, TimelineCategory> = {
		WONDER_BUILT: "wonder",
		WONDER_STARTED: "wonder",
		RELIGION_FOUNDED: "religion",
		RELIGION_SPREAD: "religion",
		THEOLOGY_ESTABLISHED: "religion",
		CITY_CAPTURED: "military",
		CITY_RAZED: "military",
		WAR_DECLARED: "military",
		PEACE_DECLARED: "military",
	};

	// ─── Build unified event list ────────────────────────────────────
	const allEvents = $derived.by<TimelineEvent[]>(() => {
		const events: TimelineEvent[] = [];

		// Techs from structured data
		for (const player of techDiscoveryHistory) {
			for (const dp of player.data) {
				if (dp.tech_name) {
					events.push({
						turn: dp.turn,
						nation: player.nation,
						playerName: player.player_name,
						category: "tech",
						label: formatEnum(dp.tech_name, "TECH_"),
						enumValue: dp.tech_name,
						spriteCategory: "techs",
					});
				}
			}
		}

		// Laws from structured data
		for (const player of lawAdoptionHistory) {
			for (const dp of player.data) {
				if (dp.law_name) {
					events.push({
						turn: dp.turn,
						nation: player.nation,
						playerName: player.player_name,
						category: "law",
						label: formatEnum(dp.law_name, "LAW_"),
						enumValue: dp.law_name,
						spriteCategory: "laws",
					});
				}
			}
		}

		// Cities from city statistics
		for (const city of cityStatistics.cities) {
			events.push({
				turn: city.founded_turn,
				nation: city.owner_nation,
				playerName: formatEnum(city.owner_nation, "NATION_"),
				category: "city",
				label: `${formatEnum(city.city_name, "CITYNAME_")}${city.is_capital ? " (Capital)" : ""}`,
				enumValue: city.city_name,
				spriteCategory: null,
			});
		}

		// Interesting events from event logs
		for (const log of eventLogs) {
			const cat = EVENT_LOG_CATEGORIES[log.log_type];
			if (cat) {
				// Try to find the nation from player_name
				const matchingPlayer = gameDetails.players.find(
					(p) => p.player_name === log.player_name,
				);
				events.push({
					turn: log.turn,
					nation: matchingPlayer?.nation ?? null,
					playerName: log.player_name ?? "Unknown",
					category: cat,
					label:
						stripMarkup(log.description) ??
						formatEnum(log.log_type, ""),
					enumValue: log.log_type,
					spriteCategory: null,
				});
			}
		}

		return events.sort((a, b) => a.turn - b.turn);
	});

	// ─── Filter events by category ───────────────────────────────────
	const filteredEvents = $derived(
		allEvents.filter((e) => categoryFilters[e.category] !== false),
	);

	// ─── Group by turn, then by nation within each turn ──────────────
	type TurnGroup = {
		turn: number;
		nationGroups: {
			nation: string | null;
			events: TimelineEvent[];
		}[];
	};

	const turnGroups = $derived.by<TurnGroup[]>(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Map used locally in function, not as reactive state
		const byTurn = new Map<number, TimelineEvent[]>();
		for (const event of filteredEvents) {
			const existing = byTurn.get(event.turn);
			if (existing) {
				existing.push(event);
			} else {
				byTurn.set(event.turn, [event]);
			}
		}

		return [...byTurn.entries()]
			.sort(([a], [b]) => a - b)
			.map(([turn, events]) => {
				// Sub-group by nation
				// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Map used locally in function, not as reactive state
				const byNation = new Map<
					string,
					TimelineEvent[]
				>();
				for (const event of events) {
					const key = event.nation ?? "__unknown__";
					const existing = byNation.get(key);
					if (existing) {
						existing.push(event);
					} else {
						byNation.set(key, [event]);
					}
				}

				const nationGroups = [...byNation.entries()].map(
					([nation, evts]) => ({
						nation:
							nation === "__unknown__" ? null : nation,
						events: evts,
					}),
				);

				return { turn, nationGroups };
			});
	});

	// ─── Metric lookup helper ────────────────────────────────────────
	function getMetricsAtTurn(turn: number) {
		const metrics: {
			nation: string | null;
			vp: number | null;
			military: number | null;
		}[] = [];
		for (const player of playerHistory) {
			// History is sorted by turn; find matching or last before
			const point = player.history.find((h) => h.turn === turn);
			if (point) {
				metrics.push({
					nation: player.nation,
					vp: point.points,
					military: point.military_power,
				});
			}
		}
		return metrics;
	}

	// ─── Category display config ─────────────────────────────────────
	const CATEGORY_LABELS: Record<TimelineCategory, string> = {
		tech: "Techs",
		law: "Laws",
		city: "Cities",
		religion: "Religion",
		wonder: "Wonders",
		military: "Military",
		other: "Other",
	};

	const CATEGORY_ICONS: Record<TimelineCategory, string> = {
		tech: "🔬",
		law: "📜",
		city: "🏛",
		religion: "⛪",
		wonder: "🏗",
		military: "⚔",
		other: "📋",
	};
</script>

<h2 class="mb-4 mt-0 font-bold text-tan">Timeline</h2>

<!-- Filter controls -->
<div class="mb-4 flex flex-wrap items-center gap-3">
	{#each Object.entries(CATEGORY_LABELS) as [key, label] (key)}
		{@const category = key as TimelineCategory}
		<label class="flex cursor-pointer items-center gap-1.5 text-sm">
			<input
				type="checkbox"
				bind:checked={categoryFilters[category]}
				class="accent-brown"
			/>
			<span class="text-gray-300"
				>{CATEGORY_ICONS[category]} {label}</span
			>
		</label>
	{/each}

	<div class="ml-auto">
		<label class="flex cursor-pointer items-center gap-1.5 text-sm">
			<input
				type="checkbox"
				bind:checked={showMetrics}
				class="accent-brown"
			/>
			<span class="text-gray-300">Show Metrics</span>
		</label>
	</div>
</div>

<!-- Results count -->
<p class="mb-4 text-sm text-brown">
	{filteredEvents.length} events across {turnGroups.length} turns
</p>

<!-- Timeline -->
{#if turnGroups.length === 0}
	<p class="py-8 text-center text-gray-400">
		No events match the current filters.
	</p>
{:else}
	<div class="space-y-1">
		{#each turnGroups as group (group.turn)}
			<div
				class="rounded-lg border border-black/50 p-3"
				style="background-color: #2a2622;"
			>
				<!-- Turn header with optional metrics -->
				<div class="mb-2 flex items-center justify-between">
					<span class="text-sm font-bold text-tan"
						>Turn {group.turn}</span
					>

					{#if showMetrics}
						{@const metrics = getMetricsAtTurn(group.turn)}
						{#if metrics.length > 0}
							<div class="flex gap-3 text-xs text-gray-400">
								{#each metrics as m, i (m.nation ?? i)}
									<span
										class="flex items-center gap-1"
									>
										<span
											class="inline-block h-2 w-2 rounded-full"
											style="background-color: {getPlayerColor(m.nation, i)};"
										></span>
										{#if m.vp != null}
											<span
												>VP:{m.vp}</span
											>
										{/if}
										{#if m.military != null}
											<span
												>Mil:{m.military}</span
											>
										{/if}
									</span>
								{/each}
							</div>
						{/if}
					{/if}
				</div>

				<!-- Nation groups -->
				{#each group.nationGroups as ng, ngIdx (ng.nation ?? ngIdx)}
					{@const nationColor = getPlayerColor(
						ng.nation,
						ngIdx,
					)}
					<div
						class="mb-1 rounded border-l-4 py-1 pl-3 pr-2 last:mb-0"
						style="border-color: {nationColor}; background-color: rgba(255,255,255,0.03);"
					>
						<!-- Nation label -->
						<div
							class="mb-1 flex items-center gap-1.5 text-xs font-bold"
							style="color: {nationColor};"
						>
							{#if ng.nation}
								<SpriteIcon
									category="crests"
									value={ng.nation}
									size={18}
									alt={formatEnum(
										ng.nation,
										"NATION_",
									)}
								/>
							{/if}
							{formatEnum(ng.nation, "NATION_")}
						</div>

						<!-- Events -->
						<div class="flex flex-wrap gap-x-4 gap-y-1">
							{#each ng.events as event (event.enumValue + event.label)}
								<div
									class="flex items-center gap-1.5 text-sm text-gray-200"
								>
									{#if event.spriteCategory}
										<SpriteIcon
											category={event.spriteCategory}
											value={event.enumValue}
											size={22}
											alt={event.label}
										/>
									{:else}
										<span class="text-base"
											>{CATEGORY_ICONS[
												event.category
											]}</span
										>
									{/if}
									<span>{event.label}</span>
								</div>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		{/each}
	</div>
{/if}
