<script lang="ts">
	// Navigational game search for the app header. Searches the SIGNED-IN
	// user's own games (independent of whichever profile is being viewed),
	// shows a results dropdown, and navigates to the picked game. Purely
	// navigational — it never filters a list or changes page scope.

	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import SearchInput from "$lib/SearchInput.svelte";
	import { autohideScroll } from "$lib/actions/autohideScroll";
	import {
		cloudApi,
		ApiError,
		type GameListItem,
		type UserMe,
	} from "$lib/api-cloud";
	import {
		formatGameTitle,
		formatDate,
		formatEnum,
	} from "$lib/utils/formatting";

	let {
		user,
		class: className = "",
		style = "",
		autofocus = false,
		onCollapse,
	}: {
		user: UserMe;
		class?: string;
		style?: string;
		autofocus?: boolean;
		onCollapse?: () => void;
	} = $props();

	let query = $state("");
	let results = $state<GameListItem[]>([]);
	let open = $state(false);
	let highlighted = $state(-1);
	// Row elements, for scroll-into-view on keyboard navigation.
	let rowEls = $state<(HTMLButtonElement | null)[]>([]);
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let abort: AbortController | null = null;

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

	async function runSearch(q: string) {
		if (abort) abort.abort();
		abort = new AbortController();
		try {
			const res = await cloudApi.listGames({
				userId: user.user_id,
				q,
				// Fetch a generous page; the dropdown stays a fixed height and
				// scrolls (newest-saved order, the list's default sort).
				limit: 50,
				signal: abort.signal,
			});
			results = res.games;
			highlighted = -1;
			open = true;
		} catch (err) {
			if (err instanceof DOMException && err.name === "AbortError") return;
			if (err instanceof ApiError) {
				console.error("Header search failed:", err);
				results = [];
				open = true;
			} else {
				throw err;
			}
		}
	}

	async function pick(g: GameListItem) {
		query = "";
		results = [];
		open = false;
		highlighted = -1;
		await goto(resolve("/games/[id]", { id: g.game_id }));
	}

	function handleKeydown(e: KeyboardEvent) {
		if (!open || results.length === 0) {
			if (e.key === "Escape") {
				open = false;
				if (query.trim() === "") onCollapse?.();
			}
			return;
		}
		if (e.key === "ArrowDown") {
			e.preventDefault();
			highlighted = (highlighted + 1) % results.length;
			rowEls[highlighted]?.scrollIntoView({ block: "nearest" });
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			highlighted = (highlighted - 1 + results.length) % results.length;
			rowEls[highlighted]?.scrollIntoView({ block: "nearest" });
		} else if (e.key === "Enter") {
			e.preventDefault();
			const target = highlighted >= 0 ? results[highlighted] : results[0];
			if (target) void pick(target);
		} else if (e.key === "Escape") {
			open = false;
			if (query.trim() === "") onCollapse?.();
		}
	}

	function handleClickOutside(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (!target.closest(".header-game-search")) {
			open = false;
			if (query.trim() === "") onCollapse?.();
		}
	}

	// When focus leaves the search entirely and there's no query, collapse
	// back to the icon. relatedTarget guards against collapsing while focus
	// moves between the input and a result row.
	function handleFocusOut(e: FocusEvent) {
		const next = e.relatedTarget as HTMLElement | null;
		if (next && next.closest(".header-game-search")) return;
		if (query.trim() === "") onCollapse?.();
	}
</script>

<svelte:window onclick={handleClickOutside} />

<div class="header-game-search relative {className}" {style}>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		onkeydown={handleKeydown}
		onfocusin={() => {
			if (results.length > 0) open = true;
		}}
		onfocusout={handleFocusOut}
	>
		<SearchInput bind:value={query} variant="dark" placeholder="" {autofocus} />
	</div>

	{#if open}
		<div
			class="absolute right-0 z-50 mt-1 w-72 overflow-hidden rounded-lg border-2 border-black bg-[#2a2622] shadow-lg"
		>
			{#if results.length === 0}
				<div class="px-3 py-2 text-xs text-tan opacity-70">No games match</div>
			{:else}
				<!-- Fixed height; scroll (mousewheel) through the rest. -->
				<div class="cloud-scroll max-h-80 overflow-y-auto" use:autohideScroll>
					{#each results as g, i (g.game_id)}
						<button
							bind:this={rowEls[i]}
							type="button"
							class="flex w-full flex-col items-start gap-0.5 border-b border-black px-3 py-2 text-left last:border-b-0 hover:bg-[#35302b] {i ===
							highlighted
								? 'bg-[#35302b]'
								: ''}"
							onclick={() => pick(g)}
							onmouseenter={() => (highlighted = i)}
						>
							<span class="text-xs font-semibold text-tan">{titleFor(g)}</span>
							<span class="text-[10px] text-tan opacity-60">
								{#if g.user_nation}{formatEnum(g.user_nation, "NATION_")} ·
								{/if}{formatDate(g.save_date)}
							</span>
						</button>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>
