<script lang="ts">
	import type { GameDetails } from "$lib/types/GameDetails";
	import type { TechDiscoveryHistory } from "$lib/types/TechDiscoveryHistory";
	import type { LawAdoptionHistory } from "$lib/types/LawAdoptionHistory";
	import type { CityStatistics } from "$lib/types/CityStatistics";
	import type { EventLog } from "$lib/types/EventLog";
	import type { PlayerHistory } from "$lib/types/PlayerHistory";
	import type { YieldHistory } from "$lib/types/YieldHistory";
	import type { PlayerWonder } from "$lib/types/PlayerWonder";
	import type { GameReligion } from "$lib/types/GameReligion";
	import { formatEnum, stripMarkup } from "$lib/utils/formatting";
	import {
		type TimelineEvent,
		type TimelineCategory,
		type SpriteCategory,
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
		allYields,
		playerWonders,
		gameReligions,
		categoryFilters = $bindable<Record<TimelineCategory, boolean>>({
			tech: true,
			law: true,
			city: true,
			religion: false,
			wonder: false,
			battle: false,
		}),
	}: {
		gameDetails: GameDetails;
		techDiscoveryHistory: TechDiscoveryHistory[];
		lawAdoptionHistory: LawAdoptionHistory[];
		cityStatistics: CityStatistics;
		eventLogs: EventLog[];
		playerHistory: PlayerHistory[];
		allYields: YieldHistory[];
		playerWonders: PlayerWonder[];
		gameReligions: GameReligion[];
		categoryFilters?: Record<TimelineCategory, boolean>;
	} = $props();

	let showMetrics = $state(true);

	// ─── Event log types (structured data handles wonders/religion founding) ─
	const EVENT_LOG_CATEGORIES: Record<string, TimelineCategory> = {
		RELIGION_SPREAD: "religion",
		THEOLOGY_ESTABLISHED: "religion",
	};

	// ─── Player columns ─────────────────────────────────────────────
	type PlayerColumn = {
		nation: string | null;
		playerName: string;
		index: number;
	};

	const playerColumns = $derived<PlayerColumn[]>(
		gameDetails.players.map((p, i) => ({
			nation: p.nation,
			playerName: p.player_name,
			index: i,
		})),
	);

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

		// Wonders from structured data
		for (const wonder of playerWonders) {
			events.push({
				turn: wonder.completed_turn,
				nation: wonder.nation,
				playerName: wonder.player_name,
				category: "wonder",
				label: formatEnum(wonder.wonder, "IMPROVEMENT_"),
				enumValue: wonder.wonder,
				spriteCategory: null,
			});
		}

		// Religions from structured data
		for (const religion of gameReligions) {
			if (religion.founded_turn != null) {
				events.push({
					turn: religion.founded_turn,
					nation: religion.founder_nation,
					playerName: formatEnum(religion.founder_nation, "NATION_"),
					category: "religion",
					label: "Founded " + formatEnum(religion.religion_name, "RELIGION_"),
					enumValue: religion.religion_name,
					spriteCategory: "religions",
				});
			}
		}

		// Additional events from event logs (religion spread, theology)
		for (const log of eventLogs) {
			const cat = EVENT_LOG_CATEGORIES[log.log_type];
			if (cat) {
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

		// Battles: detect 20%+ military power drops between consecutive turns
		for (const player of playerHistory) {
			for (let j = 1; j < player.history.length; j++) {
				const prev = player.history[j - 1];
				const curr = player.history[j];
				if (prev.military_power != null && curr.military_power != null && prev.military_power > 0) {
					const drop = (prev.military_power - curr.military_power) / prev.military_power;
					if (drop >= 0.2) {
						const pctLost = Math.round(drop * 100);
						events.push({
							turn: curr.turn,
							nation: player.nation,
							playerName: player.player_name,
							category: "battle",
							label: `Lost ${pctLost}% military power (${prev.military_power} → ${curr.military_power})`,
							enumValue: `BATTLE_${player.nation}_${curr.turn}`,
							spriteCategory: null,
						});
					}
				}
			}
		}

		return events.sort((a, b) => a.turn - b.turn);
	});

	// ─── Filter events by category ───────────────────────────────────
	const filteredEvents = $derived(
		allEvents.filter((e) => categoryFilters[e.category] !== false),
	);

	// ─── Metrics: leader per metric per turn ─────────────────────────
	type MetricLeader = {
		nation: string | null;
		value: number;
		playerIndex: number;
	};

	type TurnMetrics = {
		orders: MetricLeader | null;
		military: MetricLeader | null;
		science: MetricLeader | null;
		vp: MetricLeader | null;
	};

	const turnMetricsMap = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Map used locally in function, not as reactive state
		const result = new Map<number, TurnMetrics>();

		// Build yield indexes: nation → turn → amount
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Map used locally in function, not as reactive state
		const ordersIndex = new Map<string, Map<number, number>>();
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Map used locally in function, not as reactive state
		const scienceIndex = new Map<string, Map<number, number>>();

		for (const yh of allYields) {
			const nationKey = yh.nation ?? "__unknown__";
			if (yh.yield_type === "YIELD_ORDERS" || yh.yield_type === "YIELD_SCIENCE") {
				const targetIndex = yh.yield_type === "YIELD_ORDERS" ? ordersIndex : scienceIndex;
				// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Map used locally in function, not as reactive state
				const turnMap = new Map<number, number>();
				for (const dp of yh.data) {
					if (dp.rate != null) {
						turnMap.set(dp.turn, dp.rate);
					}
				}
				targetIndex.set(nationKey, turnMap);
			}
		}

		// Collect all turns that have events
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Set used locally in function, not as reactive state
		const eventTurns = new Set<number>();
		for (const e of filteredEvents) {
			eventTurns.add(e.turn);
		}

		// For each event turn, find the leader in each metric
		for (const turn of eventTurns) {
			const metrics: TurnMetrics = { orders: null, military: null, science: null, vp: null };

			for (let i = 0; i < gameDetails.players.length; i++) {
				const player = gameDetails.players[i];
				const nationKey = player.nation ?? "__unknown__";

				// Orders
				const ordersVal = ordersIndex.get(nationKey)?.get(turn);
				if (ordersVal != null && (metrics.orders == null || ordersVal > metrics.orders.value)) {
					metrics.orders = { nation: player.nation, value: ordersVal, playerIndex: i };
				}

				// Science
				const scienceVal = scienceIndex.get(nationKey)?.get(turn);
				if (scienceVal != null && (metrics.science == null || scienceVal > metrics.science.value)) {
					metrics.science = { nation: player.nation, value: scienceVal, playerIndex: i };
				}

				// Military & VP from playerHistory
				const ph = playerHistory.find((p) => p.nation === player.nation);
				const point = ph?.history.find((h) => h.turn === turn);
				if (point) {
					if (point.military_power != null && (metrics.military == null || point.military_power > metrics.military.value)) {
						metrics.military = { nation: player.nation, value: point.military_power, playerIndex: i };
					}
					if (point.points != null && (metrics.vp == null || point.points > metrics.vp.value)) {
						metrics.vp = { nation: player.nation, value: point.points, playerIndex: i };
					}
				}
			}

			result.set(turn, metrics);
		}

		return result;
	});

	// ─── Build table rows: turn → events by nation ──────────────────
	type TableRow = {
		turn: number;
		eventsByNation: Map<string, TimelineEvent[]>;
	};

	const tableRows = $derived.by<TableRow[]>(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Map used locally in function, not as reactive state
		const byTurn = new Map<number, Map<string, TimelineEvent[]>>();

		for (const event of filteredEvents) {
			let turnMap = byTurn.get(event.turn);
			if (!turnMap) {
				// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Map used locally in function, not as reactive state
				turnMap = new Map();
				byTurn.set(event.turn, turnMap);
			}
			const nationKey = event.nation ?? "__unknown__";
			const existing = turnMap.get(nationKey);
			if (existing) {
				existing.push(event);
			} else {
				turnMap.set(nationKey, [event]);
			}
		}

		return [...byTurn.entries()]
			.sort(([a], [b]) => a - b)
			.map(([turn, nationMap]) => ({
				turn,
				eventsByNation: nationMap,
			}));
	});

	// ─── Category display config ─────────────────────────────────────
	const CATEGORY_LABELS: Record<TimelineCategory, string> = {
		tech: "Techs",
		law: "Laws",
		city: "Cities",
		religion: "Religion",
		wonder: "Wonders",
		battle: "Battles",
	};

	// Sprite config for each filter category
	const CATEGORY_SPRITES: Record<TimelineCategory, { category: SpriteCategory; value: string }> = {
		tech: { category: "techs", value: "TECH_SCHOLARSHIP" },
		law: { category: "laws", value: "LAW_CENTRALIZATION" },
		city: { category: "yields", value: "YIELD_GROWTH" },
		religion: { category: "religions", value: "RELIGION_FOUNDED" },
		wonder: { category: "icons", value: "IMPROVEMENT_FINISHED" },
		battle: { category: "icons", value: "MILITARY" },
	};

	// Fallback emoji icons for events without sprites
	const CATEGORY_ICONS: Record<TimelineCategory, string> = {
		tech: "🔬",
		law: "📜",
		city: "🏛",
		religion: "⛪",
		wonder: "🏗",
		battle: "⚔",
	};

	// ─── Metric column config ────────────────────────────────────────
	const METRIC_COLUMNS: { key: keyof TurnMetrics; yieldSprite: string; label: string }[] = [
		{ key: "orders", yieldSprite: "YIELD_ORDERS", label: "Orders" },
		{ key: "military", yieldSprite: "YIELD_TRAINING", label: "Military" },
		{ key: "science", yieldSprite: "YIELD_SCIENCE", label: "Science" },
		{ key: "vp", yieldSprite: "YIELD_LEGITIMACY", label: "VP" },
	];
