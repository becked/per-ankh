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
 * Escapes the five HTML metacharacters so a user-controlled string can be
 * safely interpolated into an ECharts tooltip `formatter` return value, which
 * ECharts injects via `innerHTML` (the default `renderMode`). Only needed for
 * attacker-influenced text — Discord display names, free-text caster names,
 * save-derived player names — not for enum-derived labels (`formatEnum`,
 * `fmtNation`) or numbers. `&` is replaced first so the entities the later
 * rules introduce aren't double-escaped.
 *
 * @example
 * escapeHtml('<img src=x onerror=alert(1)>') // "&lt;img src=x onerror=alert(1)&gt;"
 */
export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

// Roman-numeral place-value tables (thousands handled separately as repeated "M").
// Ported from Old World's RomanNumerals.ToRomanNumeral (Reference NumeralSystems.cs).
const ROMAN_HUNDREDS = [
	"",
	"C",
	"CC",
	"CCC",
	"CD",
	"D",
	"DC",
	"DCC",
	"DCCC",
	"CM",
];
const ROMAN_TENS = ["", "X", "XX", "XXX", "XL", "L", "LX", "LXX", "LXXX", "XC"];
const ROMAN_ONES = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"];

/**
 * Converts a positive integer to a Roman numeral, matching Old World's leader
 * regnal-suffix rendering (e.g. the "II" in "Meera II"). Returns "" for values
 * below 1, since suffix 1 (first of the name) is shown without a numeral.
 *
 * @example
 * toRomanNumeral(2) // "II"
 * toRomanNumeral(14) // "XIV"
 */
