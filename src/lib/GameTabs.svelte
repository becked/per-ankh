<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import type { GameInfo } from "$lib/types";

  let games = $state<GameInfo[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

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
    // Convert NATION_ASSYRIA to Assyria
    return nation.replace("NATION_", "").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  }

  function formatGameTitle(game: GameInfo): string {
    // Check if game_name is a real name (not auto-generated "Game{number}")
    const isRealName = game.game_name && !game.game_name.match(/^Game\d+$/);

    if (isRealName) {
      return game.game_name;
    }

    // Format nation by removing NATION_ prefix and capitalizing
    const formattedNation = formatNation(game.human_nation);

    // Fallback: use nation and turns if available
    if (formattedNation && game.total_turns) {
      return `${formattedNation} - Turn ${game.total_turns}`;
    }

    if (formattedNation) {
      return formattedNation;
    }

    if (game.total_turns) {
      return `Turn ${game.total_turns}`;
    }

    return `Game ${game.match_id}`;
  }

  function formatGameSubtitle(game: GameInfo): string {
    if (game.save_date) {
      const date = new Date(game.save_date);
      return date.toISOString().split('T')[0];
    }
    return "";
  }

  function navigateToSummary() {
    goto("/");
  }

  function navigateToGame(matchId: number) {
    goto(`/game/${matchId}`);
  }
</script>

<aside class="w-[250px] h-screen bg-blue-gray border-r-2 border-black flex flex-col overflow-hidden">
  <div class="tabs-container overflow-y-auto flex-1 pt-4 px-2 pb-2">
    <button class="w-full mb-6 cursor-pointer text-left pb-2 pt-4 border-b-[3px] border-orange transition-opacity hover:opacity-80" type="button" onclick={navigateToSummary}>
      <div class="text-2xl font-bold text-gray-200">SUMMARY</div>
    </button>

    {#if loading}
      <div class="p-4 text-center text-tan">Loading games...</div>
    {:else if error}
      <div class="p-4 text-center text-orange font-bold">Error: {error}</div>
    {:else if games.length === 0}
      <div class="p-4 text-center text-tan">No games found</div>
    {:else}
      {#each games as game (game.match_id)}
        <button class="w-full p-3 mb-2 bg-tan border-2 border-black rounded cursor-pointer text-left transition-all duration-200 hover:bg-white hover:border-orange hover:translate-x-0.5 active:bg-white" type="button" onclick={() => navigateToGame(game.match_id)}>
          <div class="text-sm font-semibold mb-1 text-black">{formatGameTitle(game)}</div>
          <div class="text-xs text-brown text-right font-normal">{formatGameSubtitle(game)}</div>
        </button>
      {/each}
    {/if}
  </div>
</aside>

<style>
  /* Custom scrollbar styling - not available in Tailwind */
  .tabs-container::-webkit-scrollbar {
    width: 8px;
  }

  .tabs-container::-webkit-scrollbar-track {
    background: rgba(0, 0, 0, 0.2);
  }

  .tabs-container::-webkit-scrollbar-thumb {
    background: #D2B48C;
    border-radius: 4px;
  }

  .tabs-container::-webkit-scrollbar-thumb:hover {
    background: #FFA500;
  }
</style>
