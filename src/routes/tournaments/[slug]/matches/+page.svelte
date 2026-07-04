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
	import SpriteIcon from "$lib/game-detail/SpriteIcon.svelte";
	import TableFilterColumn from "$lib/game-detail/TableFilterColumn.svelte";
	import {
		type TableState,
		toggleSort,
		TABLE_FRAME_CLASS,
		TABLE_CLASS,
		TABLE_HEADER_TH_CLASS,
		TABLE_CELL_TD_CLASS,
	} from "$lib/game-detail/helpers";
	import MatchPopover from "$lib/tournament/MatchPopover.svelte";
	import PlayerAvatar from "$lib/tournament/PlayerAvatar.svelte";
	import {
		matchSlotAvatarUrl,
		matchSlotDisplayName,
		matchSlotNation,
		matchupLabel,
	} from "$lib/tournament/match-occupant";
	import {
		MATCH_COLUMNS,
		matchStatusGroup,
		matchSortInstant,
		DEFAULT_MATCHES_TABLE_STATE,
		type MatchSortContext,
		type MatchStatusGroup,
	} from "$lib/tournament/matches-table";
	import {
		partitionSchedule,
		scheduledDayKey,
		type ScheduleZone,
	} from "$lib/tournament/schedule";
	import {
		matchParts,
		matchDisplayStatus,
		upcomingScheduledParts,
		CAST_GRACE_MS,
		type NumberedPart,
	} from "$lib/tournament/parts";
	import { padMatchNumber } from "$lib/tournament/match-numbers";
	import CastView from "$lib/tournament/CastView.svelte";
	import CopyButton from "$lib/tournament/CopyButton.svelte";
	import { buildSlotMaps } from "$lib/tournament/slot-identity";
	import Popover from "$lib/ui/Popover.svelte";
	import { toast } from "$lib/ui/toast";
	import { formatEnum, formatScheduledInZone } from "$lib/utils/formatting";
	import { Select, Tabs, ToggleGroup } from "bits-ui";
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
		// "To be scheduled" = genuinely unscheduled matches only; a match that has
		// already started (in progress, awaiting result) doesn't belong here.
		const unscheduled = data.matches
			.filter(
				(m) =>
					m.status === "pending" &&
					m.slot_b_id != null &&
					matchDisplayStatus(m) === "unscheduled",
			)
			.sort((a, b) => (a.match_number ?? 0) - (b.match_number ?? 0))
			.map((m) => `Match ${num(m)} - ${vs(m)}`);

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
	// View, zone, and the two filters below are deep-linkable via query params
	// (?view=cast, ?caster=uncasted, ?status=scheduled, ?zone=local) so an admin
	// can point people straight at e.g. "scheduled matches that need a caster".
	// Defaults stay out of the URL; state changes replace (not push) history.
	const params = new URLSearchParams(page.url.search);
	const VIEWS = ["list", "calendar", "cast"] as const;
	type MatchesView = (typeof VIEWS)[number];
	const initialView = VIEWS.find((v) => v === params.get("view")) ?? "list";
	let view = $state<MatchesView>(initialView);
	let zone = $state<ScheduleZone>(
		params.get("zone") === "local" ? "local" : "utc",
	);
	function csvParam<T extends string>(
		name: string,
		all: readonly T[],
	): T[] | null {
		const raw = params.get(name);
		if (!raw) return null;
		const picked = raw
			.split(",")
			.filter((x): x is T => (all as readonly string[]).includes(x));
		return picked.length > 0 ? picked : null;
	}
	const viewTriggerClass =
		"relative z-10 cursor-pointer px-3 py-1.5 text-center text-xs font-bold text-tan transition-colors";

	// Stable bracket key for filtering ("championship" | "A" | "B").
	function bracketKey(m: TournamentMatch): string {
		return m.phase === "championship" ? "championship" : (m.division ?? "");
	}

	// --- Table state. tableState (search + sort) follows the Cities pattern;
	// statusFilter is a separate multi-toggle (completed off by default).
	let tableState = $state<TableState>({ ...DEFAULT_MATCHES_TABLE_STATE });
	let statusFilter = $state<MatchStatusGroup[]>(
		csvParam("status", [
			"scheduled",
			"in_progress",
			"unscheduled",
			"completed",
		] as const) ?? ["scheduled", "in_progress", "unscheduled"],
	);

	// Reflect the current view/zone/filters into the URL (defaults omitted) so
	// the address bar is always a shareable deep link to what's on screen.
	$effect(() => {
		// Build the query from plain string parts rather than a mutable
		// URLSearchParams — svelte/prefer-svelte-reactivity flags the built-in
		// class inside an effect. Every value is a closed enum of URL-safe
		// characters, so no encoding is needed.
		const parts: string[] = [];
		if (view !== "list") parts.push(`view=${view}`);
		if (zone !== "utc") parts.push(`zone=${zone}`);
		const defaultStatus = ["scheduled", "in_progress", "unscheduled"];
		if (
			statusFilter.length !== defaultStatus.length ||
			defaultStatus.some((g) => !statusFilter.includes(g as MatchStatusGroup))
		) {
			parts.push(`status=${statusFilter.join(",")}`);
		}
		const search = parts.join("&");
		const target = `${page.url.pathname}${search ? `?${search}` : ""}`;
		if (`${page.url.pathname}${page.url.search}` !== target) {
			// Same-page filter sync via goto — the app's navigation primitive (see
			// the URL writers in the stats/games tables): replaceState so filter
			// toggles don't stack history, keepFocus/noScroll so they don't jump the
			// page or drop focus. The [slug] layout load reads only route params,
			// never the query string, so this updates the address bar without
			// refetching. resolve() brands typed routes and can't express a dynamic
			// query string, matching the precedent in upload/+page.svelte.
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- dynamic filter query string; resolve()'s branded types don't admit it
			void goto(target, {
				replaceState: true,
				keepFocus: true,
				noScroll: true,
			});
		}
	});
	const statusItemClass =
		"cursor-pointer px-3 py-1.5 text-xs font-bold text-tan transition-colors data-[state=off]:opacity-50 data-[state=on]:bg-surface-raised";

	// Bracket filter: only offer brackets that actually have (non-bye) matches.
	const bracketOptions = $derived.by(() => {
		const present: Record<string, true> = {};
		for (const m of data.matches) {
			if (matchStatusGroup(m) === null) continue;
			present[bracketKey(m)] = true;
		}
		return [
			{ value: "championship", label: "Championship" },
			{ value: "A", label: data.tournament.division_a_name },
			{ value: "B", label: data.tournament.division_b_name },
		].filter((o) => present[o.value]);
	});
	// Bracket selections live in tableState.filters as "bracket:<key>" entries.
	const selectedBracketEntries = $derived(
		tableState.filters.filter((f) => f.startsWith("bracket:")),
	);
	const selectedBrackets = $derived(
		selectedBracketEntries.map((f) => f.slice("bracket:".length)),
	);
	const bracketChips = $derived(
		selectedBrackets.map(
			(v) => bracketOptions.find((o) => o.value === v)?.label ?? v,
		),
	);
	function setBracketFilter(entries: string[]) {
		const others = tableState.filters.filter((f) => !f.startsWith("bracket:"));
		tableState.filters = [...others, ...entries];
	}

	// Non-bye matches — the table's universe (denominator for the count).
	const tableEligible = $derived(
		data.matches.filter((m) => matchStatusGroup(m) !== null),
	);

	const sortCtx = $derived<MatchSortContext>({
		slotLabels: slotMaps.labels,
	});

	// Status toggle → bracket filter → search → sort, in one pass. Sort mirrors
	// the Cities comparator: nulls last, localeCompare for strings, numeric diff
	// otherwise, direction applied after.
	const rows = $derived.by(() => {
		let list = tableEligible.filter((m) =>
			statusFilter.includes(matchStatusGroup(m) as MatchStatusGroup),
		);

		if (selectedBrackets.length > 0) {
			list = list.filter((m) => selectedBrackets.includes(bracketKey(m)));
		}

		if (tableState.search) {
			const term = tableState.search.toLowerCase();
			const nationMatch = (n: string | null) =>
				n != null && formatEnum(n, "NATION_").toLowerCase().includes(term);
			list = list.filter(
				(m) =>
					(matchSlotDisplayName(m, "a", slotMaps.labels) ?? "")
						.toLowerCase()
						.includes(term) ||
					(matchSlotDisplayName(m, "b", slotMaps.labels) ?? "")
						.toLowerCase()
						.includes(term) ||
					nationMatch(matchSlotNation(m, "a")) ||
					nationMatch(matchSlotNation(m, "b")) ||
					matchParts(m).some((p) =>
						p.casters.some((c) =>
							(c.display_name ?? c.name ?? "").toLowerCase().includes(term),
						),
					),
			);
		}

		const column = MATCH_COLUMNS.find((c) => c.key === tableState.sortColumn);
		if (column) {
			list = [...list].sort((a, b) => {
				const aVal = column.sortValue(a, sortCtx);
				const bVal = column.sortValue(b, sortCtx);
				if (aVal == null && bVal == null) return 0;
				if (aVal == null) return 1;
				if (bVal == null) return -1;
				const cmp =
					typeof aVal === "string" && typeof bVal === "string"
						? aVal.localeCompare(bVal)
						: (aVal as number) - (bVal as number);
				return tableState.sortDirection === "asc" ? cmp : -cmp;
			});
		}
		return list;
	});

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

