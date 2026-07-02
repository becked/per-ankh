<script lang="ts">
	// Caster sign-up view — one of the Matches page's view modes. Lists the
	// tournament's upcoming scheduled parts (sittings) soonest-first, flags which
	// still need a caster, and lets any logged-in user add themselves as the
	// streamer or a co-caster. Writes go through the self-service cast endpoints
	// (a caster only ever touches their own entry).
	import {
		cloudApi,
		type TournamentDetail,
		type TournamentMatch,
		type UserMe,
	} from "$lib/api-cloud";
	import PlayerAvatar from "$lib/tournament/PlayerAvatar.svelte";
	import { padMatchNumber } from "$lib/tournament/match-numbers";
	import { matchSlotDisplayName } from "$lib/tournament/match-occupant";
	import { upcomingScheduledParts } from "$lib/tournament/parts";
	import type { ScheduleZone } from "$lib/tournament/schedule";
	import {
		atlasMapUrl,
		distinguishingOptions,
		mapInAtlas,
		mapPoolLabel,
		poolEntryById,
	} from "$lib/tournament/map-script-options";
	import { runAction } from "$lib/tournament/async-action";
	import {
		formatRelativeToNow,
		formatScheduledInZone,
	} from "$lib/utils/formatting";
	import { ToggleGroup } from "bits-ui";

	let {
		matches,
		tournament,
		zone,
		user,
		slotLabels,
	}: {
		matches: TournamentMatch[];
		tournament: TournamentDetail;
		zone: ScheduleZone;
		user: UserMe | null;
		slotLabels: Record<string, string>;
	} = $props();

	const distinguishing = $derived(distinguishingOptions(tournament.map_pool));

	let needsOnly = $state(true);
	let busyKey = $state<string | null>(null);

	// Upcoming scheduled parts (shared definition), with a 2h grace so a match
	// that began minutes ago is still claimable by a late caster.
	const GRACE_MS = 2 * 60 * 60 * 1000;
	const upcoming = $derived(upcomingScheduledParts(matches, GRACE_MS));
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
	const rows = $derived(
		needsOnly
			? upcoming.filter((np) => np.part.casters.length === 0)
			: upcoming,
	);

	const filterItemClass =
		"cursor-pointer px-3 py-1.5 text-xs font-bold text-tan transition-colors data-[state=on]:bg-surface-raised";

	function vs(m: TournamentMatch): string {
		return `${matchSlotDisplayName(m, "a", slotLabels) ?? "?"} v ${
			matchSlotDisplayName(m, "b", slotLabels) ?? "?"
		}`;
	}
	function mapEntry(m: TournamentMatch) {
		return poolEntryById(tournament.map_pool, m.map_pool_id);
	}
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

	// The bracket a match belongs to, as a short label.
	function bracketLabel(m: TournamentMatch): string {
		if (m.phase === "championship") return "Championship";
		if (m.division)
			return m.division === "A"
				? tournament.division_a_name
				: tournament.division_b_name;
		return "";
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

	{#if rows.length === 0}
		<p class="rounded-lg bg-surface-sunken p-8 text-center italic text-muted">
			{upcoming.length === 0
				? "No upcoming scheduled matches."
				: "Every upcoming match has a caster. 🎉"}
		</p>
	{:else}
		<ul class="flex flex-col gap-2">
			<!-- Key by match+part: part ids are only unique within a match (the 0029
			     backfill mints "p1" for every migrated match). -->
			{#each rows as np (`${np.match.match_id}:${np.part.id}`)}
				{@const m = np.match}
				{@const entry = mapEntry(m)}
				{@const key = `${m.match_id}:${np.part.id}`}
				{@const busy = busyKey === key}
				{@const mine = iAmCaster(m, np.part.id)}
				<li
					class="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-surface-sunken p-3"
				>
					<!-- Time + countdown -->
					<div class="w-40 shrink-0">
						<div class="text-sm font-bold text-tan">
							{formatScheduledInZone(np.part.scheduled_at, zone)}
						</div>
						<div class="text-xs text-muted">
							{formatRelativeToNow(np.part.scheduled_at)}
							{#if np.split}· Part {np.partNumber}{/if}
						</div>
					</div>

					<!-- Match + players + map -->
					<div class="min-w-0 flex-1">
						<div class="truncate text-sm text-bright">
							<span class="font-mono text-muted"
								>{m.match_number != null
									? padMatchNumber(m.match_number)
									: "?"}</span
							>
							· {vs(m)}
						</div>
						<div class="truncate text-xs text-muted">
							{bracketLabel(m)}
							{#if entry}
								· {#if mapInAtlas(entry)}
									<!-- eslint-disable svelte/no-navigation-without-resolve -->
									<a
										href={atlasMapUrl(entry)}
										target="_blank"
										rel="noopener noreferrer"
										class="hover:text-orange hover:underline"
										>{mapPoolLabel(entry, distinguishing, true)}</a
									>
									<!-- eslint-enable svelte/no-navigation-without-resolve -->
								{:else}{mapPoolLabel(entry, distinguishing, true)}{/if}
							{/if}
						</div>
					</div>

					<!-- Casters + actions -->
					<div class="flex shrink-0 items-center gap-2">
						{#if np.part.casters.length === 0}
							<span
								class="rounded bg-orange/15 px-2 py-0.5 text-[11px] font-bold uppercase text-orange"
								>needs a caster</span
							>
						{:else}
							<div class="flex items-center gap-1.5">
								<!-- Keyed by index: two free-text casters may share a name. -->
								{#each np.part.casters as c, i (i)}
									<span
										class="inline-flex items-center gap-1 text-xs text-tan"
										title={i === 0 ? "Streamer" : "Co-caster"}
									>
										<PlayerAvatar avatarUrl={c.avatar_url} size={16} />
										<span class="max-w-[8rem] truncate">{c.display_name}</span>
									</span>
								{/each}
							</div>
						{/if}

						{#if user}
							<div class="flex items-center gap-1.5">
								{#if !mine}
									<button
										type="button"
										class="rounded border border-input px-2 py-1 text-xs text-tan transition-colors hover:border-orange hover:text-orange disabled:opacity-50"
										disabled={busy}
										onclick={() => cast(m, np.part.id)}
									>
										I'll cast
									</button>
								{:else}
									{#if !iAmStreamer(m, np.part.id)}
										<button
											type="button"
											class="rounded border border-input px-2 py-1 text-xs text-tan transition-colors hover:border-orange hover:text-orange disabled:opacity-50"
											disabled={busy}
											onclick={() => cast(m, np.part.id, "streamer")}
										>
											Make me streamer
										</button>
									{/if}
									<button
										type="button"
										class="rounded border border-input px-2 py-1 text-xs text-tan/70 transition-colors hover:border-red-400 hover:text-red-400 disabled:opacity-50"
										disabled={busy}
										onclick={() => drop(m, np.part.id)}
									>
										Drop
									</button>
								{/if}
							</div>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</section>
