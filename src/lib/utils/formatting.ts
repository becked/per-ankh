import { COGNOMENS } from "$lib/generated/cognomens";
import { NAME_TEXT } from "$lib/generated/name-text";
import { NATION_NAMES } from "$lib/generated/nation-names";

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
 * The name Old World gives a nation, from its `NATION_*` token — the label to
 * use everywhere a nation is shown.
 *
 * The token is an internal id, not the display name: `NATION_HITTITE` is
 * **Hatti** in game ("Hittite" is the adjective) and `NATION_TAMIL` is
 * **Tamilakam**. The other eleven nations title-case correctly, so the baked
 * table carries only the two and `formatEnum` covers the rest — including any
 * nation from game content newer than the baked reference snapshot. Nullish
 * input still yields `formatEnum`'s "Unknown".
 */
export function nationName(nation: string | null | undefined): string {
	return (
		(nation ? NATION_NAMES[nation] : undefined) ?? formatEnum(nation, "NATION_")
	);
}

/**
 * The cognomen Old World gives a ruler, from its `COGNOMEN_*` token — with the
 * article, as the game writes it ("the Wise", "alcaras the Wise").
 *
 * The token is an internal id, not the label: `COGNOMEN_BRAVE` displays as
 * **the Drillmaster**. The English string was rewritten and the id kept its
 * original word — the same split the difficulty levels show, where
 * `DIFFICULTY_GREAT` is "Fragile". It is the only one of the 63 where the two
 * disagree, so the baked table settles it and `formatEnum` covers a cognomen
 * from game content newer than the baked reference snapshot, as `nationName`
 * does for a nation.
 */
export function cognomenName(cognomen: string): string {
	return (
		COGNOMENS[cognomen]?.name ?? `the ${formatEnum(cognomen, "COGNOMEN_")}`
	);
}

/**
 * The name Old World gives a character, from the save's `NAME_*` token.
 *
 * The token is an internal id, not a name: it only title-cases into the right
 * name by coincidence, which it does for most of the base game and for none of
 * Hatti (whose pool is `NAME_HITTITE_MALE03`-style indices). The baked table
 * carries every name that resolves to something else — the Hatti pool, prefixed
 * tokens (`NAME_TUTOR_ARISTOTLE` → Aristotle), hyphenated names
 * (`NAME_SAMMU_RAMAT` → Sammu-ramat) — and `formatEnum` still covers the rest,
 * including tokens from game content newer than the baked reference snapshot.
 */
