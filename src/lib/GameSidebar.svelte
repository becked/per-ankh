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
      const nation = game.human_nation ? formatEnum(game.human_nation, "NATION_").toLowerCase() : "";
      const date = formatGameSubtitle(game).toLowerCase();

      return title.includes(query) ||
             nation.includes(query) ||
             date.includes(query);
    })
  );
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
      {#each filteredGames as game (game.match_id)}
        {@const isActive = currentGameId === game.match_id}
        <button
          class="game-list-item {isActive ? 'active' : ''} w-full p-1.5 mb-0.5 border-2 rounded-lg cursor-pointer text-left transition-all duration-200 {isActive ? '' : 'border-black hover:border-orange hover:translate-x-0.5'}"
          type="button"
          onclick={() => navigateToGame(game.match_id)}
        >
          <div class="text-xs font-semibold mb-0.5 text-black">{formatGameTitle(game)}</div>
          <div class="text-[8px] text-left font-normal" style="color: #79261d;">{formatGameSubtitle(game)}</div>
        </button>
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
</style>
