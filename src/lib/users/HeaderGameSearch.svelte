<script lang="ts">
	// Navigational search for the app header. One always-open input, two
	// result groups: players (anyone with public activity — the public-search
	// endpoint) and the SIGNED-IN user's own games (independent of whichever
	// profile is being viewed). Picking a row navigates to that profile or
	// game. Purely navigational — it never filters a list or changes page
	// scope. Only the results dropdown opens and closes; the input is
	// permanent chrome.

	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import SearchInput from "$lib/SearchInput.svelte";
	import {
		cloudApi,
		ApiError,
		type GameListItem,
		type PublicUserSearchResult,
		type UserMe,
	} from "$lib/api-cloud";
	import {
		formatGameTitle,
		formatDate,
		nationName,
	} from "$lib/utils/formatting";
	import { profileHref } from "$lib/utils/profile-href";

	let {
		user,
		class: className = "",
		style = "",
	}: {
		user: UserMe;
		class?: string;
		style?: string;
	} = $props();

	// Players sit above the games in a fixed-height dropdown, so a generous
	// page of them would push the games group out of sight. Five names is
	// enough to recognize the one you meant from a 2–3 char prefix.
	const PLAYER_LIMIT = 5;

	let query = $state("");
	let results = $state<GameListItem[]>([]);
	let people = $state<PublicUserSearchResult[]>([]);
	let open = $state(false);
	let highlighted = $state(-1);
	// Row elements, for scroll-into-view on keyboard navigation.
	let rowEls = $state<(HTMLButtonElement | null)[]>([]);
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let abort: AbortController | null = null;

	type SearchRow =
		| { kind: "player"; player: PublicUserSearchResult }
		| { kind: "game"; game: GameListItem };

	// The two groups flattened in render order, so arrow keys and Enter cross
	// the group boundary without either group tracking its own cursor.
	// `highlighted` and `rowEls` both index THIS list; the games markup below
	// offsets by people.length to stay in step.
	let rows = $derived<SearchRow[]>([
		...people.map((player) => ({ kind: "player" as const, player })),
		...results.map((game) => ({ kind: "game" as const, game })),
	]);

	function titleFor(g: GameListItem): string {
		return formatGameTitle({
			display_name: g.display_name,
			game_name: g.game_name,
			save_owner_nation: g.user_nation,
			total_turns: g.total_turns,
			match_id: 0,
		});
	}

	// Debounced search-as-you-type. 250ms balances responsiveness against
	// a request per keystroke; the AbortController drops a superseded
	// in-flight request so a slow early response can't overwrite results.
	$effect(() => {
		const q = query.trim();
		if (debounceTimer) clearTimeout(debounceTimer);
		if (q === "") {
			results = [];
			people = [];
			open = false;
			highlighted = -1;
			if (abort) abort.abort();
			return;
		}
		debounceTimer = setTimeout(() => {
			void runSearch(q);
		}, 250);
		return () => {
			if (debounceTimer) clearTimeout(debounceTimer);
		};
	});

	// Both halves of a search fail independently: the people search spends its
	// own rate-limit budget, and exhausting it shouldn't blank the games group
	// (or the reverse). An abort is not a failure — it means a newer keystroke
	// owns the results now — so it propagates out of runSearch untouched.
	async function settle<T>(pending: Promise<T>, fallback: T): Promise<T> {
		try {
			return await pending;
		} catch (err) {
			if (err instanceof DOMException && err.name === "AbortError") throw err;
			if (err instanceof ApiError) {
				console.error("Header search failed:", err);
				return fallback;
			}
			throw err;
		}
	}

	async function runSearch(q: string) {
		if (abort) abort.abort();
		abort = new AbortController();
		const signal = abort.signal;
		try {
			const [players, games] = await Promise.all([
				settle(
					cloudApi
						.searchPublicUsers(q, { limit: PLAYER_LIMIT, signal })
						.then((res) => res.users),
					[] as PublicUserSearchResult[],
				),
				settle(
					cloudApi
						.listGames({
							userId: user.user_id,
							q,
							// Fetch a generous page; the dropdown stays a fixed height
							// and scrolls (newest-saved order, the list's default sort).
							limit: 50,
							signal,
						})
						.then((res) => res.games),
					[] as GameListItem[],
				),
			]);
			people = players;
			results = games;
			highlighted = -1;
			open = true;
		} catch (err) {
			if (err instanceof DOMException && err.name === "AbortError") return;
			throw err;
		}
	}

	async function pick(row: SearchRow) {
		query = "";
		results = [];
		people = [];
		open = false;
		highlighted = -1;
		if (row.kind === "player") {
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- profileHref() returns a resolve() result; lint can't see through the call
			await goto(profileHref(row.player));
		} else {
			await goto(resolve("/games/[id]", { id: row.game.game_id }));
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (!open || rows.length === 0) {
			if (e.key === "Escape") open = false;
			return;
		}
		if (e.key === "ArrowDown") {
			e.preventDefault();
			highlighted = (highlighted + 1) % rows.length;
			rowEls[highlighted]?.scrollIntoView({ block: "nearest" });
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			highlighted = (highlighted - 1 + rows.length) % rows.length;
			rowEls[highlighted]?.scrollIntoView({ block: "nearest" });
		} else if (e.key === "Enter") {
			e.preventDefault();
			const target = highlighted >= 0 ? rows[highlighted] : rows[0];
			if (target) void pick(target);
		} else if (e.key === "Escape") {
			open = false;
		}
	}

	// Dismisses the results dropdown only — the input itself is permanent
	// chrome, so there's nothing to collapse back to.
	function handleClickOutside(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (!target.closest(".header-game-search")) open = false;
	}
</script>

<svelte:window onclick={handleClickOutside} />

<div class="header-game-search relative {className}" {style}>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		onkeydown={handleKeydown}
		onfocusin={() => {
			if (rows.length > 0) open = true;
		}}
	>
		<!-- SearchInput's own default placeholder is "Search". Clearing empties
		     `query`, which the debounce effect above already treats as "reset":
		     results dropped, dropdown closed, in-flight request aborted. -->
		<SearchInput bind:value={query} variant="dark" clearable />
	</div>

	{#if open}
		<div
			class="absolute right-0 z-50 mt-1 w-72 overflow-hidden rounded-lg border-2 border-black bg-surface shadow-lg"
		>
			{#if rows.length === 0}
				<div class="px-3 py-2 text-xs text-tan opacity-70">
					No players or games match
				</div>
			{:else}
				<!-- Fixed height; scroll (mousewheel) through the rest. Both groups
				     share the one scroller so `last:border-b-0` lands on whichever
				     row is genuinely last. -->
				<div class="max-h-80 overflow-y-auto">
					{#if people.length > 0}
						<div
							class="border-b border-black bg-surface-raised px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-tan opacity-70"
						>
							Players
						</div>
						{#each people as p, i (p.user_id)}
							<button
								bind:this={rowEls[i]}
								type="button"
								class="flex w-full items-center gap-2 border-b border-black px-3 py-2 text-left last:border-b-0 hover:bg-surface-raised {i ===
								highlighted
									? 'bg-surface-raised'
									: ''}"
								onclick={() => pick({ kind: "player", player: p })}
								onmouseenter={() => (highlighted = i)}
							>
								<img
									src={p.avatar_url}
									alt=""
									class="h-5 w-5 shrink-0 rounded-full"
									width="20"
									height="20"
									loading="lazy"
								/>
								<span class="truncate text-xs font-semibold text-tan">
									{p.display_name}
								</span>
							</button>
						{/each}
					{/if}
					{#if results.length > 0}
						<div
							class="border-b border-black bg-surface-raised px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-tan opacity-70"
						>
							Your games
						</div>
						{#each results as g, i (g.game_id)}
							<button
								bind:this={rowEls[people.length + i]}
								type="button"
								class="flex w-full flex-col items-start gap-0.5 border-b border-black px-3 py-2 text-left last:border-b-0 hover:bg-surface-raised {people.length +
									i ===
								highlighted
									? 'bg-surface-raised'
									: ''}"
								onclick={() => pick({ kind: "game", game: g })}
								onmouseenter={() => (highlighted = people.length + i)}
							>
								<span class="text-xs font-semibold text-tan">{titleFor(g)}</span
								>
								<span class="text-[10px] text-tan opacity-60">
									{#if g.user_nation}{nationName(g.user_nation)} ·
									{/if}{formatDate(g.save_date)}
								</span>
							</button>
						{/each}
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</div>
