<script lang="ts">
	// Caster sign-up view — one of the Matches page's view modes. Lists the
	// tournament's upcoming scheduled parts (sittings) soonest-first, flags which
	// still need a caster, and lets any logged-in user add themselves as the
	// streamer or a co-caster. Renders through the shared MatchTable (part-row
	// granularity) with an inline actions column; writes go through the
	// self-service cast endpoints (a caster only ever touches their own entry).
	import {
		cloudApi,
		type TournamentDetail,
		type TournamentMatch,
		type UserMe,
	} from "$lib/api-cloud";
	import MatchTable from "$lib/tournament/MatchTable.svelte";
	import { pickColumns, type MatchRow } from "$lib/tournament/matches-table";
	import { upcomingScheduledParts, CAST_GRACE_MS } from "$lib/tournament/parts";
	import type { ScheduleZone } from "$lib/tournament/schedule";
	import { runAction } from "$lib/tournament/async-action";
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
		// match surfaces); the cast/drop buttons stopPropagation so they don't.
		// The matches page routes this to its own shared popover.
		// eslint-disable-next-line no-unused-vars -- documentary param names
		onOpenMatch?: (match: TournamentMatch, e: MouseEvent) => void;
	} = $props();

	let needsOnly = $state(true);
	let busyKey = $state<string | null>(null);

	// Upcoming scheduled parts (shared definition), with the shared cast grace
	// so a match that began minutes ago is still claimable by a late caster.
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

	// Same columns as the other match surfaces, plus the trailing actions column.
	const columns = pickColumns([
		"number",
		"matchup",
		"time",
		"caster",
		"stream",
		"actions",
	]);

	const filterItemClass =
		"cursor-pointer px-3 py-1.5 text-xs font-bold text-tan transition-colors data-[state=on]:bg-surface-raised";

	function iAmCaster(m: TournamentMatch, partId: string): boolean {
		if (!user) return false;
		const part = m.parts.find((p) => p.id === partId);
		return part?.casters.some((c) => c.user_id === user.user_id) ?? false;
	}
	function iAmStreamer(m: TournamentMatch, partId: string): boolean {
		if (!user) return false;
		const part = m.parts.find((p) => p.id === partId);
		return part?.casters[0]?.user_id === user.user_id;
	}

	async function cast(
		m: TournamentMatch,
		partId: string,
		role?: "streamer" | "cocaster",
	) {
		const key = `${m.match_id}:${partId}`;
		await runAction(
			() =>
				cloudApi.castMatchPart(
					tournament.tournament_id,
					m.match_id,
					partId,
					role,
				),
			{
				// Only clear if still ours — another row's action may have started.
				setBusy: (b) => (busyKey = b ? key : busyKey === key ? null : busyKey),
				success: role === "streamer" ? "You're the streamer" : "You're casting",
			},
		);
	}
	async function drop(m: TournamentMatch, partId: string) {
		const key = `${m.match_id}:${partId}`;
		await runAction(
			() =>
				cloudApi.uncastMatchPart(tournament.tournament_id, m.match_id, partId),
			{
				setBusy: (b) => (busyKey = b ? key : busyKey === key ? null : busyKey),
				success: "Dropped",
			},
		);
	}
</script>

<section
	class="mb-6 rounded-lg p-4"
	style="background-color: rgb(var(--color-surface));"
>
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
		{slotLabels}
		{slotAvatars}
		onRowClick={onOpenMatch}
		emptyMessage={upcoming.length === 0
			? "No upcoming scheduled matches."
			: "Every upcoming match has a caster. 🎉"}
	>
		{#snippet actions(row)}
			{#if row.part}
				{@const m = row.match}
				{@const partId = row.part.id}
				{@const busy = busyKey === `${m.match_id}:${partId}`}
				{@const mine = iAmCaster(m, partId)}
				<div class="flex items-center justify-end gap-1.5">
					{#if row.part.casters.length === 0}
						<span
							class="rounded bg-orange/15 px-2 py-0.5 text-[11px] font-bold uppercase text-orange"
							>needs a caster</span
						>
					{/if}
					{#if user}
						<!-- Buttons stopPropagation so acting on a row doesn't also open
						     the match card behind it. -->
						{#if !mine}
							<button
								type="button"
								class="rounded border border-input px-2 py-1 text-xs text-tan transition-colors hover:border-orange hover:text-orange disabled:opacity-50"
								disabled={busy}
								onclick={(e) => {
									e.stopPropagation();
									cast(m, partId);
								}}
							>
								I'll cast
							</button>
						{:else}
							{#if !iAmStreamer(m, partId)}
								<button
									type="button"
									class="rounded border border-input px-2 py-1 text-xs text-tan transition-colors hover:border-orange hover:text-orange disabled:opacity-50"
									disabled={busy}
									onclick={(e) => {
										e.stopPropagation();
										cast(m, partId, "streamer");
									}}
								>
									Make me streamer
								</button>
							{/if}
							<button
								type="button"
								class="rounded border border-input px-2 py-1 text-xs text-tan/70 transition-colors hover:border-red-400 hover:text-red-400 disabled:opacity-50"
								disabled={busy}
								onclick={(e) => {
									e.stopPropagation();
									drop(m, partId);
								}}
							>
								Drop
							</button>
						{/if}
					{/if}
				</div>
			{/if}
		{/snippet}
	</MatchTable>
</section>
