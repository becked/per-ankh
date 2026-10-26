<script lang="ts">
	// One tab of a game's analysis, rendered from the whole game by the tab's id
	// (game-tabs holds the list). Both views of a game render their tabs through
	// it — the analyst view's tab panes and the map view's lightboxes — so a tab
	// needs nothing its host computes. What the tabs bind (chart selections,
	// table sorts) belongs to the host, which provides it via context (see
	// GameTabState), so it outlives the tab.
	import type { cloudApi } from "$lib/api-cloud";
	import ChunkFallback from "$lib/ui/ChunkFallback.svelte";
	import { leadPlayerId, resolveGamePlayers, uploaderPlayer } from "./helpers";
	import { hasVictoryPoints } from "./victory-points";
	import { getGameTabState, type GameTabId } from "./game-tabs.svelte";
	import { LAZY_TABS, lazyTab } from "./tab-components.svelte";
	import OverviewTab from "./OverviewTab.svelte";
	// eslint-disable-next-line no-unused-vars -- TimelineTab pending redesign, see commented block below
	import TimelineTab from "./TimelineTab.svelte";

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

	// The rest of the tabs arrive as their own chunks (tab-components), so each
	// is undefined until the one being rendered has loaded — the `&&` in every
	// branch below. Reading them one tab at a time, rather than through a single
	// shared component type, is what keeps each branch's props type-checked.
	const EventsTab = $derived(LAZY_TABS.events.value);
	const LeadersTab = $derived(LAZY_TABS.leaders.value);
	const LawsTab = $derived(LAZY_TABS.laws.value);
	const TechsTab = $derived(LAZY_TABS.techs.value);
	const OrdersTab = $derived(LAZY_TABS.orders.value);
	const YieldsTab = $derived(LAZY_TABS.economics.value);
	const MilitaryTab = $derived(LAZY_TABS.military.value);
	const CitiesTab = $derived(LAZY_TABS.cities.value);
	const EconomyTab = $derived(LAZY_TABS.economy.value);
	const WondersTab = $derived(LAZY_TABS.wonders.value);
	const FamiliesTab = $derived(LAZY_TABS.families.value);
	const SpecialistsTab = $derived(LAZY_TABS.specialists.value);
	const SettingsTab = $derived(LAZY_TABS.settings.value);

	// Fetch the open tab's chunk. In an effect rather than at render so SSR,
	// which only ever renders Overview, starts no download of its own.
	const slot = $derived(lazyTab(tab));
	$effect(() => {
		slot?.start();
	});

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

	// The uploader's Discord display name, from the games row. Null for
	// observer-mode uploads.
	const userDisplayName = $derived(game.user_display_name ?? null);

	// Per-player iteration source: roster players enriched with a stable
	// playerId + unique label + color. Mirror-match safe (nation alone isn't).
	const resolvedPlayers = $derived(resolveGamePlayers(game));

	// The uploader's seat, resolved once for every tab that leads with it.
	// `uploader_player_index` is the seat they claimed (null = observer upload),
	// `uploader_nation` the raw pick beside it. Not `user_nation`, which the
	// Worker COALESCEs to the first human for display and so never reads as
	// "nobody claimed a seat".
	const uploaderPlayerId = $derived(
		uploaderPlayer(
			resolvedPlayers,
			game.uploader_player_index ?? null,
			game.uploader_nation ?? null,
		)?.playerId ?? null,
	);

	// The seat the file was written from, which carries the lead when the
	// upload claimed none. Only blobs at PARSER_VERSION 2.27.0+ record it —
	// `leadPlayerId` falls through to the lowest human seat for the rest.
	const saveOwnerPlayerId = $derived(
		game.player_roster.find((p) => p.is_save_owner)?.player_index ?? null,
	);

	// The one seat every per-player surface leads with, resolved once here
	// rather than per tab so all of them agree.
	const leadId = $derived(
		leadPlayerId(resolvedPlayers, uploaderPlayerId, saveOwnerPlayerId),
	);

	const victoryPointsEnabled = $derived(
		hasVictoryPoints(game.game_details.victory_conditions),
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
		mapTiles={game.map_tiles}
		parserVersion={game.parser_version}
		{victoryPointsEnabled}
		improvementData={game.improvement_data}
		gameReligions={game.game_religions}
		playerWonders={game.player_wonders}
		leadPlayerId={leadId}
		{uploaderPlayerId}
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
{:else if tab === "events" && EventsTab}
	<EventsTab
		eventLogs={game.event_logs}
		playerHistory={game.player_history}
		players={resolvedPlayers}
		{victoryPointsEnabled}
		bind:chartFilter={tabState.chartFilters.points}
		bind:tableState={tabState.tables.events}
	/>
{:else if tab === "leaders" && LeadersTab}
	<LeadersTab
		{characters}
		{characterTraits}
		{playerGoals}
		playerHistory={game.player_history}
		players={resolvedPlayers}
		gameDetails={game.game_details}
		bind:legitimacyChartFilter={tabState.chartFilters.legitimacy}
	/>
{:else if tab === "laws" && LawsTab}
	<LawsTab
		players={resolvedPlayers}
		lawAdoptionHistory={game.law_adoption_history}
		bind:chartFilter={tabState.chartFilters.laws}
		bind:tableState={tabState.tables.laws}
	/>
{:else if tab === "techs" && TechsTab}
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
		leadPlayerId={leadId}
		bind:chartFilter={tabState.chartFilters.techs}
	/>
{:else if tab === "orders" && OrdersTab}
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
{:else if tab === "economics" && YieldsTab}
	<YieldsTab
		allYields={game.yield_history}
		{openAtYield}
		bind:chartFilters={tabState.chartFilters}
	/>
{:else if tab === "military" && MilitaryTab}
	<MilitaryTab
		players={resolvedPlayers}
		playerHistory={game.player_history}
		unitsProduced={game.units_produced}
		{units}
		{characters}
		lawAdoptionHistory={game.law_adoption_history}
		techDiscoveryHistory={game.tech_discovery_history}
		leadPlayerId={leadId}
		bind:chartFilter={tabState.chartFilters.military}
		bind:tableState={tabState.tables.units}
	/>
{:else if tab === "cities" && CitiesTab}
	<CitiesTab
		cityStatistics={game.city_statistics}
		playerNations={game.player_nations}
		bind:tableState={tabState.tables.cities}
		bind:cityVisibleColumns={tabState.cityVisibleColumns}
	/>
{:else if tab === "economy" && EconomyTab}
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
		leadPlayerId={leadId}
		bind:tableState={tabState.tables.improvements}
	/>
{:else if tab === "wonders" && WondersTab}
	<WondersTab
		players={resolvedPlayers}
		playerWonders={game.player_wonders}
		disabledImprovements={game.game_details.disabled_improvements}
	/>
{:else if tab === "families" && FamiliesTab}
	<FamiliesTab
		players={resolvedPlayers}
		improvementData={game.improvement_data}
		cityStatistics={game.city_statistics}
		{families}
		{familyOpinionHistory}
		{units}
		totalTurns={game.game_details.total_turns}
		leadPlayerId={leadId}
	/>
{:else if tab === "specialists" && SpecialistsTab}
	<SpecialistsTab
		players={resolvedPlayers}
		improvementData={game.improvement_data}
		leadPlayerId={leadId}
		bind:tableState={tabState.tables.specialists}
	/>
{:else if tab === "settings" && SettingsTab}
	<SettingsTab
		gameDetails={game.game_details}
		players={resolvedPlayers}
		{characters}
		gameVersion={game.match_metadata.game_version}
	/>
{:else}
	<!-- A real tab whose chunk hasn't arrived. `tab` is a GameTabId, so the
	     only way here is a fetch still in flight or a failed one. The analyst
	     view's pane is already floored at 400px (GameDetailView) and the map
	     view's lightbox fills its dialog, so nothing here moves what follows. -->
	<div class="flex min-h-[200px] items-center justify-center">
		<ChunkFallback
			failed={slot?.failed ?? false}
			message="This tab didn't load."
		/>
	</div>
{/if}
