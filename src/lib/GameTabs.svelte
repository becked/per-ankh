<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { onMount } from "svelte";
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
    return `Game ${game.match_id}`;
  }

  function formatGameSubtitle(game: GameInfo): string {
    if (game.save_date) {
      const date = new Date(game.save_date);
      return date.toLocaleDateString();
    }
    return "";
  }
</script>

<aside class="game-tabs">
  <h2>Games</h2>

  {#if loading}
    <div class="loading">Loading games...</div>
  {:else if error}
    <div class="error">Error: {error}</div>
  {:else if games.length === 0}
    <div class="empty">No games found</div>
  {:else}
    <div class="tabs-container">
      {#each games as game (game.match_id)}
        <button class="game-tab" type="button">
          <div class="game-title">{formatGameTitle(game)}</div>
          <div class="game-subtitle">{formatGameSubtitle(game)}</div>
        </button>
      {/each}
    </div>
  {/if}
</aside>

<style>
  .game-tabs {
    width: 250px;
    height: 100vh;
    background: #f5f5f5;
    border-right: 1px solid #ddd;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  h2 {
    margin: 0;
    padding: 1rem;
    font-size: 1.25rem;
    border-bottom: 1px solid #ddd;
    background: #fff;
  }

  .tabs-container {
    overflow-y: auto;
    flex: 1;
    padding: 0.5rem;
  }

  .game-tab {
    width: 100%;
    padding: 0.75rem;
    margin-bottom: 0.5rem;
    background: #fff;
    border: 1px solid #ddd;
    border-radius: 4px;
    cursor: pointer;
    text-align: left;
    transition: all 0.2s;
  }

  .game-tab:hover {
    background: #f9f9f9;
    border-color: #999;
  }

  .game-tab:active {
    background: #f0f0f0;
  }

  .game-title {
    font-weight: 600;
    margin-bottom: 0.25rem;
    color: #333;
  }

  .game-subtitle {
    font-size: 0.875rem;
    color: #666;
  }

  .loading,
  .error,
  .empty {
    padding: 1rem;
    text-align: center;
    color: #666;
  }

  .error {
    color: #d32f2f;
  }

  /* Scrollbar styling */
  .tabs-container::-webkit-scrollbar {
    width: 8px;
  }

  .tabs-container::-webkit-scrollbar-track {
    background: #f1f1f1;
  }

  .tabs-container::-webkit-scrollbar-thumb {
    background: #888;
    border-radius: 4px;
  }

  .tabs-container::-webkit-scrollbar-thumb:hover {
    background: #555;
  }
</style>
