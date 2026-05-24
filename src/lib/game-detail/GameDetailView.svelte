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
		displayName = null,
		isOwner = false,
		onRename = null,
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
		// cloud detail endpoint. The Worker's COALESCE fallback (first human
		// player's nation) means this is virtually always set for cloud
		// games; nullable only for legacy callers (the frozen web/ viewer)
		// that don't pass the prop.
		userNation?: string | null;
		// Uploader's Discord display_name + their user_won flag, both from
		// the games row + users JOIN. Together they let the winner card and
		// the uploader's nation card show the user's identity ("becked")
		// when the save's leader-name field is empty — Old World writes ""
		// for solo games whose player never set a custom leader name. Both
		// are optional/null for legacy callers and observer-mode uploads.
		userDisplayName?: string | null;
		userWon?: boolean | null;
		// Owner-set rename for the save's title. When non-null/non-empty,
		// formatGameTitle uses it verbatim; otherwise falls through to the
		// save's original game_name and ultimately the nation/turns
		// derivation. Null for legacy callers (frozen web/ viewer).
		displayName?: string | null;
		// True when the signed-in viewer owns this game. Drives the H1
		// pencil-to-edit affordance. False for anonymous + non-owner readers,
		// and defaults false for legacy callers.
		isOwner?: boolean;
		// Page-supplied async hook that performs the actual rename and
		// triggers a data refresh (typically `cloudApi.renameGame` +
		// `invalidateAll`). Keeps GameDetailView free of an api-cloud
		// import so the legacy web/ viewer (which symlinks this component
		// but doesn't ship api-cloud) keeps building. Null = no rename UI.
		// eslint-disable-next-line no-unused-vars -- Callback type signature
		onRename?: ((value: string | null) => Promise<void>) | null;
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
	// Source of truth is the userNation prop, which the cloud Worker fills
	// in via COALESCE(g.user_nation, first-human-player.nation) — see
	// cloud/src/games.ts listGames / getGame / public-recent. The legacy
	// web/ share viewer doesn't supply userNation, so fall through to the
	// alphabetical-first-human heuristic (correct for single-human saves,
	// which is the only shape the frozen viewer ever sees).
	const humanNation = $derived(
		userNation ?? gameDetails.players.find((p) => p.is_human)?.nation ?? null,
	);

	const gameTitle = $derived(
		formatGameTitle({
			display_name: displayName,
			game_name: gameDetails.game_name,
			save_owner_nation: humanNation,
			total_turns: gameDetails.total_turns,
			match_id: gameDetails.match_id,
		}),
	);

	// ─── Rename affordance ────────────────────────────────────────────
	// `editing` is the inline-input toggle for owners; `editValue` mirrors
	// what's in the input. Submission/cancellation reset both. `renameError`
	// is shown inline below the input when onRename throws.
	let editing = $state(false);
	let editValue = $state("");
	let renameError = $state<string | null>(null);
	let renameBusy = $state(false);

	function startEditing() {
		editValue = displayName ?? gameDetails.game_name ?? "";
		renameError = null;
		editing = true;
	}

	function cancelEditing() {
		editing = false;
		editValue = "";
		renameError = null;
	}

	async function submitRename() {
		if (!onRename || renameBusy) return;
		const trimmed = editValue.trim();
		// Empty input clears the rename (null → fall back to original
		// game_name / nation+turns derivation).
		const value: string | null = trimmed === "" ? null : trimmed;
		renameError = null;
		renameBusy = true;
		try {
			await onRename(value);
			editing = false;
			editValue = "";
		} catch (err) {
			renameError =
				err instanceof Error && err.message ? err.message : "Failed to rename";
		} finally {
			renameBusy = false;
		}
	}

	async function resetRename() {
		if (!onRename || renameBusy) return;
		renameError = null;
		renameBusy = true;
		try {
			await onRename(null);
			editing = false;
			editValue = "";
		} catch (err) {
			renameError =
				err instanceof Error && err.message ? err.message : "Failed to reset";
		} finally {
			renameBusy = false;
		}
	}

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
	// (active = #35302B, inactive = #2a2622) inside a floating tray.
	const triggerClass =
		"cursor-pointer rounded px-3 py-1.5 text-sm font-bold text-tan transition-colors hover:bg-tan-hover data-[state=active]:bg-[#35302B] data-[state=inactive]:bg-[#2a2622]";
</script>

