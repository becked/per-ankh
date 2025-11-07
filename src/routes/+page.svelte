<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { onMount } from "svelte";
  import type { GameStatistics } from "$lib/types";

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

<style>
.container {
  flex: 1;
  padding: 1rem 2rem 2rem 2rem;
  overflow-y: auto;
  background: var(--color-blue-gray);
}

h1 {
  margin-bottom: 2rem;
  color: #eeeeee;
  font-size: 2rem;
  font-weight: bold;
  border-bottom: 3px solid var(--color-orange);
  padding-bottom: 0.5rem;
}

h2 {
  color: var(--color-brown);
  font-weight: bold;
}

.stats-summary {
  margin-bottom: 2rem;
  background: #eeeeee;
  padding: 1.5rem;
  border: 2px solid var(--color-black);
  border-radius: 8px;
}

.stats-summary h2 {
  color: var(--color-black);
}

.error {
  color: var(--color-white);
  background: var(--color-brown);
  padding: 1rem;
  border: 2px solid var(--color-orange);
  border-radius: 4px;
  font-weight: bold;
}

.nations-section {
  background: #eeeeee;
  padding: 1.5rem;
  border: 2px solid var(--color-black);
  border-radius: 8px;
}

table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 1rem;
}

th,
td {
  padding: 0.75rem;
  text-align: left;
  border-bottom: 2px solid var(--color-tan);
  color: var(--color-black);
}

th {
  font-weight: bold;
  background: transparent;
  color: var(--color-black);
  border-bottom: 2px solid var(--color-black);
}

tbody tr:hover {
  background: var(--color-tan);
}

tbody tr {
  transition: background 0.2s;
}
</style>
