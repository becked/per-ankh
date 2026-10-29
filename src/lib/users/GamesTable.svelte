<script lang="ts">
	// Games tab — the user's library as a table of two-line rows (Game ·
	// Turns · Result · Played), driven by the lighter GameListItem shape plus
	// the roster the ?players=1 opt-in adds. The chrome is the tournament
	// match table's (FRAMED_TABLE_* in $lib/ui/classes): framed box, raised
	// sticky header, zebra body, and a cell that may carry a second muted
	// line — the matchup over the save's name and map, and the result over
	// the victory it was decided by. Played is the save date alone.
	//
	// Server pagination via infinite scroll, month dividers (date sorts
	// only). Filter + sort state lives in the URL, and the column headers are
	// what write the sort — every order GAME_LIST_ORDER
	// (cloud/src/games.ts) serves is a click on one of the four. load()
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
		nationName,
		savedGameName,
		seatLabel,
	} from "$lib/utils/formatting";
	import { mapScriptLabel, mapSizeLabel } from "$lib/map-settings";
	import {
		GAMES_COLUMNS,
		gameOpponents,
		gameSelfSeat,
		nextGameSort,
		parseGameSort,
		visibleOpponents,
		type GamesColumn,
	} from "./games-table";

	// Nation accent color for the name cell (falls back to inheriting the
	// row's text color when a nation has no defined color).
	function nationColor(nation: string | null): string | undefined {
		if (!nation) return undefined;
		return getCivilizationColor(nation) ?? undefined;
	}

	// The shared framed-box header, plus this mount's one modifier: a column the
	// list query can order by advertises the click. The header doesn't stick —
	// FRAMED_TABLE_WRAPPER's overflow-x-auto makes the wrapper the nearest
	// scroll container on both axes, and it has no vertical scroll of its own,
	// so a sticky <th> has nothing to stick to. MatchTable's stickyHeader mount
	// sits on the same wrapper and doesn't stick either.
	function thClass(column: GamesColumn): string {
		const sortable =
			column.sort !== null
				? "cursor-pointer transition-colors hover:text-orange "
				: "";
		return `${sortable}${FRAMED_TABLE_TH}`;
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

<!-- The / page feed's 12-col grid without its sort column: filters
     (col-span-2) · games list (col-span-10), gap-4. One dark background
     (blue-gray) frames both columns. -->
<div class="grid gap-4 rounded-lg bg-blue-gray p-3 lg:grid-cols-12">
	<!-- Left: filters, stacked. -->
	<aside class="lg:col-span-2">
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

	<!-- Center: the table, mounted bare the way MatchTable is: no height cap
	     and no pane of its own, so .profile-scroll scrolls it along with the
	     rest of the page rather than the rows scrolling inside a second box. -->
	<div class="{FRAMED_TABLE_WRAPPER} lg:col-span-10">
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
						{@const visible = visibleOpponents(opponents)}
						{@const selfSeat = gameSelfSeat(game)}
						{@const claimedSeat = game.uploader_player_index != null}
						{@const subtext = [
							savedGameName(game),
							game.map_class ? mapScriptLabel(game.map_class) : null,
							game.map_size ? mapSizeLabel(game.map_size) : null,
						]
							.filter((part) => part !== null)
							.join(" · ")}
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
						<!-- The row opens the game, as it did when it was a role="button" div
						     with a trailing chevron. The second line is its one anchor — the
						     matchup above it links each seat to a profile — so the row stays
						     reachable by keyboard and openable in a new tab. Every link in the
						     cell stopPropagation so following one doesn't also fire the row
						     handler. -->
						<tr
							class="cursor-pointer {FRAMED_TABLE_ROW}"
							onclick={() => navigateToGame(game.game_id)}
						>
							<td class={FRAMED_TABLE_TD}>
								<div class="flex flex-col gap-0.5">
									<span class="flex items-center gap-x-2">
										{#if selfSeat}
											<span class="flex min-w-0 items-center gap-1.5">
												<!-- Fixed-size wrapper: SpriteIcon renders nothing when
												     the crest has no sprite, and the names beside it
												     would unalign without the reserved cell. -->
												<span class="flex w-4 flex-none">
													{#if selfSeat.nation}
														<SpriteIcon
															category="crests"
															value={selfSeat.nation}
															size={16}
															alt={nationName(selfSeat.nation)}
														/>
													{/if}
												</span>
												<ProfileLink
													userId={selfSeat.user_id}
													slug={selfSeat.slug}
													class="flex min-w-0 items-center gap-1 hover:underline"
													onclick={(e) => e.stopPropagation()}
												>
													{#if selfSeat.is_human}
														<PlayerAvatar
															avatarUrl={selfSeat.avatar_url}
															size={16}
														/>
													{/if}
													<!-- Every name on the line carries its own nation's color, so the
													     row reads as a matchup and not as a verdict — the Result column
													     is what says who won. The uploader's own seat keeps the heavier
													     weight that marks this profile's player; an observer upload has
													     no such seat, so nothing on its row is bolded. -->
													<span
														class="truncate text-bright {claimedSeat
															? 'font-bold'
															: ''}"
														style={nationColor(selfSeat.nation)
															? `color: ${nationColor(selfSeat.nation)}`
															: undefined}
													>
														{seatLabel(selfSeat)}
													</span>
												</ProfileLink>
											</span>
										{/if}
										{#if selfSeat && opponents.length === 1}
											<!-- "v" reads as a matchup only where there are two sides to it. With
											     three or more seats on the line there is no "against", so the same
											     separator carries the whole list. -->
											<span class="flex-none opacity-60">v</span>
										{:else if selfSeat && opponents.length > 1}
											<span class="flex-none opacity-40">·</span>
										{/if}
										{#each visible.shown as opponent, i (opponent.player_index)}
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
													<span
														class="truncate text-bright"
														style={nationColor(opponent.nation)
															? `color: ${nationColor(opponent.nation)}`
															: undefined}>{seatLabel(opponent)}</span
													>
												</ProfileLink>
											</span>
										{/each}
										{#if visible.truncated}
											<!-- The seats that didn't fit the budget. An ellipsis rather than a
											     count: what the row is saying is that the line ran out, and the
											     game page one click away is where the whole roster is. -->
											<span class="flex-none opacity-60">…</span>
										{/if}
									</span>
									<!-- The row's one anchor to the game: every seat on the line above links
									     to a profile instead. "View game" stands in for the save that has
									     neither a name nor map data to label it with. -->
									<a
										href={resolve("/games/[id]", { id: game.game_id })}
										class="text-xs opacity-75 hover:underline"
										onclick={(e) => e.stopPropagation()}
									>
										{subtext || "View game"}
									</a>
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
									{:else if game.uploader_player_index == null}
										<!-- Observer upload: no seat carries `is_uploader`, so
										     deriveUploaderColumns (cloud/src/games.ts) leaves both
										     user_nation and user_won NULL. The row still names a
										     nation — the list query COALESCEs it to the first human
										     seat — so an unlabelled dash reads as a missing result
										     rather than a seat nobody claimed. `== null`, not falsy:
										     seat 0 is a valid index. Orange rather than a neutral
										     step: the zebra's two stripes and the sticky header already
										     use the surface ramp, so a badge drawn from it reads as
										     chrome. Same fill/foreground shape as Win and Loss, because
										     the three are one set and only hue should separate them. -->
										<span
											class="rounded px-2 py-0.5 text-[10px] font-bold"
											style="background-color:rgb(var(--color-orange-surface));color:rgb(var(--color-orange));"
											>Observer</span
										>
									{:else}
										<!-- Seat claimed, save records no winner: the game ended by
										     surrender or with every human dead, and neither writes a
										     victory (`Player.makeSurrendered`, Player.cs:6577;
										     `Game.doVictory`, Game.cs:14089). `decided` is empty on
										     these too, so the dash is the whole cell. -->
										<span class="opacity-60">—</span>
									{/if}
									{#if decided}
										<span class="text-xs opacity-75">{decided}</span>
									{/if}
								</div>
							</td>
							<!-- The date alone: save_date is a bare YYYY-MM-DD (the
							     parser's parseSaveDate builds one, and
							     parseEntryNameDate matches the entry name's clock and
							     discards it), so a relative subtext under it would
							     either count on a different calendar than the date
							     above or read a clock the save never recorded. -->
							<td class={FRAMED_TABLE_TD}>
								<span>{formatDate(game.save_date)}</span>
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
</div>
