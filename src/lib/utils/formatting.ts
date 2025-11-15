/**
 * Formats enum-style values from the backend by removing prefixes and applying title casing.
 *
 * @param value - The enum value to format (e.g., "NATION_ASSYRIA", "RELIGION_CHRISTIANITY")
 * @param prefix - The prefix to remove (e.g., "NATION_", "RELIGION_")
 * @returns Formatted string with title casing (e.g., "Assyria", "Christianity")
 *
 * @example
 * formatEnum("NATION_ASSYRIA", "NATION_") // returns "Assyria"
 * formatEnum("NATION_OLD_WORLD", "NATION_") // returns "Old World"
 * formatEnum(null, "NATION_") // returns "Unknown"
 */
export function formatEnum(value: string | null | undefined, prefix: string): string {
  if (!value) return "Unknown";

  // Remove the prefix
  const withoutPrefix = value.replace(prefix, "");

  // Convert to lowercase, replace underscores with spaces, and title-case each word
  return withoutPrefix
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Formats map class values by removing the MAPCLASS prefix and splitting PascalCase.
 *
 * @param value - The map class value (e.g., "MAPCLASS_MapScriptContinent", "MAPCLASS_AridPlateau")
 * @returns Formatted string (e.g., "Continent", "Arid Plateau")
 *
 * @example
 * formatMapClass("MAPCLASS_MapScriptContinent") // returns "Continent"
 * formatMapClass("MAPCLASS_MapScriptHardwoodForest") // returns "Hardwood Forest"
 * formatMapClass("MAPCLASS_AridPlateau") // returns "Arid Plateau"
 * formatMapClass(null) // returns "Unknown"
 */
export function formatMapClass(value: string | null | undefined): string {
  if (!value) return "Unknown";

  // Remove the MAPCLASS_MapScript prefix (if present), or just MAPCLASS_ prefix
  let withoutPrefix = value.replace(/^MAPCLASS_MapScript/, "");
  if (withoutPrefix === value) {
    // MapScript wasn't present, try removing just MAPCLASS_
    withoutPrefix = value.replace(/^MAPCLASS_/, "");
  }

  // Split PascalCase by inserting space before capital letters
  // Then trim and clean up any extra spaces
  return withoutPrefix
    .replace(/([A-Z])/g, " $1")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Formats a date string to YYYY-MM-DD format for consistent display across the app.
 *
 * @param dateStr - The date string to format (ISO 8601 format from backend)
 * @returns Formatted date string in YYYY-MM-DD format
 *
 * @example
 * formatDate("2025-01-15T12:00:00Z") // returns "2025-01-15"
 * formatDate(null) // returns "Unknown"
 */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "Unknown";
  const date = new Date(dateStr);
  return date.toISOString().split('T')[0];
}

/**
 * Formats a game title for display, using intelligent fallbacks.
 *
 * Rules:
 * 1. If game has a real name (not "GameN" pattern), use it
 * 2. Otherwise, show "{Nation} - {Turns} turns"
 * 3. Fallback to just nation, just turns, or "Game {ID}"
 *
 * @param game - Game data containing name, nation, turns, and ID
 * @returns Formatted game title string
 *
 * @example
 * formatGameTitle({ game_name: "My Epic Campaign", ... }) // returns "My Epic Campaign"
 * formatGameTitle({ game_name: "Game 5", human_nation: "NATION_ROME", total_turns: 100, ... }) // returns "Rome - 100 turns"
 * formatGameTitle({ game_name: null, human_nation: "NATION_EGYPT", total_turns: null, match_id: 3 }) // returns "Egypt"
 */
export function formatGameTitle(game: {
  game_name: string | null;
  human_nation: string | null;
  total_turns: number | null;
  match_id: number;
}): string {
  // Check if game_name is a real name (not auto-generated "Game{number}")
  const isRealName = game.game_name != null &&
                     game.game_name !== "" &&
                     !game.game_name.match(/^Game\d+$/);

  if (isRealName) {
    return game.game_name!;
  }

  // Format nation by removing NATION_ prefix and capitalizing
  const formattedNation = game.human_nation ? formatEnum(game.human_nation, "NATION_") : null;

  // Fallback: use nation and turns if available
  if (formattedNation !== null && game.total_turns != null) {
    return `${formattedNation} - ${game.total_turns} turns`;
  }

  if (formattedNation !== null) {
    return formattedNation;
  }

  if (game.total_turns != null) {
    return `Turn ${game.total_turns}`;
  }

  return `Game ${game.match_id}`;
}