export function characterName(token: string | null | undefined): string {
	return (token ? NAME_TEXT[token] : undefined) ?? formatEnum(token, "NAME_");
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

// Human label for a video/stream platform id (see cloud/src/video/). Known
// platforms get a proper cased name; anything else is capitalized so a new
// provider renders sensibly before this map is updated.
const VIDEO_PLATFORM_LABELS: Record<string, string> = { youtube: "YouTube" };
export function platformLabel(platform: string): string {
	return (
		VIDEO_PLATFORM_LABELS[platform] ??
		platform.charAt(0).toUpperCase() + platform.slice(1)
	);
}

// Display locale for every scheduled-time surface. Pinned rather than following
// the viewer: the app is English throughout, so the viewer's own locale would
// translate month names ("30. Mai") in the middle of an otherwise English page.
// en-US also renders the meridiem as "PM" — en-CA, which these helpers used to
// pass, writes "7:30 p.m.". Only the LANGUAGE is fixed here; a LOCAL time's
// clock face still follows the viewer (see viewerClockOptions).
export const TIME_LOCALE = "en-US";

// The face for the CANONICAL UTC clock: the UTC position of a zone toggle, and
// the UTC half of a dual render. "14:30 UTC" is how a match is agreed,
// announced, and cast, so that half reads 24-hour whatever face the viewer's
// locale prefers — otherwise the one value everybody quotes acquires a second
// spelling. The viewer's own face belongs to the LOCAL half, where it answers
// "when is that for me".
//
// Scoped to the canonical clock, NOT to the string "UTC": a viewer whose own
// zone is UTC and whose locale is 12-hour gets "2:30 PM UTC" from the LOCAL
// half, and that is correct. They asked for their clock, and UTC is its honest
// label — sitting where "PDT" or "GMT+9" would for anyone else. Deciding it by
// the label instead would mean guessing: London reads "GMT" half the year,
// Reykjavik and Accra read "GMT" always, Lisbon reads "GMT+0", all at offset
// zero, so any test that catches those overreaches and any test that spares
// them catches only machines literally set to UTC.
const UTC_CLOCK_OPTIONS: Intl.DateTimeFormatOptions = {
	hour: "2-digit",
	minute: "2-digit",
	hour12: false,
};

// Resolved once per session. What's cached is the BROWSER's answer, which a
// page can't change — not the face on screen, which the header toggle now flips
// at will (clock-face.svelte.ts layers the explicit choice over this). Probing
// Intl builds a throwaway DateTimeFormat, and this is the default every viewer
// who has never touched the toggle falls back to on every render.
let cached12Hour: boolean | undefined;

/**
 * Whether the viewer's locale writes clock times on a 12-hour face ("7:30 PM")
 * rather than a 24-hour one ("19:30"). Asking Intl for the viewer's own hour
 * cycle gets the split right where a hardcoded 24-hour face left 12-hour
 * readers misreading every tournament time. The split is regional, not
 * English-vs-not: en-US/AU/NZ/IN/PH read 12-hour and so do es-MX, ko-KR, ar-EG
 * and hi-IN, while en-GB/IE/ZA sit with ja-JP, de-DE and fr-FR on 24-hour.
 * Governs LOCAL times only; UTC keeps its own 24-hour face (see
 * UTC_CLOCK_OPTIONS).
 *
 * This is the BROWSER's answer, and only a default: a viewer who has picked a
 * face in the header toggle overrides it. Call clockFaceIs12Hour() from
 * $lib/stores/clock-face instead — it layers the saved choice over this — unless
 * you specifically want what the browser reports.
 */
export function viewerUses12Hour(): boolean {
	// There is no viewer to ask during SSR, and the Worker resolves en-US/UTC —
	// so probing there would render every local time on a 12-hour face for
	// everyone, including the "2:30 PM UTC" that UTC_CLOCK_OPTIONS exists to
	// prevent, and including readers whose own clock is 24-hour. The canonical
	// face is the honest first paint; hydration upgrades the viewers who do read
	// 12-hour. Same `document` probe the zone cookie uses (zone-preference.ts).
	if (typeof document === "undefined") return false;
	return (cached12Hour ??=
		new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions()
			.hour12 === true);
}

// The hour/minute half of a LOCAL scheduled time, on the viewer's own clock
// face. hour12 is passed explicitly because TIME_LOCALE is pinned — en-US would
// otherwise force a 12-hour face on everyone. The 12-hour face uses "numeric"
// so it reads "7:30 PM" rather than a zero-padded "07:30 PM"; the 24-hour face
// keeps the padding that lines a column of times up.
//
// The face arrives as an argument rather than being looked up here: it is a
// reactive preference (clock-face.svelte.ts), and reading a rune from this
// module would pull $state into the ten bake scripts that import it under tsx,
// where it doesn't exist. Callers read it in their own reactive context, which
// is also what makes a flip re-render them.
function viewerClockOptions(use12Hour: boolean): Intl.DateTimeFormatOptions {
	return {
		hour: use12Hour ? "numeric" : "2-digit",
		minute: "2-digit",
		hour12: use12Hour,
	};
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
		x.toLocaleDateString(TIME_LOCALE, { timeZone, year: "numeric" });
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
		new Intl.DateTimeFormat(TIME_LOCALE, { timeZoneName: "short" })
			.formatToParts(date)
			.find((p) => p.type === "timeZoneName")?.value ?? ""
	);
}

/**
 * Formats an ISO instant as a UTC date + 24-hour time for display, e.g.
 * "May 30, 14:30" — the canonical face for every viewer, 12-hour locales
 * included (see {@link UTC_CLOCK_OPTIONS}). Callers append a " UTC" label. The
 * year is shown only when it isn't the current year (see
 * {@link isDifferentYear}).
 *
 * @param iso - ISO-8601 instant string, or null/undefined
 * @returns "MMM D, HH:MM" (or "MMM D, YYYY, HH:MM" off-year) in UTC, or "" when
 *   the input is empty/invalid
 */
