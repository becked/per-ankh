<script lang="ts">
	// The one match table, shared by every tournament match surface (the matches
	// page, the Cast view, the overview's Up Next panel). It is purely
	// presentational: the caller builds + filters + sorts the rows and picks which
	// columns to show; this renders them, reports header clicks (when sortable) and
	// row clicks (when clickable), and hosts an optional per-row actions slot.
	//
	// Columns are keyed off the shared registry (matches-table.ts) — this file
	// owns the cell markup, so a match row and a part row render identically.
	import type { Snippet } from "svelte";
	import type { TournamentDetail, TournamentMatch } from "$lib/api-cloud";
	import SpriteIcon from "$lib/game-detail/SpriteIcon.svelte";
	import PlayerAvatar from "$lib/tournament/PlayerAvatar.svelte";
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
		rowCaster,
		rowStream,
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
		slotLabels,
		slotAvatars,
		sortColumn = null,
		sortDirection = "asc",
		onSort,
		onRowClick,
		actions,
		stickyHeader = false,
		emptyMessage = "No matches",
	}: {
		columns: MatchColumn[];
		rows: MatchRow[];
		zone: ScheduleZone;
		tournament: TournamentDetail;
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
		// card). Action-column controls stopPropagation so they don't also fire it.
		// eslint-disable-next-line no-unused-vars -- documentary param names
		onRowClick?: (match: TournamentMatch, e: MouseEvent) => void;
		// Per-row trailing controls (the Cast view's cast/drop buttons), rendered in
		// the `actions` column.
		actions?: Snippet<[MatchRow]>;
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

	// Striped rows: no per-cell rounding or row gaps — a contiguous zebra table.
	// The row <tr> carries the stripe + hover background; the cells stay
	// transparent so it shows through.
	function thClass(): string {
		const sticky = stickyHeader ? "sticky -top-4 z-10 " : "";
		const sortable = onSort
			? "cursor-pointer transition-colors hover:text-orange "
			: "";
		return `${sticky}${sortable}select-none whitespace-nowrap border-b border-surface bg-surface-sunken px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-gray-100 shadow-lg`;
	}

	const tdClass = "whitespace-nowrap px-3 py-2 text-left text-tan";
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

<div class="overflow-x-auto">
	<table class="w-full border-collapse">
		<thead>
			<tr>
				{#each columns as column (column.key)}
					<th
						class={thClass()}
						onclick={onSort ? () => onSort(column.key) : undefined}
					>
						<span class="inline-flex items-center gap-1">
							{column.label}
							{#if onSort && sortColumn === column.key}
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
							{#if column.key === "number"}
								<span class="font-mono opacity-70">
									{m.match_number != null
										? padMatchNumber(m.match_number)
										: "—"}
								</span>
							{:else if column.key === "matchup"}
								<span class="inline-flex items-center gap-2">
									{@render playerCell(m, "a")}
									<span class="opacity-60">v</span>
									{@render playerCell(m, "b")}
								</span>
							{:else if column.key === "time"}
								{#if row.part}
									<div>
										{formatScheduledInZone(row.part.scheduled_at, zone)}
									</div>
									<div class="text-xs opacity-60">
										{formatRelativeToNow(row.part.scheduled_at)}{#if row.split}
											· Pt {row.partNumber}{/if}
									</div>
								{:else}
									{@const g = matchStatusGroup(m)}
									{@const t = formatScheduledInZone(matchSortInstant(m), zone)}
									{#if g === "in_progress"}
										<!-- Overdue: time passed, result unreported. Keep the
										     last-started sitting's time visible so an admin chasing
										     reports can see how overdue it is. -->
										{t || "In progress"}{#if t}<span class="opacity-60">
												· in progress</span
											>{/if}
									{:else if t}
										{t}
									{:else if g === "completed"}
										Completed
									{:else}
										Not scheduled
									{/if}
								{/if}
							{:else if column.key === "bracket"}
								{matchBracketLabel(tournament, m) || "—"}
							{:else if column.key === "map"}
								{@const entry = poolEntryById(
									tournament.map_pool,
									m.map_pool_id,
								)}
								{#if entry}
									{#if mapInAtlas(entry)}
										<!-- External atlas image, not an app route. Stop propagation
										     so the link doesn't also open the match card. -->
										<!-- eslint-disable svelte/no-navigation-without-resolve -->
										<a
											href={atlasMapUrl(entry)}
											target="_blank"
											rel="noopener noreferrer"
											class="text-tan hover:text-orange hover:underline"
											onclick={(e) => e.stopPropagation()}
										>
											{mapPoolLabel(entry, distinguishing, true)}
										</a>
										<!-- eslint-enable svelte/no-navigation-without-resolve -->
									{:else}
										{mapPoolLabel(entry, distinguishing, true)}
									{/if}
								{:else}
									—
								{/if}
							{:else if column.key === "caster"}
								{@const c = rowCaster(row)}
								{#if c}
									<span class="inline-flex items-center gap-1.5">
										<PlayerAvatar avatarUrl={c.avatar_url} size={16} />
										{c.display_name ?? c.name}
									</span>
								{:else}
									—
								{/if}
							{:else if column.key === "stream"}
								{@const s = rowStream(row)}
								{#if s}
									<!-- External stream URL (youtube/twitch), validated host-side;
									     not an app route, so resolve() doesn't apply. Stop
									     propagation so the link doesn't also open the match card. -->
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
								{:else}
									—
								{/if}
							{:else if column.key === "actions"}
								{@render actions?.(row)}
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
