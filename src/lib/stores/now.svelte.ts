// A shared, low-frequency reactive clock in epoch milliseconds. Time-relative
// display helpers (match status, schedule ordering, "up next" filtering) read
// `nowMs()` so any Svelte $derived or template that transitively calls them
// recomputes as the clock crosses a scheduled time. Without it a match keeps
// reading "Scheduled" past its start time — and an already-played sitting
// lingers in "Up next" — until an unrelated navigation forces a re-render.
//
// Ticks every 30s (scheduled times are minute-precision, so this bounds the
// visible lag well under a minute) and only in the browser; on the server the
// value stays fixed for the single SSR pass.
let now = $state(Date.now());

if (typeof window !== "undefined") {
	setInterval(() => {
		now = Date.now();
	}, 30_000);
}

// Reactive current time (epoch ms). Reading this inside a reactive context (a
// $derived, $effect, or component template) subscribes to the 30s tick; reading
// it anywhere else just returns the current value.
export function nowMs(): number {
	return now;
}
