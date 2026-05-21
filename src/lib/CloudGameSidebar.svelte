<script lang="ts">
	// Sidebar listing the user's games (loaded by /dashboard/+page.ts).
	//   - Filter state (collection, search, nation, date) lives in the URL
	//     search params; the load() function passes the first page in via
	//     `initialGames` + `total`. Switching filters re-runs load() via
	//     goto(), which resets `accumulated` from the new initialGames.
	//   - Pagination is server-side with infinite scroll: an
	//     IntersectionObserver on a sentinel below the list triggers
	//     `loadMore()` to fetch the next page until accumulated.length === total.

	import { goto, invalidateAll } from "$app/navigation";
	import { page } from "$app/state";
	import { resolve } from "$app/paths";
	import {
		cloudApi,
		ApiError,
		type CollectionInfo,
		type GameListItem,
	} from "$lib/api-cloud";
	import { autohideScroll } from "$lib/actions/autohideScroll";
	import {
		sidebarWidth,
		setSidebarWidth,
		MIN_WIDTH,
		MAX_WIDTH,
	} from "$lib/stores/sidebarWidth";
	import {
		formatGameTitle,
		formatDate,
		formatEnum,
	} from "$lib/utils/formatting";

	interface Props {
		initialGames: GameListItem[];
		total: number;
		pageSize: number;
		collections: CollectionInfo[];
		publicCount: number;
		currentGameId: string | null;
		// Resolved active filter from the dashboard load(). "all" hides the
		// public/collection filter; "public" surfaces the user's public set;
		// a number selects a specific collection_id.
		activeFilter: "all" | "public" | number;
		// Cross-filter state from the dashboard charts (sourced from URL).
		// Both narrow the visible list; combine when both are set. Sidebar
		// renders a chip per active filter and calls the matching clear
		// callback when the user dismisses.
		selectedNation?: string | null;
		selectedDate?: string | null;
		onClearNationFilter?: () => void;
		onClearDateFilter?: () => void;
	}

	let {
		initialGames,
		total,
		pageSize,
		collections,
		publicCount,
		currentGameId,
		activeFilter,
		selectedNation = null,
		selectedDate = null,
		onClearNationFilter,
		onClearDateFilter,
	}: Props = $props();

	let width = $derived($sidebarWidth);
	let dragging = $state(false);

	function startDrag(e: MouseEvent): void {
		e.preventDefault();
		dragging = true;
		// Keep the col-resize cursor when the mouse leaves the handle mid-drag.
		document.body.style.cursor = "col-resize";
		document.addEventListener("mousemove", onDrag);
		document.addEventListener("mouseup", endDrag, { once: true });
	}

	function onDrag(e: MouseEvent): void {
		setSidebarWidth(window.innerWidth - e.clientX);
	}

	function endDrag(): void {
		dragging = false;
		document.body.style.cursor = "";
		document.removeEventListener("mousemove", onDrag);
	}

	// Accumulated rows for infinite scroll. Resets whenever load() runs and
	// gives us a fresh `initialGames` (collection switch, search/nation/date
	// change). Tracked in a $effect that re-reads the prop on every change so
	// a same-length refetch (e.g. switching to a filter that happens to
	// return the same count) still resets the array.
	let accumulated = $state<GameListItem[]>([]);
	let loadingMore = $state(false);
	let loadAbort: AbortController | null = null;
	$effect(() => {
		const fresh = initialGames;
		if (loadAbort) loadAbort.abort();
		loadAbort = null;
		accumulated = fresh;
	});
	const hasMore = $derived(accumulated.length < total);

	// String form of activeFilter so it matches the (string) value attributes
	// on the <option>s. Numbers go through String() because <option value=N>
	// renders the attribute as a string in the DOM.
	const selectValue = $derived(
		activeFilter === "all" ? "all" : String(activeFilter),
	);

	// Context menu state.
	let contextMenu = $state<{ x: number; y: number; game: GameListItem } | null>(
		null,
	);
	let showNewCollectionInput = $state(false);
	let newCollectionName = $state("");
	let createError = $state<string | null>(null);
	// Rename affordance state — separate from the new-collection input so a
	// user can move-then-rename in one menu open without state crosstalk.
	let showRenameInput = $state(false);
	let renameValue = $state("");
	let renameError = $state<string | null>(null);

	async function handleFilterChange(e: Event) {
		const value = (e.target as HTMLSelectElement).value;
		const next = new URL(page.url);
		// "all" clears both filter modes. ?filter=public and ?collection_id=N
		// are mutually exclusive on the worker side, so clear the other.
		next.searchParams.delete("filter");
		next.searchParams.delete("collection_id");
		if (value === "public") next.searchParams.set("filter", "public");
		else if (value !== "all") next.searchParams.set("collection_id", value);
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- search-param-only update on the current route; URL objects are SvelteKit's documented dynamic-nav API
		await goto(next, { replaceState: true, keepFocus: true, noScroll: true });
	}

	async function loadMore() {
		if (loadingMore || !hasMore) return;
		loadingMore = true;
		if (loadAbort) loadAbort.abort();
		loadAbort = new AbortController();
		const signal = loadAbort.signal;
		// Read filters live from the URL so a fetch initiated near a
		// filter-change boundary uses the latest set (the prop-driven values
		// are a frame behind the URL during the goto → load() round-trip).
		const params = page.url.searchParams;
		const collectionIdRaw = params.get("collection_id");
		const collectionId =
			collectionIdRaw && /^\d+$/.test(collectionIdRaw)
				? Number(collectionIdRaw)
				: undefined;
		const filterParam =
			params.get("filter") === "public" ? "public" : undefined;
		try {
			const res = await cloudApi.listGames({
				limit: pageSize,
				offset: accumulated.length,
				collectionId,
				filter: filterParam,
				q: params.get("q") ?? undefined,
				nation: params.get("nation") ?? undefined,
				date: params.get("date") ?? undefined,
				signal,
			});
			if (signal.aborted) return;
			accumulated = [...accumulated, ...res.games];
		} catch (err) {
			if (err instanceof DOMException && err.name === "AbortError") return;
			if (err instanceof ApiError) {
				console.error("Failed to load more games:", err);
			} else {
				throw err;
			}
		} finally {
			if (!signal.aborted) loadingMore = false;
		}
	}

	let sentinel: HTMLDivElement | null = $state(null);
	$effect(() => {
		if (!sentinel) return;
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) void loadMore();
				}
			},
			{ rootMargin: "200px" },
		);
		observer.observe(sentinel);
		return () => observer.disconnect();
	});

	function handleContextMenu(e: MouseEvent, game: GameListItem) {
		e.preventDefault();
		e.stopPropagation();

		// Mirror desktop placement: menu appears to the left of the sidebar.
		const menuWidth = 180;
		const menuHeight = 250;
		const sidebarPx = width;

		let x = window.innerWidth - sidebarPx - menuWidth - 8;
		let y = e.clientY;

		if (y + menuHeight > window.innerHeight) {
			y = window.innerHeight - menuHeight - 8;
		}
		if (y < 8) y = 8;

		contextMenu = { x, y, game };
		showNewCollectionInput = false;
		newCollectionName = "";
		createError = null;
		showRenameInput = false;
		renameValue = "";
		renameError = null;
	}

	function closeContextMenu() {
		contextMenu = null;
		showNewCollectionInput = false;
		newCollectionName = "";
		createError = null;
		showRenameInput = false;
		renameValue = "";
		renameError = null;
	}

	async function moveToCollection(collectionId: number) {
		if (!contextMenu) return;
		try {
			await cloudApi.moveGameToCollection(
				contextMenu.game.game_id,
				collectionId,
			);
			await invalidateAll();
		} catch (err) {
			console.error("Failed to move game:", err);
		}
		closeContextMenu();
	}

	function openRenameInput() {
		if (!contextMenu) return;
		renameValue =
			contextMenu.game.display_name ?? contextMenu.game.game_name ?? "";
		renameError = null;
		showRenameInput = true;
	}

	async function submitRename() {
		if (!contextMenu) return;
		const trimmed = renameValue.trim();
		// Empty input = clear the rename (null to the worker). Matches the
		// "Reset to original" behavior on the H1 pencil affordance.
		const value: string | null = trimmed === "" ? null : trimmed;
		renameError = null;
		try {
			await cloudApi.renameGame(contextMenu.game.game_id, value);
			await invalidateAll();
			closeContextMenu();
		} catch (err) {
			if (err instanceof ApiError && err.status === 400) {
				renameError = err.message || "Invalid name";
				return;
			}
			console.error("Failed to rename game:", err);
			renameError = "Failed to rename";
		}
	}

	async function createAndMoveToCollection() {
		if (!contextMenu || !newCollectionName.trim()) return;
		createError = null;
		try {
			const created = await cloudApi.createCollection(newCollectionName.trim());
			await cloudApi.moveGameToCollection(
				contextMenu.game.game_id,
				created.collection_id,
			);
			await invalidateAll();
			closeContextMenu();
		} catch (err) {
			if (err instanceof ApiError && err.code === "DUPLICATE_NAME") {
				createError = "A collection with that name already exists";
				return;
			}
			console.error("Failed to create collection:", err);
			createError = "Failed to create collection";
		}
	}

	function handleClickOutside(e: MouseEvent) {
		if (e.button !== 0) return;
		if (!contextMenu) return;
		const target = e.target as HTMLElement;
		if (!target.closest(".context-menu")) closeContextMenu();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === "Escape" && contextMenu) closeContextMenu();
	}

	function formatGameSubtitle(game: GameListItem): string {
		return formatDate(game.save_date) === "Unknown"
			? ""
			: formatDate(game.save_date);
	}

	async function navigateToGame(gameId: string) {
		await goto(resolve("/games/[id]", { id: gameId }));
	}

	// formatGameTitle expects desktop fields; adapt for cloud shape. The
	// `match_id: 0` fallback only fires if game_name + nation + total_turns
	// are all missing — degenerate save in practice. display_name is the
	// owner's rename (null = never renamed); formatGameTitle prefers it over
	// the save's original name.
	function titleFor(g: GameListItem): string {
		return formatGameTitle({
			display_name: g.display_name,
			game_name: g.game_name,
			save_owner_nation: g.user_nation,
			total_turns: g.total_turns,
			match_id: 0,
		});
	}

	function getMonthKey(game: GameListItem): string {
		if (!game.save_date) return "unknown";
		const date = new Date(game.save_date);
		if (isNaN(date.getTime())) return "unknown";
		return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
	}

	function formatMonthLabel(monthKey: string): string {
		if (monthKey === "unknown") return "Unknown Date";
		const [year, month] = monthKey.split("-");
		const date = new Date(Number(year), Number(month) - 1);
		return date.toLocaleDateString("en-US", {
			month: "short",
			year: "numeric",
		});
	}

	type GameGroup = { monthKey: string; label: string; games: GameListItem[] };
	const groupedGames = $derived.by(() => {
		const groups: GameGroup[] = [];
		let currentKey = "";
		for (const game of accumulated) {
			const key = getMonthKey(game);
			if (key !== currentKey) {
				groups.push({ monthKey: key, label: formatMonthLabel(key), games: [] });
				currentKey = key;
			}
			groups[groups.length - 1].games.push(game);
		}
		return groups;
	});
