<script lang="ts">
	// The one match table, shared by every tournament match surface (the matches
	// page, the Cast view, the overview's Up Next panel). The caller builds +
	// filters + sorts the rows and picks which columns to show; this owns all the
	// cell markup, so a match row and a part row render identically. It reports
	// header clicks (when sortable) and row clicks (when clickable), and composes
	// the shared cast buttons (CastControls) in the trailing actions column for
	// any pending sitting.
	//
	// Columns are keyed off the shared registry (matches-table.ts).
	import type {
		TournamentDetail,
		TournamentMatch,
		TournamentMatchPartStream,
		UserMe,
	} from "$lib/api-cloud";
	import SpriteIcon from "$lib/game-detail/SpriteIcon.svelte";
	import PlayerAvatar from "$lib/tournament/PlayerAvatar.svelte";
	import CastControls from "$lib/tournament/CastControls.svelte";
	import { matchBracketLabel } from "$lib/tournament/bracket-label";
	import {
		matchSlotAvatarUrl,
		matchSlotDisplayName,
		matchSlotNation,
	} from "$lib/tournament/match-occupant";
	import {
		atlasMapUrl,
		distinguishingOptions,
		mapInAtlas,
		mapPoolLabel,
		poolEntryById,
	} from "$lib/tournament/map-script-options";
	import { padMatchNumber } from "$lib/tournament/match-numbers";
	import {
		matchStatusGroup,
		matchSortInstant,
		rowCasters,
		rowStreams,
		rowIsPendingSitting,
		type MatchColumn,
		type MatchRow,
	} from "$lib/tournament/matches-table";
	import type { ScheduleZone } from "$lib/tournament/schedule";
	import {
		formatEnum,
		formatRelativeToNow,
		formatScheduledInZone,
	} from "$lib/utils/formatting";

	let {
		columns,
		rows,
		zone,
		tournament,
		user,
		slotLabels,
		slotAvatars,
		sortColumn = null,
		sortDirection = "asc",
		onSort,
		onRowClick,
		isLive,
		stickyHeader = false,
		emptyMessage = "No matches",
	}: {
		columns: MatchColumn[];
		rows: MatchRow[];
		zone: ScheduleZone;
		tournament: TournamentDetail;
		// The signed-in viewer (null when anonymous), for the inline cast controls
		// in the Casters & Streams cell. Reads only; anonymous viewers still see the
		// "needs a caster" flag but no action buttons.
		user: UserMe | null;
		slotLabels: Record<string, string>;
		slotAvatars: Record<string, string | null>;
		// The active sort column/direction, for the header arrow. Only meaningful
		// alongside onSort (a sortable surface).
		sortColumn?: string | null;
		sortDirection?: "asc" | "desc";
		// When set, headers are clickable and call this with the column key.
		// eslint-disable-next-line no-unused-vars -- documentary param name
		onSort?: (key: string) => void;
		// When set, rows are clickable and call this (typically to open the match
		// card). The cast controls stopPropagation so they don't also fire it.
		// eslint-disable-next-line no-unused-vars -- documentary param names
		onRowClick?: (match: TournamentMatch, e: MouseEvent) => void;
		// Opt-in per-row "live now" flag (the Live & Upcoming panel passes it). When
		// it returns true the time cell shows a LIVE badge. Undefined for surfaces
		// that don't distinguish live sittings, so they render unchanged.
		// eslint-disable-next-line no-unused-vars -- documentary param name
		isLive?: (row: MatchRow) => boolean;
		// Sticky header for the full-page table (it scrolls inside its own pane);
		// off for the compact panel/cast mounts.
		stickyHeader?: boolean;
		emptyMessage?: string;
	} = $props();

	const distinguishing = $derived(distinguishingOptions(tournament.map_pool));

	// Part rows key by match+part (part ids are only unique within a match — the
	// 0029 backfill mints "p1" per migrated match); match rows key by match id.
	function rowKey(row: MatchRow): string {
		return row.part
			? `${row.match.match_id}:${row.part.id}`
			: row.match.match_id;
	}

	// The table sits in a framed box (rounded border on the wrapper below); rows
	// are a contiguous zebra — no per-cell rounding or gaps. The header is a
	// raised bar (surface-raised-hover), deliberately *lighter* than both zebra
	// tones (surface / surface-raised) so it reads as chrome and never blends into
	// a stripe: the page itself is the ramp's darkest tone (blue-gray), so a dark
	// recessed header would hug it. The row <tr> carries the stripe + hover
	// background; the cells stay transparent so it shows through.
	function thClass(sortable: boolean): string {
		const sticky = stickyHeader ? "sticky -top-4 z-10 " : "";
		const s = sortable
			? "cursor-pointer transition-colors hover:text-orange "
			: "";
		return `${sticky}${s}select-none whitespace-nowrap border-b border-black bg-surface-raised-hover px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-gray-100 shadow-lg`;
	}

	// align-top so the multi-line Match/Time/Casters cells don't vertically center
	// the shorter cells beside them.
	const tdClass = "whitespace-nowrap px-3 py-2 text-left align-top text-tan";
