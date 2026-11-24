<script lang="ts">
	import type { cloudApi } from "$lib/api-cloud";
	import { Tabs } from "bits-ui";
	import { formatEnum, nationName } from "$lib/utils/formatting";
	import { mapScriptLabel } from "$lib/map-settings";
	import { winningSeats } from "$lib/winning-team";
	import SpriteIcon from "./SpriteIcon.svelte";
	import GameTab from "./GameTab.svelte";
	import {
		GameTabState,
		gameTabs,
		resolveTabId,
		setGameTabState,
	} from "./game-tabs.svelte";

	let { game }: { game: Awaited<ReturnType<typeof cloudApi.getGame>> } =
		$props();

	const gameDetails = $derived(game.game_details);
	const tabs = $derived(gameTabs(game));

	// ─── Persistent UI state ──────────────────────────────────────────
	setGameTabState(new GameTabState(() => game));

	let activeTab = $state<string>("overview");

	// Deep-link the active tab via the URL hash (#military), so a reload or a
	// shared link restores the tab instead of falling back to Overview. The
	// hash isn't sent to the server, so SSR renders Overview and the client
	// switches on mount (one frame); a clean, non-history-polluting replaceState
	// keeps the URL in sync as the user changes tabs.
	$effect(() => {
		const fromHash = window.location.hash.replace(/^#/, "");
		if (fromHash) activeTab = resolveTabId(fromHash);
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

	// ─── Derived display values ───────────────────────────────────────
	// Source of truth is the games row's user_nation, which the cloud Worker
	// fills in via COALESCE(g.user_nation, first-human-player.nation) — see
	// cloud/src/games.ts listGames / getGame / public-recent. Falls through to
	// the alphabetical-first-human heuristic when absent.
	const humanNation = $derived(
		game.user_nation ??
			gameDetails.players.find((p) => p.is_human)?.nation ??
			null,
	);

	// Uploader's Discord display_name + their user_won flag, both from the
	// games row + users JOIN. Together they let the winner card show the
	// user's identity ("becked") when the save's leader-name field is empty —
	// Old World writes "" for solo games whose player never set a custom
	// leader name. Both are null for observer-mode uploads.
	const userDisplayName = $derived(game.user_display_name ?? null);
	const userWon = $derived(game.user_won ?? null);

	// The Winner card's text. A win is per team in Old World, so a team game
	// names every seat on the winning team — "Ezana (Aksum) + Hammurabi
	// (Babylonia)" — rather than the one seat the blob resolved it to (#384).
	// The single-seat wording below is unchanged; `games.winner_name` /
	// `winner_nation` stay single-valued and keep naming that seat.
	const winnerLabel = $derived.by(() => {
		const seats = winningSeats(game.match_metadata.winner, game.player_roster);
		if (seats.size > 1) {
			const label = [...seats]
				.map((id) => {
					const p = gameDetails.players.find((x) => x.player_id === id);
					const nation = p?.nation ? nationName(p.nation) : null;
					// The uploader's own seat falls back to their account name
					// when the save wrote no leader name, as the single-seat
					// form below and OverviewTab's nation cards do.
					const name =
						p?.player_name ||
						(id === game.uploader_player_index ? userDisplayName : null);
					if (name && nation) return `${name} (${nation})`;
					return nation ?? name ?? null;
				})
				.filter((part) => part !== null)
				.join(" + ");
			if (label) return label;
		}
		if (!gameDetails.winner_civilization) return "-";
		const nation = nationName(gameDetails.winner_civilization);
		// Prefer the save's in-game leader name. Only when it's empty (Old
		// World writes "" for solo saves whose player never set a custom name)
		// do we fall back to the uploader's account name, and only if they won.
		if (gameDetails.winner_name)
			return `${gameDetails.winner_name} (${nation})`;
		if (userWon && userDisplayName) return `${userDisplayName} (${nation})`;
		return nation;
	});

	// Tab triggers styled as chip-bar pills, matching the aggregate-stats
	// subtabs (src/lib/stats/StatsView.svelte): borderless, fill-based state
	// (active = surface-raised, inactive = surface) inside a floating tray.
	const triggerClass =
		"cursor-pointer rounded px-3 py-1.5 text-sm font-bold text-tan transition-colors hover:bg-tan-hover data-[state=active]:bg-surface-raised data-[state=inactive]:bg-surface";
</script>

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
				{winnerLabel}
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
		{#each tabs as tab (tab.id)}
			<Tabs.Trigger value={tab.id} class={triggerClass}
				>{tab.label}</Tabs.Trigger
			>
		{/each}
	</Tabs.List>

	{#each tabs as tab (tab.id)}
		<Tabs.Content value={tab.id} class="tab-pane min-h-[400px]">
			<GameTab {game} tab={tab.id} />
		</Tabs.Content>
	{/each}
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
