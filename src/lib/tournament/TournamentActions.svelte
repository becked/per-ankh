<script lang="ts">
	// The tournament's top-right action cluster, shared by the overview header and
	// the matches page so Links / Settings / the clock toggles read identically on
	// both. It owns its own flex row (gap-2) and is dropped into a wider header
	// row. SignedUp deliberately stays out of here — it's a membership action, not
	// page chrome — so the overview header renders it alongside this cluster.
	import type { TournamentDetail } from "$lib/api-cloud";
	import type { ScheduleZone } from "./schedule";
	import {
		clockFaceIs12Hour,
		setClockFace,
	} from "$lib/stores/clock-face.svelte";
	import { shortTimeZoneName } from "$lib/utils/formatting";
	import SettingsPopover from "./SettingsPopover.svelte";
	import TournamentLinksMenu from "./TournamentLinksMenu.svelte";

	interface Props {
		tournament: TournamentDetail;
		// Opens the tournament guide (threaded to the links menu).
		onGuide: () => void;
		// The active clock. Omitted on surfaces with no schedule to switch (e.g. a
		// setup-phase overview page), where the UTC/local toggle is hidden. It gates
		// that toggle alone — the face toggle beside it has its own flag.
		zone?: ScheduleZone;
		// Flip handler; the caller persists the choice app-wide (setClockZone).
		// eslint-disable-next-line no-unused-vars -- callback signature
		onZoneChange?: (zone: ScheduleZone) => void;
		// Whether to offer the 12/24-hour face toggle. Gated separately from `zone`
		// because the face reaches further: a completed tournament's overview has no
		// live schedule to switch clocks on, yet its bracket still opens match cards
		// that render a local half. The caller owns the rule — it knows the route and
		// the tournament's phase.
		showClockFace?: boolean;
	}

	let {
		tournament,
		onGuide,
		zone,
		onZoneChange,
		showClockFace = false,
	}: Props = $props();

	// Settings shows for admins always, and for everyone once the tournament is
	// past setup (mirrors the gate this cluster replaced in TournamentHeader).
	const showSettings = $derived(
		tournament.is_viewer_admin === true || tournament.status !== "setup",
	);

	// Shared pill styling for this cluster's own triggers (the two clock toggles)
	// — matching the Links/Settings triggers beside it, which style themselves.
	// inline-flex leaves room for a button's leading icon.
	const triggerClass =
		"inline-flex items-center gap-1.5 whitespace-nowrap rounded border border-tan px-2.5 py-1 text-xs text-tan transition-colors hover:border-orange hover:text-orange";

	// The local button shows the viewer's actual zone (e.g. "PDT") rather than a
	// bare "Local", matching the abbreviation on the match times themselves. The
	// "Local" fallback is for an environment that resolves no abbreviation at all
	// — NOT for SSR: the Worker runs UTC, so Intl resolves "UTC" there and this
	// button server-renders reading "UTC" even when the clock is set to local.
	// That's the honest label for that paint rather than a bug to paper over —
	// MatchTable formats a local-zone time on the Worker's UTC clock too
	// (formatScheduledInZone), so the button agrees with the times it sits above,
	// and hydration corrects the pair together.
	const localZoneLabel = $derived(shortTimeZoneName() || "Local");

	// The viewer's clock face, for the toggle beside the zone one. Read from the
	// module singleton rather than threaded as a prop like `zone`: both
	// preferences are viewer-global, but the zone arrives as a prop because the
	// layout's ZoneClock layers this visit's ?zone= deep link over the saved one,
	// and that override is the layout's to own.
	const use12Hour = $derived(clockFaceIs12Hour());
</script>

<div class="flex flex-shrink-0 items-center gap-2">
	<TournamentLinksMenu {tournament} {onGuide} />
	{#if showSettings}
		<SettingsPopover {tournament} />
	{/if}
	{#if zone && onZoneChange}
		<!-- Single toggle button: shows the active clock and flips UTC↔local in
		     place on click (one click to switch, unlike a two-segment slider). The
		     choice is sticky app-wide via the caller's cookie write. -->
		<button
			type="button"
			class={triggerClass}
			onclick={() => onZoneChange?.(zone === "utc" ? "local" : "utc")}
			title="Toggle between UTC and your local time"
			aria-label={`Showing ${zone === "utc" ? "UTC" : "local"} time; switch to ${
				zone === "utc" ? "local" : "UTC"
			}`}
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				class="h-3.5 w-3.5 opacity-80"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				stroke-width="2"
				aria-hidden="true"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
				/>
			</svg>
			{zone === "utc" ? "UTC" : localZoneLabel}
		</button>
	{/if}
	{#if showClockFace}
		<!-- Clock-face toggle. The pair answers "when is this for me": the
		     UTC/local toggle picks which clock a time is read on, this one picks how
		     that clock is written. Flips 12↔24 in place and sticks app-wide (pa_clock).
		     No icon — a second clock glyph beside the zone button's would read as
		     the same control twice. Gated on its own flag rather than the zone
		     toggle's, because a match card renders a local half beside the canonical
		     UTC one whichever way the zone is set — and on a completed tournament
		     that card is the only clock left on the page.

		     The accessible name repeats the visible "12h"/"24h" token so a voice-
		     control user can address the button by what it reads (WCAG 2.5.3 Label
		     in Name); the title carries the spelled-out wording. -->
		<button
			type="button"
			class={triggerClass}
			onclick={() => setClockFace(use12Hour ? "24" : "12")}
			title="Toggle between a 12-hour (7:30 PM) and 24-hour (19:30) clock"
			aria-label={`Showing a ${use12Hour ? "12h" : "24h"} clock; switch to ${
				use12Hour ? "24-hour" : "12-hour"
			}`}
		>
			{use12Hour ? "12h" : "24h"}
		</button>
	{/if}
</div>