</script>

<div class="rounded-lg border border-tan p-4" style="background-color: #2a2622;">
	<h3 class="mb-3 text-base font-bold text-tan">Timeline</h3>

	<!-- Filter controls -->
	<div class="mb-3 flex flex-wrap items-center gap-3">
		{#each Object.entries(CATEGORY_LABELS) as [key, label] (key)}
			{@const category = key as TimelineCategory}
			{@const sprite = CATEGORY_SPRITES[category]}
			<label class="flex cursor-pointer items-center gap-1.5 text-sm">
				<input
					type="checkbox"
					bind:checked={categoryFilters[category]}
					class="accent-brown"
				/>
				<SpriteIcon category={sprite.category} value={sprite.value} size={16} alt={label} />
				<span class="text-gray-300">{label}</span>
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
	<p class="mb-3 text-sm text-brown">
		{filteredEvents.length} events across {tableRows.length} turns
	</p>

	<!-- Timeline table -->
	{#if tableRows.length === 0}
		<p class="py-8 text-center text-gray-400">
			No events match the current filters.
		</p>
	{:else}
		<div class="overflow-x-auto rounded-lg p-3" style="background-color: #201a13;">
		<table class="border-collapse">
			<thead>
				<tr>
					<th class="sticky left-0 z-20 bg-[#201a13] px-2 py-1 text-left text-xs font-bold text-brown">
						Turn
					</th>
					{#if showMetrics}
						{#each METRIC_COLUMNS as metric (metric.key)}
							<th class="px-1 py-1 text-center" title={metric.label}>
								<SpriteIcon category="yields" value={metric.yieldSprite} size={16} alt={metric.label} />
							</th>
						{/each}
					{/if}
					{#each playerColumns as player (player.nation ?? player.index)}
						<th class="px-1 py-1 text-center text-xs font-bold" style="color: {getPlayerColor(player.nation, player.index)};">
							<div class="flex items-center justify-center gap-1">
								{#if player.nation}
									<SpriteIcon category="crests" value={player.nation} size={18} alt={formatEnum(player.nation, "NATION_")} />
								{/if}
								{formatEnum(player.nation, "NATION_")}
							</div>
						</th>
					{/each}
				</tr>
				<tr>
					<td class="sticky left-0 z-20 h-0.5 bg-[#201a13]"></td>
					{#if showMetrics}
						{#each METRIC_COLUMNS as _ (_.key)}
							<td class="h-0.5 bg-brown/30"></td>
						{/each}
					{/if}
					{#each playerColumns as player (player.nation ?? player.index)}
						<td class="h-0.5" style="background-color: {getPlayerColor(player.nation, player.index)};"></td>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each tableRows as row (row.turn)}
					{@const metrics = turnMetricsMap.get(row.turn)}
					<tr class="border-b border-brown/30 hover:bg-brown/10">
						<td class="sticky left-0 z-10 bg-[#201a13] px-2 py-0.5 text-xs font-bold text-tan align-top">
							{row.turn}
						</td>
						{#if showMetrics}
							{#each METRIC_COLUMNS as metric (metric.key)}
								{@const leader = metrics?.[metric.key]}
								<td class="px-1 py-0.5 text-center align-top whitespace-nowrap">
									{#if leader}
										<div class="inline-flex items-center gap-px">
											{#if leader.nation}
												<SpriteIcon category="crests" value={leader.nation} size={12} alt={formatEnum(leader.nation, "NATION_")} />
											{/if}
											<span class="text-[10px] font-medium" style="color: {getPlayerColor(leader.nation, leader.playerIndex)};">
												{metric.key === "vp" ? leader.value : Math.round(leader.value * 10) / 10}
											</span>
										</div>
									{/if}
								</td>
							{/each}
						{/if}
						{#each playerColumns as player (player.nation ?? player.index)}
							{@const nationKey = player.nation ?? "__unknown__"}
							{@const events = row.eventsByNation.get(nationKey) ?? []}
							<td class="px-1 py-0.5 align-top">
								<div class="flex flex-wrap gap-0.5">
									{#each events as event (event.enumValue + event.turn + event.label)}
										<span title={event.label} class="inline-flex">
											{#if event.spriteCategory}
												<SpriteIcon category={event.spriteCategory} value={event.enumValue} size={18} alt={event.label} />
											{:else}
												<span class="text-sm leading-none">{CATEGORY_ICONS[event.category]}</span>
											{/if}
										</span>
									{/each}
								</div>
							</td>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
		</div>
	{/if}
</div>