export function formatScheduledUtc(iso: string | null | undefined): string {
	if (!iso) return "";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	return d.toLocaleString(TIME_LOCALE, {
		timeZone: "UTC",
		month: "short",
		day: "numeric",
		...(isDifferentYear(d, "UTC") ? { year: "numeric" as const } : {}),
		...UTC_CLOCK_OPTIONS,
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
 * The two halves are deliberately allowed to differ in face: the UTC primary
 * is always 24-hour, while the parenthetical is the viewer's own clock, so a
 * 12-hour reader gets "May 30, 14:30 UTC (7:30 AM PDT)" — the canonical value
 * plus its translation, which is the whole point of the line.
 *
 * @param iso - ISO-8601 instant string, or null/undefined
 * @param use12Hour - the viewer's clock face, from clockFaceIs12Hour(). Governs
 *   the parenthetical local half only; the UTC primary is always 24-hour.
 * @returns "MMM D, HH:MM UTC (<time> TZ)" (date in the local part only when it
 *   differs), or "" when the input is empty/invalid
 */
export function formatScheduledWithLocal(
	iso: string | null | undefined,
	use12Hour: boolean,
): string {
	const utc = formatScheduledUtc(iso);
	if (!utc) return "";
	const d = new Date(iso as string);

	const dateOpts: Intl.DateTimeFormatOptions = {
		month: "short",
		day: "numeric",
	};
	const utcDate = d.toLocaleDateString(TIME_LOCALE, {
		...dateOpts,
		timeZone: "UTC",
	});
	const localDate = d.toLocaleDateString(TIME_LOCALE, dateOpts);

	// Whether the viewer sits on UTC is a fact about the instant, not about how
	// it's written, so the test renders BOTH sides on the canonical face. Testing
	// the display strings instead would misfire now that the halves can differ in
	// face: a 12-hour viewer on UTC would fail the equality and be handed the
	// useless "May 30, 14:30 UTC (2:30 PM GMT)".
	const utcTime = d.toLocaleTimeString(TIME_LOCALE, {
		...UTC_CLOCK_OPTIONS,
		timeZone: "UTC",
	});
	const localTimeUtcFace = d.toLocaleTimeString(TIME_LOCALE, UTC_CLOCK_OPTIONS);

	// Viewer is effectively on UTC — the local part would just echo the primary.
	if (localDate === utcDate && localTimeUtcFace === utcTime)
		return `${utc} UTC`;

	const localTime = d.toLocaleTimeString(
		TIME_LOCALE,
		viewerClockOptions(use12Hour),
	);
	const tzName = shortTimeZoneName(d);

	// The local date is shown only on a day rollover; include its year when it
	// isn't the current year, mirroring the UTC primary (formatScheduledUtc).
	// The rollover check itself stays year-agnostic — a same-instant UTC/local
	// year gap only happens across the New Year boundary, which already differs
	// by day, so the day comparison catches it.
	const localDateDisplay = isDifferentYear(d, undefined)
		? d.toLocaleDateString(TIME_LOCALE, { ...dateOpts, year: "numeric" })
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
 * @param use12Hour - the viewer's clock face, from clockFaceIs12Hour(). Applies
 *   to the local clock only; the UTC one is always 24-hour.
 * @returns "MMM D, <time> <TZ>" — 24-hour on the UTC clock, the viewer's own
 *   face on the local one — or "" when the input is empty/invalid
 */
export function formatScheduledInZone(
	iso: string | null | undefined,
	zone: "utc" | "local",
	use12Hour: boolean,
): string {
	if (!iso) return "";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";

	if (zone === "utc") {
		const utc = formatScheduledUtc(iso);
		return utc ? `${utc} UTC` : "";
	}

	const dateTime = d.toLocaleString(TIME_LOCALE, {
		month: "short",
		day: "numeric",
		...(isDifferentYear(d, undefined) ? { year: "numeric" as const } : {}),
		...viewerClockOptions(use12Hour),
	});
	const tzName = shortTimeZoneName(d);
	return tzName ? `${dateTime} ${tzName}` : dateTime;
}

/**
 * The time half alone of {@link formatScheduledInZone} — no date, no zone
 * label, e.g. "14:30" (or "2:30 PM"). For surfaces whose own chrome already
 * carries the date and zone, like the matches calendar, where the day cell
 * names the day and the toggle names the zone.
 *
 * @param iso - ISO-8601 instant string, or null/undefined
 * @param zone - "utc" for the canonical UTC clock, "local" for the viewer's
 * @param use12Hour - the viewer's clock face, from clockFaceIs12Hour(). Applies
 *   to the local clock only; the UTC one is always 24-hour.
 * @returns the clock time in that zone, or "" when the input is empty/invalid
 */
export function formatScheduledTimeInZone(
	iso: string | null | undefined,
	zone: "utc" | "local",
	use12Hour: boolean,
): string {
	if (!iso) return "";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	return zone === "utc"
		? d.toLocaleTimeString(TIME_LOCALE, {
				...UTC_CLOCK_OPTIONS,
				timeZone: "UTC",
			})
		: d.toLocaleTimeString(TIME_LOCALE, viewerClockOptions(use12Hour));
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

	// Fall back to the nation's in-game name plus the turn count
	const formattedNation = game.save_owner_nation
		? nationName(game.save_owner_nation)
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
 * A day in the short "4 Sep" form, on the pinned locale so the month never
 * arrives translated and server and client agree across hydration.
 *
 * `timeZone` names the clock the day is read on. The tournament header needs
 * UTC for `starts_at` and the viewer's own zone for `completed_at`, because the
 * two columns are written differently (see migration 0020); callers that do not
 * care omit it.
 *
 * Returns null for a missing or unparseable instant rather than "Invalid Date".
 */
export function formatShortDate(
	iso: string | null | undefined,
	timeZone?: string,
): string | null {
	if (!iso) return null;
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return null;
	return d.toLocaleDateString(TIME_LOCALE, {
		timeZone,
		month: "short",
		day: "numeric",
	});
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

// ─── Character archetypes ────────────────────────────────────────────
//
// Old World models a character's archetype as a trait flagged bArchetype,
// stored under the trait's own id with an _ARCHETYPE suffix
// (TRAIT_SCHEMER_ARCHETYPE). Three things follow from that shape, and all
// three had grown their own copy of the suffix rule: the display name drops
// the suffix, the sprite ships under the bare trait id, and a character's
// trait list has to exclude the archetype so it isn't shown twice.
//
// Lives here rather than beside its callers because both the game-detail view
// (which the frozen web/ viewer symlinks) and the stats charts need it, and
// this module is already on both sides of that boundary.
//
// The Worker keeps its own copy of the suffix rule (cloud/src/stats/
// aggregate.ts) — cloud/ is a separate package with no shared module.

const ARCHETYPE_SUFFIX = /_ARCHETYPE$/;

/** True for the archetype trait itself, e.g. TRAIT_SCHEMER_ARCHETYPE. */
export function isArchetypeTrait(traitName: string): boolean {
	return ARCHETYPE_SUFFIX.test(traitName);
}

/** Display name for an archetype: TRAIT_SCHEMER_ARCHETYPE → "Schemer". */
export function formatArchetype(archetype: string): string {
	return formatEnum(archetype.replace(ARCHETYPE_SUFFIX, ""), "TRAIT_");
}

/**
 * Sprite name for an archetype's glyph: TRAIT_SCHEMER_ARCHETYPE →
 * TRAIT_SCHEMER, which is how the art ships in the `traits` category.
 */
export function archetypeSpriteKey(archetype: string): string {
	return archetype.replace(ARCHETYPE_SUFFIX, "");
}

/**
 * Display label for a character's death_reason: the save writes localization
 * keys like TEXT_TRAIT_SEVERELY_ILL_M, so strip the TEXT_/TRAIT_ prefix and
 * the gendered _F/_M suffix before formatting ("Severely Ill").
 */
export function deathReasonLabel(reason: string): string {
	return formatEnum(
		reason.replace(/^TEXT_(TRAIT_)?/, "").replace(/_(F|M)$/, ""),
		"",
	);
}
