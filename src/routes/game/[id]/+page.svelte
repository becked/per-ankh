<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { page } from "$app/stores";
  import type { GameDetails, PlayerHistory } from "$lib/types";
  import type { EChartsOption } from "echarts";
  import Chart from "$lib/Chart.svelte";

  let gameDetails = $state<GameDetails | null>(null);
  let playerHistory = $state<PlayerHistory[] | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  const colors = ["#C87941", "#8B4513", "#CD853F", "#A0522D", "#D2691E", "#B8860B"];

  // Generate chart options for each metric
  const pointsChartOption = $derived<EChartsOption | null>(
    playerHistory
      ? {
          title: {
            text: "Victory Points",
            left: "center",
            textStyle: { color: "#1a1a1a", fontWeight: "bold" },
          },
          tooltip: {
            trigger: "axis",
          },
          legend: {
            data: playerHistory.map((p) => p.player_name),
            top: 30,
          },
          xAxis: {
            type: "category",
            name: "Turn",
            data: playerHistory[0]?.history.map((h) => h.turn) || [],
          },
          yAxis: {
            type: "value",
            name: "Points",
          },
          series: playerHistory.map((player, i) => ({
            name: player.player_name,
            type: "line",
            data: player.history.map((h) => h.points),
            itemStyle: { color: colors[i % colors.length] },
          })),
        }
      : null
  );

  const militaryChartOption = $derived<EChartsOption | null>(
    playerHistory
      ? {
          title: {
            text: "Military Power",
            left: "center",
            textStyle: { color: "#1a1a1a", fontWeight: "bold" },
          },
          tooltip: {
            trigger: "axis",
          },
          legend: {
            data: playerHistory.map((p) => p.player_name),
            top: 30,
          },
          xAxis: {
            type: "category",
            name: "Turn",
            data: playerHistory[0]?.history.map((h) => h.turn) || [],
          },
          yAxis: {
            type: "value",
            name: "Military Power",
          },
          series: playerHistory.map((player, i) => ({
            name: player.player_name,
            type: "line",
            data: player.history.map((h) => h.military_power),
            itemStyle: { color: colors[i % colors.length] },
          })),
        }
      : null
  );

  const legitimacyChartOption = $derived<EChartsOption | null>(
    playerHistory
      ? {
          title: {
            text: "Legitimacy",
            left: "center",
            textStyle: { color: "#1a1a1a", fontWeight: "bold" },
          },
          tooltip: {
            trigger: "axis",
          },
          legend: {
            data: playerHistory.map((p) => p.player_name),
            top: 30,
          },
          xAxis: {
            type: "category",
            name: "Turn",
            data: playerHistory[0]?.history.map((h) => h.turn) || [],
          },
          yAxis: {
            type: "value",
            name: "Legitimacy",
          },
          series: playerHistory.map((player, i) => ({
            name: player.player_name,
            type: "line",
            data: player.history.map((h) => h.legitimacy),
            itemStyle: { color: colors[i % colors.length] },
          })),
        }
      : null
  );

  // Reactively load game details when the route parameter changes
  $effect(() => {
    const matchId = Number($page.params.id);

    loading = true;
    error = null;
    gameDetails = null;
    playerHistory = null;

    Promise.all([
      invoke<GameDetails>("get_game_details", { matchId }),
      invoke<PlayerHistory[]>("get_player_history", { matchId }),
    ])
      .then(([details, history]) => {
        gameDetails = details;
        playerHistory = history;
      })
      .catch((err) => {
        error = String(err);
      })
      .finally(() => {
        loading = false;
      });
  });

  function formatNation(nation: string | null): string {
    if (!nation) return "Unknown";
    // Convert NATION_ASSYRIA to Assyria
    return nation.replace("NATION_", "").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  }

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return "Unknown";
    const date = new Date(dateStr);
    return date.toLocaleDateString();
  }
</script>

<main class="container">
    {#if loading}
      <p>Loading game details...</p>
    {:else if error}
      <p class="error">Error: {error}</p>
    {:else if gameDetails}
      <h1>{gameDetails.game_name || `Game ${gameDetails.match_id}`}</h1>

      <div class="game-info-section">
        <h2>Game Information</h2>
        <div class="info-grid">
          <div class="info-item">
            <span class="info-label">Save Date:</span>
            <span class="info-value">{formatDate(gameDetails.save_date)}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Turn:</span>
            <span class="info-value">{gameDetails.total_turns}</span>
          </div>
          {#if gameDetails.map_size}
            <div class="info-item">
              <span class="info-label">Map Size:</span>
              <span class="info-value">{gameDetails.map_size.replace("MAPSIZE_", "")}</span>
            </div>
          {/if}
          {#if gameDetails.map_width && gameDetails.map_height}
            <div class="info-item">
              <span class="info-label">Map Dimensions:</span>
              <span class="info-value">{gameDetails.map_width} × {gameDetails.map_height}</span>
            </div>
          {/if}
          {#if gameDetails.game_mode}
            <div class="info-item">
              <span class="info-label">Game Mode:</span>
              <span class="info-value">{gameDetails.game_mode}</span>
            </div>
          {/if}
          {#if gameDetails.opponent_level}
            <div class="info-item">
              <span class="info-label">Difficulty:</span>
              <span class="info-value">{gameDetails.opponent_level.replace("LEVEL_", "")}</span>
            </div>
          {/if}
        </div>
      </div>

      <div class="players-section">
        <h2>Players ({gameDetails.players.length})</h2>
        <table>
          <thead>
            <tr>
              <th>Player</th>
              <th>Nation</th>
              <th>Type</th>
              <th>Legitimacy</th>
              <th>State Religion</th>
            </tr>
          </thead>
          <tbody>
            {#each gameDetails.players as player}
              <tr>
                <td>{player.player_name}</td>
                <td>{formatNation(player.nation)}</td>
                <td>{player.is_human ? "Human" : "AI"}</td>
                <td>{player.legitimacy ?? "—"}</td>
                <td>{player.state_religion ? player.state_religion.replace("RELIGION_", "") : "—"}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      {#if pointsChartOption}
        <div class="chart-section">
          <Chart option={pointsChartOption} height="400px" />
        </div>
      {/if}

      {#if militaryChartOption}
        <div class="chart-section">
          <Chart option={militaryChartOption} height="400px" />
        </div>
      {/if}

      {#if legitimacyChartOption}
        <div class="chart-section">
          <Chart option={legitimacyChartOption} height="400px" />
        </div>
      {/if}
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
  color: var(--color-black);
  font-weight: bold;
  margin-bottom: 1rem;
}

.error {
  color: var(--color-white);
  background: var(--color-brown);
  padding: 1rem;
  border: 2px solid var(--color-orange);
  border-radius: 4px;
  font-weight: bold;
}

.game-info-section,
.players-section,
.chart-section {
  background: #eeeeee;
  padding: 1.5rem;
  border: 2px solid var(--color-black);
  border-radius: 8px;
  margin-bottom: 2rem;
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 1rem;
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.info-label {
  font-weight: bold;
  color: var(--color-brown);
  font-size: 0.875rem;
}

.info-value {
  color: var(--color-black);
  font-size: 1rem;
}

table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 0;
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
