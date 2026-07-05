<script lang="ts">
	// Tournament matches page. Two views, switched by the segmented control the
	// bracket/standings cards use: a sortable, filterable matches table (styled
	// like the game-detail Cities tab) and a monthly Calendar. A UTC/Local toggle
	// picks the active clock (times render in one zone; the calendar buckets days
	// by it). Clicking any match opens the match card anchored at the click point.
	import { fade } from "svelte/transition";
	import { goto, invalidateAll } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import { autohideScroll } from "$lib/actions/autohideScroll";
	import Breadcrumb, { type Crumb } from "$lib/Breadcrumb.svelte";
	import {
		ApiError,
		cloudApi,
		type TournamentMatch,
		type UserMe,
	} from "$lib/api-cloud";
	import CollapsibleSearch from "$lib/CollapsibleSearch.svelte";
	import MatchPopover from "$lib/tournament/MatchPopover.svelte";
	import MatchTable from "$lib/tournament/MatchTable.svelte";
	import TournamentActions from "$lib/tournament/TournamentActions.svelte";
	import {
		matchSlotDisplayName,
		matchupLabel,
	} from "$lib/tournament/match-occupant";
	import {
		toMatchRows,
		pickColumns,
		sortMatchRows,
		matchRowMatchesSearch,
		toggleMatchSort,
		DEFAULT_MATCHES_TABLE_STATE,
		type MatchRow,
		type MatchSortContext,
		type MatchTableState,
	} from "$lib/tournament/matches-table";
	import {
		partitionSchedule,
		scheduledDayKey,
		liveAndUpcoming,
		type ScheduleZone,
	} from "$lib/tournament/schedule";
	import {
		resolveInitialZone,
		writeZoneCookie,
	} from "$lib/tournament/zone-preference";
	import {
		matchParts,
		matchDisplayStatus,
		upcomingScheduledParts,
		CAST_GRACE_MS,
		type NumberedPart,
	} from "$lib/tournament/parts";
	import { nowMs } from "$lib/stores/now.svelte";
	import { padMatchNumber } from "$lib/tournament/match-numbers";
	import CastView from "$lib/tournament/CastView.svelte";
	import CopyButton from "$lib/tournament/CopyButton.svelte";
	import { buildSlotMaps } from "$lib/tournament/slot-identity";
	import Popover from "$lib/ui/Popover.svelte";
	import { toast } from "$lib/ui/toast";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	const user = $derived(page.data.user as UserMe | null);
	const isAdmin = $derived(data.tournament.is_viewer_admin === true);

	const crumbs: Crumb[] = $derived([
		{ label: "Home", href: resolve("/") },
		{ label: "Tournaments", href: resolve("/tournaments") },
		{
			label: data.tournament.name,
			href: resolve("/tournaments/[slug]", { slug: data.tournament.slug }),
		},
		{ label: "Matches" },
	]);

	// Open the shared guide, carrying this tournament as origin (mirrors the
	// overview page) so the guide breadcrumb can link back here.
	function openGuide() {
		const dest = `${resolve("/tournaments/guide")}?from=${data.tournament.slug}&name=${encodeURIComponent(data.tournament.name)}`;
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- query string appended to a resolved path
		goto(dest);
	}

	const slotMaps = $derived(buildSlotMaps(data.standings, data.bracket));
	const partition = $derived(partitionSchedule(data.matches));

	// Admin "sesh.fyi"-style copy of upcoming (scheduled, still-pending) matches,
	// soonest first, with Discord timestamps — paste into a Discord scheduling
	// post. `<t:UNIX:F>` renders the full local date; `<t:UNIX:R>` the relative
	// "in X hours/days". A split match contributes one line per scheduled part,
	// tagged "(Part N)"; single-session matches read as just "Match NNN".
	function seshText(scope: "all" | "needs-casters" = "all"): string {
		const num = (m: TournamentMatch) =>
			m.match_number != null ? padMatchNumber(m.match_number) : "?";
		// Each side prefers a real Discord `<@id>` mention (pings the player) when
		// the slot is a claimed account whose id we have (admin-only field), and
		// falls back to the display name for unclaimed slots.
		const vs = (m: TournamentMatch) =>
			matchupLabel(m, (side) => {
				const id = side === "a" ? m.slot_a_discord_id : m.slot_b_discord_id;
				return id
					? `<@${id}>`
					: (matchSlotDisplayName(m, side, slotMaps.labels) ?? "?");
			});

		// The "all" (sesh) scope lists only parts still ahead — a forward-looking
		// schedule post shouldn't name a sitting whose time has passed, so no
		// grace. The needs-casters scope (the Cast tab's copy) instead mirrors the
		// tab exactly: same "no caster signed up" rule AND the same CAST_GRACE_MS
		// window, so a just-started casterless sitting the tab still flags as
		// needing a caster also shows up in the copied recruit list.
		const scheduled = upcomingScheduledParts(
			data.matches,
			scope === "needs-casters" ? CAST_GRACE_MS : 0,
		)
			.filter(({ part }) => scope === "all" || part.casters.length === 0)
			.map(({ match, part, partNumber, split }) => {
				const unix = Math.floor(Date.parse(part.scheduled_at as string) / 1000);
				const partTag = split ? `(Part ${partNumber}) ` : "";
				return `Match ${num(match)} ${partTag}- ${vs(match)} - <t:${unix}:F> (<t:${unix}:R>)`;
			});
		if (scope === "needs-casters") {
			return (
				"Matches needing casters\n\n" +
				(scheduled.length ? scheduled.join("\n") : "(none — all covered)")
			);
		}
		// "To be scheduled" = matches still owing a time: never scheduled at all,
		// or carrying a part without one yet (a split match heading into "Part 2,
		// time TBD" — see #91). A match that has fully started (in progress,
		// awaiting result, no open part) doesn't belong here. The part tag mirrors
		// the "Upcoming" lines: shown only when the match is actually split.
		const unscheduled = data.matches
			.filter((m) => m.status === "pending" && m.slot_b_id != null)
			.sort((a, b) => (a.match_number ?? 0) - (b.match_number ?? 0))
			.flatMap((m) => {
				const parts = matchParts(m);
				if (parts.length === 0) {
					return matchDisplayStatus(m) === "unscheduled"
						? [`Match ${num(m)} - ${vs(m)}`]
						: [];
				}
				const split = parts.length >= 2;
				return parts
					.map((part, i) => ({ part, partNumber: i + 1 }))
					.filter(({ part }) => part.scheduled_at == null)
					.map(({ partNumber }) => {
						const partTag = split ? `(Part ${partNumber}) ` : "";
						return `Match ${num(m)} ${partTag}- ${vs(m)}`;
					});
			});

		const blocks = [
			"Upcoming matches\n\n" +
				(scheduled.length ? scheduled.join("\n") : "(none scheduled)"),
		];
		if (unscheduled.length) {
			blocks.push("To be scheduled\n\n" + unscheduled.join("\n"));
		}
		return blocks.join("\n\n");
	}

	// View + zone controls. zone picks the single clock everything reads in.
	// View and zone are deep-linkable via query params (?view=cast, ?zone=local)
	// so a link can point straight at a given tab/clock. Defaults stay out of the
	// URL; state changes replace (not push) history.
	//
	// The initial zone follows the shared precedence (?zone= param > saved cookie
	// > UTC); the toggle handlers persist explicit choices to the cookie so the
	// clock is sticky app-wide. A shared ?zone= link overrides for the visit but
	// doesn't touch their saved default.
	const params = new URLSearchParams(page.url.search);
	const VIEWS = ["live", "calendar", "cast", "all"] as const;
	type MatchesView = (typeof VIEWS)[number];
	const initialView = VIEWS.find((v) => v === params.get("view")) ?? "live";
	let view = $state<MatchesView>(initialView);
	let zone = $state<ScheduleZone>(resolveInitialZone(params.get("zone")));

	// Flip + persist the clock. Cookie writes happen here (explicit user action),
	// not in the URL-sync effect, so arriving via a deep link never rewrites the
	// saved preference.
	function setZone(next: ScheduleZone) {
		zone = next;
		writeZoneCookie(next);
	}
	const viewTriggerClass =
		"relative z-10 cursor-pointer px-3 py-1.5 text-center text-xs font-bold text-tan transition-colors";

	// --- Free-text search, shared across the three table views (live/all/cast)
	// via the collapsible control in the page header. Persists as you switch tabs,
	// so it always filters whichever match table is open.
	let searchTerm = $state("");

	// --- Sort state for the All tab, following the Cities pattern. Status/bracket
	// faceting was retired in favour of the view tabs; richer filters return in a
	// later pass. (Search lives in `searchTerm` above, not here — it's cross-view.)
	let tableState = $state<MatchTableState>({ ...DEFAULT_MATCHES_TABLE_STATE });

	// Reflect the current view/zone into the URL (defaults omitted) so the
	// address bar is always a shareable deep link to the tab/clock on screen.
	$effect(() => {
		// Build the query from plain string parts rather than a mutable
		// URLSearchParams — svelte/prefer-svelte-reactivity flags the built-in
		// class inside an effect. Every value is a closed enum of URL-safe
		// characters, so no encoding is needed.
		const parts: string[] = [];
		if (view !== "live") parts.push(`view=${view}`);
		if (zone !== "utc") parts.push(`zone=${zone}`);
		const search = parts.join("&");
		const target = `${page.url.pathname}${search ? `?${search}` : ""}`;
		if (`${page.url.pathname}${page.url.search}` !== target) {
			// Same-page sync via goto — the app's navigation primitive (see the URL
			// writers in the stats/games tables): replaceState so toggles don't stack
			// history, keepFocus/noScroll so they don't jump the page or drop focus.
			// The [slug] layout load reads only route params, never the query string,
			// so this updates the address bar without refetching. resolve() brands
			// typed routes and can't express a dynamic query string, matching the
			// precedent in upload/+page.svelte.
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- dynamic query string; resolve()'s branded types don't admit it
			void goto(target, {
				replaceState: true,
				keepFocus: true,
				noScroll: true,
			});
		}
	});

	// --- Live & Upcoming tab: live sittings (badged) + upcoming, from the shared
	// definition the overview panel uses. Part-row granularity, soonest-first —
	// a schedule, not a sortable table. Reactive via nowMs().
	const liveUpcoming = $derived(liveAndUpcoming(data.matches, nowMs()));
	const liveUpcomingRows = $derived<MatchRow[]>([
		...liveUpcoming.live,
		...liveUpcoming.upcoming,
	]);
	// The header search filters this view too; the filtered list keeps the same
	// row objects, so the reference-identity LIVE badge below still matches.
	const filteredLiveUpcomingRows = $derived(
		searchTerm
			? liveUpcomingRows.filter((r) =>
					matchRowMatchesSearch(r, searchTerm, slotMaps.labels),
				)
			: liveUpcomingRows,
	);
	// Reference-identity set for the LIVE badge (rows reuse the same objects).
	const liveSet = $derived(new Set<MatchRow>(liveUpcoming.live));

	// --- All tab: every non-bye match (one row each), search-filtered and sorted
	// through the shared matches-table helpers so the comparator + search rule
	// stay one definition across every match surface. tableEligibleRows is the
	// unfiltered census (the count denominator).
	const tableEligibleRows = $derived(toMatchRows(data.matches));
	const sortCtx = $derived<MatchSortContext>({
		slotLabels: slotMaps.labels,
	});
	const allRows = $derived.by(() => {
		let list = tableEligibleRows;
		if (searchTerm) {
			list = list.filter((r) =>
				matchRowMatchesSearch(r, searchTerm, slotMaps.labels),
			);
		}
		return sortMatchRows(
			list,
			tableState.sortColumn,
			tableState.sortDirection,
			sortCtx,
		);
	});

	// The columns the matches page shows, in order (shared by both list tabs).
	const matchColumns = pickColumns(["time", "matchup", "broadcast", "actions"]);

	// --- Match card. Anchored at the click point via a floating-ui virtual
	// anchor so it opens beside the cursor. detailMatch resolves live from the
	// match list so an edit reflects at once.
	let detailMatchId = $state<string | null>(null);
	let detailAnchor = $state<{ getBoundingClientRect: () => DOMRect } | null>(
		null,
	);
	const detailMatch = $derived(
		detailMatchId
			? (data.matches.find((m) => m.match_id === detailMatchId) ?? null)
			: null,
	);

	function pick(matchId: string, e: MouseEvent) {
		const x = e.clientX;
		const y = e.clientY;
		detailAnchor = { getBoundingClientRect: () => new DOMRect(x, y, 0, 0) };
		detailMatchId = matchId;
	}

	// Admin substitute, threaded into the match card (parity with the overview
	// page's handler). Renames the slot's occupant and refreshes via invalidate.
	async function substituteSlot(
		slotId: string,
		// undefined when the occupant handle was left unchanged — omitted from
		// the patch so the worker leaves the occupant link intact.
		newUsername: string | undefined,
		userId: string | null = null,
	) {
		if (newUsername !== undefined && !newUsername.trim()) return;
		try {
			await cloudApi.patchSlot(data.tournament.tournament_id, slotId, {
				...(newUsername !== undefined
					? { discord_username: newUsername.trim() }
					: {}),
				...(userId ? { user_id: userId } : {}),
			});
			toast.info(
				newUsername !== undefined
					? `Substituted slot to ${newUsername}`
					: "Updated slot",
			);
			await invalidateAll();
		} catch (err) {
			toast.error(err instanceof ApiError ? err.message : "Action failed");
		}
	}

	// --- Calendar. The grid is plain calendar dates; only which day cell an
	// event lands in depends on the zone (via scheduledDayKey). The month is a
	// zone-independent label. UTC-based Date math avoids local-offset surprises.
	const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
	const pad = (n: number) => String(n).padStart(2, "0");

	// Seed the calendar on the current month. (It used to open on the earliest
	// scheduled match's month, but a single stray/mis-dated match — e.g. one set
	// to the wrong year — could park the calendar on an empty month far from the
	// real schedule, hiding every other match behind the month pager.)
	function initialMonth(): { year: number; month: number } {
		const now = new Date();
		return { year: now.getFullYear(), month: now.getMonth() };
	}
	let monthCursor = $state(initialMonth());

	function stepMonth(delta: number) {
		const d = new Date(
			Date.UTC(monthCursor.year, monthCursor.month + delta, 1),
		);
		monthCursor = { year: d.getUTCFullYear(), month: d.getUTCMonth() };
	}

	const monthLabel = $derived(
		new Date(
			Date.UTC(monthCursor.year, monthCursor.month, 1),
		).toLocaleDateString("en-US", {
			month: "long",
			year: "numeric",
			timeZone: "UTC",
		}),
	);

	const eventsByDay = $derived.by(() => {
		const byDay: Record<string, NumberedPart[]> = {};
		for (const np of partition.scheduled) {
			const key = scheduledDayKey(np.part.scheduled_at, zone);
			if (!key) continue;
			(byDay[key] ??= []).push(np);
		}
		return byDay;
	});

	const calendarCells = $derived.by(() => {
		const { year, month } = monthCursor;
		const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
		const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
		const cells: ({ day: number; key: string } | null)[] = [];
		for (let i = 0; i < firstWeekday; i++) cells.push(null);
		for (let d = 1; d <= daysInMonth; d++) {
			cells.push({ day: d, key: `${year}-${pad(month + 1)}-${pad(d)}` });
		}
		while (cells.length % 7 !== 0) cells.push(null);
		return cells;
	});

	// Compact time ("HH:MM" in the active zone) and matchup for calendar chips.
	function chipTime(iso: string | null): string {
		if (!iso) return "";
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return "";
		return d.toLocaleTimeString("en-CA", {
			timeZone: zone === "utc" ? "UTC" : undefined,
			hour: "2-digit",
			minute: "2-digit",
			hour12: false,
		});
	}

	function shortMatchup(m: TournamentMatch): string {
		return matchupLabel(
			m,
			(side) => matchSlotDisplayName(m, side, slotMaps.labels) ?? "—",
		);
	}
