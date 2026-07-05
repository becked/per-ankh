<script lang="ts">
	// Caster sign-up view — one of the Matches page's view modes. Lists the
	// tournament's upcoming scheduled parts (sittings) soonest-first and flags how
	// many still need a caster; the sign-up controls themselves live inline in the
	// shared MatchTable's Casters & Streams cell (CastControls), so this view is
	// just the upcoming-parts filter + the needs-a-caster toggle around it.
	import {
		type TournamentDetail,
		type TournamentMatch,
		type UserMe,
	} from "$lib/api-cloud";
	import MatchTable from "$lib/tournament/MatchTable.svelte";
	import { pickColumns, type MatchRow } from "$lib/tournament/matches-table";
	import { upcomingScheduledParts, CAST_GRACE_MS } from "$lib/tournament/parts";
	import type { ScheduleZone } from "$lib/tournament/schedule";
	import { ToggleGroup } from "bits-ui";

	let {
		matches,
		tournament,
		zone,
		user,
		slotLabels,
		slotAvatars,
		onOpenMatch,
	}: {
		matches: TournamentMatch[];
		tournament: TournamentDetail;
		zone: ScheduleZone;
		user: UserMe | null;
		slotLabels: Record<string, string>;
		slotAvatars: Record<string, string | null>;
		// Opens the match card. Clicking a row calls it (identical to the other
		// match surfaces); the cast/drop buttons stopPropagation so they don't. The
		// matches page routes this to its own shared popover.
		// eslint-disable-next-line no-unused-vars -- documentary param names
		onOpenMatch?: (match: TournamentMatch, e: MouseEvent) => void;
	} = $props();

	let needsOnly = $state(true);

	// Upcoming scheduled parts (shared definition), with the shared cast grace so
	// a match that began minutes ago is still claimable by a late caster.
	const upcoming = $derived(upcomingScheduledParts(matches, CAST_GRACE_MS));
	// Header counts are per MATCH (a split match with two upcoming sittings
	// shouldn't count twice); the rows themselves stay per part.
	const upcomingMatchCount = $derived(
		new Set(upcoming.map((np) => np.match.match_id)).size,
	);
	const needsCasterCount = $derived(
		new Set(
			upcoming
				.filter((np) => np.part.casters.length === 0)
				.map((np) => np.match.match_id),
		).size,
	);
	// NumberedPart is structurally a part-granularity MatchRow, so the upcoming
	// list feeds MatchTable directly.
	const rows = $derived<MatchRow[]>(
		needsOnly
			? upcoming.filter((np) => np.part.casters.length === 0)
			: upcoming,
	);

	const columns = pickColumns(["time", "matchup", "broadcast", "actions"]);

	const filterItemClass =
		"cursor-pointer px-3 py-1.5 text-xs font-bold text-tan transition-colors data-[state=on]:bg-surface-raised";
</script>

<div class="mb-3 flex flex-wrap items-center justify-between gap-3">
	<p class="text-sm text-muted">
		{needsCasterCount} of {upcomingMatchCount} upcoming {upcomingMatchCount ===
		1
			? "match needs"
			: "matches need"} a caster
	</p>
	<ToggleGroup.Root
		type="single"
		value={needsOnly ? "needs" : "all"}
		onValueChange={(v) => v && (needsOnly = v === "needs")}
		class="flex overflow-hidden rounded-lg border-2 border-surface"
		style="background-color: rgb(var(--color-surface-sunken));"
		aria-label="Filter"
	>
		<ToggleGroup.Item value="needs" class={filterItemClass}
			>Needs a caster</ToggleGroup.Item
		>
		<ToggleGroup.Item value="all" class={filterItemClass}
			>All scheduled</ToggleGroup.Item
		>
	</ToggleGroup.Root>
</div>

{#if !user}
	<p
		class="mb-3 rounded-lg border border-border-subtle bg-surface-sunken p-3 text-sm text-muted"
	>
		Log in to sign up as a caster.
	</p>
{/if}

<MatchTable
	{columns}
	{rows}
	{zone}
	{tournament}
	{user}
	{slotLabels}
	{slotAvatars}
	onRowClick={onOpenMatch}
	emptyMessage={upcoming.length === 0
		? "No upcoming scheduled matches."
		: "Every upcoming match has a caster. 🎉"}
/>
