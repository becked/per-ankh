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

  function formatGameTitle(game: GameInfo): string {
    if (game.game_name) {
      return game.game_name;
    }

    // Fallback: use nation and turns if available
    if (game.human_nation && game.total_turns) {
      return `${game.human_nation} - Turn ${game.total_turns}`;
    }

    if (game.human_nation) {
      return game.human_nation;
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

<aside class="game-tabs">
  <div class="tabs-container">
    <button class="game-tab summary-tab" type="button" onclick={navigateToSummary}>
      <div class="game-title">SUMMARY</div>
      <div class="game-subtitle">All Games</div>
    </button>

    {#if loading}
      <div class="loading">Loading games...</div>
    {:else if error}
      <div class="error">Error: {error}</div>
    {:else if games.length === 0}
      <div class="empty">No games found</div>
    {:else}
      {#each games as game (game.match_id)}
        <button class="game-tab" type="button" onclick={() => navigateToGame(game.match_id)}>
          <div class="game-title">{formatGameTitle(game)}</div>
          <div class="game-subtitle">{formatGameSubtitle(game)}</div>
        </button>
      {/each}
    {/if}
  </div>
</aside>

<style>
  .game-tabs {
    width: 250px;
    height: 100vh;
    background: var(--color-blue-gray);
    border-right: 2px solid var(--color-black);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  h2 {
    margin: 0;
    padding: 1rem;
    font-size: 1.25rem;
    border-bottom: 2px solid var(--color-black);
    background: transparent;
    color: var(--color-white);
    font-weight: bold;
  }

  .tabs-container {
    overflow-y: auto;
    flex: 1;
    padding: 1rem 0.5rem 0.5rem 0.5rem;
  }

  .game-tab {
    width: 100%;
    padding: 0.75rem;
    margin-bottom: 0.5rem;
    background: var(--color-tan);
    border: 2px solid var(--color-black);
    border-radius: 4px;
    cursor: pointer;
    text-align: left;
    transition: all 0.2s;
  }

  .game-tab:hover {
    background: var(--color-white);
    border-color: var(--color-orange);
    transform: translateX(2px);
  }

  .game-tab:active {
    background: var(--color-white);
  }

  .summary-tab {
    font-weight: 600;
    font-size: 1.1rem;
  }

  .game-title {
    font-size: 0.95rem;
    font-weight: 600;
    margin-bottom: 0.25rem;
    color: var(--color-black);
  }

  .game-subtitle {
    font-size: 0.75rem;
    color: var(--color-brown);
    text-align: right;
    font-weight: normal;
  }

  .loading,
  .error,
  .empty {
    padding: 1rem;
    text-align: center;
    color: var(--color-tan);
  }

  .error {
    color: var(--color-orange);
    font-weight: bold;
  }

  /* Scrollbar styling */
  .tabs-container::-webkit-scrollbar {
    width: 8px;
  }

  .tabs-container::-webkit-scrollbar-track {
    background: rgba(0, 0, 0, 0.2);
  }

  .tabs-container::-webkit-scrollbar-thumb {
    background: var(--color-tan);
    border-radius: 4px;
  }

  .tabs-container::-webkit-scrollbar-thumb:hover {
    background: var(--color-orange);
  }
</style>
