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
