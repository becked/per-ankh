<script lang="ts">
	// One tab of a game's analysis, rendered from the whole game by the tab's id
	// (game-tabs holds the list). Both views of a game render their tabs through
	// it — the analyst view's tab panes and the map view's lightboxes — so a tab
	// needs nothing its host computes. What the tabs bind (chart selections,
	// table sorts) belongs to the host, which provides it via context (see
	// GameTabState), so it outlives the tab.
	import type { cloudApi } from "$lib/api-cloud";
	import { formatEnum } from "$lib/utils/formatting";
	import { hasVictoryPoints, resolveGamePlayers } from "./helpers";
	import { getGameTabState, type GameTabId } from "./game-tabs.svelte";
	import OverviewTab from "./OverviewTab.svelte";
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
	import SettingsTab from "./SettingsTab.svelte";

	let {
		game,
		tab,
		openAtYield = null,
	}: {
		game: Awaited<ReturnType<typeof cloudApi.getGame>>;
		tab: GameTabId;
		// Which yield the Yields tab opens at, for a host that opened the tab
		// from one — the map view's yield strip. The analyst view, whose tabs
		// are opened by name alone, leaves it null.
		openAtYield?: string | null;
	} = $props();

	const tabState = getGameTabState();

	// Fields the Worker's blob schema doesn't require (cloud/src/schemas/game.ts).
	// A blob parsed before a field existed doesn't carry it, so each defaults to
	// [] and the tabs it feeds hide or trim what it would have shown.
	const units = $derived(game.units ?? []);
	const techChoices = $derived(game.tech_choices ?? []);
	const characters = $derived(game.characters ?? []);
	const characterTraits = $derived(game.character_traits ?? []);
	const playerGoals = $derived(game.player_goals ?? []);
	const families = $derived(game.families ?? []);
	const memoryData = $derived(game.memory_data ?? []);
	const storyEvents = $derived(game.story_events ?? []);
	const yieldPrices = $derived(game.yield_price_history ?? []);
	const playerResources = $derived(game.player_resources ?? []);
	const familyOpinionHistory = $derived(game.family_opinion_history ?? []);
	const projectsProduced = $derived(game.projects_produced ?? []);

	// The uploader's picked nation and Discord display name, from the games
	// row. The Worker's COALESCE fallback (first human player's nation) means
	// the nation is virtually always set; the name is null for observer-mode
	// uploads.
	const userNation = $derived(game.user_nation ?? null);
	const userDisplayName = $derived(game.user_display_name ?? null);

	// Per-player iteration source: roster players enriched with a stable
	// playerId + unique label + color. Mirror-match safe (nation alone isn't).
	const resolvedPlayers = $derived(resolveGamePlayers(game));

	const victoryConditions = $derived(
		game.game_details.victory_conditions
			?.split("+")
			.map((v) => formatEnum(v, "VICTORY_"))
			.join(", ") ?? "Unknown",
	);

	const victoryPointsEnabled = $derived(hasVictoryPoints(game.game_details));

	const dlcList = $derived(
		game.game_details.enabled_dlc
			?.split("+")
			.map((dlc) => formatEnum(dlc, "DLC_"))
			.join(", ") ?? "None",
	);

	const modsList = $derived(
		game.game_details.enabled_mods?.split("+").join(", ") ?? "None",
	);
</script>