</script>

<div class="flex flex-1 overflow-hidden">
	<main class="isolate flex flex-1 flex-col overflow-hidden">
		<div
			class="cloud-scroll flex-1 overflow-y-auto px-4 pb-8 pt-4"
			use:autohideScroll
		>
			<div class="mx-auto max-w-screen-2xl">
				<!-- Trail on the left, the shared action cluster (Links · Settings ·
				     clock toggle) top-right, matching the overview header. -->
				<div class="mb-4 flex items-center justify-between gap-3">
					<Breadcrumb {crumbs} class="min-w-0" />
					<TournamentActions
						tournament={data.tournament}
						onGuide={openGuide}
						settingsDisabled={detailMatchId !== null}
						{zone}
						onZoneChange={setZone}
					/>
				</div>

				<!-- Controls card: title + copy tools (left), the Upcoming/Casts/All view
					     toggle (center), Calendar (right). The UTC/Local clock now lives in
					     the top-right action cluster with Links/Settings. -->
				<div
					class="mb-4 grid grid-cols-3 items-center gap-3 rounded-lg px-3 py-2"
					style="background-color: rgb(var(--color-surface-raised));"
				>
					<div class="flex items-center gap-2 justify-self-start">
						<h1 class="text-lg font-bold text-tan">Matches</h1>
						{#if isAdmin}
							<CopyButton
								text={seshText}
								label="Copy upcoming (sesh)"
								title="Copy upcoming scheduled matches (soonest first) with Discord timestamps, for a sesh.fyi / Discord post"
								class="inline-flex items-center justify-center rounded border border-surface p-1 text-tan transition-colors hover:bg-surface-hover hover:text-orange"
							>
								{#snippet children(copied)}
									{#if copied}
										<svg
											xmlns="http://www.w3.org/2000/svg"
											class="h-4 w-4"
											fill="none"
											viewBox="0 0 24 24"
											stroke="currentColor"
											stroke-width="2"
											aria-hidden="true"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												d="M5 13l4 4L19 7"
											/>
										</svg>
									{:else}
										<svg
											xmlns="http://www.w3.org/2000/svg"
											class="h-4 w-4"
											fill="none"
											viewBox="0 0 24 24"
											stroke="currentColor"
											stroke-width="2"
											aria-hidden="true"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
											/>
										</svg>
									{/if}
								{/snippet}
							</CopyButton>
						{/if}
						{#if isAdmin && view === "cast"}
							<CopyButton
								text={() => seshText("needs-casters")}
								label="Copy matches needing casters"
								title="Copy upcoming matches that still need a caster (soonest first) with Discord timestamps"
								class="inline-flex items-center justify-center rounded border border-surface p-1 text-tan transition-colors hover:bg-surface-hover hover:text-orange"
							>
								{#snippet children(copied)}
									{#if copied}
										<svg
											xmlns="http://www.w3.org/2000/svg"
											class="h-4 w-4"
											fill="none"
											viewBox="0 0 24 24"
											stroke="currentColor"
											stroke-width="2"
											aria-hidden="true"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												d="M5 13l4 4L19 7"
											/>
										</svg>
									{:else}
										<svg
											xmlns="http://www.w3.org/2000/svg"
											class="h-4 w-4"
											fill="none"
											viewBox="0 0 24 24"
											stroke="currentColor"
											stroke-width="2"
											aria-hidden="true"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
											/>
										</svg>
									{/if}
								{/snippet}
							</CopyButton>
						{/if}
					</div>
					<!-- View toggle (Upcoming / Casts / All), centered. Plain segmented
					     control matching the clock toggle; Calendar is its own button on
					     the right, so when it's active none of these read as pressed. -->
					<div
						class="relative grid grid-cols-3 justify-self-center overflow-hidden rounded-lg border-2 border-surface"
						style="background-color: rgb(var(--color-surface));"
						role="group"
						aria-label="View"
					>
						<div
							class="pointer-events-none absolute inset-y-0 left-0 w-1/3 transition-transform duration-200 ease-out"
							style:background-color="rgb(var(--color-surface-raised))"
							style:opacity={view === "calendar" ? "0" : "1"}
							style:transform={view === "cast"
								? "translateX(100%)"
								: view === "all"
									? "translateX(200%)"
									: "translateX(0)"}
						></div>
						<button
							type="button"
							class={viewTriggerClass}
							aria-pressed={view === "live"}
							onclick={() => (view = "live")}
						>
							Upcoming
						</button>
						<button
							type="button"
							class={viewTriggerClass}
							aria-pressed={view === "cast"}
							onclick={() => (view = "cast")}
						>
							Casts
						</button>
						<button
							type="button"
							class={viewTriggerClass}
							aria-pressed={view === "all"}
							onclick={() => (view = "all")}
						>
							All
						</button>
					</div>

					<!-- Right cluster: search + Calendar toggle. (The UTC/Local clock moved
					     to the top-right action cluster.) -->
					<div class="flex items-center gap-2 justify-self-end">
						<!-- Header search: an icon that expands inline to filter whichever
						     match table is open (live/all/cast). Hidden in the calendar view,
						     which is not a table. Shares searchTerm across the tabs. -->
						{#if view !== "calendar"}
							<CollapsibleSearch
								bind:value={searchTerm}
								class="w-44"
								ariaLabel="Search matches"
							/>
						{/if}
						<!-- Calendar: its own single-cell toggle, pressed in the calendar view. -->
						<button
							type="button"
							class="{viewTriggerClass} inline-flex items-center justify-center gap-1.5 rounded-lg border-2 border-surface"
							style:background-color={view === "calendar"
								? "rgb(var(--color-surface-raised))"
								: "rgb(var(--color-surface))"}
							aria-pressed={view === "calendar"}
							onclick={() => (view = "calendar")}
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
									d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
								/>
							</svg>
							Calendar
						</button>
					</div>
				</div>

				<div class="view-stack">
					{#key view}
						<div
							class="view-pane"
							in:fade={{ duration: 200 }}
							out:fade={{ duration: 200 }}
						>
							{#if view === "live"}
								<!-- Live & Upcoming: live sittings (badged) followed by the
								     upcoming schedule, soonest-first. A schedule, not a sortable
								     table — no headers to sort, no filters. -->
								<MatchTable
									columns={matchColumns}
									rows={filteredLiveUpcomingRows}
									{zone}
									tournament={data.tournament}
									{user}
									slotLabels={slotMaps.labels}
									slotAvatars={slotMaps.avatars}
									isLive={(row) => liveSet.has(row)}
									onRowClick={(m, e) => pick(m.match_id, e)}
									stickyHeader
									emptyMessage="No live or upcoming matches."
								/>
							{:else if view === "all"}
								<!-- All matches, one row each — every status, unscheduled
								     included. Column sort here; search lives in the header cluster
								     (shared across views). The census reflects the active filter. -->
								<div class="mb-3 flex flex-wrap items-center gap-3">
									<span class="text-xs text-tan opacity-70"
										>{allRows.length} / {tableEligibleRows.length} matches</span
									>
								</div>

								<MatchTable
									columns={matchColumns}
									rows={allRows}
									{zone}
									tournament={data.tournament}
									{user}
									slotLabels={slotMaps.labels}
									slotAvatars={slotMaps.avatars}
									sortColumn={tableState.sortColumn}
									sortDirection={tableState.sortDirection}
									onSort={(key) => toggleMatchSort(tableState, key)}
									onRowClick={(m, e) => pick(m.match_id, e)}
									stickyHeader
								/>
							{:else if view === "cast"}
								<CastView
									matches={data.matches}
									tournament={data.tournament}
									{zone}
									{user}
									slotLabels={slotMaps.labels}
									slotAvatars={slotMaps.avatars}
									search={searchTerm}
									onOpenMatch={(m, e) => pick(m.match_id, e)}
								/>
							{:else}
								<!-- Monthly calendar. -->
								<section
									class="mb-6 rounded-lg p-4"
									style="background-color: rgb(var(--color-surface));"
								>
									<div class="mb-3 flex items-center justify-between gap-3">
										<button
											type="button"
											class="rounded border border-tan px-2.5 py-1 text-xs text-tan opacity-80 transition-opacity hover:opacity-100"
											onclick={() => stepMonth(-1)}
											aria-label="Previous month"
										>
											‹ Prev
										</button>
										<h2 class="text-sm font-bold text-tan">{monthLabel}</h2>
										<button
											type="button"
											class="rounded border border-tan px-2.5 py-1 text-xs text-tan opacity-80 transition-opacity hover:opacity-100"
											onclick={() => stepMonth(1)}
											aria-label="Next month"
										>
											Next ›
										</button>
									</div>

									<div class="grid grid-cols-7 gap-1">
										{#each WEEKDAYS as wd (wd)}
											<div
												class="px-1 py-1 text-center text-[11px] font-bold uppercase text-tan opacity-60"
											>
												{wd}
											</div>
										{/each}
										{#each calendarCells as cell, i (i)}
											{#if cell === null}
												<div
													class="min-h-[5rem] rounded-lg"
													style="background-color: rgb(var(--color-surface-sunken));"
												></div>
											{:else}
												{@const events = eventsByDay[cell.key] ?? []}
												<div
													class="flex min-h-[5rem] flex-col gap-1 rounded-lg p-1.5"
													style="background-color: rgb(var(--color-surface-raised));"
												>
													<span
														class="text-[11px] font-bold text-tan opacity-70"
													>
														{cell.day}
													</span>
													<!-- Key by match+part: part ids are only unique within a
													     match (the 0029 backfill mints "p1" per migrated match). -->
													{#each events as np (`${np.match.match_id}:${np.part.id}`)}
														<button
															type="button"
															class="flex flex-col rounded px-1.5 py-1 text-left text-[11px] text-tan transition-colors hover:bg-track"
															style="background-color: rgb(var(--color-surface));"
															onclick={(e) => pick(np.match.match_id, e)}
														>
															<span class="font-bold"
																>{chipTime(
																	np.part.scheduled_at,
																)}{#if np.split}<span
																		class="ml-1 font-normal opacity-60"
																		>· Pt {np.partNumber}</span
																	>{/if}</span
															>
															<span class="truncate opacity-80"
																>{shortMatchup(np.match)}</span
															>
														</button>
													{/each}
												</div>
											{/if}
										{/each}
									</div>
								</section>
							{/if}
						</div>
					{/key}
				</div>
			</div>
		</div>
	</main>
</div>

<!-- Match card, anchored at the click point and shared by both views. -->
<Popover
	open={detailMatchId !== null}
	onOpenChange={(o) => {
		if (!o) detailMatchId = null;
	}}
	customAnchor={detailAnchor}
	side="right"
	align="start"
	contentClass="w-[min(92vw,35.2rem)]"
	frameClass="bg-surface p-3 shadow-[0_24px_64px_-12px_rgb(var(--color-black)/0.85)]"
	ariaLabel="Match detail"
>
	{#if detailMatch}
		{#key detailMatch.match_id}
			<MatchPopover
				match={detailMatch}
				tournament={data.tournament}
				slotLabels={slotMaps.labels}
				slotUserIds={slotMaps.userIds}
				slotAvatars={slotMaps.avatars}
				{user}
				onSubstitute={isAdmin ? substituteSlot : undefined}
				onClose={() => (detailMatchId = null)}
			/>
		{/key}
	{/if}
</Popover>

<style>
	/* Crossfade the two views: both panes share the grid cell so the outgoing
	   and incoming overlap in place (no transform, nothing shifts). Mirrors the
	   overview page's bracket/standings switch. */
	.view-stack {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
	}

	.view-stack > :global(.view-pane) {
		grid-area: 1 / 1;
		min-width: 0;
	}
</style>
