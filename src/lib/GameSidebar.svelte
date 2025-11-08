<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import type { GameInfo } from "$lib/types";
  import { formatEnum, formatDate } from "$lib/utils/formatting";

  let games = $state<GameInfo[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let searchQuery = $state("");

  // Get current game ID from URL
  const currentGameId = $derived($page.params.id ? Number($page.params.id) : null);

  onMount(async () => {
    try {
      games = await invoke<GameInfo[]>("get_games_list");
    } catch (err) {
      error = String(err);
    } finally {
      loading = false;
    }
  });

  function formatNation(nation: string | null): string | null {
    if (!nation) return null;
    return formatEnum(nation, "NATION_");
  }

  function formatGameTitle(game: GameInfo): string {
    // Check if game_name is a real name (not auto-generated "Game{number}")
    const isRealName = game.game_name != null && game.game_name !== "" && !game.game_name.match(/^Game\d+$/);

    if (isRealName) {
      return game.game_name!;
    }

    // Format nation by removing NATION_ prefix and capitalizing
    const formattedNation = formatNation(game.human_nation);

    // Fallback: use nation and turns if available
    if (formattedNation !== null && game.total_turns != null) {
      return `${formattedNation} - ${game.total_turns} turns`;
    }

    if (formattedNation !== null) {
      return formattedNation;
    }

    if (game.total_turns != null) {
      return `Turn ${game.total_turns}`;
    }

    return `Game ${game.match_id}`;
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
      if (!searchQuery) return true;

      const query = searchQuery.toLowerCase();
      const title = formatGameTitle(game).toLowerCase();
      const nation = formatNation(game.human_nation)?.toLowerCase() ?? "";
      const date = formatGameSubtitle(game).toLowerCase();

      return title.includes(query) ||
             nation.includes(query) ||
             date.includes(query);
    })
  );
</script>

<aside class="w-[175px] h-full bg-blue-gray border-r-2 border-black flex flex-col overflow-hidden">
  <div class="sidebar-content overflow-y-auto flex-1 pt-4 px-2 pb-2">
    <!-- Search Bar -->
    <div class="mb-4">
      <input
        type="text"
        bind:value={searchQuery}
        placeholder="Search"
        class="w-full px-3 py-2 bg-tan border-2 border-black rounded text-black text-sm font-normal placeholder-gray-500 placeholder:font-light focus:outline-none focus:border-orange transition-colors"
      />
    </div>

    {#if loading}
      <div class="p-4 text-center text-tan">Loading games...</div>
    {:else if error}
      <div class="p-4 text-center text-orange font-bold">Error: {error}</div>
    {:else if filteredGames.length === 0}
      <div class="p-4 text-center text-tan">
        {searchQuery ? "No games match your search" : "No games found"}
      </div>
    {:else}
      {#each filteredGames as game (game.match_id)}
        {@const isActive = currentGameId === game.match_id}
        <button
          class="w-full p-2 mb-2 border-2 rounded cursor-pointer text-left transition-all duration-200 {isActive ? 'bg-tan-hover border-tan-hover hover:border-orange' : 'bg-tan border-black hover:bg-tan-hover hover:border-orange hover:translate-x-0.5'} active:bg-tan-hover"
          type="button"
          onclick={() => navigateToGame(game.match_id)}
        >
          <div class="text-xs font-semibold mb-0.5 text-black">{formatGameTitle(game)}</div>
          <div class="text-[8px] text-brown text-left font-normal">{formatGameSubtitle(game)}</div>
        </button>
      {/each}
    {/if}
  </div>
</aside>

<style>
  /* Custom scrollbar styling - not available in Tailwind */
  .sidebar-content::-webkit-scrollbar {
    width: 8px;
  }

  .sidebar-content::-webkit-scrollbar-track {
    background: rgba(0, 0, 0, 0.2);
  }

  .sidebar-content::-webkit-scrollbar-thumb {
    background: var(--color-tan);
    border-radius: 4px;
  }

  .sidebar-content::-webkit-scrollbar-thumb:hover {
    background: var(--color-orange);
  }
</style>