export function toRomanNumeral(value: number): string {
	if (value < 1) return "";
	const thousands = "M".repeat(Math.floor(value / 1000));
	return (
		thousands +
		ROMAN_HUNDREDS[Math.floor((value % 1000) / 100)] +
		ROMAN_TENS[Math.floor((value % 100) / 10)] +
		ROMAN_ONES[value % 10]
	);
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

	// Remove the MAPCLASS_MapScript prefix (if present), or just MAPCLASS_ prefix.
	// Case-insensitive: the Empires of the Indus DLC ships scripts spelled with a
	// lowercase 's' (MAPCLASS_Mapscript…), which a case-sensitive match would miss,
	// leaving a stray "Mapscript" word in the output.
	let withoutPrefix = value.replace(/^MAPCLASS_MapScript/i, "");
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
 * Whether an instant's year, read in the given timezone, differs from the
 * current year in that same zone. Schedule displays normally omit the year (it's
 * almost always "this year" and clutters the line), but that hides an off-by-a-
 * year date — a match mistakenly set to 2025 instead of 2026 renders as a bare
 * "Jul 2" and masquerades as a same-year date. Callers add the year only when
 * this returns true, so a wrong year is immediately visible.
 *
 * @param d - the instant
 * @param timeZone - IANA zone name, or undefined for the viewer's local zone
 */
function isDifferentYear(d: Date, timeZone: string | undefined): boolean {
	const yearOf = (x: Date) =>
		x.toLocaleDateString("en-US", { timeZone, year: "numeric" });
	return yearOf(d) !== yearOf(new Date());
}

/**
 * The short name of the viewer's local timezone for a given instant, e.g.
 * "PDT" / "EST" — the same abbreviation the scheduled-time helpers append to a
 * local clock. It is DST-dependent, so it resolves for a specific instant
 * (defaulting to now). Returns "" when the environment can't produce one (and
 * on the UTC worker during SSR, where it resolves to "UTC"/"GMT").
 *
 * @param date - the instant to read the zone name for (defaults to now)
 */
export function shortTimeZoneName(date: Date = new Date()): string {
	return (
		new Intl.DateTimeFormat("en-US", { timeZoneName: "short" })
			.formatToParts(date)
			.find((p) => p.type === "timeZoneName")?.value ?? ""
	);
}

/**
 * Formats an ISO instant as a UTC date + 24h time for display, e.g.
 * "May 30, 14:30". Tournament match scheduling is entered and shown in UTC
 * (localization is a later iteration); callers append a " UTC" label. The year
 * is shown only when it isn't the current year (see {@link isDifferentYear}).
 *
 * @param iso - ISO-8601 instant string, or null/undefined
 * @returns "MMM D, HH:MM" (or "MMM D, YYYY, HH:MM" off-year) in UTC, or "" when
 *   the input is empty/invalid
 */
export function formatScheduledUtc(iso: string | null | undefined): string {
	if (!iso) return "";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	return d.toLocaleString("en-CA", {
		timeZone: "UTC",
		month: "short",
		day: "numeric",
		...(isDifferentYear(d, "UTC") ? { year: "numeric" as const } : {}),
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

	const utcDate = d.toLocaleDateString("en-CA", {
		...dateOpts,
		timeZone: "UTC",
	});
	const utcTime = d.toLocaleTimeString("en-CA", {
		...timeOpts,
		timeZone: "UTC",
	});
	const localDate = d.toLocaleDateString("en-CA", dateOpts);
	const localTime = d.toLocaleTimeString("en-CA", timeOpts);

	// Viewer is effectively on UTC — the local part would just echo the primary.
	if (localDate === utcDate && localTime === utcTime) return `${utc} UTC`;

	const tzName = shortTimeZoneName(d);

	// The local date is shown only on a day rollover; include its year when it
	// isn't the current year, mirroring the UTC primary (formatScheduledUtc).
	// The rollover check itself stays year-agnostic — a same-instant UTC/local
	// year gap only happens across the New Year boundary, which already differs
	// by day, so the day comparison catches it.
	const localDateDisplay = isDifferentYear(d, undefined)
		? d.toLocaleDateString("en-CA", { ...dateOpts, year: "numeric" })
		: localDate;

	const local =
		localDate === utcDate
			? `${localTime} ${tzName}`
			: `${localDateDisplay}, ${localTime} ${tzName}`;

	return `${utc} UTC (${local.trim()})`;
}

/**
 * Formats an ISO instant in a single chosen timezone, e.g. "May 30, 14:30 UTC"
 * (zone="utc") or "May 30, 07:30 PDT" (zone="local"). Unlike
 * {@link formatScheduledWithLocal}, which always shows both, this renders one
 * zone — for surfaces with an explicit UTC/Local toggle where the viewer has
 * already chosen which clock to read.
 *
 * @param iso - ISO-8601 instant string, or null/undefined
 * @param zone - "utc" for the canonical UTC clock, "local" for the viewer's
 * @returns "MMM D, HH:MM <TZ>", or "" when the input is empty/invalid
 */
export function formatScheduledInZone(
	iso: string | null | undefined,
	zone: "utc" | "local",
): string {
	if (!iso) return "";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";

	if (zone === "utc") {
		const utc = formatScheduledUtc(iso);
		return utc ? `${utc} UTC` : "";
	}

	const dateTime = d.toLocaleString("en-CA", {
		month: "short",
		day: "numeric",
		...(isDifferentYear(d, undefined) ? { year: "numeric" as const } : {}),
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});
	const tzName = shortTimeZoneName(d);
	return tzName ? `${dateTime} ${tzName}` : dateTime;
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

/**
 * Relative "in X" / "X ago" string for a scheduled instant, matching Discord's
 * `<t:…:R>` style: "in 2 days", "in 5 hours", "in 30 minutes", "3 days ago".
 * Computed at render time from the current clock — not a live-ticking countdown
 * (it refreshes whenever the surface re-renders, e.g. reopening the popover).
 * The unit steps up as the gap widens (minutes → hours → days → months →
 * years), always picking the coarsest unit that still reads naturally.
 *
 * @param iso - ISO-8601 instant string, or null/undefined
 * @returns e.g. "in 2 days", or "" when the input is empty/invalid
 */
export function formatRelativeToNow(iso: string | null | undefined): string {
	if (!iso) return "";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	const diffMs = d.getTime() - Date.now();
	const abs = Math.abs(diffMs);
	const MIN = 60_000;
	const HOUR = 60 * MIN;
	const DAY = 24 * HOUR;
	const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
	if (abs < HOUR) return rtf.format(Math.round(diffMs / MIN), "minute");
	if (abs < DAY) return rtf.format(Math.round(diffMs / HOUR), "hour");
	if (abs < 30 * DAY) return rtf.format(Math.round(diffMs / DAY), "day");
	if (abs < 365 * DAY)
		return rtf.format(Math.round(diffMs / (30 * DAY)), "month");
	return rtf.format(Math.round(diffMs / (365 * DAY)), "year");
}
