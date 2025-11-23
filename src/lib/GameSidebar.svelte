<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import type { GameInfo } from "$lib/types";
  import { formatGameTitle, formatDate, formatEnum } from "$lib/utils/formatting";
  import { refreshData } from "$lib/stores/refresh";
  import { searchQuery } from "$lib/stores/search";

  let games = $state<GameInfo[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  // Get current game ID from URL
  const currentGameId = $derived($page.params.id ? Number($page.params.id) : null);

  async function fetchGames() {
    loading = true;
    error = null;
    try {
      games = await invoke<GameInfo[]>("get_games_list");
    } catch (err) {
      error = String(err);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    fetchGames();
  });

  // Subscribe to refresh events
  refreshData.subscribe(() => {
    fetchGames();
  });

  function formatGameSubtitle(game: GameInfo): string {
    return formatDate(game.save_date) === "Unknown" ? "" : formatDate(game.save_date);
  }

  function navigateToGame(matchId: number) {
    goto(`/game/${matchId}`);
  }

  // Filter games based on search query
  const filteredGames = $derived(
    games.filter(game => {
      if (!$searchQuery) return true;

      const query = $searchQuery.toLowerCase();
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
  <div class="sidebar-content overflow-y-auto flex-1 pt-2 px-2 pb-2">
    {#if loading}
      <div class="p-4 text-center text-tan">Loading games...</div>
    {:else if error}
      <div class="p-4 text-center text-orange font-bold">Error: {error}</div>
    {:else if filteredGames.length === 0}
      <div class="p-4 text-center text-tan">
        {$searchQuery ? "No games match your search" : "No games found"}
      </div>
    {:else}
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
          >
            {#if game.save_owner_won === true}
              <span class="trophy-badge" title="Victory">🏆</span>
            {/if}
            <div class="text-xs font-semibold mb-0.5 text-black">{formatGameTitle(game)}</div>
            <div class="text-[8px] text-left font-normal" style="color: #79261d;">{formatGameSubtitle(game)}</div>
          </button>
        {/each}
      {/each}
    {/if}
  </div>
</aside>

<style>
  .game-list-item {
    background-color: #c1872f;
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
</style>
