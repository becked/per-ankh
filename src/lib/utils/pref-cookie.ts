// The one place the app's client-side UI preferences agree on cookie policy:
// app-global (path=/), a year long, SameSite=Lax, and no HttpOnly since JS both
// writes and reads them. The UTC/local zone (pa_zone,
// tournament/zone-preference.svelte) and the 12/24-hour clock face (pa_clock,
// stores/clock-face) both ride it, so the policy can't drift between them — a
// change to the max-age or the SameSite stance lands on every preference at
// once.
//
// Values come back raw and each caller narrows with its own type guard, so an
// unset, unknown, or hand-edited cookie falls through to that surface's default
// instead of being trusted.

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * The raw value of a preference cookie, or null when it isn't set — and always
 * on the server, which has no `document` to read.
 *
 * @param name - the cookie name, e.g. "pa_zone"
 */
export function readPrefCookie(name: string): string | null {
	if (typeof document === "undefined") return null;
	// Scanned rather than matched by regex: the name is compared after trimming
	// the "; " separator, so a neighbouring cookie whose name merely ENDS with
	// this one (xpa_zone) can't match, and the caller's guard rejects anything
	// whose value isn't one of its own.
	for (const entry of document.cookie.split(";")) {
		const eq = entry.indexOf("=");
		if (eq === -1) continue;
		if (entry.slice(0, eq).trim() === name) return entry.slice(eq + 1).trim();
	}
	return null;
}

/**
 * Persist a preference app-globally for a year. A no-op on the server.
 *
 * @param name - the cookie name, e.g. "pa_zone"
 * @param value - the value to store; callers pass their own narrowed union
 */
export function writePrefCookie(name: string, value: string): void {
	if (typeof document === "undefined") return;
	document.cookie = `${name}=${value}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
}
