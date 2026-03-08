<script lang="ts">
	import type { Snippet } from "svelte";
	import type { GameDetails } from "$lib/types/GameDetails";
	import type { PlayerHistory } from "$lib/types/PlayerHistory";
	import type { YieldHistory } from "$lib/types/YieldHistory";
	import type { EventLog } from "$lib/types/EventLog";
	import type { LawAdoptionHistory } from "$lib/types/LawAdoptionHistory";
	import type { PlayerLaw } from "$lib/types/PlayerLaw";
	import type { TechDiscoveryHistory } from "$lib/types/TechDiscoveryHistory";
	import type { PlayerTech } from "$lib/types/PlayerTech";
	import type { PlayerUnitProduced } from "$lib/types/PlayerUnitProduced";
	import type { CityStatistics } from "$lib/types/CityStatistics";
	import type { ImprovementData } from "$lib/types/ImprovementData";
	import type { GameReligion } from "$lib/types/GameReligion";
	import type { PlayerWonder } from "$lib/types/PlayerWonder";
	import type { MapTile } from "$lib/types/MapTile";
	import { Tabs } from "bits-ui";
	import {
		formatEnum,
		formatDate,
		formatGameTitle,
		formatMapClass,
	} from "$lib/utils/formatting";
	import { getCivilizationColor } from "$lib/config";
	import {
		PLAYER_CHART_KEYS,
		createDefaultChartFilters,
		createDefaultTableStates,
		createDefaultCityVisibleColumns,
		createDefaultSelection,
	} from "./helpers";
	import type { TimelineCategory } from "./helpers";
	import OverviewTab from "./OverviewTab.svelte";
	import TimelineTab from "./TimelineTab.svelte";
	import EventsTab from "./EventsTab.svelte";
	import LawsTab from "./LawsTab.svelte";
	import TechsTab from "./TechsTab.svelte";
	import YieldsTab from "./YieldsTab.svelte";
	import MilitaryTab from "./MilitaryTab.svelte";
	import CitiesTab from "./CitiesTab.svelte";
	import ImprovementsTab from "./ImprovementsTab.svelte";
	import MapTab from "./MapTab.svelte";
	import SettingsTab from "./SettingsTab.svelte";

	let {
		gameDetails,
		playerHistory,
		allYields,
		eventLogs,
		lawAdoptionHistory,
		currentLaws,
		techDiscoveryHistory,
		completedTechs,
		unitsProduced,
		cityStatistics,
		improvementData,
		gameReligions,
		playerWonders,
		mapTiles,
		onMapTurnChange,
		selectedMapTurn = null,
		headerActions,
		preTabs,
	}: {
		gameDetails: GameDetails;
		playerHistory: PlayerHistory[];
		allYields: YieldHistory[];
		eventLogs: EventLog[];
		lawAdoptionHistory: LawAdoptionHistory[];
		currentLaws: PlayerLaw[];
		techDiscoveryHistory: TechDiscoveryHistory[];
		completedTechs: PlayerTech[];
		unitsProduced: PlayerUnitProduced[];
		cityStatistics: CityStatistics;
		improvementData: ImprovementData;
		gameReligions: GameReligion[];
		playerWonders: PlayerWonder[];
		mapTiles: MapTile[] | null;
		// eslint-disable-next-line no-unused-vars -- Callback type signature
		onMapTurnChange?: ((turn: number) => Promise<void>) | null;
		selectedMapTurn?: number | null;
		headerActions?: Snippet;
		preTabs?: Snippet;
	} = $props();

	// ─── Persistent UI state ──────────────────────────────────────────
	let activeTab = $state<string>("overview");
	let chartFilters = $state(createDefaultChartFilters());
	let tables = $state(createDefaultTableStates());
	let cityVisibleColumns = $state(createDefaultCityVisibleColumns());
	let timelineFilters = $state<Record<TimelineCategory, boolean>>({
		tech: true,
		law: true,
		city: true,
		religion: false,
		wonder: false,
		battle: false,
	});

	// ─── Initialize chart filters when data loads ─────────────────────
	$effect(() => {
		if (playerHistory) {
			const defaultSelection = createDefaultSelection(playerHistory);
			for (const key of PLAYER_CHART_KEYS) {
				chartFilters[key] = { ...defaultSelection };
			}
		}
	});

	$effect(() => {
		if (lawAdoptionHistory) {
			chartFilters.laws = createDefaultSelection(lawAdoptionHistory);
		}
	});

	$effect(() => {
		if (techDiscoveryHistory) {
			chartFilters.techs = createDefaultSelection(techDiscoveryHistory);
		}
	});

	// ─── Derived display values ───────────────────────────────────────
	const humanNation = $derived(
		gameDetails.players.find((p) => p.is_human)?.nation ?? null,
	);

	const gameTitle = $derived(
		formatGameTitle({
			game_name: gameDetails.game_name,
			save_owner_nation: humanNation,
			total_turns: gameDetails.total_turns,
			match_id: gameDetails.match_id,
		}),
	);

	const winnerColor = $derived.by(() => {
		if (!gameDetails.winner_civilization) return undefined;
		return getCivilizationColor(gameDetails.winner_civilization);
	});

	const victoryConditions = $derived(
		gameDetails.victory_conditions
			?.split("+")
			.map((v) => formatEnum(v, "VICTORY_"))
			.join(", ") ?? "Unknown",
	);

	const victoryPointsEnabled = $derived(
		gameDetails.victory_conditions?.includes("VICTORY_POINTS") ?? false,
	);

	const dlcList = $derived(
		gameDetails.enabled_dlc
			?.split("+")
			.map((dlc) => formatEnum(dlc, "DLC_"))
			.join(", ") ?? "None",
	);

	const modsList = $derived(
		gameDetails.enabled_mods?.split("+").join(", ") ?? "None",
	);
