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
  let activeTab = $state<string>("events");

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

  // Get the human player's nation
  const humanNation = $derived(
    gameDetails?.players.find((p) => p.is_human)?.nation || null
  );
</script>

<main class="container">
    {#if loading}
      <p>Loading game details...</p>
    {:else if error}
      <p class="error">Error: {error}</p>
    {:else if gameDetails}
      <h1>{gameDetails.game_name || `Game ${gameDetails.match_id}`}</h1>

      <!-- Summary Section -->
      <div class="summary-section">
        <div class="summary-grid">
          <div class="summary-item">
            <span class="summary-label">Save Date</span>
            <span class="summary-value">{formatDate(gameDetails.save_date)}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Players</span>
            <span class="summary-value">{gameDetails.players.length}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Human Nation</span>
            <span class="summary-value">{formatNation(humanNation)}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Turns</span>
            <span class="summary-value">{gameDetails.total_turns}</span>
          </div>
        </div>
      </div>

      <!-- Tab Navigation -->
      <div class="tabs">
        <button
          class="tab"
          class:active={activeTab === "events"}
          onclick={() => (activeTab = "events")}
        >
          Events
        </button>
        <button
          class="tab"
          class:active={activeTab === "laws"}
          onclick={() => (activeTab = "laws")}
        >
          Laws & Technology
        </button>
        <button
          class="tab"
          class:active={activeTab === "economics"}
          onclick={() => (activeTab = "economics")}
        >
          Economics
        </button>
        <button
          class="tab"
          class:active={activeTab === "settings"}
          onclick={() => (activeTab = "settings")}
        >
          Game Settings
        </button>
      </div>

      <!-- Tab Content -->
      <div class="tab-content">
        {#if activeTab === "events"}
          <div class="tab-pane">
            <h2>Game History</h2>
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
          </div>
        {:else if activeTab === "laws"}
          <div class="tab-pane">
            <h2>Laws & Technology</h2>
            <p class="placeholder">Coming soon...</p>
          </div>
        {:else if activeTab === "economics"}
          <div class="tab-pane">
            <h2>Economics</h2>
            <p class="placeholder">Coming soon...</p>
          </div>
        {:else if activeTab === "settings"}
          <div class="tab-pane">
            <h2>Game Settings</h2>
            <div class="settings-grid">
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

            <div class="players-section">
              <h3>Players</h3>
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
          </div>
        {/if}
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
  color: var(--color-black);
  font-weight: bold;
  margin-bottom: 1rem;
  margin-top: 0;
}

h3 {
  color: var(--color-black);
  font-weight: bold;
  margin-bottom: 1rem;
  margin-top: 2rem;
  font-size: 1.25rem;
}

.error {
  color: var(--color-white);
  background: var(--color-brown);
  padding: 1rem;
  border: 2px solid var(--color-orange);
  border-radius: 4px;
  font-weight: bold;
}

/* Summary Section */
.summary-section {
  background: #eeeeee;
  padding: 1.5rem;
  border: 2px solid var(--color-black);
  border-radius: 8px;
  margin-bottom: 1.5rem;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1.5rem;
}

.summary-item {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  text-align: center;
}

.summary-label {
  font-weight: bold;
  color: var(--color-brown);
  font-size: 0.875rem;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.summary-value {
  color: var(--color-black);
  font-size: 1.5rem;
  font-weight: bold;
}

/* Tabs */
.tabs {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1.5rem;
  border-bottom: 2px solid var(--color-black);
}

.tab {
  padding: 0.75rem 1.5rem;
  background: var(--color-tan);
  border: 2px solid var(--color-black);
  border-bottom: none;
  border-radius: 8px 8px 0 0;
  font-weight: bold;
  color: var(--color-black);
  cursor: pointer;
  transition: background 0.2s, transform 0.1s;
  position: relative;
  bottom: -2px;
}

.tab:hover {
  background: #d4c4a8;
}

.tab.active {
  background: #eeeeee;
  color: var(--color-black);
}

/* Tab Content */
.tab-content {
  background: #eeeeee;
  padding: 2rem;
  border: 2px solid var(--color-black);
  border-radius: 0 8px 8px 8px;
  min-height: 400px;
}

.tab-pane {
  animation: fadeIn 0.3s;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.placeholder {
  color: var(--color-brown);
  font-style: italic;
  text-align: center;
  padding: 2rem;
  font-size: 1.125rem;
}

/* Settings Grid */
.settings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 1rem;
  margin-bottom: 2rem;
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

/* Chart Section */
.chart-section {
  background: white;
  padding: 1rem;
  border: 2px solid var(--color-tan);
  border-radius: 8px;
  margin-bottom: 1.5rem;
}

/* Players Section */
.players-section {
  margin-top: 2rem;
}

table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 0.5rem;
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
