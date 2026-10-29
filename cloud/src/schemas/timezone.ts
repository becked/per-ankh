// The IANA timezone id carried by `users.timezone` and
// `tournament_slots.timezone` (migration 0055).
//
// Its own module rather than a field rule inside ./user or ./tournament:
// both of those need it, and ./user already imports from ./tournament, so
// putting it in either would make the pair circular.

import * as v from "valibot";

// Whether the runtime recognizes `zone` as a timezone. Intl is the only
// authority available here — there is no zone table in the Worker — and it
// answers by throwing RangeError on an unknown id. Accepts the fixed-offset
// forms too ("UTC", "Etc/GMT+5"), which is correct: those are real zone ids a
// player may legitimately be in.
export function isTimeZone(zone: string): boolean {
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: zone });
		return true;
	} catch {
		return false;
	}
}

// The canonical spelling of a zone the runtime already accepted. Intl matches
// zone ids case-insensitively, so "america/new_york" parses — storing what was
// typed would leave the same zone spelled several ways across rows, and the
// client compares stored value against `getLocalTimeZone()` to decide whether
// the dropdown is showing a saved zone or a detected one. Returns the input
// unchanged if the runtime won't resolve it; the check above is what rejects.
export function canonicalTimeZone(zone: string): string {
	try {
		return new Intl.DateTimeFormat("en-US", {
			timeZone: zone,
		}).resolvedOptions().timeZone;
	} catch {
		return zone;
	}
}

// 64 chars is well clear of the longest id in the database
// ("America/Argentina/ComodRivadavia", 32) while still bounding the string
// before it reaches Intl.
export const TimeZoneSchema = v.pipe(
	v.string(),
	v.trim(),
	v.maxLength(64),
	v.check(isTimeZone, "Not a recognized IANA timezone"),
	v.transform(canonicalTimeZone),
);
