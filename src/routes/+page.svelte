<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { onMount } from "svelte";
  import type { GameStatistics } from "$lib/types";
  import GameTabs from "$lib/GameTabs.svelte";

  let stats = $state<GameStatistics | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  onMount(async () => {
    try {
      stats = await invoke<GameStatistics>("get_game_statistics");
    } catch (err) {
      error = String(err);
    } finally {
      loading = false;
    }
  });
</script>

<div class="app-layout">
  <GameTabs />

  <main class="container">
  <h1>Per-Ankh - Old World Stats</h1>

  {#if loading}
    <p>Loading...</p>
  {:else if error}
    <p class="error">Error: {error}</p>
  {:else if stats}
    <div class="stats-summary">
      <h2>Games Played: {stats.total_games}</h2>
    </div>

    <div class="nations-section">
      <h2>Nations</h2>
      <table>
        <thead>
          <tr>
            <th>Nation</th>
            <th>Games Played</th>
          </tr>
        </thead>
        <tbody>
          {#each stats.nations as nation}
            <tr>
              <td>{nation.nation}</td>
              <td>{nation.games_played}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
  </main>
</div>

<style>
.app-layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

.container {
  flex: 1;
  padding: 2rem;
  overflow-y: auto;
}

h1 {
  margin-bottom: 2rem;
}

.stats-summary {
  margin-bottom: 2rem;
}

.error {
  color: red;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th,
td {
  padding: 0.5rem;
  text-align: left;
  border-bottom: 1px solid #ddd;
}

th {
  font-weight: bold;
}
</style>