</script>

<!-- Header -->
<div class="mb-8 flex items-baseline justify-between">
	<h1 class="text-3xl font-bold text-gray-200">{gameTitle}</h1>
	<div class="flex items-center gap-4">
		{#if headerActions}
			{@render headerActions()}
		{/if}
		<p class="text-sm text-brown">{formatDate(gameDetails.save_date)}</p>
	</div>
</div>

<!-- Pre-tabs slot (e.g., share banner) -->
{#if preTabs}
	{@render preTabs()}
{/if}

<!-- Summary Section -->
<div
	class="mb-6 rounded-lg border-2 border-black p-2"
	style="background-color: #36302a;"
>
	<div class="flex justify-evenly">
		<!-- Left Column: Player, Winner & Victory Type -->
		<div
			class="grid grid-cols-[auto_minmax(180px,1fr)] items-center gap-x-2 gap-y-2"
		>
			<span
				class="text-right text-xs font-bold uppercase tracking-wide text-brown"
				>Player:</span
			>
			<span class="text-xl font-bold" style="color: #EEEEEE;"
				>{formatEnum(humanNation, "NATION_")}</span
			>

			<span
				class="text-right text-xs font-bold uppercase tracking-wide text-brown"
				>Winner:</span
			>
			<span
				class="text-xl font-bold"
				style:color={winnerColor ?? "#EEEEEE"}
			>
				{#if gameDetails.winner_player_id}
					{#if gameDetails.winner_name}
						{gameDetails.winner_name} - {formatEnum(
							gameDetails.winner_civilization,
							"NATION_",
						)}
					{:else}
						{formatEnum(gameDetails.winner_civilization, "NATION_")}
					{/if}
				{:else}
					In Progress
				{/if}
			</span>

			<span
				class="text-right text-xs font-bold uppercase tracking-wide text-brown"
				>Victory Type:</span
			>
			<span class="text-xl font-bold" style="color: #EEEEEE;">
				{#if gameDetails.winner_victory_type}
					{formatEnum(gameDetails.winner_victory_type, "VICTORY_")}
				{:else}
					-
				{/if}
			</span>
		</div>

		<!-- Right Column: Map, Turns & Nations -->
		<div
			class="grid grid-cols-[auto_minmax(100px,1fr)] items-center gap-x-2 gap-y-2"
		>
			{#if gameDetails.map_class}
				<span
					class="text-right text-xs font-bold uppercase tracking-wide text-brown"
					>Map:</span
				>
				<span class="text-xl font-bold" style="color: #EEEEEE;"
					>{formatMapClass(gameDetails.map_class)}</span
				>
			{/if}

			<span
				class="text-right text-xs font-bold uppercase tracking-wide text-brown"
				>Turns:</span
			>
			<span class="text-xl font-bold" style="color: #EEEEEE;"
				>{gameDetails.total_turns}</span
			>

			<span
				class="text-right text-xs font-bold uppercase tracking-wide text-brown"
				>Nations:</span
			>
			<span class="text-xl font-bold" style="color: #EEEEEE;"
				>{gameDetails.players.length}</span
			>
		</div>
	</div>
</div>

<!-- Tabs -->
<Tabs.Root bind:value={activeTab}>
	<!-- Tab Navigation -->
	<Tabs.List class="flex">
		<Tabs.Trigger
			value="overview"
			class="cursor-pointer rounded-tl-lg border-2 border-b-0 border-r-0 border-black px-3 py-2 text-sm font-bold transition-all duration-200 hover:bg-tan-hover data-[state=active]:bg-[#35302B] data-[state=inactive]:bg-[#2a2622] data-[state=active]:text-tan data-[state=inactive]:text-tan"
		>
			Overview
		</Tabs.Trigger>

		<!-- Timeline tab hidden pending redesign
		<Tabs.Trigger
			value="timeline"
			class="cursor-pointer border-2 border-b-0 border-r-0 border-black px-3 py-2 text-sm font-bold transition-all duration-200 hover:bg-tan-hover data-[state=active]:bg-[#35302B] data-[state=inactive]:bg-[#2a2622] data-[state=active]:text-tan data-[state=inactive]:text-tan"
		>
			Timeline
		</Tabs.Trigger>
		-->

		<Tabs.Trigger
			value="events"
			class="cursor-pointer border-2 border-b-0 border-r-0 border-black px-3 py-2 text-sm font-bold transition-all duration-200 hover:bg-tan-hover data-[state=active]:bg-[#35302B] data-[state=inactive]:bg-[#2a2622] data-[state=active]:text-tan data-[state=inactive]:text-tan"
		>
			Events
		</Tabs.Trigger>

		<Tabs.Trigger
			value="laws"
			class="cursor-pointer border-2 border-b-0 border-r-0 border-black px-3 py-2 text-sm font-bold transition-all duration-200 hover:bg-tan-hover data-[state=active]:bg-[#35302B] data-[state=inactive]:bg-[#2a2622] data-[state=active]:text-tan data-[state=inactive]:text-tan"
		>
			Laws
		</Tabs.Trigger>

		<Tabs.Trigger
			value="techs"
			class="cursor-pointer border-2 border-b-0 border-r-0 border-black px-3 py-2 text-sm font-bold transition-all duration-200 hover:bg-tan-hover data-[state=active]:bg-[#35302B] data-[state=inactive]:bg-[#2a2622] data-[state=active]:text-tan data-[state=inactive]:text-tan"
		>
			Techs
		</Tabs.Trigger>

		<Tabs.Trigger
			value="economics"
			class="cursor-pointer border-2 border-b-0 border-r-0 border-black px-3 py-2 text-sm font-bold transition-all duration-200 hover:bg-tan-hover data-[state=active]:bg-[#35302B] data-[state=inactive]:bg-[#2a2622] data-[state=active]:text-tan data-[state=inactive]:text-tan"
		>
			Yields
		</Tabs.Trigger>

		<Tabs.Trigger
			value="military"
			class="cursor-pointer border-2 border-b-0 border-r-0 border-black px-3 py-2 text-sm font-bold transition-all duration-200 hover:bg-tan-hover data-[state=active]:bg-[#35302B] data-[state=inactive]:bg-[#2a2622] data-[state=active]:text-tan data-[state=inactive]:text-tan"
		>
			Military
		</Tabs.Trigger>

		<Tabs.Trigger
			value="cities"
			class="cursor-pointer border-2 border-b-0 border-r-0 border-black px-3 py-2 text-sm font-bold transition-all duration-200 hover:bg-tan-hover data-[state=active]:bg-[#35302B] data-[state=inactive]:bg-[#2a2622] data-[state=active]:text-tan data-[state=inactive]:text-tan"
		>
			Cities
		</Tabs.Trigger>

		<Tabs.Trigger
			value="improvements"
			class="cursor-pointer border-2 border-b-0 border-r-0 border-black px-3 py-2 text-sm font-bold transition-all duration-200 hover:bg-tan-hover data-[state=active]:bg-[#35302B] data-[state=inactive]:bg-[#2a2622] data-[state=active]:text-tan data-[state=inactive]:text-tan"
		>
			Improvements
		</Tabs.Trigger>

		<Tabs.Trigger
			value="map"
			class="cursor-pointer border-2 border-b-0 border-r-0 border-black px-3 py-2 text-sm font-bold transition-all duration-200 hover:bg-tan-hover data-[state=active]:bg-[#35302B] data-[state=inactive]:bg-[#2a2622] data-[state=active]:text-tan data-[state=inactive]:text-tan"
		>
			Map
		</Tabs.Trigger>

		<Tabs.Trigger
			value="settings"
			class="cursor-pointer rounded-tr-lg border-2 border-b-0 border-black px-3 py-2 text-sm font-bold transition-all duration-200 hover:bg-tan-hover data-[state=active]:bg-[#35302B] data-[state=inactive]:bg-[#2a2622] data-[state=active]:text-tan data-[state=inactive]:text-tan"
		>
			Settings
		</Tabs.Trigger>
	</Tabs.List>

	<!-- Tab Content: Overview -->
	<Tabs.Content
		value="overview"
		class="tab-pane min-h-[400px] rounded-b-lg border-2 border-t-0 border-black p-8"
		style="background-color: #35302B;"
	>
		<OverviewTab
			{gameDetails}
			{playerHistory}
			{allYields}
			{completedTechs}
			{currentLaws}
			{unitsProduced}
			{cityStatistics}
			{victoryPointsEnabled}
			{improvementData}
			{gameReligions}
			{playerWonders}
		/>
	</Tabs.Content>

	<!-- Timeline tab hidden pending redesign
	<Tabs.Content
		value="timeline"
		class="tab-pane min-h-[400px] rounded-b-lg border-2 border-t-0 border-black p-8"
		style="background-color: #35302B;"
	>
		<TimelineTab
			{gameDetails}
			{techDiscoveryHistory}
			{lawAdoptionHistory}
			{cityStatistics}
			{eventLogs}
			{playerHistory}
			{allYields}
			{playerWonders}
			{gameReligions}
			bind:categoryFilters={timelineFilters}
		/>
	</Tabs.Content>
	-->

	<!-- Tab Content: Events -->
	<Tabs.Content
		value="events"
		class="tab-pane min-h-[400px] rounded-b-lg border-2 border-t-0 border-black p-8"
		style="background-color: #35302B;"
	>
		<EventsTab
			{eventLogs}
			{playerHistory}
			{gameDetails}
			{victoryPointsEnabled}
			{victoryConditions}
			bind:chartFilter={chartFilters.points}
			bind:tableState={tables.events}
		/>
	</Tabs.Content>

	<!-- Tab Content: Laws -->
	<Tabs.Content
		value="laws"
		class="tab-pane min-h-[400px] rounded-b-lg border-2 border-t-0 border-black p-8"
		style="background-color: #35302B;"
	>
		<LawsTab
			{lawAdoptionHistory}
			{currentLaws}
			bind:chartFilter={chartFilters.laws}
			bind:tableState={tables.laws}
		/>
	</Tabs.Content>

	<!-- Tab Content: Techs -->
	<Tabs.Content
		value="techs"
		class="tab-pane min-h-[400px] rounded-b-lg border-2 border-t-0 border-black p-8"
		style="background-color: #35302B;"
	>
		<TechsTab
			{techDiscoveryHistory}
			{completedTechs}
			bind:chartFilter={chartFilters.techs}
			bind:tableState={tables.techs}
		/>
	</Tabs.Content>

	<!-- Tab Content: Yields -->
	<Tabs.Content
		value="economics"
		class="tab-pane min-h-[400px] rounded-b-lg border-2 border-t-0 border-black p-8"
		style="background-color: #35302B;"
	>
		<YieldsTab
			{allYields}
			{playerHistory}
			bind:chartFilters
		/>
	</Tabs.Content>

	<!-- Tab Content: Military -->
	<Tabs.Content
		value="military"
		class="tab-pane min-h-[400px] rounded-b-lg border-2 border-t-0 border-black p-8"
		style="background-color: #35302B;"
	>
		<MilitaryTab
			{gameDetails}
			{playerHistory}
			{unitsProduced}
			bind:chartFilter={chartFilters.military}
			bind:tableState={tables.units}
		/>
	</Tabs.Content>

	<!-- Tab Content: Cities -->
	<Tabs.Content
		value="cities"
		class="tab-pane min-h-[400px] rounded-b-lg border-2 border-t-0 border-black p-8"
		style="background-color: #35302B;"
	>
		<CitiesTab
			{cityStatistics}
			bind:tableState={tables.cities}
			bind:cityVisibleColumns
		/>
	</Tabs.Content>

	<!-- Tab Content: Improvements -->
	<Tabs.Content
		value="improvements"
		class="tab-pane min-h-[400px] rounded-b-lg border-2 border-t-0 border-black p-8"
		style="background-color: #35302B;"
	>
		<ImprovementsTab
			{improvementData}
			bind:tableState={tables.improvements}
		/>
	</Tabs.Content>

	<!-- Tab Content: Map -->
	<Tabs.Content
		value="map"
		class="tab-pane min-h-[400px] rounded-b-lg border-2 border-t-0 border-black p-8"
		style="background-color: #35302B;"
	>
		<MapTab
			{mapTiles}
			totalTurns={gameDetails.total_turns}
			selectedTurn={selectedMapTurn}
			onTurnChange={onMapTurnChange}
		/>
	</Tabs.Content>

	<!-- Tab Content: Settings -->
	<Tabs.Content
		value="settings"
		class="tab-pane min-h-[400px] rounded-b-lg border-2 border-t-0 border-black p-8"
		style="background-color: #35302B;"
	>
		<SettingsTab
			{gameDetails}
			{victoryConditions}
			{dlcList}
			{modsList}
		/>
	</Tabs.Content>
</Tabs.Root>

<style>
	/* Custom fade-in animation for tab switching */
	:global(.tab-pane) {
		animation: fadeIn 0.3s;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
</style>
