// The single active-clock (UTC/local) preference shared across a tournament's
// three view tabs. The [slug] layout constructs one instance, seeds it from the
// deep-link precedence (?zone= param > saved cookie > local), and provides it
// via context; the overview and matches pages read `zone` from it, so switching
// tabs never re-initialises the clock (no flicker) and the header's top-right
// toggle stays in lockstep with every time-bearing surface.
//
// Init reads the cookie but never writes it — the cookie write lives in `set`,
// which fires only on an explicit toggle, so arriving via a shared ?zone= link
// forces the clock for the visit without overwriting the visitor's own default
// (mirroring the precedence documented in zone-preference.ts).
import { getContext, setContext } from "svelte";
import type { ScheduleZone } from "./schedule";
import { writeZoneCookie } from "./zone-preference";

export class ZoneClock {
	zone = $state<ScheduleZone>("local");

	constructor(initial: ScheduleZone) {
		this.zone = initial;
	}

	// Flip and persist the clock app-wide. Called only from the header toggle (an
	// explicit user action), so the cookie is written here, never on init.
	set(next: ScheduleZone) {
		this.zone = next;
		writeZoneCookie(next);
	}
}

const KEY = Symbol("tournament-zone-clock");

export function setZoneClock(clock: ZoneClock): ZoneClock {
	return setContext(KEY, clock);
}

export function getZoneClock(): ZoneClock {
	return getContext(KEY);
}
