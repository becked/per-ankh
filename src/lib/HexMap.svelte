<script lang="ts">
  import { onMount, tick } from "svelte";
  import { Deck, OrthographicView } from "@deck.gl/core";
  import { PolygonLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
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

  // Marker visibility toggles
  let showCities = $state(true);
  let showUrbanImprovements = $state(true);
  let showRuralImprovements = $state(true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let deck: Deck<any> | null = null;
  let tooltipContent = $state<string | null>(null);
  let tooltipX = $state(0);
  let tooltipY = $state(0);

  // Fullscreen state
  let dialogRef: HTMLDialogElement | null = $state(null);
  let fullscreenCanvas: HTMLCanvasElement;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fullscreenDeck: Deck<any> | null = null;
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
   * For religion mode, returns the first religion's color (stripes handled separately).
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
        // For single-color fallback, use first religion's founder nation
        if (tile.religions && tile.religions.length > 0) {
          const firstReligion = tile.religions[0];
          if (firstReligion.founder_nation) {
            const nationColor = getCivilizationColor(firstReligion.founder_nation.replace("NATION_", ""));
            if (nationColor) {
              const terrainColor = getMutedTerrainColor(tile.terrain, tile.height, tile.vegetation);
              return blendColors(nationColor, terrainColor, 0.65);
            }
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
        if (tile.religions && tile.religions.length > 0) {
          if (tile.religions.length === 1) {
            const rel = tile.religions[0];
            lines.push(`Religion: ${formatEnum(rel.religion_name, "RELIGION_")}`);
            if (rel.founder_nation) {
              lines.push(`Founded by: ${formatEnum(rel.founder_nation, "NATION_")}`);
            }
          } else {
            lines.push(`<b>Religions:</b>`);
            for (const rel of tile.religions) {
              const name = formatEnum(rel.religion_name, "RELIGION_");
              const founder = rel.founder_nation
                ? ` (${formatEnum(rel.founder_nation, "NATION_")})`
                : "";
              lines.push(`&nbsp;&nbsp;• ${name}${founder}`);
            }
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
      if (tile.is_city_center) {
        lines.push(tile.is_capital ? `City Site (Capital)` : `City Site`);
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
      if (mode === "political" && tile.religions && tile.religions.length > 0) {
        const religionNames = tile.religions.map(r => formatEnum(r.religion_name, "RELIGION_")).join(", ");
        lines.push(`Religion: ${religionNames}`);
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
  let isFastPlaying = $state(false);
  let playbackInterval: ReturnType<typeof setInterval> | null = null;
  const PLAYBACK_SPEED_MS = 300; // Time between turns in milliseconds (normal speed)
  const FAST_PLAYBACK_SPEED_MS = 150; // Time between turns at 2x speed

  function startPlayback(fast: boolean = false) {
    if (!totalTurns || selectedTurn == null) return;

    // Stop any existing playback first
    stopPlayback();

    // If at the end, start from beginning
    if (selectedTurn >= totalTurns) {
      onTurnChange?.(1);
    }

    isPlaying = !fast;
    isFastPlaying = fast;
    const speed = fast ? FAST_PLAYBACK_SPEED_MS : PLAYBACK_SPEED_MS;

    playbackInterval = setInterval(() => {
      if (selectedTurn != null && totalTurns != null) {
        if (selectedTurn >= totalTurns) {
          // Reached the end, stop playing
          stopPlayback();
        } else {
          onTurnChange?.(selectedTurn + 1);
        }
      }
    }, speed);
  }

  function stopPlayback() {
    isPlaying = false;
    isFastPlaying = false;
    if (playbackInterval) {
      clearInterval(playbackInterval);
      playbackInterval = null;
    }
  }

  function togglePlayback() {
    if (isPlaying) {
      stopPlayback();
    } else {
      startPlayback(false);
    }
  }

  function toggleFastPlayback() {
    if (isFastPlaying) {
      stopPlayback();
    } else {
      startPlayback(true);
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

  // Marker data for improvements, cities, capitals
  interface MarkerData {
    position: [number, number];
    tile: MapTile;
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

  // Prepare marker data for urban improvements (on TERRAIN_URBAN, but not city centers)
  function prepareUrbanImprovementMarkers(): MarkerData[] {
    return tiles
      .filter((tile) => tile.improvement && !tile.is_city_center && tile.terrain === "TERRAIN_URBAN")
      .map((tile) => ({
        position: hexToPixel(tile.x, tile.y),
        tile,
      }));
  }

  // Prepare marker data for rural improvements (not on TERRAIN_URBAN, not city centers)
  function prepareRuralImprovementMarkers(): MarkerData[] {
    return tiles
      .filter((tile) => tile.improvement && !tile.is_city_center && tile.terrain !== "TERRAIN_URBAN")
      .map((tile) => ({
        position: hexToPixel(tile.x, tile.y),
        tile,
      }));
  }

  // Prepare marker data for non-capital city centers (circles)
  function prepareCityMarkers(): MarkerData[] {
    return tiles
      .filter((tile) => tile.is_city_center && !tile.is_capital)
      .map((tile) => ({
        position: hexToPixel(tile.x, tile.y),
        tile,
      }));
  }

  // Prepare marker data for capital cities (stars)
  function prepareCapitalMarkers(): MarkerData[] {
    return tiles
      .filter((tile) => tile.is_capital)
      .map((tile) => ({
        position: hexToPixel(tile.x, tile.y),
        tile,
      }));
  }

  // Calculate initial view bounds
  function calculateViewState(canvas?: HTMLCanvasElement): { target: [number, number, number]; zoom: number } {
    if (tiles.length === 0) {
      return { target: [0, 0, 0] as [number, number, number], zoom: 0 };
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

    return { target: [centerX, centerY, 0] as [number, number, number], zoom };
  }

  function createLayers(mode: ColorMode) {
    const tileData = prepareTileData(mode);

    // Marker sizes (in pixels, will scale with zoom)
    const IMPROVEMENT_DOT_RADIUS = 2;
    const CITY_CIRCLE_RADIUS = 2.5;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const layers: any[] = [
      // Base hex layer
      new PolygonLayer<TileData>({
        id: "hex-layer",
        data: tileData,
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
      }),
    ];

    // Conditionally add marker layers based on toggles
    if (showUrbanImprovements) {
      layers.push(
        new ScatterplotLayer<MarkerData>({
          id: "urban-improvement-markers",
          data: prepareUrbanImprovementMarkers(),
          getPosition: (d) => d.position,
          getRadius: IMPROVEMENT_DOT_RADIUS,
          getFillColor: [26, 26, 26],
          radiusUnits: "pixels",
          pickable: false,
        })
      );
    }

    if (showRuralImprovements) {
      layers.push(
        new ScatterplotLayer<MarkerData>({
          id: "rural-improvement-markers",
          data: prepareRuralImprovementMarkers(),
          getPosition: (d) => d.position,
          getRadius: IMPROVEMENT_DOT_RADIUS,
          getFillColor: [26, 26, 26],
          radiusUnits: "pixels",
          pickable: false,
        })
      );
    }

    if (showCities) {
      // Non-capital city centers (circles)
      layers.push(
        new ScatterplotLayer<MarkerData>({
          id: "city-markers",
          data: prepareCityMarkers(),
          getPosition: (d) => d.position,
          getRadius: CITY_CIRCLE_RADIUS,
          getFillColor: [0, 0, 0, 0], // Transparent fill
          getLineColor: [26, 26, 26],
          getLineWidth: 1.5,
          lineWidthUnits: "pixels",
          stroked: true,
          filled: false,
          radiusUnits: "pixels",
          pickable: false,
        })
      );

      // Capital cities (stars)
      layers.push(
        new TextLayer<MarkerData>({
          id: "capital-markers",
          data: prepareCapitalMarkers(),
          getPosition: (d) => d.position,
          getText: () => "★",
          getSize: 16,
          getColor: [26, 26, 26],
          getTextAnchor: "middle",
          getAlignmentBaseline: "center",
          characterSet: ["★"],
          sizeUnits: "pixels",
          pickable: false,
        })
      );
    }

    return layers;
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
    currentViewState = viewState;

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
      getCursor: () => panMode ? (isDragging ? "grabbing" : "grab") : "default",
      layers: createLayers(colorMode),
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
    fullscreenViewState = viewState;

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
      getCursor: () => fullscreenPanMode ? (isDragging ? "grabbing" : "grab") : "default",
      layers: createLayers(colorMode),
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
          layers: createLayers(colorMode),
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

  // Track current view state for zoom controls
  let currentViewState = $state<{ target: [number, number, number]; zoom: number } | null>(null);
  let fullscreenViewState = $state<{ target: [number, number, number]; zoom: number } | null>(null);

  // Pan mode state
  let panMode = $state(false);
  let fullscreenPanMode = $state(false);
  let isDragging = $state(false);
  let lastDragPosition = $state<{ x: number; y: number } | null>(null);

  // Zoom controls
  function zoomIn(isFullscreen = false) {
    const targetDeck = isFullscreen ? fullscreenDeck : deck;
    const viewState = isFullscreen ? fullscreenViewState : currentViewState;
    if (!targetDeck || !viewState) return;

    const newZoom = Math.min(viewState.zoom + 0.5, 6);
    const newViewState = { ...viewState, zoom: newZoom };

    if (isFullscreen) {
      fullscreenViewState = newViewState;
    } else {
      currentViewState = newViewState;
    }

    targetDeck.setProps({
      initialViewState: {
        ...newViewState,
        minZoom: -2,
        maxZoom: 6,
        transitionDuration: 200,
      },
    });
  }

  function zoomOut(isFullscreen = false) {
    const targetDeck = isFullscreen ? fullscreenDeck : deck;
    const viewState = isFullscreen ? fullscreenViewState : currentViewState;
    if (!targetDeck || !viewState) return;

    const newZoom = Math.max(viewState.zoom - 0.5, -2);
    const newViewState = { ...viewState, zoom: newZoom };

    if (isFullscreen) {
      fullscreenViewState = newViewState;
    } else {
      currentViewState = newViewState;
    }

    targetDeck.setProps({
      initialViewState: {
        ...newViewState,
        minZoom: -2,
        maxZoom: 6,
        transitionDuration: 200,
      },
    });
  }

  function resetView(isFullscreen = false) {
    const targetDeck = isFullscreen ? fullscreenDeck : deck;
    const targetCanvas = isFullscreen ? fullscreenCanvas : deckCanvas;
    if (!targetDeck) return;

    const viewState = calculateViewState(targetCanvas);

    if (isFullscreen) {
      fullscreenViewState = viewState;
    } else {
      currentViewState = viewState;
    }

    targetDeck.setProps({
      initialViewState: {
        ...viewState,
        minZoom: -2,
        maxZoom: 6,
        transitionDuration: 300,
      },
    });
  }

  function pan(dx: number, dy: number, isFullscreen = false) {
    const targetDeck = isFullscreen ? fullscreenDeck : deck;
    const viewState = isFullscreen ? fullscreenViewState : currentViewState;
    if (!targetDeck || !viewState) return;

    // Pan amount scales with zoom level (pan more when zoomed out)
    const panAmount = 50 / Math.pow(2, viewState.zoom);
    const newTarget: [number, number, number] = [
      viewState.target[0] + dx * panAmount,
      viewState.target[1] + dy * panAmount,
      viewState.target[2],
    ];
    const newViewState = { ...viewState, target: newTarget };

    if (isFullscreen) {
      fullscreenViewState = newViewState;
    } else {
      currentViewState = newViewState;
    }

    targetDeck.setProps({
      initialViewState: {
        ...newViewState,
        minZoom: -2,
        maxZoom: 6,
        transitionDuration: 100,
      },
    });
  }

  function togglePanMode(isFullscreen = false) {
    if (isFullscreen) {
      fullscreenPanMode = !fullscreenPanMode;
    } else {
      panMode = !panMode;
    }
    // Reset drag state when toggling off
    isDragging = false;
    lastDragPosition = null;
  }

  function handleDragStart(e: MouseEvent, isFullscreen = false) {
    const isPanModeActive = isFullscreen ? fullscreenPanMode : panMode;
    if (!isPanModeActive) return;

    isDragging = true;
    lastDragPosition = { x: e.clientX, y: e.clientY };
  }

  function handleDragMove(e: MouseEvent, isFullscreen = false) {
    const isPanModeActive = isFullscreen ? fullscreenPanMode : panMode;
    if (!isPanModeActive || !isDragging || !lastDragPosition) return;

    const targetDeck = isFullscreen ? fullscreenDeck : deck;
    const viewState = isFullscreen ? fullscreenViewState : currentViewState;
    if (!targetDeck || !viewState) return;

    // Calculate delta in screen pixels
    const dx = e.clientX - lastDragPosition.x;
    const dy = e.clientY - lastDragPosition.y;

    // Convert screen pixels to world units based on zoom level
    // Negate both to make map follow cursor (drag right = map moves right)
    const scale = Math.pow(2, viewState.zoom);
    const worldDx = -dx / scale;
    const worldDy = -dy / scale;

    const newTarget: [number, number, number] = [
      viewState.target[0] + worldDx,
      viewState.target[1] + worldDy,
      viewState.target[2],
    ];
    const newViewState = { ...viewState, target: newTarget };

    if (isFullscreen) {
      fullscreenViewState = newViewState;
    } else {
      currentViewState = newViewState;
    }

    targetDeck.setProps({
      initialViewState: {
        ...newViewState,
        minZoom: -2,
        maxZoom: 6,
        transitionDuration: 0,
      },
    });

    lastDragPosition = { x: e.clientX, y: e.clientY };
  }

  function handleDragEnd() {
    isDragging = false;
    lastDragPosition = null;
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

  // Update layers when tiles, color mode, or marker toggles change
  $effect(() => {
    const mode = colorMode;
    const currentTiles = tiles;
    const tileCount = currentTiles.length;
    // Track marker toggles for reactivity
    const _cities = showCities;
    const _urbanImprovements = showUrbanImprovements;
    const _ruralImprovements = showRuralImprovements;

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
        layers: createLayers(mode),
      });
    }
    if (fullscreenDeck && currentTiles.length > 0) {
      fullscreenDeck.setProps({
        layers: createLayers(mode),
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

    <!-- Marker toggles -->
    <div class="flex items-center gap-3 text-sm">
      <label class="marker-toggle">
        <input type="checkbox" bind:checked={showCities} />
        <span class="marker-label">Cities</span>
      </label>
      <label class="marker-toggle">
        <input type="checkbox" bind:checked={showUrbanImprovements} />
        <span class="marker-label">Urban</span>
      </label>
      <label class="marker-toggle">
        <input type="checkbox" bind:checked={showRuralImprovements} />
        <span class="marker-label">Rural</span>
      </label>
    </div>

    <!-- Turn slider (only in political mode) -->
    {#if showTurnSlider}
      <div class="flex items-center gap-3 ml-auto">
        <span class="text-brown text-sm font-bold">Turn:</span>
        <!-- Playback buttons grouped together -->
        <div class="flex items-center">
          <!-- Play/Pause button -->
          <button
            onclick={togglePlayback}
            class="p-1.5 rounded transition-colors {isPlaying ? 'bg-brown text-tan' : 'bg-brown/30 hover:bg-brown/50'}"
            aria-label={isPlaying ? "Pause" : "Play"}
            title={isPlaying ? "Pause" : "Play (1x)"}
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
          <!-- Fast Forward button (2x speed) -->
          <button
            onclick={toggleFastPlayback}
            class="p-1.5 rounded transition-colors {isFastPlaying ? 'bg-brown text-tan' : 'bg-brown/30 hover:bg-brown/50'}"
            aria-label={isFastPlaying ? "Pause" : "Fast Forward"}
            title={isFastPlaying ? "Pause" : "Fast Forward (2x)"}
          >
            {#if isFastPlaying}
              <!-- Pause icon -->
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-tan" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </svg>
            {:else}
              <!-- Fast Forward icon (double play arrows) -->
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-tan" fill="currentColor" viewBox="0 0 24 24">
                <path d="M4 5v14l8-7z" />
                <path d="M12 5v14l8-7z" />
              </svg>
            {/if}
          </button>
        </div>
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
    <!-- Map controls (top right) -->
    <div class="absolute top-3 right-3 z-10 flex items-start gap-2">
      <!-- Pan mode toggle (hand icon) -->
      <button
        onclick={() => togglePanMode(false)}
        class="control-btn {panMode ? 'active' : ''}"
        aria-label={panMode ? "Disable pan mode" : "Enable pan mode"}
        title={panMode ? "Disable pan mode" : "Enable pan mode (drag to pan)"}
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11" />
        </svg>
      </button>

      <!-- Zoom slider -->
      <div class="zoom-container">
        <!-- Zoom in button -->
        <button
          onclick={() => zoomIn(false)}
          class="zoom-btn"
          aria-label="Zoom in"
          title="Zoom in"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v12m6-6H6" />
          </svg>
        </button>
        <!-- Slider track -->
        <div class="zoom-track">
          <div class="zoom-track-line"></div>
          <div class="zoom-thumb"></div>
        </div>
        <!-- Zoom out button -->
        <button
          onclick={() => zoomOut(false)}
          class="zoom-btn"
          aria-label="Zoom out"
          title="Zoom out"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M18 12H6" />
          </svg>
        </button>
      </div>

      <!-- Expand button -->
      <button
        onclick={openFullscreen}
        class="control-btn"
        aria-label="Expand map to fullscreen"
        title="Expand to fullscreen"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
        </svg>
      </button>
    </div>

    <div
      class="w-full"
      style="height: {height}"
      onmousedown={(e) => handleDragStart(e, false)}
      onmousemove={(e) => handleDragMove(e, false)}
      onmouseup={handleDragEnd}
      onmouseleave={handleDragEnd}
      role="application"
      aria-label="Map view"
    >
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

        <!-- Marker toggles -->
        <div class="flex items-center gap-3 text-sm">
          <label class="marker-toggle">
            <input type="checkbox" bind:checked={showCities} />
            <span class="marker-label">Cities</span>
          </label>
          <label class="marker-toggle">
            <input type="checkbox" bind:checked={showUrbanImprovements} />
            <span class="marker-label">Urban</span>
          </label>
          <label class="marker-toggle">
            <input type="checkbox" bind:checked={showRuralImprovements} />
            <span class="marker-label">Rural</span>
          </label>
        </div>

        <!-- Turn slider (only in political mode) -->
        {#if showTurnSlider}
          <div class="flex items-center gap-3 ml-auto">
            <span class="text-brown text-sm font-bold">Turn:</span>
            <!-- Playback buttons grouped together -->
            <div class="flex items-center">
              <!-- Play/Pause button -->
              <button
                onclick={togglePlayback}
                class="p-1.5 rounded transition-colors {isPlaying ? 'bg-brown text-tan' : 'bg-brown/30 hover:bg-brown/50'}"
                aria-label={isPlaying ? "Pause" : "Play"}
                title={isPlaying ? "Pause" : "Play (1x)"}
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
              <!-- Fast Forward button (2x speed) -->
              <button
                onclick={toggleFastPlayback}
                class="p-1.5 rounded transition-colors {isFastPlaying ? 'bg-brown text-tan' : 'bg-brown/30 hover:bg-brown/50'}"
                aria-label={isFastPlaying ? "Pause" : "Fast Forward"}
                title={isFastPlaying ? "Pause" : "Fast Forward (2x)"}
              >
                {#if isFastPlaying}
                  <!-- Pause icon -->
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-tan" fill="currentColor" viewBox="0 0 24 24">
                    <rect x="6" y="4" width="4" height="16" />
                    <rect x="14" y="4" width="4" height="16" />
                  </svg>
                {:else}
                  <!-- Fast Forward icon (double play arrows) -->
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-tan" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M4 5v14l8-7z" />
                    <path d="M12 5v14l8-7z" />
                  </svg>
                {/if}
              </button>
            </div>
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
      <!-- Map controls -->
      <div class="absolute top-3 right-3 z-10 flex items-start gap-2">
        <!-- Pan mode toggle (hand icon) -->
        <button
          onclick={() => togglePanMode(true)}
          class="control-btn {fullscreenPanMode ? 'active' : ''}"
          aria-label={fullscreenPanMode ? "Disable pan mode" : "Enable pan mode"}
          title={fullscreenPanMode ? "Disable pan mode" : "Enable pan mode (drag to pan)"}
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11" />
          </svg>
        </button>

        <!-- Zoom slider -->
        <div class="zoom-container">
          <!-- Zoom in button -->
          <button
            onclick={() => zoomIn(true)}
            class="zoom-btn"
            aria-label="Zoom in"
            title="Zoom in"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v12m6-6H6" />
            </svg>
          </button>
          <!-- Slider track -->
          <div class="zoom-track">
            <div class="zoom-track-line"></div>
            <div class="zoom-thumb"></div>
          </div>
          <!-- Zoom out button -->
          <button
            onclick={() => zoomOut(true)}
            class="zoom-btn"
            aria-label="Zoom out"
            title="Zoom out"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M18 12H6" />
            </svg>
          </button>
        </div>
      </div>

      <div
        class="w-full h-full"
        onmousedown={(e) => handleDragStart(e, true)}
        onmousemove={(e) => handleDragMove(e, true)}
        onmouseup={handleDragEnd}
        onmouseleave={handleDragEnd}
        role="application"
        aria-label="Fullscreen map view"
      >
        <canvas bind:this={fullscreenCanvas} class="w-full h-full"></canvas>
      </div>

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

  /* Control button styles */
  .control-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    background: #35302B;
    border: 2px solid var(--color-tan);
    border-radius: 8px;
    color: var(--color-tan);
    cursor: pointer;
    transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
  }

  .control-btn:hover {
    color: white;
    border-color: white;
  }

  .control-btn.active {
    background: var(--color-brown);
    color: var(--color-tan);
    border-color: var(--color-tan);
  }

  .control-btn.active:hover {
    background: var(--color-brown);
    color: white;
    border-color: white;
  }

  /* Zoom slider styles */
  .zoom-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    background: #35302B;
    border: 2px solid var(--color-tan);
    border-radius: 8px;
    padding: 6px;
    gap: 4px;
  }

  .zoom-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    background: transparent;
    border: none;
    color: var(--color-tan);
    cursor: pointer;
    transition: color 0.15s ease;
  }

  .zoom-btn:hover {
    color: white;
  }

  .zoom-track {
    position: relative;
    width: 20px;
    height: 50px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .zoom-track-line {
    width: 3px;
    height: 100%;
    background: var(--color-tan);
    border-radius: 2px;
    opacity: 0.5;
  }

  .zoom-thumb {
    position: absolute;
    width: 12px;
    height: 12px;
    background: var(--color-tan);
    border-radius: 50%;
    top: 50%;
    transform: translateY(-50%);
  }

  /* Marker toggle styles */
  .marker-toggle {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    cursor: pointer;
  }

  .marker-toggle input[type="checkbox"] {
    appearance: none;
    width: 14px;
    height: 14px;
    border: 2px solid var(--color-tan);
    border-radius: 3px;
    background: transparent;
    cursor: pointer;
    position: relative;
    transition: background 0.15s ease, border-color 0.15s ease;
  }

  .marker-toggle input[type="checkbox"]:checked {
    background: var(--color-tan);
  }

  .marker-toggle input[type="checkbox"]:checked::after {
    content: "";
    position: absolute;
    left: 3px;
    top: 0px;
    width: 4px;
    height: 8px;
    border: solid #1a1a1a;
    border-width: 0 2px 2px 0;
    transform: rotate(45deg);
  }

  .marker-toggle:hover input[type="checkbox"] {
    border-color: white;
  }

  .marker-label {
    color: var(--color-tan);
    user-select: none;
  }

  .marker-toggle:hover .marker-label {
    color: white;
  }
</style>
