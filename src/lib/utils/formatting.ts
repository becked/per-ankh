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
