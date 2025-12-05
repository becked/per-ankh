<script lang="ts">
  import { onMount, tick } from "svelte";
  import * as echarts from "echarts";
  import type { MapTile } from "$lib/types/MapTile";
  import {
    getCivilizationColor,
    getTerrainColor,
    getHeightColor,
    getVegetationColor,
    getResourceColor,
    getMutedTerrainColor,
  } from "$lib/config";

  export type ColorMode = "political" | "terrain" | "height" | "vegetation" | "resource";

  let {
    tiles,
    height = "600px",
  }: {
    tiles: MapTile[];
    height?: string;
  } = $props();

  let colorMode = $state<ColorMode>("political");
  let chartContainer: HTMLDivElement;
  let chart: echarts.ECharts | null = null;

  // Fullscreen dialog state
  let dialogRef: HTMLDialogElement | null = $state(null);
  let fullscreenChartContainer: HTMLDivElement;
  let fullscreenChart: echarts.ECharts | null = null;
  let isClosing = $state(false);

  const ANIMATION_DURATION = 200; // ms - keep in sync with CSS

  function openFullscreen() {
    dialogRef?.showModal();
    // Initialize fullscreen chart after dialog opens
    tick().then(() => {
      if (fullscreenChartContainer && !fullscreenChart) {
        fullscreenChart = echarts.init(fullscreenChartContainer);
        if (chartOption) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          fullscreenChart.setOption(chartOption as any);
        }
      }
      fullscreenChart?.resize();
    });
  }

  function closeFullscreen() {
    if (!dialogRef || isClosing) return;
    isClosing = true;
    setTimeout(() => {
      dialogRef?.close();
      isClosing = false;
    }, ANIMATION_DURATION);
  }

  function handleDialogClose() {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === dialogRef) {
      closeFullscreen();
    }
  }

  const COLOR_MODES: { value: ColorMode; label: string }[] = [
    { value: "political", label: "Political" },
    { value: "terrain", label: "Terrain" },
    { value: "height", label: "Elevation" },
    { value: "vegetation", label: "Vegetation" },
    { value: "resource", label: "Resources" },
  ];

  // Hex geometry constants (flat-top orientation)
  const HEX_SIZE = 10;
  const HEX_WIDTH = HEX_SIZE * 2;
  const HEX_HEIGHT = Math.sqrt(3) * HEX_SIZE;

  /**
   * Convert axial hex coordinates to pixel position
   * Flat-top hex: odd rows offset right by half width
   */
  function hexToPixel(x: number, y: number): [number, number] {
    const px = x * HEX_WIDTH * 0.75;
    const py = y * HEX_HEIGHT + (x % 2 === 1 ? HEX_HEIGHT / 2 : 0);
    return [px, py];
  }

  /**
   * Generate vertices for a flat-top hexagon with separate x/y scaling
   * to handle non-uniform aspect ratios
   */
  function hexVertices(cx: number, cy: number, sizeX: number, sizeY: number): number[][] {
    const vertices: number[][] = [];
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i;
      vertices.push([
        cx + sizeX * Math.cos(angle),
        cy + sizeY * Math.sin(angle),
      ]);
    }
    return vertices;
  }

  /**
   * Blend two hex colors together with a given alpha (0-1).
   * Result = foreground * alpha + background * (1 - alpha)
   */
  function blendColors(foreground: string, background: string, alpha: number): string {
    const fg = parseInt(foreground.slice(1), 16);
    const bg = parseInt(background.slice(1), 16);

    const fgR = (fg >> 16) & 255;
    const fgG = (fg >> 8) & 255;
    const fgB = fg & 255;

    const bgR = (bg >> 16) & 255;
    const bgG = (bg >> 8) & 255;
    const bgB = bg & 255;

    const r = Math.round(fgR * alpha + bgR * (1 - alpha));
    const g = Math.round(fgG * alpha + bgG * (1 - alpha));
    const b = Math.round(fgB * alpha + bgB * (1 - alpha));

    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
  }

  /**
   * Get tile color based on current color mode.
   * In political mode, unowned tiles show terrain color.
   */
  function getTileColor(tile: MapTile, mode: ColorMode): string {
    switch (mode) {
      case "political":
        if (tile.owner_nation) {
          const nationColor = getCivilizationColor(tile.owner_nation.replace("NATION_", ""));
          if (nationColor) {
            // Blend nation color over terrain so features show through
            const terrainColor = getMutedTerrainColor(tile.terrain, tile.height, tile.vegetation);
            return blendColors(nationColor, terrainColor, 0.65);
          }
          return getTerrainColor(tile.terrain);
        }
        // Unclaimed tiles show muted terrain features
        return getMutedTerrainColor(tile.terrain, tile.height, tile.vegetation);
      case "terrain":
        return getTerrainColor(tile.terrain);
      case "height":
        return getHeightColor(tile.height);
      case "vegetation":
        return getVegetationColor(tile.vegetation);
      case "resource":
        return tile.resource ? getResourceColor(tile.resource) : getTerrainColor(tile.terrain);
      default:
        return getTerrainColor(tile.terrain);
    }
  }

  function buildChartOption(mode: ColorMode) {
    if (!tiles.length) return null;

    return {
      backgroundColor: "#1a1a1a",
      animation: false,
      grid: {
        left: 20,
        right: 20,
        top: 20,
        bottom: 20,
        containLabel: false,
      },
      tooltip: {
        trigger: "item",
        formatter: (params: { data: { tile: MapTile } }) => {
          const t = params.data.tile;
          const lines = [`<b>(${t.x}, ${t.y})</b>`];

          if (mode === "political") {
            // Show all tile info in political mode
            if (t.owner_nation) {
              lines.push(`Owner: ${t.owner_nation.replace("NATION_", "")}`);
            }
            if (t.owner_city) {
              lines.push(`City: ${t.owner_city.replace("CITYNAME_", "")}`);
            }
            if (t.terrain) {
              lines.push(`Terrain: ${t.terrain.replace("TERRAIN_", "")}`);
            }
            if (t.height && t.height !== "HEIGHT_FLAT") {
              lines.push(`Elevation: ${t.height.replace("HEIGHT_", "")}`);
            }
            if (t.vegetation && t.vegetation !== "VEGETATION_NONE") {
              lines.push(`Vegetation: ${t.vegetation.replace("VEGETATION_", "")}`);
            }
            if (t.resource) {
              lines.push(`Resource: ${t.resource.replace("RESOURCE_", "")}`);
            }
            if (t.improvement) {
              let imp = t.improvement.replace("IMPROVEMENT_", "");
              if (t.improvement_pillaged) imp += " (Pillaged)";
              lines.push(`Improvement: ${imp}`);
            }
            if (t.specialist) {
              lines.push(`Specialist: ${t.specialist.replace("SPECIALIST_", "")}`);
            }
            if (t.tribe_site) {
              lines.push(`Tribe Site: ${t.tribe_site.replace("TRIBE_", "")}`);
            }
            if (t.religion) {
              lines.push(`Religion: ${t.religion.replace("RELIGION_", "")}`);
            }
            if (t.has_road) {
              lines.push(`Road: Yes`);
            }
            // Rivers
            const rivers: string[] = [];
            if (t.river_w) rivers.push("W");
            if (t.river_sw) rivers.push("SW");
            if (t.river_se) rivers.push("SE");
            if (rivers.length > 0) {
              lines.push(`Rivers: ${rivers.join(", ")}`);
            }
          } else {
            // Other modes show mode-specific info
            if (mode === "terrain" && t.terrain) {
              lines.push(`Terrain: ${t.terrain.replace("TERRAIN_", "")}`);
            }
            if (mode === "height" && t.height) {
              lines.push(`Elevation: ${t.height.replace("HEIGHT_", "")}`);
            }
            if (mode === "vegetation" && t.vegetation) {
              lines.push(`Vegetation: ${t.vegetation.replace("VEGETATION_", "")}`);
            }
            if (mode === "resource" && t.resource) {
              lines.push(`Resource: ${t.resource.replace("RESOURCE_", "")}`);
            }
          }
          return lines.join("<br/>");
        },
      },
      xAxis: { show: false, min: "dataMin", max: "dataMax" },
      yAxis: { show: false, min: "dataMin", max: "dataMax", inverse: true },
      series: [{
        type: "custom",
        coordinateSystem: "cartesian2d",
        renderItem: (params: unknown, api: {
          value: (idx: number) => number;
          coord: (val: [number, number]) => [number, number];
          style: (opts: { fill: string }) => Record<string, unknown>;
        }) => {
          const px = api.value(0) as number;
          const py = api.value(1) as number;
          const color = api.value(2) as unknown as string;
          const [cx, cy] = api.coord([px, py]);

          // Calculate screen scale for both axes independently
          const [x0, y0] = api.coord([0, 0]);
          const [x1] = api.coord([HEX_WIDTH * 0.75, 0]); // One horizontal step
          const [, y1] = api.coord([0, HEX_HEIGHT]); // One vertical step

          const screenHSpacing = x1 - x0;
          const screenVSpacing = Math.abs(y1 - y0);

          // For flat-top hexes: h_spacing = 1.5 * rX, v_spacing = sqrt(3) * rY
          // Calculate independent X and Y radii to handle aspect ratio distortion
          const screenHexSizeX = screenHSpacing / 1.5;
          const screenHexSizeY = screenVSpacing / Math.sqrt(3);

          return {
            type: "polygon",
            shape: { points: hexVertices(cx, cy, screenHexSizeX, screenHexSizeY) },
            style: api.style({ fill: color }),
          };
        },
        data: tiles.map((tile) => {
          const [px, py] = hexToPixel(tile.x, tile.y);
          return {
            value: [px, py, getTileColor(tile, mode)],
            tile,
          };
        }),
      }],
    };
  }

  const chartOption = $derived(buildChartOption(colorMode));

  onMount(() => {
    let resizeObserver: ResizeObserver;

    const initChart = () => {
      if (!chartContainer || chartContainer.clientWidth === 0) return;
      if (!chart) {
        chart = echarts.init(chartContainer);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (chartOption) chart.setOption(chartOption as any);
      }
    };

    tick().then(() => {
      initChart();
      resizeObserver = new ResizeObserver(() => {
        if (!chart && chartContainer) initChart();
        chart?.resize();
      });
      resizeObserver.observe(chartContainer);
    });

    window.addEventListener("resize", () => chart?.resize());

    return () => {
      resizeObserver?.disconnect();
      chart?.dispose();
    };
  });

  $effect(() => {
    // Access chartOption unconditionally to ensure it's tracked
    const opt = chartOption;
    if (chart && opt) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      chart.setOption(opt as any, true);
    }
    // Keep fullscreen chart in sync
    if (fullscreenChart && opt) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fullscreenChart.setOption(opt as any, true);
    }
  });

  // Cleanup fullscreen chart on unmount
  $effect(() => {
    return () => {
      fullscreenChart?.dispose();
    };
  });
