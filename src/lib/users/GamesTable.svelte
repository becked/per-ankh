<script lang="ts">
	// Games tab — the user's library as a table of two-line rows (Game ·
	// Turns · Result · Played), driven by the lighter GameListItem shape plus
	// the roster the ?players=1 opt-in adds. The chrome is the tournament
	// match table's (FRAMED_TABLE_* in $lib/ui/classes): framed box, raised
	// sticky header, zebra body, and a cell that may carry a second muted
	// line — the matchup over the save's name and map, the result over the
	// victory it was decided by, the date over how long ago that was.
	//
	// Server pagination via infinite scroll, month dividers (date sorts
	// only). Filter + sort state lives in the URL — the headers write it, as
	// does the sort dropdown beside them, so the two can't disagree. load()
	// passes the first page in via initialGames and the resolved filter
	// props. Rename / move-to-collection live on the game-detail page, not
	// here.

	import { untrack } from "svelte";
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import { resolve } from "$app/paths";
	import { cloudApi, ApiError, type GameListItem } from "$lib/api-cloud";
	import SearchInput from "$lib/SearchInput.svelte";
	import DateFilter from "./DateFilter.svelte";
	import ProfileLink from "$lib/ProfileLink.svelte";
	import Select from "$lib/ui/Select.svelte";
	import type { SelectOption } from "$lib/ui/types";
	import {
		FRAMED_TABLE_ROW,
		FRAMED_TABLE_TD,
		FRAMED_TABLE_TH,
		FRAMED_TABLE_WRAPPER,
	} from "$lib/ui/classes";
	import SpriteIcon from "$lib/game-detail/SpriteIcon.svelte";
	import PlayerAvatar from "$lib/tournament/PlayerAvatar.svelte";
	import { getCivilizationColor } from "$lib/config";
	import {
		formatDate,
		formatEnum,
		formatRelativeToNow,
		nationName,
		savedGameName,
		seatLabel,
	} from "$lib/utils/formatting";
	import { mapScriptLabel, mapSizeLabel } from "$lib/map-settings";
	import {
		GAMES_COLUMNS,
		MAX_OPPONENTS_SHOWN,
		gameOpponents,
		nextGameSort,
		parseGameSort,
		type GamesColumn,
	} from "./games-table";

	// Nation accent color for the name cell (falls back to inheriting the
	// row's text color when a nation has no defined color).
	function nationColor(nation: string | null): string | undefined {
		if (!nation) return undefined;
		return getCivilizationColor(nation) ?? undefined;
	}

	// The shared framed-box header, plus this mount's two modifiers: it sticks
	// to the top of the pane the table scrolls in (no offset — the pane has no
	// padding of its own, unlike the matches page's), and a column the list
	// query can order by advertises the click.
	function thClass(column: GamesColumn): string {
		const sortable =
			column.sort !== null
				? "cursor-pointer transition-colors hover:text-orange "
				: "";
		return `sticky top-0 z-10 ${sortable}${FRAMED_TABLE_TH}`;
	}

	interface Props {
		userId: string;
		initialGames: GameListItem[];
		total: number;
		pageSize: number;
		// Resolved filter/sort state from load() (mirrors the URL).
		q: string;
		nation: string | null;
		result: "win" | "loss" | null;
		date: string | null;
		sort: string;
		// Nations present in the corpus, for the Nation filter dropdown.
		nationOptions: string[];
	}

	let {
		userId,
		initialGames,
		total,
		pageSize,
		q,
		nation,
		result,
		date,
		sort,
		nationOptions,
	}: Props = $props();

	// --- URL writers --------------------------------------------------
	async function setParam(key: string, value: string | null) {
		const next = new URL(page.url);
		if (value === null) next.searchParams.delete(key);
		else next.searchParams.set(key, value);
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- search-param-only update on the current route; URL objects are SvelteKit's documented dynamic-nav API
		await goto(next, { replaceState: true, keepFocus: true, noScroll: true });
	}

	// Free-text filter: local state pushed to ?q debounced. Comparing
	// against the `q` prop (which reflects the URL) keeps this from looping
	// — once load() re-runs with the new q, searchText === q and the
	// writer is a no-op.
	// Initial value only — the writer effect below re-reads `q` reactively
	// to detect when the URL has caught up. untrack() makes the
	// initial-only intent explicit (and silences state_referenced_locally).
	let searchText = $state(untrack(() => q));
	let searchDebounce: ReturnType<typeof setTimeout> | null = null;
	$effect(() => {
		const v = searchText;
		if (v === q) return;
		if (searchDebounce) clearTimeout(searchDebounce);
		searchDebounce = setTimeout(() => {
			void setParam("q", v.trim() === "" ? null : v.trim());
		}, 300);
		return () => {
			if (searchDebounce) clearTimeout(searchDebounce);
		};
	});

	// --- Sort ---------------------------------------------------------
	// Every order GAME_LIST_ORDER (cloud/src/games.ts) serves, so this
	// dropdown can name whatever a header click put in the URL — a header
	// toggles its own column both ways, and a value with no option here would
	// leave the dropdown reading blank.
	const SORT_OPTIONS: Array<{ value: string; label: string }> = [
		{ value: "date_desc", label: "Newest first" },
		{ value: "date_asc", label: "Oldest first" },
		{ value: "turns_desc", label: "Most turns" },
		{ value: "turns_asc", label: "Fewest turns" },
		{ value: "nation_asc", label: "Nation A–Z" },
		{ value: "nation_desc", label: "Nation Z–A" },
		{ value: "name_asc", label: "Name A–Z" },
		{ value: "name_desc", label: "Name Z–A" },
		{ value: "result_desc", label: "Wins first" },
		{ value: "result_asc", label: "Losses first" },
	];
	const isDateSort = $derived(sort.startsWith("date"));
	// Which header carries the arrow, and which way it points.
	const sortState = $derived(parseGameSort(sort));

	async function toggleSort(column: GamesColumn) {
		const next = nextGameSort(sort, column);
		if (next !== null) await setParam("sort", next);
	}

	// --- Filter option lists (for the styled Select) ------------------
	const RESULT_OPTIONS: SelectOption[] = [
		{ value: "", label: "Any result" },
		{ value: "win", label: "Win" },
		{ value: "loss", label: "Loss" },
	];
	const nationSelectOptions = $derived<SelectOption[]>([
		{ value: "", label: "All nations" },
		...nationOptions.map((n) => ({
			value: n,
			label: nationName(n),
		})),
	]);

	// --- Infinite scroll (ported from CloudGameSidebar) ---------------
	let accumulated = $state<GameListItem[]>([]);
	let loadingMore = $state(false);
	let loadAbort: AbortController | null = null;
	// Reset the accumulated list whenever load() hands us a fresh first
	// page (any filter/sort change). Re-reads initialGames every run so a
	// same-length refetch still resets.
	$effect(() => {
		const fresh = initialGames;
		if (loadAbort) loadAbort.abort();
		loadAbort = null;
		accumulated = fresh;
	});
	const hasMore = $derived(accumulated.length < total);

	async function loadMore() {
		if (loadingMore || !hasMore) return;
		loadingMore = true;
		if (loadAbort) loadAbort.abort();
		loadAbort = new AbortController();
		const signal = loadAbort.signal;
		// Read filters live from the URL so a fetch near a filter-change
		// boundary uses the latest set (props lag a frame during the
		// goto → load() round-trip).
		const params = page.url.searchParams;
		const scopeRaw = params.get("scope");
		const scope =
			scopeRaw &&
			(scopeRaw === "public" ||
				scopeRaw === "vs_ai" ||
				scopeRaw === "mp" ||
				scopeRaw === "tournament" ||
				scopeRaw === "challenge" ||
				/^\d+$/.test(scopeRaw))
				? scopeRaw
				: undefined;
		const resultRaw = params.get("result");
		try {
			const res = await cloudApi.listGames({
				userId,
				limit: pageSize,
				offset: accumulated.length,
				scope,
				q: params.get("q") ?? undefined,
				nation: params.get("nation") ?? undefined,
				result:
					resultRaw === "win" || resultRaw === "loss" ? resultRaw : undefined,
				date: params.get("date") ?? undefined,
				sort: params.get("sort") ?? undefined,
				// The same payload load() asked for — without it the rows past
				// the first page would name nobody.
				players: true,
				signal,
			});
			if (signal.aborted) return;
			accumulated = [...accumulated, ...res.games];
		} catch (err) {
			if (err instanceof DOMException && err.name === "AbortError") return;
			if (err instanceof ApiError) {
				console.error("Failed to load more games:", err);
			} else {
				throw err;
			}
		} finally {
			if (!signal.aborted) loadingMore = false;
		}
	}

	let sentinel: HTMLDivElement | null = $state(null);
	$effect(() => {
		if (!sentinel) return;
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) void loadMore();
				}
			},
			{ rootMargin: "300px" },
		);
		observer.observe(sentinel);
		return () => observer.disconnect();
	});

	// --- Month grouping (date sorts only) -----------------------------
	function getMonthKey(game: GameListItem): string {
		if (!game.save_date) return "unknown";
		const d = new Date(game.save_date);
		if (isNaN(d.getTime())) return "unknown";
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
	}
	function formatMonthLabel(monthKey: string): string {
		if (monthKey === "unknown") return "Unknown Date";
		const [year, month] = monthKey.split("-");
		const d = new Date(Number(year), Number(month) - 1);
		return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
	}
	type GameGroup = { monthKey: string; label: string; games: GameListItem[] };
	const groupedGames = $derived.by((): GameGroup[] => {
		if (!isDateSort)
			return [{ monthKey: "all", label: "", games: accumulated }];
		const groups: GameGroup[] = [];
		let currentKey = "";
		for (const game of accumulated) {
			const key = getMonthKey(game);
			if (key !== currentKey) {
				groups.push({ monthKey: key, label: formatMonthLabel(key), games: [] });
				currentKey = key;
			}
			groups[groups.length - 1].games.push(game);
		}
		return groups;
	});

	async function navigateToGame(gameId: string) {
		await goto(resolve("/games/[id]", { id: gameId }));
	}
