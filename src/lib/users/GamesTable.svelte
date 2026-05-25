<script lang="ts">
	// Games tab — the user's library as a table of rows (Nation · Victory ·
	// Map · Turns · Result · Date), driven by the lighter GameListItem
	// shape. Server pagination via infinite scroll, month dividers (date
	// sorts only). Filter + sort state lives in the URL; load() passes the
	// first page in via initialGames and the resolved filter props. Rename
	// / move-to-collection live on the game-detail page, not here.

	import { untrack } from "svelte";
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import { resolve } from "$app/paths";
	import { cloudApi, ApiError, type GameListItem } from "$lib/api-cloud";
	import { autohideScroll } from "$lib/actions/autohideScroll";
	import SearchInput from "$lib/SearchInput.svelte";
	import DateFilter from "./DateFilter.svelte";
	import SpriteIcon from "$lib/game-detail/SpriteIcon.svelte";
	import { getCivilizationColor } from "$lib/config";
	import { formatDate, formatEnum } from "$lib/utils/formatting";

	// Nation accent color for the name cell (falls back to inheriting the
	// row's text color when a nation has no defined color).
	function nationColor(nation: string | null): string | undefined {
		if (!nation) return undefined;
		return getCivilizationColor(nation.replace(/^NATION_/, "")) ?? undefined;
	}

	// Shared grid template for the header row and each game row, so columns
	// line up: Nation · Victory · Map · Turns · Result · Date · chevron.
	const GRID_COLS =
		"grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_3.5rem_4.5rem_5.5rem_1.5rem] items-center gap-3";

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
	const SORT_OPTIONS: Array<{ value: string; label: string }> = [
		{ value: "date_desc", label: "Newest first" },
		{ value: "date_asc", label: "Oldest first" },
		{ value: "turns_desc", label: "Most turns" },
		{ value: "turns_asc", label: "Fewest turns" },
		{ value: "nation_asc", label: "Nation A–Z" },
		{ value: "name_asc", label: "Name A–Z" },
		{ value: "result_desc", label: "Wins first" },
	];
	const isDateSort = $derived(sort.startsWith("date"));

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
     (#211a12) frames all three columns. -->
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

			<select
				class="w-full cursor-pointer rounded border border-black bg-[#35302b] px-2 py-1.5 text-xs text-tan"
				value={nation ?? ""}
				onchange={(e) =>
					setParam("nation", (e.target as HTMLSelectElement).value || null)}
				aria-label="Filter by nation"
			>
				<option value="">All nations</option>
				{#each nationOptions as n (n)}
					<option value={n}>{formatEnum(n, "NATION_")}</option>
				{/each}
			</select>

			<select
				class="w-full cursor-pointer rounded border border-black bg-[#35302b] px-2 py-1.5 text-xs text-tan"
				value={result ?? ""}
				onchange={(e) =>
					setParam("result", (e.target as HTMLSelectElement).value || null)}
				aria-label="Filter by result"
			>
				<option value="">Any result</option>
				<option value="win">Win</option>
				<option value="loss">Loss</option>
			</select>

			<DateFilter value={date} onChange={(v) => setParam("date", v)} />
		</div>
	</aside>

	<!-- Center: the game cards (lighter #35302b) read as distinct against
       the shared dark background. -->
	<div
		class="cloud-scroll max-h-[calc(100vh-220px)] overflow-y-auto lg:col-span-8"
		use:autohideScroll
	>
		{#if accumulated.length === 0}
			<div class="p-8 text-center text-sm text-tan opacity-60">
				No games found
			</div>
		{:else}
			<!-- Column headers — stay put while the rows scroll. -->
			<div
				class="{GRID_COLS} sticky top-0 z-10 bg-blue-gray px-3 pb-2 pt-1 text-[10px] font-bold uppercase tracking-wide text-gray-100"
			>
				<span>Nation</span>
				<span>Victory</span>
				<span>Map</span>
				<span class="text-right">Turns</span>
				<span>Result</span>
				<span class="text-right">Date</span>
				<span></span>
			</div>

			{#each groupedGames as group, gi (group.monthKey)}
				<!-- Skip the first divider — the leading group is the current /
				     most-recent month and needs no label. -->
				{#if isDateSort && group.label && gi > 0}
					<div class="my-2 flex items-center gap-2 px-1">
						<div class="h-px flex-1 bg-tan opacity-30"></div>
						<span
							class="text-[10px] uppercase tracking-wide text-tan opacity-60"
						>
							{group.label}
						</span>
						<div class="h-px flex-1 bg-tan opacity-30"></div>
					</div>
				{/if}
				{#each group.games as game (game.game_id)}
					<div
						class="{GRID_COLS} group mb-1.5 cursor-pointer rounded-lg bg-[#2a2622] px-3 py-3 transition-colors hover:bg-[#3e362f]"
						role="button"
						tabindex="0"
						onclick={() => navigateToGame(game.game_id)}
						onkeydown={(e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault();
								navigateToGame(game.game_id);
							}
						}}
					>
						<span class="flex min-w-0 items-center gap-2">
							{#if game.user_nation}
								<SpriteIcon
									category="crests"
									value={game.user_nation}
									size={16}
									alt={formatEnum(game.user_nation, "NATION_")}
								/>
							{/if}
							<span
								class="truncate font-bold text-gray-100"
								style={nationColor(game.user_nation)
									? `color: ${nationColor(game.user_nation)}`
									: undefined}
							>
								{game.user_nation
									? formatEnum(game.user_nation, "NATION_")
									: "—"}
							</span>
						</span>
						<span class="truncate text-tan opacity-80">
							{game.victory_type
								? formatEnum(game.victory_type, "VICTORY_")
								: "—"}
						</span>
						<span class="truncate text-tan opacity-80">
							{game.map_size ? formatEnum(game.map_size, "MAPSIZE_") : "—"}
						</span>
						<span class="text-right font-semibold text-tan opacity-80">
							{game.total_turns}
						</span>
						<span>
							{#if game.user_won === true}
								<span
									class="rounded px-2 py-0.5 text-[10px] font-bold"
									style="background-color:#2a3a24;color:#8fcc6a;">Win</span
								>
							{:else if game.user_won === false}
								<span
									class="rounded px-2 py-0.5 text-[10px] font-bold"
									style="background-color:#3a2622;color:#d98c87;">Loss</span
								>
							{/if}
						</span>
						<span class="whitespace-nowrap text-right text-tan opacity-70">
							{formatDate(game.save_date)}
						</span>
						<span class="flex justify-end text-tan opacity-40">›</span>
					</div>
				{/each}
			{/each}
			{#if hasMore}
				<div
					bind:this={sentinel}
					class="py-3 text-center text-[10px] text-tan opacity-70"
				>
					{loadingMore ? "Loading…" : ""}
				</div>
			{/if}
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
		<select
			class="w-full cursor-pointer rounded border border-black bg-[#35302b] px-2 py-1.5 text-xs text-tan"
			value={sort}
			onchange={(e) => setParam("sort", (e.target as HTMLSelectElement).value)}
			aria-label="Sort"
		>
			{#each SORT_OPTIONS as o (o.value)}
				<option value={o.value}>{o.label}</option>
			{/each}
		</select>
	</aside>
</div>
