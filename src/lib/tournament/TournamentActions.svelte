<script lang="ts">
	// The tournament's top-right action cluster, shared by the overview header and
	// the matches page so Links / Settings / the clock toggle read identically on
	// both. It owns its own flex row (gap-2) and is dropped into a wider header
	// row. SignedUp deliberately stays out of here — it's a membership action, not
	// page chrome — so the overview header renders it alongside this cluster.
	import { resolve } from "$app/paths";
	import type { TournamentDetail } from "$lib/api-cloud";
	import type { ScheduleZone } from "./schedule";
	import { shortTimeZoneName } from "$lib/utils/formatting";
	import SettingsPopover from "./SettingsPopover.svelte";
	import TournamentLinksMenu from "./TournamentLinksMenu.svelte";

	interface Props {
		tournament: TournamentDetail;
		// Opens the tournament guide (threaded to the links menu).
		onGuide: () => void;
		// Settings is disabled while a match popover is open (shallow-routing guard).
		settingsDisabled?: boolean;
		// The active clock. Omitted on surfaces with no time-bearing content (e.g. a
		// setup-phase overview page), where the toggle is hidden entirely.
		zone?: ScheduleZone;
		// Flip handler; the caller persists the choice app-wide (writeZoneCookie).
		// eslint-disable-next-line no-unused-vars -- callback signature
		onZoneChange?: (zone: ScheduleZone) => void;
	}

	let {
		tournament,
		onGuide,
		settingsDisabled = false,
		zone,
		onZoneChange,
	}: Props = $props();

	// Settings shows for admins always, and for everyone once the tournament is
	// past setup (mirrors the gate this cluster replaced in TournamentHeader).
	const showSettings = $derived(
		tournament.is_viewer_admin === true || tournament.status !== "setup",
	);

	// Shared pill styling for this cluster's triggers (Stats link, Links/Settings,
	// the clock toggle). inline-flex leaves room for each button's leading icon.
	const triggerClass =
		"inline-flex items-center gap-1.5 whitespace-nowrap rounded border border-tan px-2.5 py-1 text-xs text-tan transition-colors hover:border-orange hover:text-orange";

	// The local button shows the viewer's actual zone (e.g. "PDT") rather than a
	// bare "Local", matching the abbreviation on the match times themselves. Falls
	// back to "Local" if the environment can't resolve one (also the SSR case,
	// where it would otherwise read "UTC" — corrected on hydration).
	const localZoneLabel = $derived(shortTimeZoneName() || "Local");
</script>

<div class="flex flex-shrink-0 items-center gap-2">
	<a
		href={resolve("/tournaments/[slug]/stats", { slug: tournament.slug })}
		class={triggerClass}
		title="Tournament stats"
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
				d="M3 21h18M7 21V10M12 21V4M17 21V14"
			/>
		</svg>
		Stats
	</a>
	<TournamentLinksMenu {tournament} {onGuide} />
	{#if showSettings}
		<SettingsPopover {tournament} disabled={settingsDisabled} />
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
</div>