</script>

<aside
	class="sidebar-aside flex h-full flex-col overflow-hidden border-l-2 border-black bg-blue-gray"
	class:dragging
	style="width: {width}px;"
>
	<!--
		Resize handle: ~6px-wide hit zone straddling the aside's left border.
		Drag to resize the dashboard/sidebar partition. Width persists via the
		sidebarWidth store. role="separator" + aria-valuenow makes it
		discoverable to screen readers; pointer drag is the only interaction
		(no keyboard handler — desktop UI, mouse-only).
	-->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="resize-handle"
		onmousedown={startDrag}
		role="separator"
		aria-orientation="vertical"
		aria-valuemin={MIN_WIDTH}
		aria-valuemax={MAX_WIDTH}
		aria-valuenow={width}
		aria-label="Resize games sidebar"
	></div>

	<!-- Collection filter dropdown -->
	<div class="border-b border-black px-2 pb-1 pt-2">
		<!--
			Svelte 5's one-way `value=` binding on a <select> doesn't reliably
			re-apply when the options array changes around it (collections come
			in async via load()). Force option values to string and use the
			derived selectValue so a goto()-driven activeFilter change picks
			the right option after the re-render.
		-->
		<select
			class="w-full cursor-pointer rounded border border-black bg-[#35302b] p-1.5 text-xs text-tan"
			value={selectValue}
			onchange={handleFilterChange}
		>
			<option value="all">All Collections</option>
			{#if publicCount > 0}
				<option value="public">Public ({publicCount})</option>
			{/if}
			{#each collections as c (c.collection_id)}
				<option value={String(c.collection_id)}>
					{c.name} ({c.game_count})
				</option>
			{/each}
		</select>

		{#if selectedNation || selectedDate}
			<div class="mt-1.5 flex flex-wrap gap-1">
				{#if selectedNation}
					<button
						type="button"
						class="filter-chip"
						onclick={() => onClearNationFilter?.()}
						title="Clear nation filter"
					>
						<span>{formatEnum(selectedNation, "NATION_")}</span>
						<span class="chip-x" aria-hidden="true">×</span>
					</button>
				{/if}
				{#if selectedDate}
					<button
						type="button"
						class="filter-chip"
						onclick={() => onClearDateFilter?.()}
						title="Clear date filter"
					>
						<span>{selectedDate}</span>
						<span class="chip-x" aria-hidden="true">×</span>
					</button>
				{/if}
			</div>
		{/if}
	</div>

	<div
		class="sidebar-content cloud-scroll flex-1 overflow-y-auto px-2 pb-2 pt-2"
		use:autohideScroll
	>
		{#if accumulated.length === 0}
			<div class="p-4 text-center text-tan">No games found</div>
		{:else}
			{#each groupedGames as group (group.monthKey)}
				<div class="month-separator my-2 flex items-center gap-1.5 px-1">
					<div class="separator-line h-px flex-1 bg-tan opacity-50"></div>
					<span class="whitespace-nowrap text-[9px] text-tan"
						>{group.label}</span
					>
					<div class="separator-line h-px flex-1 bg-tan opacity-50"></div>
				</div>

				{#each group.games as game (game.game_id)}
					{@const isActive = currentGameId === game.game_id}
					<button
						class="game-list-item {isActive
							? 'active'
							: ''} mb-0.5 w-full cursor-pointer rounded-lg border-2 p-1.5 text-left transition-all duration-200 {isActive
							? ''
							: 'border-black hover:translate-x-0.5 hover:border-orange'} relative"
						type="button"
						onclick={() => navigateToGame(game.game_id)}
						oncontextmenu={(e) => handleContextMenu(e, game)}
					>
						{#if game.user_won === true}
							<span class="trophy-badge" title="Victory">🏆</span>
						{/if}
						<div class="mb-0.5 text-xs font-semibold text-black">
							{titleFor(game)}
						</div>
						<div class="date-badge">{formatGameSubtitle(game)}</div>
						{#if game.user_nation}
							<span class="nation-badge"
								>{formatEnum(game.user_nation, "NATION_")}</span
							>
						{/if}
					</button>
				{/each}
			{/each}
			{#if hasMore}
				<div
					bind:this={sentinel}
					class="py-2 text-center text-[10px] text-tan opacity-70"
				>
					{loadingMore ? "Loading…" : ""}
				</div>
			{/if}
		{/if}
	</div>
</aside>

<svelte:window onclick={handleClickOutside} onkeydown={handleKeydown} />

{#if contextMenu}
	<div
		class="context-menu fixed z-50 min-w-[160px] rounded border-2 border-black bg-blue-gray shadow-lg"
		style="left: {contextMenu.x}px; top: {contextMenu.y}px;"
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => {
			if (e.key === "Escape") contextMenu = null;
		}}
		role="menu"
		tabindex="-1"
	>
		<!-- Rename: lives above "Move to Collection" so the most-disruptive
		     destructive-ish action (changing the visible title) is the first
		     option a user sees. Inline-input pattern mirrors the
		     "+ New Collection..." affordance below. -->
		{#if showRenameInput}
			<div class="border-b border-black p-2">
				<!-- svelte-ignore a11y_autofocus -->
				<input
					type="text"
					bind:value={renameValue}
					placeholder="Save title"
					maxlength={120}
					autofocus
					class="w-full rounded border border-[#4a433b] bg-[#35302b] px-2 py-1 text-sm text-tan placeholder:text-[#c5c3c2] focus:border-[#5a524a] focus:outline-none"
					onkeydown={(e) => {
						if (e.key === "Enter") submitRename();
						if (e.key === "Escape") {
							showRenameInput = false;
							renameValue = "";
							renameError = null;
						}
					}}
				/>
				{#if renameError}
					<p class="mt-1 text-[10px] text-orange">{renameError}</p>
				{/if}
				<p class="mt-1 text-[10px] text-tan opacity-70">
					Leave blank to reset to the save's original title.
				</p>
				<div class="mt-1 flex gap-1">
					<button
						type="button"
						class="flex-1 rounded bg-[#35302b] px-2 py-1 text-xs text-tan transition-colors hover:bg-[#453e37]"
						onclick={() => {
							showRenameInput = false;
							renameValue = "";
							renameError = null;
						}}
					>
						Cancel
					</button>
					<button
						type="button"
						class="flex-1 rounded bg-[#ab9978] px-2 py-1 text-xs text-black transition-colors hover:bg-[#9a8a6c]"
						onclick={submitRename}
					>
						Save
					</button>
				</div>
			</div>
		{:else}
			<button
				type="button"
				class="w-full border-b border-black px-3 py-1.5 text-left text-xs text-tan transition-colors hover:bg-[#35302b]"
				onclick={openRenameInput}
			>
				Rename…
			</button>
		{/if}

		<div class="border-b border-black px-3 py-2 text-sm text-white">
			Move to Collection
		</div>

		{#each collections as collection (collection.collection_id)}
			<button
				type="button"
				class="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs text-tan transition-colors hover:bg-[#35302b]
        {collection.collection_id === contextMenu.game.collection_id
					? 'bg-[#35302b]'
					: ''}"
				onclick={() => moveToCollection(collection.collection_id)}
			>
				<span>{collection.name}</span>
				{#if collection.collection_id === contextMenu.game.collection_id}
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-4 w-4 text-orange"
						viewBox="0 0 20 20"
						fill="currentColor"
					>
						<path
							fill-rule="evenodd"
							d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
							clip-rule="evenodd"
						/>
					</svg>
				{/if}
			</button>
		{/each}

		<div class="border-t border-black">
			{#if showNewCollectionInput}
				<div class="p-2">
					<!-- svelte-ignore a11y_autofocus -->
					<input
						type="text"
						bind:value={newCollectionName}
						placeholder="Collection name"
						autofocus
						class="w-full rounded border border-[#4a433b] bg-[#35302b] px-2 py-1 text-sm text-tan placeholder:text-[#c5c3c2] focus:border-[#5a524a] focus:outline-none"
						onkeydown={(e) => {
							if (e.key === "Enter") createAndMoveToCollection();
							if (e.key === "Escape") {
								showNewCollectionInput = false;
								newCollectionName = "";
								createError = null;
							}
						}}
					/>
					{#if createError}
						<p class="mt-1 text-[10px] text-orange">{createError}</p>
					{/if}
					<div class="mt-1 flex gap-1">
						<button
							type="button"
							class="flex-1 rounded bg-[#35302b] px-2 py-1 text-xs text-tan transition-colors hover:bg-[#453e37]"
							onclick={() => {
								showNewCollectionInput = false;
								newCollectionName = "";
								createError = null;
							}}
						>
							Cancel
						</button>
						<button
							type="button"
							class="flex-1 rounded bg-[#ab9978] px-2 py-1 text-xs text-black transition-colors hover:bg-[#9a8a6c]"
							onclick={createAndMoveToCollection}
							disabled={!newCollectionName.trim()}
						>
							Create
						</button>
					</div>
				</div>
			{:else}
				<button
					type="button"
					class="w-full px-3 py-1.5 text-left text-xs text-tan transition-colors hover:bg-[#35302b]"
					onclick={() => {
						showNewCollectionInput = true;
					}}
				>
					+ New Collection...
				</button>
			{/if}
		</div>
	</div>
{/if}

<style>
	.sidebar-aside {
		position: relative;
	}

	.sidebar-aside.dragging {
		user-select: none;
		cursor: col-resize;
	}

	/*
	 * Hit zone straddles the aside's 2px left border. 6px wide so the
	 * cursor catches it without a precise aim. Visually subtle on hover so
	 * the affordance is discoverable without being noisy.
	 */
	.resize-handle {
		position: absolute;
		left: -3px;
		top: 0;
		bottom: 0;
		width: 6px;
		cursor: col-resize;
		z-index: 10;
		background-color: transparent;
		transition: background-color 150ms ease;
	}

	.resize-handle:hover,
	.sidebar-aside.dragging .resize-handle {
		background-color: rgba(255, 165, 0, 0.35);
	}

	.game-list-item {
		background-color: #c1872f;
		padding-bottom: 18px;
	}

	.game-list-item:hover,
	.game-list-item.active {
		background-color: #f2a93b;
	}

	.game-list-item.active {
		border-color: #f2a93b;
	}

	.trophy-badge {
		position: absolute;
		top: 2px;
		right: 4px;
		font-size: 7px;
		line-height: 1;
		background-color: rgba(0, 0, 0, 0.6);
		border-radius: 50%;
		width: 18px;
		height: 18px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.date-badge {
		position: absolute;
		bottom: 2px;
		left: 6px;
		font-size: 8px;
		font-weight: 600;
		color: var(--color-dark-brown);
		line-height: 1;
	}

	.nation-badge {
		position: absolute;
		bottom: 2px;
		right: 4px;
		font-size: 8px;
		font-weight: 600;
		color: var(--color-dark-brown);
		line-height: 1;
	}

	.filter-chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 2px 6px;
		border-radius: 9999px;
		border: 1px solid #000;
		background-color: #c1872f;
		color: #000;
		font-size: 10px;
		font-weight: 600;
		line-height: 1;
		cursor: pointer;
		transition: background-color 150ms ease;
	}

	.filter-chip:hover {
		background-color: #f2a93b;
	}

	.chip-x {
		font-size: 12px;
		line-height: 1;
	}
</style>