</script>

<div class="flex flex-col gap-4">
  <!-- Color mode selector -->
  <div class="flex gap-2">
    {#each COLOR_MODES as mode}
      <button
        class="px-4 py-2 rounded border-2 border-black font-bold text-sm transition-colors {colorMode === mode.value ? 'bg-brown text-tan' : 'bg-transparent text-brown hover:bg-brown/30'}"
        onclick={() => colorMode = mode.value}
      >
        {mode.label}
      </button>
    {/each}
  </div>

  <!-- Map container -->
  <div class="relative border-2 border-tan rounded-lg overflow-hidden" style="background-color: var(--color-chart-frame)">
    <!-- Expand button -->
    <button
      onclick={openFullscreen}
      class="absolute top-3 right-3 z-10 p-1.5 rounded bg-black/20 hover:bg-black/40 transition-colors cursor-pointer focus:outline-none"
      aria-label="Expand map to fullscreen"
      title="Expand to fullscreen"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="h-4 w-4 text-white"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        stroke-width="2"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
        />
      </svg>
    </button>

    <div class="w-full" style="height: {height}">
      <div bind:this={chartContainer} class="w-full h-full"></div>
    </div>
  </div>
</div>

<!-- Fullscreen dialog -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<dialog
  bind:this={dialogRef}
  onclick={handleBackdropClick}
  onclose={handleDialogClose}
  class="fullscreen-dialog {isClosing ? 'closing' : ''}"
>
  <div class="dialog-content">
    <!-- Close button -->
    <button
      onclick={closeFullscreen}
      class="absolute top-0 right-0 z-10 p-2 rounded bg-black/30 hover:bg-black/50 transition-colors cursor-pointer focus:outline-none"
      aria-label="Close fullscreen"
      title="Close fullscreen (Esc)"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="h-5 w-5 text-white"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        stroke-width="2"
      >
        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>

    <!-- Color mode selector in fullscreen -->
    <div class="mb-4 flex-shrink-0 bg-black/90 rounded-lg px-4 py-3">
      <div class="flex gap-2">
        {#each COLOR_MODES as mode}
          <button
            class="px-4 py-2 rounded border-2 border-black font-bold text-sm transition-colors {colorMode === mode.value ? 'bg-brown text-tan' : 'bg-transparent text-brown hover:bg-brown/30'}"
            onclick={() => colorMode = mode.value}
          >
            {mode.label}
          </button>
        {/each}
      </div>
    </div>

    <!-- Fullscreen map -->
    <div class="flex-1 min-h-0 rounded-lg overflow-hidden" style="background-color: var(--color-chart-frame)">
      <div bind:this={fullscreenChartContainer} class="w-full h-full"></div>
    </div>
  </div>
</dialog>

<style>
  .fullscreen-dialog {
    border: none;
    padding: 0;
    background: transparent;
    max-width: none;
    max-height: none;
    width: 100vw;
    height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    outline: none;
  }

  .fullscreen-dialog[open] {
    animation: dialogFadeIn 0.2s ease-out;
  }

  .fullscreen-dialog[open] .dialog-content {
    animation: dialogZoomIn 0.2s ease-out;
  }

  .fullscreen-dialog[open]::backdrop {
    animation: backdropFadeIn 0.2s ease-out;
  }

  .fullscreen-dialog.closing {
    animation: dialogFadeOut 0.2s ease-in forwards;
  }

  .fullscreen-dialog.closing .dialog-content {
    animation: dialogZoomOut 0.2s ease-in forwards;
  }

  .fullscreen-dialog.closing::backdrop {
    animation: backdropFadeOut 0.2s ease-in forwards;
  }

  @keyframes dialogFadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes dialogFadeOut {
    from { opacity: 1; }
    to { opacity: 0; }
  }

  @keyframes dialogZoomIn {
    from {
      opacity: 0;
      transform: scale(0.95);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  @keyframes dialogZoomOut {
    from {
      opacity: 1;
      transform: scale(1);
    }
    to {
      opacity: 0;
      transform: scale(0.95);
    }
  }

  @keyframes backdropFadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes backdropFadeOut {
    from { opacity: 1; }
    to { opacity: 0; }
  }

  .fullscreen-dialog::backdrop {
    background: rgba(0, 0, 0, 0.8);
  }

  .dialog-content {
    position: relative;
    width: 95vw;
    height: 90vh;
    max-width: 95vw;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    border: 2px solid var(--color-tan);
    border-radius: 0.5rem;
    padding: 1rem;
    background-color: #35302B;
  }
</style>