<!-- Header -->
<div class="mb-4 flex items-baseline justify-between gap-4">
	{#if editing && onRename}
		<!-- Inline edit mode: input + Save / Cancel / Reset buttons. Empty
		     input on Save clears the rename (same semantics as the sidebar
		     Rename… affordance). -->
		<div class="flex min-w-0 flex-1 flex-col gap-1">
			<div class="flex items-center gap-2">
				<!-- svelte-ignore a11y_autofocus -->
				<input
					type="text"
					bind:value={editValue}
					maxlength={120}
					placeholder="Save title"
					autofocus
					disabled={renameBusy}
					class="min-w-0 flex-1 rounded border border-[#4a433b] bg-[#35302b] px-2 py-1 text-2xl font-bold text-gray-200 focus:border-[#7a6f60] focus:outline-none"
					onkeydown={(e) => {
						if (e.key === "Enter") submitRename();
						if (e.key === "Escape") cancelEditing();
					}}
				/>
				<button
					type="button"
					class="cursor-pointer rounded bg-[#ab9978] px-3 py-1 text-sm font-bold text-black transition-colors hover:bg-[#9a8a6c] disabled:opacity-50"
					onclick={submitRename}
					disabled={renameBusy}
				>
					Save
				</button>
				<button
					type="button"
					class="cursor-pointer rounded bg-[#35302b] px-3 py-1 text-sm text-tan transition-colors hover:bg-[#453e37] disabled:opacity-50"
					onclick={cancelEditing}
					disabled={renameBusy}
				>
					Cancel
				</button>
				{#if displayName != null && displayName.trim() !== ""}
					<button
						type="button"
						class="cursor-pointer rounded border border-[#4a433b] px-3 py-1 text-sm text-tan transition-colors hover:bg-[#35302b] disabled:opacity-50"
						onclick={resetRename}
						disabled={renameBusy}
						title="Clear the rename and fall back to the save's original title"
					>
						Reset
					</button>
				{/if}
			</div>
			{#if renameError}
				<p class="text-xs text-orange">{renameError}</p>
			{/if}
		</div>
	{:else}
		<h1
			class="flex min-w-0 items-baseline gap-2 text-3xl font-bold text-gray-200"
		>
			<span class="truncate">{gameTitle}</span>
			{#if isOwner && onRename}
				<!-- Pencil affordance: opens the inline editor. Only rendered
				     for the signed-in owner; anonymous and non-owner viewers
				     see the static title. -->
				<button
					type="button"
					class="shrink-0 cursor-pointer rounded p-1 text-base text-tan opacity-60 transition hover:bg-[#35302b] hover:opacity-100"
					onclick={startEditing}
					title="Rename this save"
					aria-label="Rename this save"
				>
					<!-- Inline SVG pencil; no external sprite dep. -->
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 20 20"
						fill="currentColor"
						class="h-4 w-4"
					>
						<path
							d="M13.586 3.586a2 2 0 1 1 2.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793 4 13.172V16h2.828l7.379-7.379-2.828-2.828z"
						/>
					</svg>
				</button>
			{/if}
		</h1>
	{/if}
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
	<Tabs.List
		class="mb-4 flex w-fit flex-wrap items-center gap-1 rounded-lg border border-[#2a2622] bg-[#241f1b] p-2 shadow-lg"
	>
		<Tabs.Trigger value="overview" class={triggerClass}>Overview</Tabs.Trigger>

		<!-- Timeline tab hidden pending redesign
		<Tabs.Trigger value="timeline" class={triggerClass}>Timeline</Tabs.Trigger>
		-->

		<Tabs.Trigger value="events" class={triggerClass}>Events</Tabs.Trigger>

		<Tabs.Trigger value="laws" class={triggerClass}>Laws</Tabs.Trigger>

		<Tabs.Trigger value="techs" class={triggerClass}>Techs</Tabs.Trigger>

		<Tabs.Trigger value="economics" class={triggerClass}>Yields</Tabs.Trigger>

		<Tabs.Trigger value="military" class={triggerClass}>Military</Tabs.Trigger>

		<Tabs.Trigger value="cities" class={triggerClass}>Cities</Tabs.Trigger>

		<Tabs.Trigger value="improvements" class={triggerClass}>
			Improvements
		</Tabs.Trigger>

		<Tabs.Trigger value="map" class={triggerClass}>Map</Tabs.Trigger>

		<Tabs.Trigger value="settings" class={triggerClass}>Settings</Tabs.Trigger>
	</Tabs.List>

	<!-- Tab Content: Overview -->
	<Tabs.Content value="overview" class="tab-pane min-h-[400px]">
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
		class="tab-pane min-h-[400px] rounded-lg p-8"
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
	<Tabs.Content value="events" class="tab-pane min-h-[400px]">
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
	<Tabs.Content value="laws" class="tab-pane min-h-[400px]">
		<LawsTab
			{lawAdoptionHistory}
			{currentLaws}
			bind:chartFilter={chartFilters.laws}
			bind:tableState={tables.laws}
		/>
	</Tabs.Content>

	<!-- Tab Content: Techs -->
	<Tabs.Content value="techs" class="tab-pane min-h-[400px]">
		<TechsTab
			{techDiscoveryHistory}
			{completedTechs}
			bind:chartFilter={chartFilters.techs}
			bind:tableState={tables.techs}
		/>
	</Tabs.Content>

	<!-- Tab Content: Yields -->
	<Tabs.Content value="economics" class="tab-pane min-h-[400px]">
		<YieldsTab {allYields} bind:chartFilters />
	</Tabs.Content>

	<!-- Tab Content: Military -->
	<Tabs.Content value="military" class="tab-pane min-h-[400px]">
		<MilitaryTab
			{gameDetails}
			{playerHistory}
			{unitsProduced}
			bind:chartFilter={chartFilters.military}
			bind:tableState={tables.units}
		/>
	</Tabs.Content>

	<!-- Tab Content: Cities -->
	<Tabs.Content value="cities" class="tab-pane min-h-[400px]">
		<CitiesTab
			{cityStatistics}
			bind:tableState={tables.cities}
			bind:cityVisibleColumns
		/>
	</Tabs.Content>

	<!-- Tab Content: Improvements -->
	<Tabs.Content value="improvements" class="tab-pane min-h-[400px]">
		<ImprovementsTab {improvementData} bind:tableState={tables.improvements} />
	</Tabs.Content>

	<!-- Tab Content: Map -->
	<Tabs.Content
		value="map"
		class="tab-pane min-h-[400px] rounded-lg bg-blue-gray p-4"
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
	<Tabs.Content value="settings" class="tab-pane min-h-[400px]">
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
