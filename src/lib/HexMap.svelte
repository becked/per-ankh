<script lang="ts">
  import { onMount, tick } from "svelte";
  import { Deck, OrthographicView } from "@deck.gl/core";
  import { PolygonLayer } from "@deck.gl/layers";
  import type { MapTile } from "$lib/types/MapTile";
  import {
    getCivilizationColor,
    getTerrainColor,
    getHeightColor,
    getVegetationColor,
    getResourceColor,
    getMutedTerrainColor,
  } from "$lib/config";
  import { formatEnum } from "$lib/utils/formatting";

  export type ColorMode = "political" | "religion" | "terrain" | "height" | "vegetation" | "resource";

  let {
    tiles,
    height = "600px",
    totalTurns = null,
    selectedTurn = null,
    onTurnChange = null,
  }: {
    tiles: MapTile[];
    height?: string;
    totalTurns?: number | null;
    selectedTurn?: number | null;
    onTurnChange?: ((turn: number) => void) | null;
  } = $props();

  let colorMode = $state<ColorMode>("political");
  let deckCanvas: HTMLCanvasElement;
  let deck: Deck | null = null;
  let tooltipContent = $state<string | null>(null);
  let tooltipX = $state(0);
  let tooltipY = $state(0);

  // Fullscreen state
  let dialogRef: HTMLDialogElement | null = $state(null);
  let fullscreenCanvas: HTMLCanvasElement;
  let fullscreenDeck: Deck | null = null;
  let isClosing = $state(false);
  let fullscreenTooltipContent = $state<string | null>(null);
  let fullscreenTooltipX = $state(0);
  let fullscreenTooltipY = $state(0);

  const ANIMATION_DURATION = 200;

  const COLOR_MODES: { value: ColorMode; label: string }[] = [
    { value: "political", label: "Political" },
    { value: "religion", label: "Religion" },
  ];

  // Hex geometry constants (flat-top orientation)
  // Use equal spacing so square tile grids appear square
  const HEX_SIZE = 10;
  const HEX_SPACING = HEX_SIZE * 1.5; // Equal horizontal and vertical spacing

  /**
   * Convert axial hex coordinates to pixel position
   * Flat-top hex: odd columns offset down by half spacing
   * Y is negated because deck.gl Y increases upward, but game coordinates Y increases downward
   */
  function hexToPixel(x: number, y: number): [number, number] {
    const px = x * HEX_SPACING;
    const py = -(y * HEX_SPACING + (x % 2 === 1 ? HEX_SPACING / 2 : 0));
    return [px, py];
  }

  /**
   * Generate vertices for a flat-top hexagon centered at given position
   * Slightly adjusted aspect ratio to fill grid cells nicely
   */
  function hexVertices(cx: number, cy: number, size: number): [number, number][] {
    const vertices: [number, number][] = [];
    // Hex radius for x and y to make hexes fill the equal-spaced grid
    const rx = size;
    const ry = size * 0.9; // Slightly shorter to account for equal spacing
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i;
      vertices.push([
        cx + rx * Math.cos(angle),
        cy + ry * Math.sin(angle),
      ]);
    }
    return vertices;
  }

  /**
   * Blend two hex colors together with a given alpha (0-1).
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
   * Convert hex color string to RGB array for deck.gl
   */
  function hexToRgb(hex: string): [number, number, number] {
    const val = parseInt(hex.slice(1), 16);
    return [(val >> 16) & 255, (val >> 8) & 255, val & 255];
  }

  /**
   * Get tile color based on current color mode.
   */
  function getTileColor(tile: MapTile, mode: ColorMode): string {
    switch (mode) {
      case "political":
        if (tile.owner_nation) {
          const nationColor = getCivilizationColor(tile.owner_nation.replace("NATION_", ""));
          if (nationColor) {
            const terrainColor = getMutedTerrainColor(tile.terrain, tile.height, tile.vegetation);
            return blendColors(nationColor, terrainColor, 0.65);
          }
          return getTerrainColor(tile.terrain);
        }
        return getMutedTerrainColor(tile.terrain, tile.height, tile.vegetation);
      case "religion":
        if (tile.religion && tile.religion_founder_nation) {
          const nationColor = getCivilizationColor(tile.religion_founder_nation.replace("NATION_", ""));
          if (nationColor) {
            const terrainColor = getMutedTerrainColor(tile.terrain, tile.height, tile.vegetation);
            return blendColors(nationColor, terrainColor, 0.65);
          }
        }
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

  /**
   * Build tooltip HTML content for a tile
   */
  function buildTooltipContent(tile: MapTile, mode: ColorMode): string {
    const lines = [`<b>(${tile.x}, ${tile.y})</b>`];

    if (mode === "political" || mode === "religion") {
      // Religion mode shows religion info prominently at top
      if (mode === "religion") {
        if (tile.religion) {
          lines.push(`Religion: ${formatEnum(tile.religion, "RELIGION_")}`);
          if (tile.religion_founder_nation) {
            lines.push(`Founded by: ${formatEnum(tile.religion_founder_nation, "NATION_")}`);
          }
        } else {
          lines.push(`Religion: None`);
        }
      }
      if (tile.owner_nation) {
        lines.push(`Owner: ${formatEnum(tile.owner_nation, "NATION_")}`);
      }
      if (tile.owner_city) {
        lines.push(`City: ${formatEnum(tile.owner_city, "CITYNAME_")}`);
      }
      if (tile.terrain && tile.terrain !== "TERRAIN_URBAN") {
        lines.push(`Terrain: ${formatEnum(tile.terrain, "TERRAIN_")}`);
      }
      if (tile.height && tile.height !== "HEIGHT_FLAT") {
        lines.push(`Elevation: ${formatEnum(tile.height, "HEIGHT_")}`);
      }
      if (tile.vegetation && tile.vegetation !== "VEGETATION_NONE") {
        lines.push(`Vegetation: ${formatEnum(tile.vegetation, "VEGETATION_")}`);
      }
      if (tile.resource) {
        lines.push(`Resource: ${formatEnum(tile.resource, "RESOURCE_")}`);
      }
      if (tile.improvement) {
        let imp = formatEnum(tile.improvement, "IMPROVEMENT_");
        if (imp.startsWith("Shrine ")) {
          imp = imp.replace("Shrine ", "") + " Shrine";
        } else if (imp.startsWith("Monastery ")) {
          imp = imp.replace("Monastery ", "") + " Monastery";
        }
        if (tile.improvement_pillaged) imp += " (Pillaged)";
        lines.push(`Improvement: ${imp}`);
      }
      if (tile.specialist) {
        lines.push(`Specialist: ${formatEnum(tile.specialist, "SPECIALIST_")}`);
      }
      if (tile.tribe_site) {
        lines.push(`Tribe Site: ${formatEnum(tile.tribe_site, "TRIBE_")}`);
      }
      // Only show religion in political mode (religion mode shows it at the top)
      if (mode === "political" && tile.religion) {
        lines.push(`Religion: ${formatEnum(tile.religion, "RELIGION_")}`);
      }
      if (tile.has_road) {
        lines.push(`Road: Yes`);
      }
      const rivers: string[] = [];
      if (tile.river_w) rivers.push("W");
      if (tile.river_sw) rivers.push("SW");
      if (tile.river_se) rivers.push("SE");
      if (rivers.length > 0) {
        lines.push(`Rivers: ${rivers.join(", ")}`);
      }
    } else {
      if (mode === "terrain" && tile.terrain) {
        lines.push(`Terrain: ${formatEnum(tile.terrain, "TERRAIN_")}`);
      }
      if (mode === "height" && tile.height) {
        lines.push(`Elevation: ${formatEnum(tile.height, "HEIGHT_")}`);
      }
      if (mode === "vegetation" && tile.vegetation) {
        lines.push(`Vegetation: ${formatEnum(tile.vegetation, "VEGETATION_")}`);
      }
      if (mode === "resource" && tile.resource) {
        lines.push(`Resource: ${formatEnum(tile.resource, "RESOURCE_")}`);
      }
    }
    return lines.join("<br/>");
  }

  // Turn slider handling with debounce
  let sliderDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  function handleSliderChange(event: Event) {
    const target = event.target as HTMLInputElement;
    const turn = parseInt(target.value, 10);

    if (sliderDebounceTimer) {
      clearTimeout(sliderDebounceTimer);
    }

    sliderDebounceTimer = setTimeout(() => {
      onTurnChange?.(turn);
    }, 100);
  }

  const showTurnSlider = $derived(
    (colorMode === "political" || colorMode === "religion") && totalTurns != null && selectedTurn != null && onTurnChange != null
  );

  // Playback state
  let isPlaying = $state(false);
  let playbackInterval: ReturnType<typeof setInterval> | null = null;
  const PLAYBACK_SPEED_MS = 300; // Time between turns in milliseconds

  function startPlayback() {
    if (isPlaying || !totalTurns || selectedTurn == null) return;

    // If at the end, start from beginning
    if (selectedTurn >= totalTurns) {
      onTurnChange?.(1);
    }

    isPlaying = true;
    playbackInterval = setInterval(() => {
      if (selectedTurn != null && totalTurns != null) {
        if (selectedTurn >= totalTurns) {
          // Reached the end, stop playing
          stopPlayback();
        } else {
          onTurnChange?.(selectedTurn + 1);
        }
      }
    }, PLAYBACK_SPEED_MS);
  }

  function stopPlayback() {
    isPlaying = false;
    if (playbackInterval) {
      clearInterval(playbackInterval);
      playbackInterval = null;
    }
  }

  function togglePlayback() {
    if (isPlaying) {
      stopPlayback();
    } else {
      startPlayback();
    }
  }

  // Clean up playback on unmount
  $effect(() => {
    return () => {
      if (playbackInterval) {
        clearInterval(playbackInterval);
      }
    };
  });

  // Prepare tile data with polygon vertices
  interface TileData {
    tile: MapTile;
    polygon: [number, number][];
    color: [number, number, number];
  }

  function prepareTileData(mode: ColorMode): TileData[] {
    return tiles.map((tile) => {
      const [px, py] = hexToPixel(tile.x, tile.y);
      return {
        tile,
        polygon: hexVertices(px, py, HEX_SIZE),
        color: hexToRgb(getTileColor(tile, mode)),
      };
    });
  }

  // Calculate initial view bounds
  function calculateViewState(canvas?: HTMLCanvasElement) {
    if (tiles.length === 0) {
      return { target: [0, 0, 0], zoom: 0 };
    }

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    for (const tile of tiles) {
      const [px, py] = hexToPixel(tile.x, tile.y);
      minX = Math.min(minX, px);
      maxX = Math.max(maxX, px);
      minY = Math.min(minY, py);
      maxY = Math.max(maxY, py);
    }

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const mapWidth = maxX - minX + HEX_SPACING * 2;
    const mapHeight = maxY - minY + HEX_SPACING * 2;

    const containerWidth = canvas?.clientWidth || deckCanvas?.clientWidth || 800;
    const containerHeight = canvas?.clientHeight || deckCanvas?.clientHeight || 600;

    // Calculate zoom to fit both dimensions in container
    const scaleX = containerWidth / mapWidth;
    const scaleY = containerHeight / mapHeight;
    const scale = Math.min(scaleX, scaleY) * 0.95;
    const zoom = Math.log2(scale);

    return { target: [centerX, centerY, 0], zoom };
  }

  function createLayer(mode: ColorMode) {
    const data = prepareTileData(mode);

    return new PolygonLayer<TileData>({
      id: "hex-layer",
      data,
      getPolygon: (d) => d.polygon,
      getFillColor: (d) => d.color,
      getLineColor: [40, 40, 40],
      getLineWidth: 1,
      lineWidthMinPixels: 0.5,
      pickable: true,
      stroked: true,
      filled: true,
      extruded: false,
      transitions: {
        getFillColor: 200,
      },
    });
  }

  function initDeck() {
    if (!deckCanvas) return;

    const width = deckCanvas.clientWidth;
    const height = deckCanvas.clientHeight;
    if (width === 0 || height === 0) return;

    // Clean up existing deck to prevent WebGL context accumulation
    if (deck) {
      deck.finalize();
      deck = null;
    }

    // Set canvas pixel dimensions to match CSS dimensions (prevents stretching)
    deckCanvas.width = width * window.devicePixelRatio;
    deckCanvas.height = height * window.devicePixelRatio;

    const viewState = calculateViewState();

    deck = new Deck({
      canvas: deckCanvas,
      width,
      height,
      useDevicePixels: true,
      views: new OrthographicView({ id: "ortho", controller: false }),
      initialViewState: {
        ...viewState,
        minZoom: -2,
        maxZoom: 6,
      },
      controller: false,
      getCursor: () => "default",
      layers: [createLayer(colorMode)],
      onHover: ({ object, x, y }: { object?: TileData; x: number; y: number }) => {
        if (object) {
          tooltipContent = buildTooltipContent(object.tile, colorMode);
          tooltipX = x;
          tooltipY = y;
        } else {
          tooltipContent = null;
        }
      },
    });
  }

  function initFullscreenDeck() {
    if (!fullscreenCanvas) return;

    const width = fullscreenCanvas.clientWidth;
    const height = fullscreenCanvas.clientHeight;
    if (width === 0 || height === 0) return;

    // Clean up existing fullscreen deck to prevent WebGL context accumulation
    if (fullscreenDeck) {
      fullscreenDeck.finalize();
      fullscreenDeck = null;
    }

    // Set canvas pixel dimensions to match CSS dimensions (prevents stretching)
    fullscreenCanvas.width = width * window.devicePixelRatio;
    fullscreenCanvas.height = height * window.devicePixelRatio;

    const viewState = calculateViewState(fullscreenCanvas);

    fullscreenDeck = new Deck({
      canvas: fullscreenCanvas,
      width,
      height,
      useDevicePixels: true,
      views: new OrthographicView({ id: "ortho", controller: false }),
      initialViewState: {
        ...viewState,
        minZoom: -2,
        maxZoom: 6,
      },
      controller: false,
      getCursor: () => "default",
      layers: [createLayer(colorMode)],
      onHover: ({ object, x, y }: { object?: TileData; x: number; y: number }) => {
        if (object) {
          fullscreenTooltipContent = buildTooltipContent(object.tile, colorMode);
          fullscreenTooltipX = x;
          fullscreenTooltipY = y;
        } else {
          fullscreenTooltipContent = null;
        }
      },
    });
  }

  function openFullscreen() {
    dialogRef?.showModal();
    tick().then(() => {
      if (fullscreenCanvas && !fullscreenDeck) {
        initFullscreenDeck();
      }
      if (fullscreenDeck && fullscreenCanvas) {
        fullscreenDeck.setProps({
          width: fullscreenCanvas.clientWidth,
          height: fullscreenCanvas.clientHeight,
          layers: [createLayer(colorMode)],
        });
      }
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

  onMount(() => {
    let lastWidth = 0;
    let lastHeight = 0;
    let checkIntervalId: ReturnType<typeof setInterval> | null = null;

    // Check for visibility changes periodically (less aggressive than RAF)
    function checkVisibility() {
      if (!deckCanvas) return;

      const width = deckCanvas.clientWidth;
      const height = deckCanvas.clientHeight;

      // Only act if dimensions actually changed
      if (width === lastWidth && height === lastHeight) return;

      // Detect when canvas becomes visible (dimensions change from 0 to non-zero)
      if (width > 0 && height > 0 && (lastWidth === 0 || lastHeight === 0) && !deck) {
        initDeck();
      }

      lastWidth = width;
      lastHeight = height;
    }

    // Check visibility every 100ms (much less aggressive than RAF)
    checkIntervalId = setInterval(checkVisibility, 100);

    // Also try to init after a tick
    tick().then(() => {
      if (!deck && deckCanvas && deckCanvas.clientWidth > 0) {
        initDeck();
        lastWidth = deckCanvas.clientWidth;
        lastHeight = deckCanvas.clientHeight;
      }
    });

    return () => {
      if (checkIntervalId !== null) {
        clearInterval(checkIntervalId);
      }
      // Clean up WebGL contexts to prevent "too many contexts" error
      if (deck) {
        deck.finalize();
        deck = null;
      }
      if (fullscreenDeck) {
        fullscreenDeck.finalize();
        fullscreenDeck = null;
      }
    };
  });

  // Track previous tile count to detect game changes
  let prevTileCount = $state(0);

  // Update layers when tiles or color mode changes
  $effect(() => {
    const mode = colorMode;
    const currentTiles = tiles;
    const tileCount = currentTiles.length;

    // If tile count changed significantly, reinitialize deck with new view bounds
    if (tileCount > 0 && Math.abs(tileCount - prevTileCount) > 100) {
      prevTileCount = tileCount;
      // Reinitialize to get correct view bounds for new map
      if (deckCanvas) {
        initDeck();
      }
      return;
    }
    prevTileCount = tileCount;

    // If deck doesn't exist but we have tiles and a valid canvas, initialize it
    // This handles the case when switching back to the Map tab
    if (!deck && currentTiles.length > 0 && deckCanvas && deckCanvas.clientWidth > 0) {
      initDeck();
    }

    if (deck && currentTiles.length > 0) {
      deck.setProps({
        layers: [createLayer(mode)],
      });
    }
    if (fullscreenDeck && currentTiles.length > 0) {
      fullscreenDeck.setProps({
        layers: [createLayer(mode)],
      });
    }
  });
</script>

<div class="flex flex-col gap-4">
  <!-- Controls row: Color mode selector + Turn slider -->
  <div class="flex flex-wrap items-center gap-4">
    <!-- Color mode buttons -->
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

    <!-- Turn slider (only in political mode) -->
    {#if showTurnSlider}
      <div class="flex items-center gap-3 ml-auto">
        <span class="text-brown text-sm font-bold">Turn:</span>
        <!-- Play/Pause button -->
        <button
          onclick={togglePlayback}
          class="p-1.5 rounded bg-brown/30 hover:bg-brown/50 transition-colors"
          aria-label={isPlaying ? "Pause" : "Play"}
          title={isPlaying ? "Pause" : "Play"}
        >
          {#if isPlaying}
            <!-- Pause icon -->
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-tan" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          {:else}
            <!-- Play icon -->
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-tan" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          {/if}
        </button>
        <input
          type="range"
          min="1"
          max={totalTurns}
          value={selectedTurn}
          oninput={handleSliderChange}
          class="turn-slider w-48"
        />
        <span class="text-tan text-sm font-bold w-8 text-right">{selectedTurn}</span>
      </div>
    {/if}
  </div>

  <!-- Map container -->
  <div class="relative border-2 border-tan rounded-lg overflow-hidden" style="background-color: #1a1a1a">
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
      <canvas bind:this={deckCanvas} class="w-full h-full"></canvas>
    </div>

    <!-- Custom tooltip -->
    {#if tooltipContent}
      <div
        class="tooltip"
        style="left: {tooltipX + 10}px; top: {tooltipY + 10}px;"
      >
        {@html tooltipContent}
      </div>
    {/if}
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

    <!-- Controls in fullscreen -->
    <div class="mb-4 flex-shrink-0 bg-black/90 rounded-lg px-4 py-3">
      <div class="flex flex-wrap items-center gap-4">
        <!-- Color mode buttons -->
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

        <!-- Turn slider (only in political mode) -->
        {#if showTurnSlider}
          <div class="flex items-center gap-3 ml-auto">
            <span class="text-brown text-sm font-bold">Turn:</span>
            <!-- Play/Pause button -->
            <button
              onclick={togglePlayback}
              class="p-1.5 rounded bg-brown/30 hover:bg-brown/50 transition-colors"
              aria-label={isPlaying ? "Pause" : "Play"}
              title={isPlaying ? "Pause" : "Play"}
            >
              {#if isPlaying}
                <!-- Pause icon -->
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-tan" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="4" width="4" height="16" />
                  <rect x="14" y="4" width="4" height="16" />
                </svg>
              {:else}
                <!-- Play icon -->
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-tan" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              {/if}
            </button>
            <input
              type="range"
              min="1"
              max={totalTurns}
              value={selectedTurn}
              oninput={handleSliderChange}
              class="turn-slider w-64"
            />
            <span class="text-tan text-sm font-bold w-8 text-right">{selectedTurn}</span>
          </div>
        {/if}
      </div>
    </div>

    <!-- Fullscreen map -->
    <div class="flex-1 min-h-0 rounded-lg overflow-hidden relative" style="background-color: #1a1a1a">
      <canvas bind:this={fullscreenCanvas} class="w-full h-full"></canvas>

      <!-- Fullscreen tooltip -->
      {#if fullscreenTooltipContent}
        <div
          class="tooltip"
          style="left: {fullscreenTooltipX + 10}px; top: {fullscreenTooltipY + 10}px;"
        >
          {@html fullscreenTooltipContent}
        </div>
      {/if}
    </div>
  </div>
</dialog>

<style>
  .tooltip {
    position: absolute;
    background: rgba(50, 50, 50, 0.95);
    color: white;
    padding: 8px 12px;
    border-radius: 4px;
    font-size: 12px;
    line-height: 1.4;
    pointer-events: none;
    z-index: 100;
    max-width: 250px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }

  /* Turn slider styling */
  .turn-slider {
    -webkit-appearance: none;
    appearance: none;
    height: 6px;
    background: #4a4540;
    border-radius: 3px;
    outline: none;
    cursor: pointer;
  }

  .turn-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 16px;
    height: 16px;
    background: var(--color-brown);
    border-radius: 50%;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .turn-slider::-webkit-slider-thumb:hover {
    background: var(--color-tan);
  }

  .turn-slider::-moz-range-thumb {
    width: 16px;
    height: 16px;
    background: var(--color-brown);
    border-radius: 50%;
    cursor: pointer;
    border: none;
    transition: background 0.15s ease;
  }

  .turn-slider::-moz-range-thumb:hover {
    background: var(--color-tan);
  }

  /* Fullscreen dialog styles */
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