{#if tab === "overview"}
	<OverviewTab
		gameDetails={game.game_details}
		eventLogs={game.event_logs}
		players={resolvedPlayers}
		playerHistory={game.player_history}
		allYields={game.yield_history}
		completedTechs={game.completed_techs}
		currentLaws={game.current_laws}
		unitsProduced={game.units_produced}
		cityStatistics={game.city_statistics}
		{victoryPointsEnabled}
		improvementData={game.improvement_data}
		gameReligions={game.game_religions}
		playerWonders={game.player_wonders}
		{userNation}
		{userDisplayName}
	/>

	<!-- Timeline tab hidden pending redesign
{:else if tab === "timeline"}
	<TimelineTab
		gameDetails={game.game_details}
		players={resolvedPlayers}
		techDiscoveryHistory={game.tech_discovery_history}
		lawAdoptionHistory={game.law_adoption_history}
		cityStatistics={game.city_statistics}
		eventLogs={game.event_logs}
		playerHistory={game.player_history}
		allYields={game.yield_history}
		playerWonders={game.player_wonders}
		gameReligions={game.game_religions}
		bind:categoryFilters={tabState.timelineFilters}
	/>
	-->
{:else if tab === "events"}
	<EventsTab
		eventLogs={game.event_logs}
		playerHistory={game.player_history}
		players={resolvedPlayers}
		{victoryPointsEnabled}
		bind:chartFilter={tabState.chartFilters.points}
		bind:tableState={tabState.tables.events}
	/>
{:else if tab === "leaders"}
	<LeadersTab
		{characters}
		{characterTraits}
		{playerGoals}
		playerHistory={game.player_history}
		players={resolvedPlayers}
		gameDetails={game.game_details}
		bind:legitimacyChartFilter={tabState.chartFilters.legitimacy}
	/>
{:else if tab === "laws"}
	<LawsTab
		players={resolvedPlayers}
		lawAdoptionHistory={game.law_adoption_history}
		bind:chartFilter={tabState.chartFilters.laws}
		bind:tableState={tabState.tables.laws}
	/>
{:else if tab === "techs"}
	<!-- The final turn's tiles, always: the science breakdown decomposes the
	     end state (#269). -->
	<TechsTab
		players={resolvedPlayers}
		techDiscoveryHistory={game.tech_discovery_history}
		completedTechs={game.completed_techs}
		allYields={game.yield_history}
		lawAdoptionHistory={game.law_adoption_history}
		currentLaws={game.current_laws}
		improvementData={game.improvement_data}
		cityStatistics={game.city_statistics}
		{techChoices}
		mapTiles={game.map_tiles}
		{families}
		{memoryData}
		{storyEvents}
		{characters}
		{characterTraits}
		gameReligions={game.game_religions}
		gameOptions={game.game_details.game_options}
		{userNation}
		bind:chartFilter={tabState.chartFilters.techs}
	/>
{:else if tab === "orders"}
	<OrdersTab
		players={resolvedPlayers}
		allYields={game.yield_history}
		playerHistory={game.player_history}
		{characters}
		{characterTraits}
		currentLaws={game.current_laws}
		{playerGoals}
		{storyEvents}
		bind:ordersChartFilter={tabState.chartFilters.orders}
		bind:legitimacyChartFilter={tabState.chartFilters.legitimacy}
	/>
{:else if tab === "economics"}
	<YieldsTab
		allYields={game.yield_history}
		{openAtYield}
		bind:chartFilters={tabState.chartFilters}
	/>
{:else if tab === "military"}
	<MilitaryTab
		players={resolvedPlayers}
		playerHistory={game.player_history}
		unitsProduced={game.units_produced}
		{units}
		{characters}
		lawAdoptionHistory={game.law_adoption_history}
		techDiscoveryHistory={game.tech_discovery_history}
		{userNation}
		bind:chartFilter={tabState.chartFilters.military}
		bind:tableState={tabState.tables.units}
	/>
{:else if tab === "cities"}
	<CitiesTab
		cityStatistics={game.city_statistics}
		playerNations={game.player_nations}
		bind:tableState={tabState.tables.cities}
		bind:cityVisibleColumns={tabState.cityVisibleColumns}
	/>
{:else if tab === "economy"}
	<EconomyTab
		players={resolvedPlayers}
		improvementData={game.improvement_data}
		allYields={game.yield_history}
		{yieldPrices}
		eventLogs={game.event_logs}
		{playerResources}
		{projectsProduced}
		cityStatistics={game.city_statistics}
		playerWonders={game.player_wonders}
		unitsProduced={game.units_produced}
		{units}
		tileOwnershipHistory={game.tile_ownership_history}
		totalTurns={game.game_details.total_turns}
		{userNation}
		bind:tableState={tabState.tables.improvements}
	/>
{:else if tab === "wonders"}
	<WondersTab
		players={resolvedPlayers}
		playerWonders={game.player_wonders}
		disabledImprovements={game.game_details.disabled_improvements}
	/>
{:else if tab === "families"}
	<FamiliesTab
		players={resolvedPlayers}
		improvementData={game.improvement_data}
		cityStatistics={game.city_statistics}
		{families}
		{familyOpinionHistory}
		{units}
		totalTurns={game.game_details.total_turns}
		{userNation}
	/>
{:else if tab === "specialists"}
	<SpecialistsTab
		players={resolvedPlayers}
		improvementData={game.improvement_data}
		{userNation}
		bind:tableState={tabState.tables.specialists}
	/>
{:else if tab === "settings"}
	<SettingsTab
		gameDetails={game.game_details}
		players={resolvedPlayers}
		{victoryConditions}
		{dlcList}
		{modsList}
	/>
{/if}
