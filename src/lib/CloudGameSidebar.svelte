<script lang="ts">
	// Cloud counterpart of src/lib/GameSidebar.svelte. Different enough from
	// the desktop version to warrant a separate component:
	//   - Data comes in as props (loaded by /dashboard/+page.ts), not via
	//     Tauri commands; refresh is `invalidateAll()`, not a refresh store.
	//   - Field shape: game_id (string), user_nation/user_won (vs desktop
	//     match_id (number), save_owner_nation/save_owner_won).
	//   - Filtering/searching is client-side over the props array. The
	//     server cap on listGames is 200 — switch to server-side if a user
	//     ever exceeds that ceiling.
	//   - "Public (N)" pseudo-filter replaces desktop's "Shared" pseudo-
	//     collection (every game is in the cloud now; what used to be
	//     "shared" is the is_public flag).

	import { goto, invalidateAll } from "$app/navigation";
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
		games: GameListItem[];
		collections: CollectionInfo[];
		publicCount: number;
		currentGameId: string | null;
	}

	let { games, collections, publicCount, currentGameId }: Props = $props();

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

	// "all" | "public" | <collection_id>
	let activeFilter = $state<"all" | "public" | number>("all");
	let searchInput = $state("");

	// Context menu state.
	let contextMenu = $state<{ x: number; y: number; game: GameListItem } | null>(
		null,
	);
	let showNewCollectionInput = $state(false);
	let newCollectionName = $state("");
	let createError = $state<string | null>(null);

	function handleFilterChange(e: Event) {
		const value = (e.target as HTMLSelectElement).value;
		if (value === "all") activeFilter = "all";
		else if (value === "public") activeFilter = "public";
		else activeFilter = Number(value);
	}

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
	}

	function closeContextMenu() {
		contextMenu = null;
		showNewCollectionInput = false;
		newCollectionName = "";
		createError = null;
	}

	async function moveToCollection(collectionId: number) {
		if (!contextMenu) return;
		try {
			await cloudApi.moveGameToCollection(contextMenu.game.game_id, collectionId);
			await invalidateAll();
		} catch (err) {
			console.error("Failed to move game:", err);
		}
		closeContextMenu();
	}

	async function createAndMoveToCollection() {
		if (!contextMenu || !newCollectionName.trim()) return;
		createError = null;
		try {
			const created = await cloudApi.createCollection(newCollectionName.trim());
			await cloudApi.moveGameToCollection(contextMenu.game.game_id, created.collection_id);
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
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- Navigation is awaited
		await goto(resolve("/games/[id]", { id: gameId }));
	}

	// formatGameTitle expects desktop fields; adapt for cloud shape. The
	// `match_id: 0` fallback only fires if game_name + nation + total_turns
	// are all missing — degenerate save in practice.
	function titleFor(g: GameListItem): string {
		return formatGameTitle({
			game_name: g.game_name,
			save_owner_nation: g.user_nation,
			total_turns: g.total_turns,
			match_id: 0,
		});
	}

	// First filter by collection/public, then by search query.
	const filteredGames = $derived.by(() => {
		let result = games;
		if (activeFilter === "public") {
			result = result.filter((g) => g.is_public);
		} else if (typeof activeFilter === "number") {
			result = result.filter((g) => g.collection_id === activeFilter);
		}

		const query = searchInput.trim().toLowerCase();
		if (!query) return result;

		return result.filter((game) => {
			const title = titleFor(game).toLowerCase();
			const nation = game.user_nation
				? formatEnum(game.user_nation, "NATION_").toLowerCase()
				: "";
			const date = formatGameSubtitle(game).toLowerCase();
			return title.includes(query) || nation.includes(query) || date.includes(query);
		});
	});

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
		return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
	}

	type GameGroup = { monthKey: string; label: string; games: GameListItem[] };
	const groupedGames = $derived.by(() => {
		const groups: GameGroup[] = [];
		let currentKey = "";
		for (const game of filteredGames) {
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

	<!-- Search -->
	<div class="border-b border-black px-2 pb-1 pt-2">
		<input
			type="search"
			bind:value={searchInput}
			placeholder="Search games"
			class="w-full rounded border border-black bg-[#35302b] p-1.5 text-xs text-tan placeholder:text-[#9a8a6c] focus:outline-none focus:ring-1 focus:ring-orange"
		/>
	</div>

	<!-- Collection filter dropdown -->
	<div class="border-b border-black px-2 pb-1 pt-2">
		<select
			class="w-full cursor-pointer rounded border border-black bg-[#35302b] p-1.5 text-xs text-tan"
			value={activeFilter === "all" ? "all" : String(activeFilter)}
			onchange={handleFilterChange}
		>
			<option value="all">All Collections</option>
			{#if publicCount > 0}
				<option value="public">Public ({publicCount})</option>
			{/if}
			{#each collections as c (c.collection_id)}
				<option value={c.collection_id}>
					{c.name} ({c.game_count})
				</option>
			{/each}
		</select>
	</div>

	<div
		class="sidebar-content cloud-scroll flex-1 overflow-y-auto px-2 pb-2 pt-2"
		use:autohideScroll
	>
		{#if filteredGames.length === 0}
			<div class="p-4 text-center text-tan">
				{searchInput ? "No games match your search" : "No games found"}
			</div>
		{:else}
			{#key searchInput}
				{#each groupedGames as group (group.monthKey)}
					<div class="month-separator my-2 flex items-center gap-1.5 px-1">
						<div class="separator-line h-px flex-1 bg-tan opacity-50"></div>
						<span class="whitespace-nowrap text-[9px] text-tan">{group.label}</span>
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
			{/key}
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
			if (e.key === 'Escape') contextMenu = null;
		}}
		role="menu"
		tabindex="-1"
	>
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
</style>
