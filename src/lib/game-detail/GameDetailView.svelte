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
	import type { StoryEvent } from "$lib/types/StoryEvent";
	import type { PlayerWonder } from "$lib/types/PlayerWonder";
	import type { MapTile } from "$lib/types/MapTile";
	import type {
		PlayerRosterEntry,
		PlayerNationEntry,
		CharacterInfo,
		CharacterTraitInfo,
		PlayerGoalInfo,
		UnitInfo,
		FamilyInfo,
		MemoryInfo,
		TileOwnershipEntry,
		YieldPriceEntry,
		PlayerResourceInfo,
		FamilyOpinionEntry,
		ProjectProducedInfo,
	} from "$lib/parser/types";
	import { Tabs } from "bits-ui";
	import { formatEnum, formatDate, nationName } from "$lib/utils/formatting";
	import { mapScriptLabel } from "$lib/map-settings";
	import {
		PLAYER_CHART_KEYS,
		createDefaultChartFilters,
		createDefaultTableStates,
		createDefaultCityVisibleColumns,
		createDefaultSelection,
		resolveDetailPlayers,
	} from "./helpers";
	import type { TimelineCategory } from "./helpers";
	import OverviewTab from "./OverviewTab.svelte";
	import SpriteIcon from "./SpriteIcon.svelte";
	// eslint-disable-next-line no-unused-vars -- TimelineTab pending redesign, see commented block below
	import TimelineTab from "./TimelineTab.svelte";
	import EventsTab from "./EventsTab.svelte";
	import LeadersTab from "./LeadersTab.svelte";
	import LawsTab from "./LawsTab.svelte";
	import TechsTab from "./TechsTab.svelte";
	import OrdersTab from "./OrdersTab.svelte";
	import YieldsTab from "./YieldsTab.svelte";
	import MilitaryTab from "./MilitaryTab.svelte";
	import CitiesTab from "./CitiesTab.svelte";
	import EconomyTab from "./EconomyTab.svelte";
	import WondersTab from "./WondersTab.svelte";
	import FamiliesTab from "./FamiliesTab.svelte";
	import SpecialistsTab from "./SpecialistsTab.svelte";
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
		units = [],
		cityStatistics,
		improvementData,
		gameReligions,
		playerWonders,
		playerRoster = [],
		playerNations = [],
		characters = [],
		characterTraits = [],
		playerGoals = [],
		families = [],
		memoryData = [],
		storyEvents = [],
		tileOwnershipHistory = [],
		yieldPrices = [],
		playerResources = [],
		familyOpinionHistory = [],
		projectsProduced = [],
		mapTiles,
		onMapTurnChange,
		selectedMapTurn = null,
		userNation = null,
		userDisplayName = null,
		userWon = null,
		titleSlot,
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
		// Ending unit roster (units alive at game end) — drives the Military tab's
		// Ending Army comparison. Defaults to [] for any blob without it.
		units?: UnitInfo[];
		cityStatistics: CityStatistics;
		improvementData: ImprovementData;
		gameReligions: GameReligion[];
		playerWonders: PlayerWonder[];
		// Canonical roster (player_index = the per-player join key). Present in
		// every blob; used to recover player ids for pre-2.6.0 game_details
		// rows that lack them.
		playerRoster?: PlayerRosterEntry[];
		// player_xml_id → nation, used by the map to resolve each city's founding
		// nation for architecture rendering.
		playerNations?: PlayerNationEntry[];
		// Leader/character data for the Leaders tab. All default to [] for
		// pre-2.8.0 blobs, where the tab is hidden.
		characters?: CharacterInfo[];
		characterTraits?: CharacterTraitInfo[];
		playerGoals?: PlayerGoalInfo[];
		// Family, diplomatic-memory, and story-event data for the Techs tab's
		// science annotations (Sages seat founding, steal-research missions,
		// expedition events / spike attribution). All default to [] for older
		// blobs.
		families?: FamilyInfo[];
		memoryData?: MemoryInfo[];
		storyEvents?: StoryEvent[];
		// Sparse per-tile ownership transitions — the Economy tab's territory
		// curve. Defaults to [] for legacy callers (frozen web/ viewer), which
		// hides that one view.
		tileOwnershipHistory?: TileOwnershipEntry[];
		// Game-level market prices per turn — the Economy tab's GDP basket.
		// Defaults to [] for legacy callers (frozen web/ viewer), which drops
		// that one view.
		yieldPrices?: YieldPriceEntry[];
		// End-of-game stockpiles — the Economy tab's national-wealth panel.
		// Defaults to [] for legacy callers (frozen web/ viewer).
		playerResources?: PlayerResourceInfo[];
		// Per-turn family opinion — the Economy tab's upkeep companion chart.
		// Defaults to [] for legacy callers (frozen web/ viewer).
		familyOpinionHistory?: FamilyOpinionEntry[];
		// Whole-game project counts per player (2.13.0+ blobs). Defaults to []
		// for legacy callers and older blobs, which hide the Economy panel.
		projectsProduced?: ProjectProducedInfo[];
		mapTiles: MapTile[] | null;
		// eslint-disable-next-line no-unused-vars -- Callback type signature
		onMapTurnChange?: ((turn: number) => Promise<void>) | null;
		selectedMapTurn?: number | null;
		// The uploader's picked nation, sourced from the games row by the
		// cloud detail endpoint. The Worker's COALESCE fallback (first human
		// player's nation) means this is virtually always set.
		userNation?: string | null;
		// Uploader's Discord display_name + their user_won flag, both from
		// the games row + users JOIN. Together they let the winner card and
		// the uploader's nation card show the user's identity ("becked")
		// when the save's leader-name field is empty — Old World writes ""
		// for solo games whose player never set a custom leader name. Both
		// are optional/null for observer-mode uploads.
		userDisplayName?: string | null;
		userWon?: boolean | null;
		// The heading: the route passes a breadcrumb trail here, whose final
		// segment is the game title.
		titleSlot: Snippet;
		headerActions?: Snippet;
		preTabs?: Snippet;
		mapMissingMessage?: Snippet;
	} = $props();

	// ─── Persistent UI state ──────────────────────────────────────────
	// Per-player iteration source: roster players enriched with a stable
	// playerId + unique label + color. Mirror-match safe (nation alone isn't).
	// `player_roster` is the id source; when a blob lacks it, fall back to one
	// synthesized from player_history (which carries player_id) to recover ids
	// for those id-less game_details.players rows.
	const effectiveRoster = $derived(
		playerRoster.length > 0
			? playerRoster
			: playerHistory.map((h) => ({
					player_index: h.player_id,
					player_name: h.player_name,
					nation: h.nation,
				})),
	);
	const resolvedPlayers = $derived(
		resolveDetailPlayers(gameDetails.players, effectiveRoster),
	);

	// The Leaders tab only appears when the blob has rulers — pre-2.8.0 games
	// have none.
	const hasLeaders = $derived(
		characters.some((c) => c.became_leader_turn != null),
	);

	let activeTab = $state<string>("overview");

	// Deep-link the active tab via the URL hash (#military), so a reload or a
	// shared link restores the tab instead of falling back to Overview. The
	// hash isn't sent to the server, so SSR renders Overview and the client
	// switches on mount (one frame); a clean, non-history-polluting replaceState
	// keeps the URL in sync as the user changes tabs.
	// Tabs that have been renamed, so links shared before the rename still land
	// somewhere. A hash with no matching trigger renders an empty tab pane, and
	// #improvements has been a shareable link for as long as the tab existed.
	const RENAMED_TABS: Record<string, string> = { improvements: "economy" };

	$effect(() => {
		const fromHash = window.location.hash.replace(/^#/, "");
		if (fromHash) activeTab = RENAMED_TABS[fromHash] ?? fromHash;
	});
	$effect(() => {
		const target = activeTab === "overview" ? "" : `#${activeTab}`;
		if (window.location.hash !== target) {
			history.replaceState(
				history.state,
				"",
				`${window.location.pathname}${window.location.search}${target}`,
			);
		}
	});

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
	// Source of truth is the userNation prop, which the cloud Worker fills
	// in via COALESCE(g.user_nation, first-human-player.nation) — see
	// cloud/src/games.ts listGames / getGame / public-recent. Falls through to
	// the alphabetical-first-human heuristic when absent.
	const humanNation = $derived(
		userNation ?? gameDetails.players.find((p) => p.is_human)?.nation ?? null,
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

	// Tab triggers styled as chip-bar pills, matching the aggregate-stats
	// subtabs (src/lib/stats/StatsView.svelte): borderless, fill-based state
	// (active = surface-raised, inactive = surface) inside a floating tray.
	const triggerClass =
		"cursor-pointer rounded px-3 py-1.5 text-sm font-bold text-tan transition-colors hover:bg-tan-hover data-[state=active]:bg-surface-raised data-[state=inactive]:bg-surface";
</script>

<!-- Header -->
<div class="mb-4 flex items-baseline justify-between gap-4">
	<!-- The route passes a breadcrumb trail; its final segment is the
	     game title. -->
	{@render titleSlot()}
	<div class="flex items-center gap-4">
		{#if headerActions}
			{@render headerActions()}
		{/if}
		<p class="text-sm text-gray-200">{formatDate(gameDetails.save_date)}</p>
	</div>
</div>

<!-- Pre-tabs slot (e.g., the reparse banner) -->
{#if preTabs}
	{@render preTabs()}
{/if}

<!-- Summary Section -->
<div
	class="mb-6 rounded-lg p-4"
	style="background-color: rgb(var(--color-surface));"
>
	<div class="grid grid-cols-2 gap-3 lg:grid-cols-5">
		<!-- Player -->
		<div
			class="rounded-lg p-3"
			style="background-color: rgb(var(--color-surface-raised));"
		>
			<p class="mb-1 flex items-center gap-1 text-xs font-bold text-gray-400">
				{#if humanNation}
					<SpriteIcon
						category="crests"
						value={humanNation}
						size={14}
						alt={nationName(humanNation)}
					/>
				{/if}
				Player
			</p>
			<p class="text-lg font-bold" style="color: rgb(var(--color-bright));">
				{nationName(humanNation)}
			</p>
		</div>

		<!-- Winner -->
		<div
			class="rounded-lg p-3"
			style="background-color: rgb(var(--color-surface-raised));"
		>
			<p class="mb-1 flex items-center gap-1 text-xs font-bold text-gray-400">
				<SpriteIcon
					category="icons"
					value="ACHIEVEMENT_WIN"
					size={14}
					alt="Winner"
				/>
				Winner
			</p>
			<p class="text-lg font-bold" style="color: rgb(var(--color-bright));">
				{#if gameDetails.winner_civilization}
					{#if gameDetails.winner_name}
						<!-- Prefer the save's in-game leader name. Only when it's
						     empty (Old World writes "" for solo saves whose player
						     never set a custom name) do we fall back to the
						     uploader's account name, and only if they won. -->
						{gameDetails.winner_name} ({nationName(
							gameDetails.winner_civilization,
						)})
					{:else if userWon && userDisplayName}
						{userDisplayName} ({nationName(gameDetails.winner_civilization)})
					{:else}
						{nationName(gameDetails.winner_civilization)}
					{/if}
				{:else}
					-
				{/if}
			</p>
		</div>

		<!-- Victory Type -->
		<div
			class="rounded-lg p-3"
			style="background-color: rgb(var(--color-surface-raised));"
		>
			<p class="mb-1 flex items-center gap-1 text-xs font-bold text-gray-400">
				<SpriteIcon
					category="icons"
					value="VICTORY_NORMAL"
					size={14}
					alt="Victory Type"
				/>
				Victory Type
			</p>
			<p class="text-lg font-bold" style="color: rgb(var(--color-bright));">
				{#if gameDetails.winner_victory_type}
					{formatEnum(gameDetails.winner_victory_type, "VICTORY_")}
				{:else}
					-
				{/if}
			</p>
		</div>

		<!-- Map -->
		{#if gameDetails.map_class}
			<div
				class="rounded-lg p-3"
				style="background-color: rgb(var(--color-surface-raised));"
			>
				<p class="mb-1 flex items-center gap-1 text-xs font-bold text-gray-400">
					<SpriteIcon
						category="icons"
						value="MAP_OVERVIEW"
						size={14}
						alt="Map"
					/>
					Map
				</p>
				<p class="text-lg font-bold" style="color: rgb(var(--color-bright));">
					{mapScriptLabel(gameDetails.map_class)}
				</p>
			</div>
		{/if}

		<!-- Turns -->
		<div
			class="rounded-lg p-3"
			style="background-color: rgb(var(--color-surface-raised));"
		>
			<p class="mb-1 flex items-center gap-1 text-xs font-bold text-gray-400">
				<SpriteIcon category="icons" value="TURN" size={14} alt="Turns" />
				Turns
			</p>
			<p class="text-lg font-bold" style="color: rgb(var(--color-bright));">
				{gameDetails.total_turns}
			</p>
		</div>
	</div>
</div>

<!-- Tabs -->
<Tabs.Root bind:value={activeTab}>
	<!-- Tab Navigation -->
	<Tabs.List
		class="mb-4 flex w-fit flex-wrap items-center gap-1 rounded-lg border border-surface bg-surface-sunken p-2 shadow-lg"
	>
		<Tabs.Trigger value="overview" class={triggerClass}>Overview</Tabs.Trigger>

		<!-- Timeline tab hidden pending redesign
		<Tabs.Trigger value="timeline" class={triggerClass}>Timeline</Tabs.Trigger>
		-->

		<Tabs.Trigger value="events" class={triggerClass}>Events</Tabs.Trigger>

		{#if hasLeaders}
			<Tabs.Trigger value="leaders" class={triggerClass}>Leaders</Tabs.Trigger>
		{/if}

		<Tabs.Trigger value="laws" class={triggerClass}>Laws</Tabs.Trigger>

		<Tabs.Trigger value="techs" class={triggerClass}>Techs</Tabs.Trigger>

		<Tabs.Trigger value="orders" class={triggerClass}>Orders</Tabs.Trigger>

		<Tabs.Trigger value="economics" class={triggerClass}>Yields</Tabs.Trigger>

		<Tabs.Trigger value="military" class={triggerClass}>Military</Tabs.Trigger>

		<Tabs.Trigger value="cities" class={triggerClass}>Cities</Tabs.Trigger>

		<Tabs.Trigger value="economy" class={triggerClass}>Economy</Tabs.Trigger>

		<Tabs.Trigger value="wonders" class={triggerClass}>Wonders</Tabs.Trigger>

		<Tabs.Trigger value="families" class={triggerClass}>Families</Tabs.Trigger>

		<Tabs.Trigger value="specialists" class={triggerClass}>
			Specialists
		</Tabs.Trigger>

		<Tabs.Trigger value="map" class={triggerClass}>Map</Tabs.Trigger>

		<Tabs.Trigger value="settings" class={triggerClass}>Settings</Tabs.Trigger>
	</Tabs.List>

	<!-- Tab Content: Overview -->
	<Tabs.Content value="overview" class="tab-pane min-h-[400px]">
		<OverviewTab
			{gameDetails}
			players={resolvedPlayers}
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
		class="tab-pane min-h-[400px] rounded-lg p-8"
		style="background-color: rgb(var(--color-surface-raised));"
	>
		<TimelineTab
			{gameDetails}
			players={resolvedPlayers}
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
	<Tabs.Content value="events" class="tab-pane min-h-[400px]">
		<EventsTab
			{eventLogs}
			{playerHistory}
			players={resolvedPlayers}
			{victoryPointsEnabled}
			bind:chartFilter={chartFilters.points}
			bind:tableState={tables.events}
		/>
	</Tabs.Content>

	<!-- Tab Content: Leaders -->
	{#if hasLeaders}
		<Tabs.Content value="leaders" class="tab-pane min-h-[400px]">
			<LeadersTab
				{characters}
				{characterTraits}
				{playerGoals}
				{playerHistory}
				players={resolvedPlayers}
				{gameDetails}
				bind:legitimacyChartFilter={chartFilters.legitimacy}
			/>
		</Tabs.Content>
	{/if}

	<!-- Tab Content: Laws -->
	<Tabs.Content value="laws" class="tab-pane min-h-[400px]">
		<LawsTab
			players={resolvedPlayers}
			{lawAdoptionHistory}
			bind:chartFilter={chartFilters.laws}
			bind:tableState={tables.laws}
		/>
	</Tabs.Content>

	<!-- Tab Content: Techs -->
	<Tabs.Content value="techs" class="tab-pane min-h-[400px]">
		<TechsTab
			players={resolvedPlayers}
			{techDiscoveryHistory}
			{completedTechs}
			{allYields}
			{lawAdoptionHistory}
			{currentLaws}
			{improvementData}
			{cityStatistics}
			{families}
			{memoryData}
			{storyEvents}
			{characters}
			{gameReligions}
			gameOptions={gameDetails.game_options}
			{userNation}
			bind:chartFilter={chartFilters.techs}
		/>
	</Tabs.Content>

	<!-- Tab Content: Orders -->
	<Tabs.Content value="orders" class="tab-pane min-h-[400px]">
		<OrdersTab
			players={resolvedPlayers}
			{allYields}
			{playerHistory}
			{characters}
			{characterTraits}
			{currentLaws}
			{playerGoals}
			{storyEvents}
			bind:ordersChartFilter={chartFilters.orders}
			bind:legitimacyChartFilter={chartFilters.legitimacy}
		/>
	</Tabs.Content>

	<!-- Tab Content: Yields -->
	<Tabs.Content value="economics" class="tab-pane min-h-[400px]">
		<YieldsTab {allYields} bind:chartFilters />
	</Tabs.Content>

	<!-- Tab Content: Military -->
	<Tabs.Content value="military" class="tab-pane min-h-[400px]">
		<MilitaryTab
			players={resolvedPlayers}
			{playerHistory}
			{unitsProduced}
			{units}
			{characters}
			{lawAdoptionHistory}
			{techDiscoveryHistory}
			{userNation}
			bind:chartFilter={chartFilters.military}
			bind:tableState={tables.units}
		/>
	</Tabs.Content>

	<!-- Tab Content: Cities -->
	<Tabs.Content value="cities" class="tab-pane min-h-[400px]">
		<CitiesTab
			{cityStatistics}
			{playerNations}
			bind:tableState={tables.cities}
			bind:cityVisibleColumns
		/>
	</Tabs.Content>

	<!-- Tab Content: Economy -->
	<Tabs.Content value="economy" class="tab-pane min-h-[400px]">
		<EconomyTab
			players={resolvedPlayers}
			{improvementData}
			{allYields}
			{yieldPrices}
			{eventLogs}
			{playerResources}
			{projectsProduced}
			{cityStatistics}
			{playerWonders}
			{unitsProduced}
			{units}
			{tileOwnershipHistory}
			totalTurns={gameDetails.total_turns}
			{userNation}
			bind:tableState={tables.improvements}
		/>
	</Tabs.Content>

	<!-- Tab Content: Wonders -->
	<Tabs.Content value="wonders" class="tab-pane min-h-[400px]">
		<WondersTab
			players={resolvedPlayers}
			{playerWonders}
			disabledImprovements={gameDetails.disabled_improvements}
		/>
	</Tabs.Content>

	<!-- Tab Content: Families -->
	<Tabs.Content value="families" class="tab-pane min-h-[400px]">
		<FamiliesTab
			players={resolvedPlayers}
			{improvementData}
			{cityStatistics}
			{families}
			{familyOpinionHistory}
			{units}
			totalTurns={gameDetails.total_turns}
			{userNation}
		/>
	</Tabs.Content>

	<!-- Tab Content: Specialists -->
	<Tabs.Content value="specialists" class="tab-pane min-h-[400px]">
		<SpecialistsTab
			players={resolvedPlayers}
			{improvementData}
			{userNation}
			bind:tableState={tables.specialists}
		/>
	</Tabs.Content>

	<!-- Tab Content: Map -->
	<Tabs.Content
		value="map"
		class="tab-pane min-h-[400px] rounded-lg bg-blue-gray p-4"
	>
		<MapTab
			{mapTiles}
			cities={cityStatistics.cities}
			{playerNations}
			totalTurns={gameDetails.total_turns}
			selectedTurn={selectedMapTurn}
			onTurnChange={onMapTurnChange}
			missingMessage={mapMissingMessage}
		/>
	</Tabs.Content>

	<!-- Tab Content: Settings -->
	<Tabs.Content value="settings" class="tab-pane min-h-[400px]">
		<SettingsTab
			{gameDetails}
			players={resolvedPlayers}
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
