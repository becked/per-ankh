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
 * formatEnum("IMPROVEMENT_GARRISON_1", "IMPROVEMENT_") // returns "Garrison"
 * formatEnum(null, "NATION_") // returns "Unknown"
 */
export function formatEnum(
	value: string | null | undefined,
	prefix: string,
): string {
	if (!value) return "Unknown";

	// Remove the prefix
	const withoutPrefix = value.replace(prefix, "");

	// Convert to lowercase, replace underscores with spaces, and title-case each word
	const formatted = withoutPrefix
		.toLowerCase()
		.split("_")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");

	// Remove trailing numbers (e.g., "Garrison 1" -> "Garrison", "Poet 2" -> "Poet")
	return formatted.replace(/\s+\d+$/, "");
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
	return date.toISOString().split("T")[0];
}

/**
 * Formats an ISO instant as a UTC date + 24h time for display, e.g.
 * "May 30, 14:30". Tournament match scheduling is entered and shown in UTC
 * (localization is a later iteration); callers append a " UTC" label.
 *
 * @param iso - ISO-8601 instant string, or null/undefined
 * @returns "MMM D, HH:MM" in UTC, or "" when the input is empty/invalid
 */
export function formatScheduledUtc(iso: string | null | undefined): string {
	if (!iso) return "";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	return d.toLocaleString("en-CA", {
		timeZone: "UTC",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});
}

/**
 * Formats an ISO instant as the UTC display (see {@link formatScheduledUtc})
 * followed by the same instant in the viewer's local timezone, e.g.
 * "May 30, 14:30 UTC (07:30 PDT)". The local part is appended inline so a
 * viewer never has to do the timezone math themselves.
 *
 * Two refinements keep the parenthetical honest and uncluttered:
 * - It is omitted entirely when the viewer is effectively on UTC (zero offset,
 *   e.g. GMT/Iceland), since "(14:30 UTC)" would just echo the primary value.
 * - The local date is included only when it differs from the UTC date — far
 *   eastern/western zones can roll the instant onto a neighbouring day, and a
 *   bare "(00:30 JST)" next to "May 30" would be misleading.
 *
 * @param iso - ISO-8601 instant string, or null/undefined
 * @returns "MMM D, HH:MM UTC (HH:MM TZ)" (date in the local part only when it
 *   differs), or "" when the input is empty/invalid
 */
export function formatScheduledWithLocal(
	iso: string | null | undefined,
): string {
	const utc = formatScheduledUtc(iso);
	if (!utc) return "";
	const d = new Date(iso as string);

	const dateOpts: Intl.DateTimeFormatOptions = {
		month: "short",
		day: "numeric",
	};
	const timeOpts: Intl.DateTimeFormatOptions = {
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	};

	const utcDate = d.toLocaleDateString("en-CA", { ...dateOpts, timeZone: "UTC" });
	const utcTime = d.toLocaleTimeString("en-CA", { ...timeOpts, timeZone: "UTC" });
	const localDate = d.toLocaleDateString("en-CA", dateOpts);
	const localTime = d.toLocaleTimeString("en-CA", timeOpts);

	// Viewer is effectively on UTC — the local part would just echo the primary.
	if (localDate === utcDate && localTime === utcTime) return `${utc} UTC`;

	const tzName =
		new Intl.DateTimeFormat("en-US", { timeZoneName: "short" })
			.formatToParts(d)
			.find((p) => p.type === "timeZoneName")?.value ?? "";

	const local =
		localDate === utcDate
			? `${localTime} ${tzName}`
			: `${localDate}, ${localTime} ${tzName}`;

	return `${utc} UTC (${local.trim()})`;
}

/**
 * Formats a game title for display, using intelligent fallbacks.
 *
 * Rules (first match wins):
 * 1. Owner-set display_name (always wins — the user explicitly chose this).
 * 2. game_name from the save, if it's a real name (not the "GameN" pattern
 *    Old World writes when the player never customized the name).
 * 3. "{Nation} - {Turns} turns"
 * 4. Just nation, just turns, or "Game {ID}".
 *
 * @param game - Game data containing optional display_name, save name, nation, turns, and ID
 * @returns Formatted game title string
 *
 * @example
 * formatGameTitle({ display_name: "MP vs Joe", ... }) // returns "MP vs Joe"
 * formatGameTitle({ game_name: "My Epic Campaign", ... }) // returns "My Epic Campaign"
 * formatGameTitle({ game_name: "Game 5", save_owner_nation: "NATION_ROME", total_turns: 100, ... }) // returns "Rome - 100 turns"
 * formatGameTitle({ game_name: null, save_owner_nation: "NATION_EGYPT", total_turns: null, match_id: 3 }) // returns "Egypt"
 */
/**
 * Strips Unity TextMeshPro rich text markup from a string.
 * Removes tags like <color=#e3c08c>, <link="...">, <sprite="..." name="..." tint>, etc.
 * Also handles Old World specific patterns like icon(YIELD_SOMETHING) and link(CONCEPT_SOMETHING).
 *
 * @param text - The text containing markup to strip
 * @returns Plain text with all markup tags removed
 *
 * @example
 * stripMarkup("Discovered <color=#e3c08c><link=\"HELP\">Tech</link></color>") // returns "Discovered Tech"
 * stripMarkup("link(CONCEPT_AMBITION): icon(YIELD_LEGITIMACY) Send") // returns "Ambition: Send"
 * stripMarkup(null) // returns ""
 */
export function stripMarkup(text: string | null | undefined): string {
	if (!text) return "";

	return (
		text
			// Remove all angle-bracket tags (Unity TextMeshPro rich text)
			.replace(/<[^>]*>/g, "")
			// Remove icon(...) patterns entirely
			.replace(/icon\([^)]*\)\s*/g, "")
			// Replace link(CONCEPT_SOMETHING) with formatted "Something".
			// OW also emits link(...,N) with a count/declension argument
			// (e.g. link(UNIT_AKKADIAN_ARCHER,2)); discard that argument.
			.replace(/link\(CONCEPT_([^),]+)(?:,[^)]*)?\)/g, (_, concept) => {
				// Convert SOMETHING_LIKE_THIS to "Something Like This"
				return concept
					.toLowerCase()
					.split("_")
					.map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
					.join(" ");
			})
			// Replace any remaining link(...) patterns with their content
			.replace(/link\(([^),]+)(?:,[^)]*)?\)/g, (_, content) => {
				// Extract meaningful part after prefix (e.g., "TECH_IRONWORKING" -> "Ironworking")
				const parts = content.split("_");
				if (parts.length > 1) {
					return parts
						.slice(1)
						.map(
							(word: string) =>
								word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
						)
						.join(" ");
				}
				return content;
			})
			.trim()
	);
}

export function formatGameTitle(game: {
	display_name?: string | null;
	game_name: string | null;
	save_owner_nation: string | null;
	total_turns: number | null;
	match_id: number;
}): string {
	// Owner-set rename always wins, even if it happens to match the
	// auto-generated "GameN" pattern — the user explicitly chose this.
	if (game.display_name != null && game.display_name.trim() !== "") {
		return game.display_name;
	}

	// Check if game_name is a real name (not auto-generated "Game{number}")
	const isRealName =
		game.game_name != null &&
		game.game_name !== "" &&
		!game.game_name.match(/^Game\d+$/);

	if (isRealName) {
		return game.game_name!;
	}

	// Format nation by removing NATION_ prefix and capitalizing
	const formattedNation = game.save_owner_nation
		? formatEnum(game.save_owner_nation, "NATION_")
		: null;

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
