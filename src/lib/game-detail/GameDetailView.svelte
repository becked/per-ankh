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
	import {
		PLAYER_CHART_KEYS,
		createDefaultChartFilters,
		createDefaultTableStates,
		createDefaultCityVisibleColumns,
		createDefaultSelection,
	} from "./helpers";
	import type { TimelineCategory } from "./helpers";
	import OverviewTab from "./OverviewTab.svelte";
	import SpriteIcon from "./SpriteIcon.svelte";
	// eslint-disable-next-line no-unused-vars -- TimelineTab pending redesign, see commented block below
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
		userNation = null,
		userDisplayName = null,
		userWon = null,
		headerActions,
		preTabs,
		mapMissingMessage,
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
		// The uploader's picked nation, sourced from the games row by the
		// cloud detail endpoint. When present, the H1 title and OverviewTab's
		// save-owner flag prefer this over the alphabetical-first-human
		// heuristic — the latter only works when the save has a single
		// human, which is the legacy-share-viewer case but not multiplayer
		// cloud uploads. Null when the uploader picked Observer, or for
		// legacy callers (the frozen web/ viewer) that don't pass the prop.
		userNation?: string | null;
		// Uploader's Discord display_name + their user_won flag, both from
		// the games row + users JOIN. Together they let the winner card and
		// the uploader's nation card show the user's identity ("becked")
		// when the save's leader-name field is empty — Old World writes ""
		// for solo games whose player never set a custom leader name. Both
		// are optional/null for legacy callers and observer-mode uploads.
		userDisplayName?: string | null;
		userWon?: boolean | null;
		headerActions?: Snippet;
		preTabs?: Snippet;
		mapMissingMessage?: Snippet;
	} = $props();

	// ─── Persistent UI state ──────────────────────────────────────────
	let activeTab = $state<string>("overview");
	let chartFilters = $state(createDefaultChartFilters());
	let tables = $state(createDefaultTableStates());
	let cityVisibleColumns = $state(createDefaultCityVisibleColumns());
	// eslint-disable-next-line no-unused-vars -- TimelineTab pending redesign, see commented block below
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
	// Prefer the uploader's picked nation (cloud-only, plumbed via the
	// userNation prop) over the alphabetical-first-human heuristic. The
	// heuristic gives a wrong answer for multi-human saves but is correct
	// for legacy single-human shares from the (frozen) web/ viewer, which
	// don't supply userNation.
	const humanNation = $derived(
		userNation ?? gameDetails.players.find((p) => p.is_human)?.nation ?? null,
	);

	const gameTitle = $derived(
		formatGameTitle({
			game_name: gameDetails.game_name,
			save_owner_nation: humanNation,
			total_turns: gameDetails.total_turns,
			match_id: gameDetails.match_id,
		}),
	);

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
<div class="mb-4 flex items-baseline justify-between">
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
<div class="mb-6 rounded-lg p-4" style="background-color: #2a2622;">
	<div class="grid grid-cols-2 gap-3 lg:grid-cols-5">
		<!-- Player -->
		<div class="rounded-lg p-3" style="background-color: #35302B;">
			<p class="mb-1 flex items-center gap-1 text-xs font-bold text-gray-400">
				{#if humanNation}
					<SpriteIcon
						category="crests"
						value={humanNation}
						size={14}
						alt={formatEnum(humanNation, "NATION_")}
					/>
				{/if}
				Player
			</p>
			<p class="text-lg font-bold" style="color: #DBDEE3;">
				{formatEnum(humanNation, "NATION_")}
			</p>
		</div>

		<!-- Winner -->
		<div class="rounded-lg p-3" style="background-color: #35302B;">
			<p class="mb-1 flex items-center gap-1 text-xs font-bold text-gray-400">
				<SpriteIcon
					category="icons"
					value="ACHIEVEMENT_WIN"
					size={14}
					alt="Winner"
				/>
				Winner
			</p>
			<p class="text-lg font-bold" style="color: #DBDEE3;">
				{#if userWon && userDisplayName && gameDetails.winner_civilization}
					{userDisplayName} ({formatEnum(
						gameDetails.winner_civilization,
						"NATION_",
					)})
				{:else if gameDetails.winner_civilization}
					{#if gameDetails.winner_name}
						{gameDetails.winner_name} ({formatEnum(
							gameDetails.winner_civilization,
							"NATION_",
						)})
					{:else}
						{formatEnum(gameDetails.winner_civilization, "NATION_")}
					{/if}
				{:else}
					-
				{/if}
			</p>
		</div>

		<!-- Victory Type -->
		<div class="rounded-lg p-3" style="background-color: #35302B;">
			<p class="mb-1 flex items-center gap-1 text-xs font-bold text-gray-400">
				<SpriteIcon
					category="icons"
					value="VICTORY_NORMAL"
					size={14}
					alt="Victory Type"
				/>
				Victory Type
			</p>
			<p class="text-lg font-bold" style="color: #DBDEE3;">
				{#if gameDetails.winner_victory_type}
					{formatEnum(gameDetails.winner_victory_type, "VICTORY_")}
				{:else}
					-
				{/if}
			</p>
		</div>

		<!-- Map -->
		{#if gameDetails.map_class}
			<div class="rounded-lg p-3" style="background-color: #35302B;">
				<p class="mb-1 flex items-center gap-1 text-xs font-bold text-gray-400">
					<SpriteIcon
						category="icons"
						value="MAP_OVERVIEW"
						size={14}
						alt="Map"
					/>
					Map
				</p>
				<p class="text-lg font-bold" style="color: #DBDEE3;">
					{formatMapClass(gameDetails.map_class)}
				</p>
			</div>
		{/if}

		<!-- Turns -->
		<div class="rounded-lg p-3" style="background-color: #35302B;">
			<p class="mb-1 flex items-center gap-1 text-xs font-bold text-gray-400">
				<SpriteIcon category="icons" value="TURN" size={14} alt="Turns" />
				Turns
			</p>
			<p class="text-lg font-bold" style="color: #DBDEE3;">
				{gameDetails.total_turns}
			</p>
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
			{userNation}
			{userDisplayName}
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
			bind:chartFilter={chartFilters.points}
			bind:legitimacyChartFilter={chartFilters.legitimacy}
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
		<YieldsTab {allYields} bind:chartFilters />
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
		<ImprovementsTab {improvementData} bind:tableState={tables.improvements} />
	</Tabs.Content>

	<!-- Tab Content: Map -->
	<Tabs.Content
		value="map"
		class="tab-pane min-h-[400px] rounded-b-lg border-2 border-t-0 border-black p-8"
		style="background-color: #35302B;"
	>
		<MapTab
			{mapTiles}
			cities={cityStatistics.cities}
			totalTurns={gameDetails.total_turns}
			selectedTurn={selectedMapTurn}
			onTurnChange={onMapTurnChange}
			missingMessage={mapMissingMessage}
		/>
	</Tabs.Content>

	<!-- Tab Content: Settings -->
	<Tabs.Content
		value="settings"
		class="tab-pane min-h-[400px] rounded-b-lg border-2 border-t-0 border-black p-8"
		style="background-color: #35302B;"
	>
		<SettingsTab {gameDetails} {victoryConditions} {dlcList} {modsList} />
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