<!-- One player's table cell: crest + avatar + name. Side B renders "Bye" when
     there's no opponent slot. -->
{#snippet playerCell(m: TournamentMatch, side: "a" | "b")}
	{@const slotId = side === "a" ? m.slot_a_id : m.slot_b_id}
	{#if side === "b" && slotId === null}
		<span>Bye</span>
	{:else}
		{@const nation = matchSlotNation(m, side)}
		{@const name = matchSlotDisplayName(m, side, slotMaps.labels) ?? "—"}
		<span class="inline-flex items-center gap-1.5">
			{#if nation}
				<SpriteIcon
					category="crests"
					value={nation}
					size={16}
					alt={formatEnum(nation, "NATION_")}
				/>
			{/if}
			<PlayerAvatar
				avatarUrl={matchSlotAvatarUrl(m, side, slotMaps.avatars)}
				size={16}
			/>
			<span>{name}</span>
		</span>
	{/if}
{/snippet}

<div class="flex flex-1 overflow-hidden">
	<main class="isolate flex flex-1 flex-col overflow-hidden">
		<div
			class="cloud-scroll flex-1 overflow-y-auto px-4 pb-8 pt-4"
			use:autohideScroll
		>
			<div class="mx-auto max-w-screen-2xl">
				<Breadcrumb {crumbs} class="mb-4 min-w-0" />

				<!-- Controls card: title + sesh-copy on the left, zone + view toggles on the right. -->
				<div
					class="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg px-3 py-2"
					style="background-color: rgb(var(--color-surface-raised));"
				>
					<div class="flex items-center gap-2">
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
					<div class="flex items-center gap-2">
						<!-- UTC / Local: a segmented toggle picking the active clock. -->
						<div
							class="relative grid grid-cols-2 overflow-hidden rounded-lg border-2 border-surface"
							style="background-color: rgb(var(--color-surface));"
							role="group"
							aria-label="Timezone"
						>
							<div
								class="pointer-events-none absolute inset-y-0 left-0 w-1/2 transition-transform duration-200 ease-out"
								style:background-color="rgb(var(--color-surface-raised))"
								style:transform={zone === "local"
									? "translateX(100%)"
									: "translateX(0)"}
							></div>
							<button
								type="button"
								class={viewTriggerClass}
								aria-pressed={zone === "utc"}
								onclick={() => (zone = "utc")}
							>
								UTC
							</button>
							<button
								type="button"
								class={viewTriggerClass}
								aria-pressed={zone === "local"}
								onclick={() => (zone = "local")}
							>
								Local
							</button>
						</div>

						<!-- List / Calendar / Casts view switch (bracket-card pattern). -->
						<Tabs.Root bind:value={view}>
							<Tabs.List
								class="relative grid shrink-0 grid-cols-3 overflow-hidden rounded-lg border-2 border-surface"
								style="background-color: rgb(var(--color-surface));"
							>
								<div
									class="pointer-events-none absolute inset-y-0 left-0 w-1/3 transition-transform duration-200 ease-out"
									style:background-color="rgb(var(--color-surface-raised))"
									style:transform={view === "calendar"
										? "translateX(100%)"
										: view === "cast"
											? "translateX(200%)"
											: "translateX(0)"}
								></div>
								<Tabs.Trigger value="list" class={viewTriggerClass}
									>List</Tabs.Trigger
								>
								<Tabs.Trigger value="calendar" class={viewTriggerClass}>
									Calendar
								</Tabs.Trigger>
								<Tabs.Trigger value="cast" class={viewTriggerClass}>
									Casts
								</Tabs.Trigger>
							</Tabs.List>
						</Tabs.Root>
					</div>
				</div>

				<div class="view-stack">
					{#key view}
						<div
							class="view-pane"
							in:fade={{ duration: 200 }}
							out:fade={{ duration: 200 }}
						>
							{#if view === "list"}
								<!-- Cities-style sortable table: search + bracket filter on the
								     left, status toggle + table on the right. -->
								<div class={TABLE_FRAME_CLASS}>
									<TableFilterColumn
										bind:search={tableState.search}
										count={`${rows.length} / ${tableEligible.length} matches`}
										chips={bracketChips}
									>
										{#snippet filters()}
											{#if bracketOptions.length > 0}
												<Select.Root
													type="multiple"
													value={selectedBracketEntries}
													onValueChange={setBracketFilter}
												>
													<Select.Trigger
														class="flex w-full cursor-pointer items-center justify-between rounded border border-black bg-surface-raised px-2 py-1.5 text-xs text-tan"
													>
														<span class="truncate">Bracket</span>
														<span class="ml-2 text-tan opacity-60">▼</span>
													</Select.Trigger>
													<Select.Portal>
														<Select.Content
															class="z-50 max-h-80 overflow-y-auto rounded bg-surface-sunken shadow-lg"
														>
															<Select.Viewport>
																{#each bracketOptions as opt (opt.value)}
																	<Select.Item
																		value={`bracket:${opt.value}`}
																		label={opt.label}
																		class="flex cursor-pointer items-center justify-between px-3 py-2 text-sm text-tan hover:bg-surface-raised data-[highlighted]:bg-surface-raised"
																	>
																		{#snippet children({ selected })}
																			<span>{opt.label}</span>
																			{#if selected}
																				<span class="font-bold text-orange"
																					>✓</span
																				>
																			{/if}
																		{/snippet}
																	</Select.Item>
																{/each}
															</Select.Viewport>
														</Select.Content>
													</Select.Portal>
												</Select.Root>
											{/if}
										{/snippet}
									</TableFilterColumn>

									<div class="min-w-0 flex-1">
										<!-- Status filter above the table, styled like the bracket view tabs. -->
										<div class="mb-3 flex flex-wrap justify-end gap-2">
											<ToggleGroup.Root
												type="multiple"
												value={statusFilter}
												onValueChange={(v) =>
													(statusFilter = v as MatchStatusGroup[])}
												class="flex overflow-hidden rounded-lg border-2 border-surface"
												style="background-color: rgb(var(--color-surface));"
												aria-label="Match status"
											>
												<ToggleGroup.Item
													value="scheduled"
													class={statusItemClass}
												>
													Scheduled
												</ToggleGroup.Item>
												<ToggleGroup.Item
													value="in_progress"
													class={statusItemClass}
												>
													In Progress
												</ToggleGroup.Item>
												<ToggleGroup.Item
													value="unscheduled"
													class={statusItemClass}
												>
													Unscheduled
												</ToggleGroup.Item>
												<ToggleGroup.Item
													value="completed"
													class={statusItemClass}
												>
													Completed
												</ToggleGroup.Item>
											</ToggleGroup.Root>
										</div>

										<div class="overflow-x-auto">
											<table class={TABLE_CLASS}>
												<thead>
													<tr>
														{#each MATCH_COLUMNS as column, i (column.key)}
															<th
																class="{TABLE_HEADER_TH_CLASS} {i === 0
																	? 'rounded-l-lg border-l'
																	: ''} {i === MATCH_COLUMNS.length - 1
																	? 'rounded-r-lg border-r'
																	: ''}"
																onclick={() =>
																	toggleSort(tableState, column.key)}
															>
																<span class="inline-flex items-center gap-1">
																	{column.label}
																	{#if tableState.sortColumn === column.key}
																		<span class="text-orange">
																			{tableState.sortDirection === "asc"
																				? "↑"
																				: "↓"}
																		</span>
																	{/if}
																</span>
															</th>
														{/each}
													</tr>
												</thead>
												<tbody>
													{#each rows as m (m.match_id)}
														<tr
															class="group cursor-pointer"
															onclick={(e) => pick(m.match_id, e)}
														>
															{#each MATCH_COLUMNS as column, i (column.key)}
																<td
																	class="{TABLE_CELL_TD_CLASS} {i === 0
																		? 'rounded-l-lg'
																		: ''} {i === MATCH_COLUMNS.length - 1
																		? 'rounded-r-lg'
																		: ''} whitespace-nowrap"
																>
																	{#if column.key === "scheduled_at"}
																		{@const g = matchStatusGroup(m)}
																		{@const t = formatScheduledInZone(
																			matchSortInstant(m),
																			zone,
																		)}
																		{#if g === "in_progress"}
																			<!-- Overdue: time passed, result unreported. Keep the
																			     last-started sitting's time visible so an admin
																			     chasing reports can see how overdue it is. -->
																			{t || "In progress"}{#if t}<span
																					class="opacity-60"
																				>
																					· in progress</span
																				>{/if}
																		{:else if t}
																			{t}
																		{:else if g === "completed"}
																			Completed
																		{:else}
																			Not scheduled
																		{/if}
																	{:else if column.key === "match"}
																		<span
																			class="inline-flex items-center gap-2"
																		>
																			{@render playerCell(m, "a")}
																			<span class="opacity-60">v</span>
																			{@render playerCell(m, "b")}
																		</span>
																	{:else if column.key === "caster"}
																		{@const firstCast = matchParts(m).find(
																			(part) => part.casters.length > 0,
																		)?.casters[0]}
																		{#if firstCast}
																			<span
																				class="inline-flex items-center gap-1.5"
																			>
																				<PlayerAvatar
																					avatarUrl={firstCast.avatar_url}
																					size={16}
																				/>
																				{firstCast.display_name ??
																					firstCast.name}
																			</span>
																		{:else}
																			—
																		{/if}
																	{:else if column.key === "streams"}
																		{@const firstStream = matchParts(m)
																			.flatMap((part) => part.streams)
																			.at(0)}
																		{#if firstStream}
																			<!-- External stream URL (youtube/twitch), validated
																			     host-side; not an app route, so resolve() doesn't
																			     apply. Stop propagation so the link doesn't also
																			     open the match card. -->
																			<!-- eslint-disable svelte/no-navigation-without-resolve -->
																			<a
																				href={firstStream.url}
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
																				{firstStream.label?.trim() || "Stream"}
																			</a>
																			<!-- eslint-enable svelte/no-navigation-without-resolve -->
																		{:else}
																			—
																		{/if}
																	{/if}
																</td>
															{/each}
														</tr>
													{:else}
														<tr>
															<td
																colspan={MATCH_COLUMNS.length}
																class="p-8 text-center italic text-tan"
															>
																No matches
															</td>
														</tr>
													{/each}
												</tbody>
											</table>
										</div>
									</div>
								</div>
							{:else if view === "cast"}
								<CastView
									matches={data.matches}
									tournament={data.tournament}
									{zone}
									{user}
									slotLabels={slotMaps.labels}
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
