/**
 * Terrain visualization colors for hex map
 */

export const TERRAIN_COLORS: Record<string, string> = {
  TERRAIN_WATER: "#1a5276",
  TERRAIN_COAST: "#2980b9",
  TERRAIN_TEMPERATE: "#27ae60",
  TERRAIN_ARID: "#d4ac6e",
  TERRAIN_TUNDRA: "#bdc3c7",
  TERRAIN_DESERT: "#f4d03f",
};

export const HEIGHT_COLORS: Record<string, string> = {
  HEIGHT_OCEAN: "#154360",
  HEIGHT_FLAT: "#58d68d",
  HEIGHT_HILL: "#a04000",
  HEIGHT_MOUNTAIN: "#7f8c8d",
};

export const VEGETATION_COLORS: Record<string, string> = {
  VEGETATION_NONE: "#d4ac6e",
  VEGETATION_TREES: "#1e8449",
  VEGETATION_SCRUB: "#7d6608",
  VEGETATION_MARSH: "#45b39d",
};

export const UNOWNED_TILE_COLOR = "#444444";

/**
 * Muted colors for unclaimed tiles in political mode.
 * These are desaturated/darkened to let owned nation colors stand out.
 */
const MUTED_TERRAIN: Record<string, string> = {
  TERRAIN_WATER: "#2c4a5a",
  TERRAIN_COAST: "#3a5a6a",
  TERRAIN_TEMPERATE: "#4a5a4a",
  TERRAIN_ARID: "#6a5a4a",
  TERRAIN_TUNDRA: "#5a5a5a",
  TERRAIN_DESERT: "#7a6a5a",
};

const MUTED_HEIGHT: Record<string, string> = {
  HEIGHT_OCEAN: "#1a3040",
  HEIGHT_FLAT: "#4a5a4a",
  HEIGHT_HILL: "#5a4a3a",
  HEIGHT_MOUNTAIN: "#5a5a5a",
};

const MUTED_VEGETATION: Record<string, string> = {
  VEGETATION_NONE: "#5a5040",
  VEGETATION_TREES: "#3a4a3a",
  VEGETATION_SCRUB: "#4a4a3a",
  VEGETATION_MARSH: "#3a5050",
};

/**
 * Get a muted natural color for unclaimed tiles based on terrain characteristics.
 * Prioritizes: water/ocean first, then mountains, then vegetation, then base terrain.
 */
export function getMutedTerrainColor(
  terrain: string | null | undefined,
  height: string | null | undefined,
  vegetation: string | null | undefined
): string {
  // Water tiles - use terrain color (water/coast)
  if (terrain === "TERRAIN_WATER" || terrain === "TERRAIN_COAST") {
    return MUTED_TERRAIN[terrain] ?? "#2c4a5a";
  }

  // Ocean depth
  if (height === "HEIGHT_OCEAN") {
    return MUTED_HEIGHT.HEIGHT_OCEAN;
  }

  // Mountains stand out
  if (height === "HEIGHT_MOUNTAIN") {
    return MUTED_HEIGHT.HEIGHT_MOUNTAIN;
  }

  // Hills
  if (height === "HEIGHT_HILL") {
    return MUTED_HEIGHT.HEIGHT_HILL;
  }

  // Vegetation on flat land
  if (vegetation && vegetation !== "VEGETATION_NONE") {
    return MUTED_VEGETATION[vegetation] ?? MUTED_VEGETATION.VEGETATION_NONE;
  }

  // Fall back to terrain type
  if (terrain) {
    return MUTED_TERRAIN[terrain] ?? UNOWNED_TILE_COLOR;
  }

  return UNOWNED_TILE_COLOR;
}

export function getTerrainColor(terrain: string | null | undefined): string {
  if (!terrain) return UNOWNED_TILE_COLOR;
  return TERRAIN_COLORS[terrain] ?? UNOWNED_TILE_COLOR;
}

export function getHeightColor(height: string | null | undefined): string {
  if (!height) return UNOWNED_TILE_COLOR;
  return HEIGHT_COLORS[height] ?? UNOWNED_TILE_COLOR;
}

export function getVegetationColor(vegetation: string | null | undefined): string {
  if (!vegetation) return VEGETATION_COLORS.VEGETATION_NONE;
  return VEGETATION_COLORS[vegetation] ?? VEGETATION_COLORS.VEGETATION_NONE;
}

export const RESOURCE_COLORS: Record<string, string> = {
  // Strategic
  RESOURCE_IRON: "#708090",
  RESOURCE_STONE: "#A9A9A9",
  RESOURCE_WOOD: "#8B4513",
  RESOURCE_HORSES: "#D2691E",
  // Luxury
  RESOURCE_WINE: "#722F37",
  RESOURCE_WHEAT: "#F5DEB3",
  RESOURCE_GAME: "#228B22",
  RESOURCE_FISH: "#4682B4",
  RESOURCE_MARBLE: "#F5F5F5",
  RESOURCE_GEMS: "#E6E6FA",
  RESOURCE_INCENSE: "#DEB887",
  RESOURCE_SILK: "#FFD700",
  RESOURCE_SPICES: "#FF6347",
  RESOURCE_OLIVES: "#808000",
};

export const RESOURCE_DEFAULT_COLOR = "#FFD700";

export function getResourceColor(resource: string | null | undefined): string {
  if (!resource) return UNOWNED_TILE_COLOR;
  return RESOURCE_COLORS[resource] ?? RESOURCE_DEFAULT_COLOR;
}
