<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import type { GameInfo } from "$lib/types";
  import type { Collection } from "$lib/types/Collection";
  import { formatGameTitle, formatDate, formatEnum } from "$lib/utils/formatting";
  import { refreshData } from "$lib/stores/refresh";
  import { searchQuery } from "$lib/stores/search";
  import { activeCollectionId } from "$lib/stores/collection";
  import { api } from "$lib/api";
  import { get } from "svelte/store";

  let games = $state<GameInfo[]>([]);
  let collections = $state<Collection[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  // Context menu state
  let contextMenu = $state<{ x: number; y: number; game: GameInfo } | null>(null);
  let showNewCollectionInput = $state(false);
  let newCollectionName = $state("");

  // Convert stores to reactive state for proper Svelte 5 integration
  let currentSearchQuery = $state(get(searchQuery));
  $effect.pre(() => {
    const unsubscribe = searchQuery.subscribe((value) => {
      currentSearchQuery = value;
    });
    return unsubscribe;
  });

  let currentCollectionId = $state<number | null>(get(activeCollectionId));
  $effect.pre(() => {
    const unsubscribe = activeCollectionId.subscribe((value) => {
      currentCollectionId = value;
    });
    return unsubscribe;
  });

  // Get current game ID from URL
  const currentGameId = $derived($page.params.id ? Number($page.params.id) : null);

  async function fetchCollections() {
    try {
      collections = await api.getCollections();
    } catch (err) {
      console.error("Failed to load collections:", err);
    }
  }

  async function fetchGames() {
    loading = true;
    error = null;
    try {
      games = await api.getGamesList(currentCollectionId);
    } catch (err) {
      error = String(err);
    } finally {
      loading = false;
    }
  }

  // Re-fetch games when collection filter changes
  $effect(() => {
    const _ = currentCollectionId;
    fetchGames();
  });

  onMount(() => {
    fetchCollections();
  });

  // Subscribe to refresh events
  refreshData.subscribe(() => {
    fetchCollections();
    fetchGames();
  });

  function handleCollectionChange(e: Event) {
    const value = (e.target as HTMLSelectElement).value;
    const id = value === "all" ? null : Number(value);
    activeCollectionId.set(id);
  }

  function handleContextMenu(e: MouseEvent, game: GameInfo) {
    e.preventDefault();
    e.stopPropagation();

    // Menu dimensions (approximate - matches min-w-[160px] and typical height)
    const menuWidth = 180;
    const menuHeight = 250;
    const sidebarWidth = 175;

    // Position menu to the left of the sidebar
    let x = window.innerWidth - sidebarWidth - menuWidth - 8;
    let y = e.clientY;

    // If menu would overflow bottom edge, shift up
    if (y + menuHeight > window.innerHeight) {
      y = window.innerHeight - menuHeight - 8;
    }

    // Ensure y doesn't go negative
    if (y < 8) {
      y = 8;
    }

    contextMenu = { x, y, game };
    showNewCollectionInput = false;
    newCollectionName = "";
  }

  function closeContextMenu() {
    contextMenu = null;
    showNewCollectionInput = false;
    newCollectionName = "";
  }

  async function moveToCollection(collectionId: number) {
    if (!contextMenu) return;

    try {
      await api.moveMatchesToCollection([contextMenu.game.match_id], collectionId);
      refreshData.trigger();
    } catch (err) {
      console.error("Failed to move game:", err);
    }

    closeContextMenu();
  }

  async function createAndMoveToCollection() {
    if (!contextMenu || !newCollectionName.trim()) return;

    try {
      const newCollection = await api.createCollection(newCollectionName.trim());
      await api.moveMatchesToCollection([contextMenu.game.match_id], newCollection.collection_id);
      refreshData.trigger();
    } catch (err) {
      console.error("Failed to create collection:", err);
    }

    closeContextMenu();
  }

  function handleClickOutside(e: MouseEvent) {
    // Only handle left clicks (button 0)
    if (e.button !== 0) return;
    if (!contextMenu) return;
    const target = e.target as HTMLElement;
    if (!target.closest(".context-menu")) {
      closeContextMenu();
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && contextMenu) {
      closeContextMenu();
    }
  }

  function formatGameSubtitle(game: GameInfo): string {
    return formatDate(game.save_date) === "Unknown" ? "" : formatDate(game.save_date);
  }

  function navigateToGame(matchId: number) {
    goto(`/game/${matchId}`);
  }

  // Filter games based on search query
  const filteredGames = $derived(
    games.filter(game => {
      if (!currentSearchQuery) return true;

      const query = currentSearchQuery.toLowerCase();
      const title = formatGameTitle(game).toLowerCase();
      const nation = game.save_owner_nation ? formatEnum(game.save_owner_nation, "NATION_").toLowerCase() : "";
      const date = formatGameSubtitle(game).toLowerCase();

      return title.includes(query) ||
             nation.includes(query) ||
             date.includes(query);
    })
  );

  // Get month key for grouping (e.g., "2024-11")
  function getMonthKey(game: GameInfo): string {
    if (!game.save_date) return "unknown";
    const date = new Date(game.save_date);
    if (isNaN(date.getTime())) return "unknown";
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }

  // Format month key for display (e.g., "Nov 2024")
  function formatMonthLabel(monthKey: string): string {
    if (monthKey === "unknown") return "Unknown Date";
    const [year, month] = monthKey.split("-");
    const date = new Date(Number(year), Number(month) - 1);
    return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  }

  // Group games by month, preserving order
  type GameGroup = { monthKey: string; label: string; games: GameInfo[] };
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

<aside class="w-[175px] h-full bg-blue-gray border-l-2 border-black flex flex-col overflow-hidden">
  <!-- Collection filter dropdown -->
  <div class="px-2 pt-2 pb-1 border-b border-black">
    <select
      class="w-full bg-[#35302b] text-tan text-xs p-1.5 rounded border border-black cursor-pointer"
      value={currentCollectionId ?? "all"}
      onchange={handleCollectionChange}
    >
      <option value="all">All Collections</option>
      {#each collections as c (c.collection_id)}
        <option value={c.collection_id}>
          {c.name} ({c.match_count})
        </option>
      {/each}
    </select>
  </div>

  <div class="sidebar-content overflow-y-auto flex-1 pt-2 px-2 pb-2">
    {#if loading}
      <div class="p-4 text-center text-tan">Loading games...</div>
    {:else if error}
      <div class="p-4 text-center text-orange font-bold">Error: {error}</div>
    {:else if filteredGames.length === 0}
      <div class="p-4 text-center text-tan">
        {currentSearchQuery ? "No games match your search" : "No games found"}
      </div>
    {:else}
      <!-- Key block forces complete re-render when search changes to avoid stale DOM -->
      {#key currentSearchQuery}
        {#each groupedGames as group (group.monthKey)}
          <!-- Month separator -->
          <div class="month-separator flex items-center gap-1.5 my-2 px-1">
            <div class="separator-line flex-1 h-px bg-tan opacity-50"></div>
            <span class="text-tan text-[9px] whitespace-nowrap">{group.label}</span>
            <div class="separator-line flex-1 h-px bg-tan opacity-50"></div>
          </div>

          {#each group.games as game (game.match_id)}
          {@const isActive = currentGameId === game.match_id}
          <button
            class="game-list-item {isActive ? 'active' : ''} w-full p-1.5 mb-0.5 border-2 rounded-lg cursor-pointer text-left transition-all duration-200 {isActive ? '' : 'border-black hover:border-orange hover:translate-x-0.5'} relative"
            type="button"
            onclick={() => navigateToGame(game.match_id)}
            oncontextmenu={(e) => handleContextMenu(e, game)}
          >
            {#if game.save_owner_won === true}
              <span class="trophy-badge" title="Victory">🏆</span>
            {/if}
            <div class="text-xs font-semibold mb-0.5 text-black">{formatGameTitle(game)}</div>
            <div class="date-badge">{formatGameSubtitle(game)}</div>
            {#if game.save_owner_nation}
              <span class="nation-badge">{formatEnum(game.save_owner_nation, "NATION_")}</span>
            {/if}
          </button>
          {/each}
        {/each}
      {/key}
    {/if}
  </div>
</aside>

<!-- Context menu for moving games to collections -->
<svelte:window onclick={handleClickOutside} onkeydown={handleKeydown} />

{#if contextMenu}
  <!-- onclick stopPropagation prevents handleClickOutside from firing on internal clicks -->
  <div
    class="context-menu fixed bg-blue-gray border-2 border-black rounded shadow-lg z-50 min-w-[160px]"
    style="left: {contextMenu.x}px; top: {contextMenu.y}px;"
    onclick={(e) => e.stopPropagation()}
  >
    <div class="px-3 py-2 text-sm text-white border-b border-black">
      Move to Collection
    </div>

    {#each collections as collection (collection.collection_id)}
      <button
        type="button"
        class="w-full text-left px-3 py-1.5 text-xs text-tan hover:bg-[#35302b] transition-colors flex items-center justify-between
          {collection.collection_id === contextMenu.game.collection_id ? 'bg-[#35302b]' : ''}"
        onclick={() => moveToCollection(collection.collection_id)}
      >
        <span>{collection.name}</span>
        {#if collection.collection_id === contextMenu.game.collection_id}
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-orange" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
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
            class="w-full bg-[#35302b] text-tan text-sm px-2 py-1 rounded border border-[#4a433b] focus:outline-none focus:border-[#5a524a] placeholder:text-[#c5c3c2]"
            onkeydown={(e) => {
              if (e.key === "Enter") createAndMoveToCollection();
              if (e.key === "Escape") { showNewCollectionInput = false; newCollectionName = ""; }
            }}
          />
          <div class="flex gap-1 mt-1">
            <button
              type="button"
              class="flex-1 text-xs bg-[#35302b] hover:bg-[#453e37] text-tan px-2 py-1 rounded transition-colors"
              onclick={createAndMoveToCollection}
              disabled={!newCollectionName.trim()}
            >
              Create
            </button>
            <button
              type="button"
              class="flex-1 text-xs bg-[#ab9978] hover:bg-[#9a8a6c] text-black px-2 py-1 rounded transition-colors"
              onclick={() => { showNewCollectionInput = false; newCollectionName = ""; }}
            >
              Cancel
            </button>
          </div>
        </div>
      {:else}
        <button
          type="button"
          class="w-full text-left px-3 py-1.5 text-xs text-tan hover:bg-[#35302b] transition-colors"
          onclick={() => { showNewCollectionInput = true; }}
        >
          + New Collection...
        </button>
      {/if}
    </div>
  </div>
{/if}

<style>
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
    color: #79261d;
    line-height: 1;
  }

  .nation-badge {
    position: absolute;
    bottom: 2px;
    right: 4px;
    font-size: 8px;
    font-weight: 600;
    color: #79261d;
    line-height: 1;
  }
</style>
