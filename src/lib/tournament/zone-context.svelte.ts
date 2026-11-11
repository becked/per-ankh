// A tournament visit's ?zone= deep-link override, layered over the app-wide
// clock preference (zone-preference.svelte.ts). The [slug] layout constructs
// one instance from the URL and provides it via context; the overview, matches
// and stats pages read `zone` from it, so switching tabs never re-initialises
// the clock (no flicker) and the header's top-right toggle stays in lockstep
// with every time-bearing surface.
//
// Only the override lives here. The preference itself is a module singleton any
// surface can read — which is what the home page's upcoming inset does, having
// no context to reach — so a flip made on one of these pages re-renders the
// others too.
//
// Init reads the URL but never writes the cookie: that write lives in `set`,
// which fires only on an explicit toggle, so arriving via a shared ?zone= link
// forces the clock for the visit without overwriting the visitor's own default.
import { getContext, setContext } from "svelte";
import type { ScheduleZone } from "./schedule";
import { clockZone, parseZone, setClockZone } from "./zone-preference.svelte";

export class ZoneClock {
	// The clock the link asked for, or null when it asked for none — which is
	// when `zone` falls through to the viewer's own preference.
	#linkZone = $state<ScheduleZone | null>(null);

	constructor(param: string | null) {
		this.#linkZone = parseZone(param);
	}

	// The clock this tournament's pages render on: the deep link's while it
	// stands, otherwise the saved preference. Reading it in a template or
	// $derived subscribes to both, so either changing re-renders the surface.
	get zone(): ScheduleZone {
		return this.#linkZone ?? clockZone();
	}

	// Flip and persist the clock app-wide. Called only from the header toggle (an
	// explicit user action), so the cookie is written here, never on init. The
	// link's clock is dropped first — a choice the viewer just made outranks the
	// one the link that brought them here asked for.
	set(next: ScheduleZone) {
		this.#linkZone = null;
		setClockZone(next);
	}
}

const KEY = Symbol("tournament-zone-clock");

export function setZoneClock(clock: ZoneClock): ZoneClock {
	return setContext(KEY, clock);
}

export function getZoneClock(): ZoneClock {
	return getContext(KEY);
}