</script>

<!-- One player's cell: crest + avatar + name. Side B collapses to "Bye" when
     there's no opponent slot; an unresolved side-A feeder reads "TBD". -->
{#snippet playerCell(m: TournamentMatch, side: "a" | "b")}
	{@const slotId = side === "a" ? m.slot_a_id : m.slot_b_id}
	{#if slotId === null}
		<span class="opacity-60">{side === "b" ? "Bye" : "TBD"}</span>
	{:else}
		{@const nation = matchSlotNation(m, side)}
		{@const name = matchSlotDisplayName(m, side, slotLabels) ?? "—"}
		<span class="inline-flex min-w-0 items-center gap-1.5">
			{#if nation}
				<SpriteIcon
					category="crests"
					value={nation}
					size={16}
					alt={formatEnum(nation, "NATION_")}
				/>
			{/if}
			<PlayerAvatar
				avatarUrl={matchSlotAvatarUrl(m, side, slotAvatars)}
				size={16}
			/>
			<span class="truncate">{name}</span>
		</span>
	{/if}
{/snippet}

<!-- One stream/recording link: external-link icon + the stream's label (or a
     generic "Stream" when untagged). Repeated per stream so a match's multiple
     POVs/VODs each keep their own label. -->
{#snippet streamLink(s: TournamentMatchPartStream)}
	<!-- External stream URL (youtube/twitch), validated host-side; not an app
	     route, so resolve() doesn't apply. Stop propagation so the link doesn't
	     also open the match card. -->
	<!-- eslint-disable svelte/no-navigation-without-resolve -->
	<a
		href={s.url}
		target="_blank"
		rel="noopener noreferrer"
		class="inline-flex items-center gap-1 text-tan hover:underline"
		onclick={(e) => e.stopPropagation()}
	>
		<svg
			xmlns="http://www.w3.org/2000/svg"
			class="h-3 w-3"
			fill="none"
			viewBox="0 0 24 24"
			stroke="currentColor"
			stroke-width="2"
			aria-hidden="true"
		>
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
			/>
		</svg>
		{s.label?.trim() || "Stream"}
	</a>
	<!-- eslint-enable svelte/no-navigation-without-resolve -->
{/snippet}

<div class="overflow-x-auto rounded-lg border border-black">
	<table class="w-full border-collapse">
		<thead>
			<tr>
				{#each columns as column (column.key)}
					{@const sortable = !!onSort && column.label !== ""}
					<th
						class={thClass(sortable)}
						onclick={sortable ? () => onSort?.(column.key) : undefined}
					>
						<span class="inline-flex items-center gap-1">
							{column.label}
							{#if sortable && sortColumn === column.key}
								<span class="text-orange">
									{sortDirection === "asc" ? "↑" : "↓"}
								</span>
							{/if}
						</span>
					</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#each rows as row (rowKey(row))}
				{@const m = row.match}
				<tr
					class="{onRowClick
						? 'cursor-pointer '
						: ''}transition-colors odd:bg-surface even:bg-surface-raised hover:bg-surface-hover"
					onclick={onRowClick ? (e) => onRowClick(m, e) : undefined}
				>
					{#each columns as column (column.key)}
						<td class={tdClass}>
							{#if column.key === "matchup"}
								{@const bracketLabel = matchBracketLabel(tournament, m)}
								{@const entry = poolEntryById(
									tournament.map_pool,
									m.map_pool_id,
								)}
								<div class="flex flex-col gap-0.5">
									<span class="inline-flex items-center gap-2">
										{#if m.match_number != null}
											<span class="shrink-0 font-mono opacity-60">
												{padMatchNumber(m.match_number)}
											</span>
										{/if}
										{@render playerCell(m, "a")}
										<span class="shrink-0 opacity-60">v</span>
										{@render playerCell(m, "b")}
									</span>
									<!-- Bracket + map as subtext under the matchup, so a row reads the
									     same on every surface (the Cast tab's old two-line layout, now
									     shared by all match tables). -->
									{#if bracketLabel || entry}
										<span class="text-xs opacity-60">
											{bracketLabel}
											{#if entry}
												{#if bracketLabel}·{/if}
												{#if mapInAtlas(entry)}
													<!-- External atlas image, not an app route. Stop
													     propagation so it doesn't also open the match card. -->
													<!-- eslint-disable svelte/no-navigation-without-resolve -->
													<a
														href={atlasMapUrl(entry)}
														target="_blank"
														rel="noopener noreferrer"
														class="hover:text-orange hover:underline"
														onclick={(e) => e.stopPropagation()}
													>
														{mapPoolLabel(entry, distinguishing, true)}
													</a>
													<!-- eslint-enable svelte/no-navigation-without-resolve -->
												{:else}
													{mapPoolLabel(entry, distinguishing, true)}
												{/if}
											{/if}
										</span>
									{/if}
								</div>
							{:else if column.key === "time"}
								{#if row.part}
									{@const live = isLive?.(row) ?? false}
									<div class="flex items-center gap-2">
										<span
											>{formatScheduledInZone(
												row.part.scheduled_at,
												zone,
											)}</span
										>
										{#if live}
											<span
												class="inline-flex items-center gap-1 rounded bg-orange/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-orange"
											>
												<span class="h-1.5 w-1.5 rounded-full bg-orange"></span>
												Live
											</span>
										{/if}
									</div>
									<div class="text-xs opacity-60">
										{formatRelativeToNow(row.part.scheduled_at)}{#if row.split}
											· Pt {row.partNumber}{/if}
									</div>
								{:else}
									{@const g = matchStatusGroup(m)}
									{@const instant = matchSortInstant(m)}
									{@const t = formatScheduledInZone(instant, zone)}
									{#if instant}
										{@const rel = formatRelativeToNow(instant)}
										<!-- A real instant (scheduled or overdue): show it with the same
										     relative subtext the part rows carry. An overdue (in-progress)
										     match keeps its last-started time visible; the relative subtext
										     ("2h ago") is what conveys how overdue it is. -->
										<div>{t}</div>
										{#if rel}<div class="text-xs opacity-60">{rel}</div>{/if}
									{:else if g === "completed"}
										<!-- Completed matches get a badge mirroring the Live one (same
										     pill shape + alpha fill, success color instead of orange). -->
										<span
											class="inline-flex items-center gap-1 rounded bg-success/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-success"
										>
											<span class="h-1.5 w-1.5 rounded-full bg-success"></span>
											Completed
										</span>
									{:else}
										Not scheduled
									{/if}
								{/if}
							{:else if column.key === "broadcast"}
								{@const casters = rowCasters(row)}
								{@const streams = rowStreams(row)}
								{@const pendingSitting = rowIsPendingSitting(row)}
								<!-- Main line: the first stream + "by {streamer} with
								     {co-casters}". Further streams (a match's extra POVs/VODs —
								     often labeled "part 2", "part 3") stack as subtext beneath. Each
								     piece is optional — a caster-only row is just the name(s) (no
								     "by"); a casterless pending sitting shows the "needs a caster"
								     flag; the cast buttons live in the trailing actions column. -->
								<div class="flex flex-col items-start gap-0.5">
									{#if streams.length > 0 || casters.length > 0}
										<div class="flex items-center gap-x-1.5">
											<!-- First stream, a little smaller than the caster name. -->
											{#if streams.length > 0}
												<span class="text-xs">
													{@render streamLink(streams[0])}
												</span>
											{/if}
											<!-- Streamer (index 0), then any co-casters introduced by a
											     muted "with"; the whole group prefixed with a small "by"
											     when a stream precedes. -->
											{#if casters.length > 0}
												{#if streams.length > 0}
													<span class="text-[10px] opacity-50">by</span>
												{/if}
												<span class="inline-flex items-center gap-1.5">
													<span class="inline-flex items-center gap-1">
														<PlayerAvatar
															avatarUrl={casters[0].avatar_url}
															size={16}
														/>
														{casters[0].display_name ?? casters[0].name}
													</span>
													{#if casters.length > 1}
														<span class="text-[10px] opacity-50">with</span>
														{#each casters.slice(1) as c, i (i)}
															{#if i > 0}<span class="opacity-40">,</span>{/if}
															<span
																class="inline-flex items-center gap-1 opacity-70"
															>
																<PlayerAvatar
																	avatarUrl={c.avatar_url}
																	size={16}
																/>
																{c.display_name ?? c.name}
															</span>
														{/each}
													{/if}
												</span>
											{/if}
										</div>
									{/if}
									<!-- Streams 2..N as muted subtext lines, one per line. -->
									{#each streams.slice(1) as s, i (i)}
										<span class="text-xs opacity-70"
											>{@render streamLink(s)}</span
										>
									{/each}
									<!-- Casterless pending sitting: the recruiting flag (the buttons
									     that act on it are in the actions column). -->
									{#if pendingSitting && casters.length === 0}
										<span
											class="rounded bg-orange/15 px-2 py-0.5 text-[11px] font-bold uppercase text-orange"
											>needs a caster</span
										>
									{/if}
									<!-- Nothing to show: no caster, no stream, and not a castable
									     sitting (e.g. a completed match with no VOD). -->
									{#if casters.length === 0 && streams.length === 0 && !pendingSitting}
										<span>—</span>
									{/if}
								</div>
							{:else if column.key === "actions"}
								<!-- Trailing header-less column: the inline cast buttons,
								     right-aligned (CastControls justifies to the end) so they line
								     up across rows. -->
								{#if rowIsPendingSitting(row)}
									<CastControls {row} {tournament} {user} />
								{/if}
							{/if}
						</td>
					{/each}
				</tr>
			{:else}
				<tr>
					<td colspan={columns.length} class="p-8 text-center italic text-tan">
						{emptyMessage}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
