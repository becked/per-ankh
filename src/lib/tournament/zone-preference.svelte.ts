// The viewer's sticky UTC/local clock — which clock a match time is read on,
// the canonical UTC one or their own. Companion to the 12/24-hour clock face
// (pa_clock, $lib/stores/clock-face): this one picks which clock a time is read
// on, that one picks how that clock is written. Both persist through the shared
// preference-cookie policy in $lib/utils/pref-cookie, and both are module
// singletons, so every surface that renders a time can read either — including
// the home page's upcoming inset, which sits outside the tournament layout and
// so has no context to read.
//
// Unset means the viewer's own zone, which is what everyone got before the
// toggle existed.
//
// A visit can override the preference without touching it: an explicit ?zone=
// deep link forces a clock for the recipient, which is what ZoneClock layers on
// top (zone-context.svelte.ts). The cookie is written only on an explicit
// toggle, so following someone's ?zone= link never silently overwrites your own
// saved default.
//
// Read/written client-side via document.cookie: the tournament routes use
// universal loads only (no +*.server.ts), so there's no server load to read the
// cookie during SSR — and "local" times re-render on hydration anyway (the
// worker runs UTC). The cookie substrate still leaves the door open to a
// server-side read later without migrating storage.
import type { ScheduleZone } from "./schedule";
import { readPrefCookie, writePrefCookie } from "$lib/utils/pref-cookie";

const COOKIE = "pa_zone";

/**
 * The clock a string names, or null when it names none. Both the saved cookie
 * and the ?zone= query param narrow through here, so an unset, unknown, or
 * hand-edited value falls through to the default instead of being trusted.
 */
export function parseZone(v: string | null | undefined): ScheduleZone | null {
	return v === "utc" || v === "local" ? v : null;
}

// The saved clock, or null when unset / on the server (no document).
function readZoneCookie(): ScheduleZone | null {
	return parseZone(readPrefCookie(COOKIE));
}

// Seeded at module load — on the client that's app bootstrap, before the first
// component renders, so a saved clock is already in place for the first paint
// after hydration. On the server there's no document and this stays null, so
// the singleton never carries a choice between requests.
let zone = $state<ScheduleZone | null>(readZoneCookie());

/**
 * The clock match times should render on — the viewer's explicit choice when
 * they've made one, otherwise their own local zone. Pass the result to the
 * schedule formatters in $lib/utils/formatting; read it in a template or
 * $derived and a flip re-renders the surface. Under /tournaments/[slug] read
 * ZoneClock's `zone` instead, which layers the ?zone= deep link over this.
 */
export function clockZone(): ScheduleZone {
	return zone ?? "local";
}

/**
 * Record an explicit clock and remember it app-wide for a year. Called only
 * from the header toggle (by way of ZoneClock.set), so the cookie is written on
 * a real choice and never on a passive render.
 */
export function setClockZone(next: ScheduleZone): void {
	zone = next;
	writePrefCookie(COOKIE, next);
}
