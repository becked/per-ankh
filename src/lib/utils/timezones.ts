import { getLocalTimeZone } from "@internationalized/date";
import { formatTimeZone } from "$lib/utils/formatting";
import type { SelectOption } from "$lib/ui/types";

// The IANA timezone list behind both zone dropdowns — account Preferences and
// tournament signup — so the two can't offer different zones or label the same
// zone two ways.

// The "no zone" entry, matching Select's own placeholderValue so picking it
// reaches onChange as null.
const NO_ZONE: SelectOption = { value: "", label: "Not set" };

// The zone entries, built once per page load rather than per render: labelling
// 400-odd zones means 400-odd Intl formats, and the list is identical every
// time. It is also stable within a session for the one way it could move — an
// offset crossing a DST boundary while the tab sits open — which drifts a
// label, not the value that gets stored.
let cached: SelectOption[] | null = null;

function zoneOptions(): SelectOption[] {
	if (cached) return cached;
	const now = new Date();
	// Intl.supportedValuesOf is the only enumeration available — the app ships
	// no zone table — and it is what keeps this in step with the runtime's
	// tzdata instead of a baked list going stale. A runtime without it still
	// gets a working control, because the one entry that matters is the
	// viewer's own detected zone and that is what the dropdowns preselect.
	const zones =
		typeof Intl.supportedValuesOf === "function"
			? Intl.supportedValuesOf("timeZone")
			: [getLocalTimeZone()];
	cached = zones.map((zone) => ({
		value: zone,
		label: formatTimeZone(zone, now),
	}));
	return cached;
}

/**
 * Options for a timezone Select, with "Not set" first.
 *
 * `selected` is appended when the enumeration doesn't contain it, which is a
 * normal case rather than a defensive one: `supportedValuesOf` returns only
 * canonical ids, while a browser may well detect — and a row may well hold —
 * a link name the same tzdata still resolves ("Asia/Calcutta" for
 * "Asia/Kolkata"). Without the entry the trigger would show the placeholder
 * over a zone that is really set.
 */
export function timeZoneOptions(selected: string | null): SelectOption[] {
	const zones = zoneOptions();
	if (selected === null || zones.some((o) => o.value === selected)) {
		return [NO_ZONE, ...zones];
	}
	return [
		NO_ZONE,
		{ value: selected, label: formatTimeZone(selected) },
		...zones,
	];
}