</script>

<!-- Same 12-col grid as the / page feed: filters (col-span-2) · games
     list (col-span-8) · sort (col-span-2), gap-4. One dark background
     (blue-gray) frames all three columns. -->
<div class="grid gap-4 rounded-lg bg-blue-gray p-3 lg:grid-cols-12">
	<!-- Left: filters, stacked. -->
	<aside class="lg:col-span-2">
		<!-- Spacer matching the table header row so the controls line up with
		     the first data row, not the header. -->
		<div
			class="pb-2 pt-1 text-[10px] font-bold uppercase tracking-wide"
			aria-hidden="true"
		>
			&nbsp;
		</div>
		<div class="space-y-2">
			<SearchInput
				bind:value={searchText}
				variant="dark"
				placeholder=""
				class="w-full"
			/>

			<Select
				value={nation ?? ""}
				onChange={(v) => setParam("nation", v)}
				options={nationSelectOptions}
				ariaLabel="Filter by nation"
				class="w-full"
			/>

			<Select
				value={result ?? ""}
				onChange={(v) => setParam("result", v)}
				options={RESULT_OPTIONS}
				ariaLabel="Filter by result"
				class="w-full"
			/>

			<DateFilter value={date} onChange={(v) => setParam("date", v)} />
		</div>
	</aside>

	<!-- Center: the table. The framed box is also the scroll pane, so the
	     header can stick to it — a separate inner frame would capture the
	     scroll and the header would stick to nothing. -->
	<div
		class="{FRAMED_TABLE_WRAPPER} max-h-[calc(100vh-220px)] overflow-y-auto lg:col-span-8"
	>
		<table class="w-full border-collapse text-sm">
			<thead>
				<tr>
					{#each GAMES_COLUMNS as column (column.key)}
						<th
							class={thClass(column)}
							onclick={column.sort !== null
								? () => toggleSort(column)
								: undefined}
						>
							<span class="inline-flex items-center gap-1">
								{column.label}
								{#if column.sort !== null && sortState.base === column.sort}
									<span class="text-orange">
										{sortState.direction === "asc" ? "↑" : "↓"}
									</span>
								{/if}
							</span>
						</th>
					{/each}
				</tr>
			</thead>
			{#each groupedGames as group, gi (group.monthKey)}
				<!-- Skip the first divider — the leading group is the current /
				     most-recent month and needs no label. One <tbody> per group so
				     the zebra restarts under each divider instead of counting it as
				     a row and inverting the stripes below. -->
				{#if isDateSort && group.label && gi > 0}
					<tbody>
						<tr>
							<td colspan={GAMES_COLUMNS.length} class="px-3">
								<div class="my-2 flex items-center gap-2">
									<div class="h-px flex-1 bg-tan opacity-30"></div>
									<span
										class="text-[10px] uppercase tracking-wide text-tan opacity-60"
									>
										{group.label}
									</span>
									<div class="h-px flex-1 bg-tan opacity-30"></div>
								</div>
							</td>
						</tr>
					</tbody>
				{/if}
				<tbody>
					{#each group.games as game (game.game_id)}
						{@const opponents = gameOpponents(game)}
						{@const subtext = [
							savedGameName(game),
							game.map_class ? mapScriptLabel(game.map_class) : null,
							game.map_size ? mapSizeLabel(game.map_size) : null,
						]
							.filter((part) => part !== null)
							.join(" · ")}
						{@const relative = formatRelativeToNow(game.save_date, "local")}
						<!-- How the game was decided, and for whom — the winner only
						     where the badge hasn't already said it, since on a win the
						     nation is the row's own. Both parts are missing often
						     enough (a game that ended with no recorded winner, an
						     observer upload) that they join rather than print a dash
						     apiece under a badge that is already one. -->
						{@const decided = [
							game.victory_type
								? formatEnum(game.victory_type, "VICTORY_")
								: null,
							game.user_won !== true && game.winner_nation
								? `${nationName(game.winner_nation)} won`
								: null,
						]
							.filter((part) => part !== null)
							.join(" · ")}
						<!-- The row opens the game, as it did when it was a
						     role="button" div with a trailing chevron. The nation on
						     the matchup line is the same link spelled as one, so the
						     row is reachable by keyboard and openable in a new tab;
						     the opponent links stopPropagation so following one
						     doesn't also open the game. -->
						<tr
							class="cursor-pointer {FRAMED_TABLE_ROW}"
							onclick={() => navigateToGame(game.game_id)}
						>
							<td class={FRAMED_TABLE_TD}>
								<div class="flex flex-col gap-0.5">
									<span class="flex items-center gap-x-2">
										<a
											href={resolve("/games/[id]", { id: game.game_id })}
											class="flex min-w-0 items-center gap-1.5 hover:underline"
											onclick={(e) => e.stopPropagation()}
										>
											<!-- Fixed-size wrapper: SpriteIcon renders nothing when
											     the crest has no sprite, and the names beside it
											     would unalign without the reserved cell. -->
											<span class="flex w-4 flex-none">
												{#if game.user_nation}
													<SpriteIcon
														category="crests"
														value={game.user_nation}
														size={16}
														alt={nationName(game.user_nation)}
													/>
												{/if}
											</span>
											<span
												class="truncate font-bold text-gray-100"
												style={nationColor(game.user_nation)
													? `color: ${nationColor(game.user_nation)}`
													: undefined}
											>
												{game.user_nation ? nationName(game.user_nation) : "—"}
											</span>
										</a>
										{#if opponents.length > 0}
											<span class="flex-none opacity-60">v</span>
										{/if}
										{#each opponents.slice(0, MAX_OPPONENTS_SHOWN) as opponent, i (opponent.player_index)}
											{#if i > 0}
												<span class="flex-none opacity-40">·</span>
											{/if}
											<span class="flex min-w-0 items-center gap-1.5">
												<span class="flex w-4 flex-none">
													{#if opponent.nation}
														<SpriteIcon
															category="crests"
															value={opponent.nation}
															size={16}
															alt={nationName(opponent.nation)}
														/>
													{/if}
												</span>
												<!-- An AI seat gets no avatar: PlayerAvatar's
												     stand-in means "nobody has claimed this seat",
												     which is a statement about a person. The crest
												     is an AI's whole identity — 121 of the 122 AI
												     seats across test-data/saves/ carry no name
												     either, so seatLabel names it by nation. -->
												<ProfileLink
													userId={opponent.user_id}
													slug={opponent.slug}
													class="flex min-w-0 items-center gap-1 hover:underline"
													onclick={(e) => e.stopPropagation()}
												>
													{#if opponent.is_human}
														<PlayerAvatar
															avatarUrl={opponent.avatar_url}
															size={16}
														/>
													{/if}
													<span class="truncate text-bright"
														>{seatLabel(opponent)}</span
													>
												</ProfileLink>
											</span>
										{/each}
										{#if opponents.length > MAX_OPPONENTS_SHOWN}
											<span class="flex-none opacity-60"
												>+{opponents.length - MAX_OPPONENTS_SHOWN}</span
											>
										{/if}
									</span>
									{#if subtext}
										<span class="text-xs opacity-75">{subtext}</span>
									{/if}
								</div>
							</td>
							<td class={FRAMED_TABLE_TD}>
								<span class="font-semibold opacity-80">{game.total_turns}</span>
							</td>
							<td class={FRAMED_TABLE_TD}>
								<div class="flex flex-col items-start gap-0.5">
									{#if game.user_won === true}
										<span
											class="rounded px-2 py-0.5 text-[10px] font-bold"
											style="background-color:rgb(var(--color-success-surface));color:rgb(var(--color-success));"
											>Win</span
										>
									{:else if game.user_won === false}
										<span
											class="rounded px-2 py-0.5 text-[10px] font-bold"
											style="background-color:rgb(var(--color-danger-surface));color:rgb(var(--color-danger));"
											>Loss</span
										>
									{:else}
										<!-- Observer upload: the save records no seat for the
										     owner, so there is no win or loss to report. -->
										<span class="opacity-60">—</span>
									{/if}
									{#if decided}
										<span class="text-xs opacity-75">{decided}</span>
									{/if}
								</div>
							</td>
							<td class={FRAMED_TABLE_TD}>
								<div class="flex flex-col gap-0.5">
									<span>{formatDate(game.save_date)}</span>
									{#if relative}
										<span class="text-xs opacity-75">{relative}</span>
									{/if}
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			{/each}
			{#if accumulated.length === 0}
				<tbody>
					<tr>
						<td
							colspan={GAMES_COLUMNS.length}
							class="p-8 text-center text-sm text-tan opacity-60"
						>
							No games found
						</td>
					</tr>
				</tbody>
			{/if}
		</table>
		{#if hasMore}
			<div
				bind:this={sentinel}
				class="py-3 text-center text-[10px] text-tan opacity-70"
			>
				{loadingMore ? "Loading…" : ""}
			</div>
		{/if}
	</div>

	<!-- Right: sort. -->
	<aside class="lg:col-span-2">
		<!-- Spacer matching the table header row (see left aside). -->
		<div
			class="pb-2 pt-1 text-[10px] font-bold uppercase tracking-wide"
			aria-hidden="true"
		>
			&nbsp;
		</div>
		<Select
			value={sort}
			onChange={(v) => setParam("sort", v ?? "date_desc")}
			options={SORT_OPTIONS}
			ariaLabel="Sort"
			class="w-full"
		/>
	</aside>
</div>
