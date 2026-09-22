<script lang="ts">
	import { goto } from "$app/navigation";
	import { navigating, page } from "$app/state";
	import { autohideScroll } from "$lib/actions/autohideScroll";
	import type { PlayedGamesRow } from "$lib/api-cloud";
	import SpriteIcon from "$lib/game-detail/SpriteIcon.svelte";
	import ProfileLink from "$lib/ProfileLink.svelte";
	import { cognomenName } from "$lib/utils/formatting";
	import { profileHref } from "$lib/utils/profile-href";
	import { cognomenOf, RUNGS } from "./ladder";
	import PlayersGuide from "./PlayersGuide.svelte";
	import { ALL_BOARD, resolveSelection, selectionKey } from "./seasons";
	import type { Board } from "./seasons";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	type Row = PlayedGamesRow & { other: number };
	const withOther = (rows: PlayedGamesRow[]): Row[] =>
		rows.map((u) => ({
			...u,
			// Everything that isn't a network duel, a cloud duel, or an FFA:
			// single-player and hotseat/LAN games.
			other: u.total - u.duels_network - u.duels_cloud - u.ffas,
		}));

	// The board in the server's own order, each row carrying its rank.
	//
	// A plain ordinal: the row's position, 1, 2, 3, with nothing shared. This
	// was standard competition ranking (equal totals sharing a rank, 1, 1, 3)
	// on the grounds that a board can't hand out different numbers to players
	// it can't tell apart — and at a season's start, where most of the field
	// sits on one game, that was nearly the whole board. It can tell them
	// apart now: the server breaks a tied total on who reached it first
	// (total_reach, stats/handlers.ts), the same rule the crowns use, so the
	// order is a real one and the numbers on it are earned rather than
	// alphabetical. Sharing a rank would now be the board declining to say
	// something it knows.
	//
	// The rank is computed here, before any sort, and travels on the row: it
	// is the player's standing on this board, not their position in whatever
	// column the table is currently sorted by. Sorting by FFAs and reading
	// 1, 4, 2 down the # column is the point — it says who those players are
	// on the board you are looking at.
	type Ranked = Row & { rank: number };
	const ranked = $derived.by(() =>
		withOther(data.players).map((r, i) => ({ ...r, rank: i + 1 })),
	);

	// Column sorting. Local state rather than a URL param: this page's load
	// re-fetches the board on any URL change — a D1 read and a season_view
	// budget slot, which is why `select` guards a no-op navigation — and a
	// sort only rearranges rows already on screen. Board and season stay in
	// the URL because they change *which* rows those are.
	//
	// Same state shape and toggle rule as the app's other sortable tables
	// (the game-detail tabs' toggleSort, the tournament matches table's
	// toggleMatchSort): the sorted column flips, a new column opens in its
	// own natural direction. Neither of those helpers takes this page's
	// state — both are typed to their own domain's table object, which
	// carries search and filters this board has no equivalent of — so the
	// rule is spelled here as it is there.
	type SortKey = "rank" | "display_name" | FormatKey | "other" | "total";
	// Which way a column reads when you first click it. A count column opens
	// descending — every one of them is an achievement, and the question a
	// board answers is who has the most. Rank and name open ascending, where
	// first and A are the top of the column.
	const OPENS_ASCENDING: SortKey[] = ["rank", "display_name"];
	// The board opens on the order the server sent it in — which is now the
	// # column, not Total. The two used to be the same ordering; they are
	// not any more, because the server settles a tied total on who reached
	// it first and the rank carries that, where a Total sort only sees the
	// number. Opening on Total would put a row the board ranks third at the
	// top of it.
	let sortColumn = $state<SortKey>("rank");
	let sortDirection = $state<"asc" | "desc">("asc");
	function toggleSort(key: SortKey): void {
		if (sortColumn === key) {
			sortDirection = sortDirection === "asc" ? "desc" : "asc";
		} else {
			sortColumn = key;
			sortDirection = OPENS_ASCENDING.includes(key) ? "asc" : "desc";
		}
	}
	const rows = $derived.by(() => {
		const key = sortColumn;
		const dir = sortDirection === "asc" ? 1 : -1;
		return [...ranked].sort((a, b) => {
			if (key === "display_name")
				return dir * a.display_name.localeCompare(b.display_name);
			const by = dir * (a[key] - b[key]);
			if (by !== 0) return by;
			// A counted format's column ties exactly where its crown does, so
			// it breaks the tie the same way: sorting by Network has to open
			// on the player wearing the Network crown, or the column and the
			// card above it name two different leaders. `crownBeats` ranks the
			// whole column, not just its top — every tied group in it is a
			// group that reached the same number, which is the only thing the
			// rule ever asks. Direction flips the counts, never this: the
			// question it answers is who got there first, which reversing
			// would turn into nothing anyone asked.
			if (isFormatKey(key)) {
				if (crownBeats(a, b, key)) return -1;
				if (crownBeats(b, a, key)) return 1;
			}
			// Array.prototype.sort is stable and `ranked` arrives in board
			// order, so everything else keeps its standing within a tie —
			// sorting by Other puts the higher total first.
			return 0;
		});
	});

	// Board navigation: the stepper walks the archive (every season since
	// per-ankh's first) and the switch chooses season-vs-career. The two are
	// independent selections and the URL keeps them in separate params, so
	// moving one leaves the other where it was — switching to the career
	// board and back returns to the season you left, not to today's. Every
	// board this page can show, a past season's crowns included, is linkable
	// forever. Season is the default: the board that resets, so being behind
	// is never more than a few months deep. All-time is the career monument.
	//
	// The vocabulary the URL is written in — ALL_BOARD, and the normalizer
	// both the load and this file read a URL through — lives in ./seasons.
	const currentSlug = $derived(data.seasons[data.seasons.length - 1].slug);
	// The selection a URL names, normalized exactly as the load normalizes it
	// — one shared function (./seasons) rather than a second copy of the
	// rules, so the write guard, the swap check and the load cannot drift.
	const keyOf = (url: URL): string =>
		selectionKey(resolveSelection(url, data.seasons));

	// `data` describes the board on screen, which during a swap is the one
	// being replaced: a navigation is already in flight and `page.url` does
	// not advance until it lands. The controls therefore steer by the URL the
	// page is *heading to*, so a second click while the first is still
	// loading steps a second season rather than recomputing the first — the
	// stepper sits outside the dimmed `.board` and stays clickable throughout,
	// which is the point of leaving it live.
	const liveUrl = $derived(navigating.to?.url ?? page.url);
	const live = $derived(resolveSelection(liveUrl, data.seasons));
	const liveIndex = $derived(
		data.seasons.findIndex((s) => s.slug === live.selected.slug),
	);
	const liveIsCurrent = $derived(liveIndex === data.seasons.length - 1);
	// Whether the season on screen is the current one — the empty state's
	// wording, which describes what is rendered rather than what is coming.
	const isCurrentSeason = $derived(data.selected.slug === currentSlug);
	// One writer for both controls, so neither can drop the other's selection
	// on its way past. Defaults drop their param rather than spelling them
	// out, keeping one canonical URL — and one edge-cache entry — for the
	// default view, as GlobalFacetRow and ScopeRow do.
	function select(board: Board, slug: string): void {
		const url = new URL(liveUrl);
		if (slug === currentSlug) url.searchParams.delete("season");
		else url.searchParams.set("season", slug);
		if (board === "all") url.searchParams.set("board", ALL_BOARD);
		else url.searchParams.delete("board");
		// Re-selecting the view already asked for would spend a D1 read and a
		// per-IP budget slot to fetch back what is already coming — the same
		// guard GlobalFacetRow puts in front of its facet writes.
		if (keyOf(url) === keyOf(liveUrl)) return;
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- search-param-only update on the current route; URL objects are SvelteKit's documented dynamic-nav API
		void goto(url, { noScroll: true });
	}

	// The board switch, as the segmented control the tournament pages use:
	// a lit thumb that slides between two fixed-width cells.
	// Switching to Season returns to whichever season the stepper last
	// selected — the load keeps `selected` meaningful on the career board
	// for exactly this, which is also why the stepper below can go inert
	// there rather than doubling as a way back.
	const BOARDS = [
		{ key: "season", label: "Season" },
		{ key: "all", label: "All time" },
	] as const satisfies readonly { key: Board; label: string }[];
	const boardIndex = $derived(BOARDS.findIndex((b) => b.key === data.board));
	// Segmented-control tokens, matching the tournament stats page's status
	// switch and the matches page's view switch.
	const triggerClass =
		"relative z-10 cursor-pointer whitespace-nowrap px-3 py-1.5 text-center text-xs font-bold text-tan transition-colors disabled:cursor-default disabled:opacity-50";

	// Every board change re-runs the load, so the page keeps showing the
	// outgoing board until the new one lands. Dimming for the duration is the
	// /stats treatment: it says the numbers still on screen belong to the
	// board you just left, and it covers the wait that stepping through the
	// archive would otherwise spend looking unresponsive.
	const isSwapping = $derived.by(() => {
		const to = navigating.to;
		if (!to) return false;
		return keyOf(to.url) !== keyOf(page.url);
	});

	// Crowns of the board — most games played in each format, foursquare-
	// mayor style. One player holds each. A past season's crowns are settled;
	// the current season's and the career board's are up for grabs.
	//
	// They describe whichever board is on screen: switch to All time and the
	// panel crowns careers rather than the season, the way the viewer's tally
	// switches under it. A season panel over career numbers would be naming a
	// season the disabled stepper can't even move off.
	//
	// One entry per counted format, and the table's columns are drawn from it
	// too — header and body cell alike — so a format cannot exist in one and
	// not the other. `header` names the column, where `label` names the crown
	// and its tooltip: the column has room to say which of the two duel modes
	// it counts, and the crown card, already titled "Crowns of …", does not.
	const CROWN_FORMATS = [
		{ key: "duels_network", label: "Network", header: "Network (Duel)" },
		{ key: "duels_cloud", label: "Cloud", header: "Cloud (Duel)" },
		{ key: "ffas", label: "FFA", header: "FFA" },
	] as const;
	type FormatKey = (typeof CROWN_FORMATS)[number]["key"];
	// Whether a sortable column is one of the counted formats — the columns
	// that have a crown, and so the ones whose ties the crown rule settles.
	const isFormatKey = (key: SortKey): key is FormatKey =>
		CROWN_FORMATS.some((f) => f.key === key);
	// A crown holder as the card names them — one face, one name.
	type Holder = Pick<Row, "user_id" | "display_name" | "avatar_url">;
	// Which of two players tied at the top of a format keeps its crown.
	//
	// Whoever reached the number first: `_at` is when the server saw each of
	// them get there (stats/handlers.ts), so the earlier timestamp wins. A
	// season opens with its whole field tied on one game, so this is the
	// common path, not the corner case.
	//
	// Equal timestamps mean one match — the two of them played *each other*,
	// and one upload gave both their count at the same instant — so the game
	// decides itself and `_won` takes it. Beyond that there is nothing left
	// to read: a winnerless duel, or two matches that landed in the same
	// second. The board's own secondary order (the server's `total DESC,
	// display_name ASC`) settles those rather than a second rule.
	const crownBeats = (a: Row, b: Row, key: FormatKey): boolean => {
		const aAt = a[`${key}_at`];
		const bAt = b[`${key}_at`];
		// Null is a format the player has no games in, which a holder of a
		// crown at count > 0 cannot be — guarded so it can never win the
		// comparison by sorting ahead of a real timestamp.
		if (aAt == null || bAt == null) return aAt != null;
		if (aAt !== bAt) return aAt < bAt;
		const aWon = a[`${key}_won`];
		if (aWon !== b[`${key}_won`]) return aWon;
		return a.display_name.localeCompare(b.display_name) < 0;
	};
	const crowns = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- built fresh inside $derived, not mutated after
		const out = new Map<FormatKey, { holder: Holder | null; count: number }>();
		for (const f of CROWN_FORMATS) {
			// One pass for both the number and who holds it: the board is
			// unbounded (every player with a public game is on it), so a max
			// spread into Math.max would pass one argument per row, and a
			// filter-then-reduce would walk it twice. A row at a new high
			// replaces the holder; a row that ties one is put to `crownBeats`.
			let max = 0;
			let best: Ranked | null = null;
			for (const r of ranked) {
				const n = r[f.key];
				if (n === 0) continue;
				if (n > max) {
					max = n;
					best = r;
				} else if (n === max && best !== null && crownBeats(r, best, f.key)) {
					best = r;
				}
			}
			// Every format gets an entry, claimed or not: a crown nobody holds
			// yet is the season's standing invitation, so it is named rather
			// than omitted. A null holder is what `hasCrown` already reads as
			// unclaimed, so no row wears a crown for an empty format.
			out.set(f.key, {
				holder: best
					? {
							user_id: best.user_id,
							display_name: best.display_name,
							avatar_url: best.avatar_url,
						}
					: null,
				count: max,
			});
		}
		return out;
	});
	// The panel's heading and the per-row leader tooltip both name the board
	// being crowned, so a career crown and a season's can't be read for each
	// other — the rule the viewer's tally already follows.
	const crownsHeading = $derived(
		data.board === "all"
			? "Crowns of all time"
			: `Crowns of ${data.selected.label}`,
	);
	const leaderTerm = $derived(
		data.board === "all" ? "All-time leader" : "Season leader",
	);
	const hasCrown = (u: Row, key: FormatKey): boolean =>
		crowns.get(key)?.holder?.user_id === u.user_id;

	// The signed-in viewer's arc, ahead of anyone else's: their cognomen, a
	// count, and a progress bar to the next rung — their own climb, never
	// the summit or the gap to it. A viewer with no games on this board is
	// absent from `rows` — at a season's start that is everyone — so the
	// card is built from a zero total rather than from a row: the arc
	// begins before the first game instead of at it.
	const viewerId = $derived(data.user?.user_id ?? null);
	const viewerIndex = $derived(
		viewerId == null ? -1 : rows.findIndex((r) => r.user_id === viewerId),
	);
	const viewerTotal = $derived(viewerIndex >= 0 ? rows[viewerIndex].total : 0);
	// The board's own rendering of the name once they're on it, so the card
	// and their row never disagree.
	const viewerName = $derived(
		viewerIndex >= 0
			? rows[viewerIndex].display_name
			: (data.user?.display_name ?? ""),
	);
	// The tally names the board it counts, so a career total and a season's
	// can't be read for each other on a page where one switch swaps them.
	const viewerTally = $derived(
		`${viewerTotal} ${viewerTotal === 1 ? "game" : "games"} · ${
			data.board === "all" ? "All time" : data.selected.label
		}`,
	);
	const viewerCognomen = $derived(cognomenOf(viewerTotal));
	const currentRung = $derived(RUNGS.findLast((r) => viewerTotal >= r.games));
	const nextRung = $derived(RUNGS.find((r) => r.games > viewerTotal));
	// Progress within the current rung's span, for the bar — every game
	// played visibly moves it. At zero the bar is empty and the first rung
	// is the whole span.
	const rungProgress = $derived.by(() => {
		if (!nextRung) return 1;
		const floor = currentRung?.games ?? 0;
		return (viewerTotal - floor) / (nextRung.games - floor);
	});

	// The whole row opens the player's profile, not just their name — every
	// cell in it describes that one player, so the name cell was a small
	// target for the only destination the row has.
	//
	// A plain left click only: a modified click is the browser's to handle
	// (new tab, new window, a selection drag), and it still has the name
	// cell's real anchor to handle it with — which is also what keyboard
	// activation follows, so the row needs no key handler of its own. The row
	// carries the same slug the anchor does, so both land on one URL rather
	// than the row taking the permalink's redirect.
	function openProfile(u: Row, e: MouseEvent): void {
		if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- profileHref() returns a resolve() result; lint can't see through the call
		void goto(profileHref(u));
	}

	const num = (n: number) => (n === 0 ? "—" : n.toLocaleString());

	const HEADER_CELL =
		"whitespace-nowrap px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wide text-gray-100";
	const CELL = "px-3 py-2 text-right tabular-nums text-tan";
	// border-separate leaves the <tr> with no continuous box to paint, so each
	// cell paints the row background — and the hover lift has to travel the
	// same way, driven off the row's `group`.
	const ROW_BG = "bg-surface transition-colors group-hover:bg-surface-hover";
</script>

<main class="cloud-scroll flex-1 overflow-y-auto px-4 py-8" use:autohideScroll>
	<div class="mx-auto max-w-3xl">
		<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
			<h1 class="text-2xl font-bold text-gray-200">Players</h1>
			<div class="flex flex-wrap items-center gap-2">
				<!-- Season stepper: chevrons walk the archive, and the label between
				     them names the season they land on. Inert on the career board,
				     which has no season to step through — disabled rather than
				     hidden, so the control keeps its footprint and stays readable as
				     where Season will take you back to. -->
				<div
					class="relative flex w-fit items-center overflow-hidden rounded-lg border-2 border-surface"
					style="background-color: rgb(var(--color-surface));"
					role="group"
					aria-label="Season"
				>
					<button
						type="button"
						class={triggerClass}
						aria-label="Previous season{liveIndex > 0
							? `: ${data.seasons[liveIndex - 1].label}`
							: ''}"
						disabled={live.board === "all" || liveIndex <= 0}
						onclick={() => select(live.board, data.seasons[liveIndex - 1].slug)}
						>‹</button
					>
					<span
						class="whitespace-nowrap px-1 text-xs font-bold text-tan"
						class:opacity-50={data.board === "all"}
					>
						<!-- Every season's label is laid into one grid cell, all but the
						     selected one hidden, so the stepper is as wide as its widest
						     season and stays that width whichever is selected — walking
						     the archive can't shift the chevrons out from under the
						     cursor. Same construct as the /stats facet triggers. -->
						<span class="label-stack">
							{#each data.seasons as s (s.slug)}
								<span class="label-sizer" aria-hidden="true"
									>{s.label} · {s.range}</span
								>
							{/each}
							<span>{data.selected.label} · {data.selected.range}</span>
						</span>
					</span>
					<button
						type="button"
						class={triggerClass}
						aria-label="Next season{!liveIsCurrent
							? `: ${data.seasons[liveIndex + 1].label}`
							: ''}"
						disabled={live.board === "all" || liveIsCurrent}
						onclick={() => select(live.board, data.seasons[liveIndex + 1].slug)}
						>›</button
					>
				</div>
				<!-- Board switch: the season board or the career board, the lit
				     segment sliding across (the tournament stats page's status
				     switch, in the same construct). -->
				<div
					class="relative grid w-fit overflow-hidden rounded-lg border-2 border-surface"
					style="background-color: rgb(var(--color-surface)); grid-template-columns: repeat({BOARDS.length}, minmax(0, 1fr));"
					role="group"
					aria-label="Board"
				>
					<div
						class="pointer-events-none absolute inset-y-0 left-0 transition-transform duration-200 ease-out"
						style:width="{100 / BOARDS.length}%"
						style:background-color="rgb(var(--color-surface-raised))"
						style:transform="translateX({boardIndex * 100}%)"
					></div>
					{#each BOARDS as b (b.key)}
						<button
							type="button"
							class={triggerClass}
							aria-pressed={data.board === b.key}
							onclick={() => select(b.key, live.selected.slug)}
						>
							{b.label}
						</button>
					{/each}
				</div>
			</div>
		</div>

		<div class="board" class:swapping={isSwapping} aria-busy={isSwapping}>
			<!-- The board's format crowns: most games played in each format, one
			     card per crown in the shape the game page's Nations panel uses —
			     a titled panel over raised subpanels. Shown whether or not anyone
			     holds them; a fresh season's board is three open crowns, which is
			     the whole point of the reset. -->
			<div class="mb-4 rounded-lg bg-surface p-4">
				<h3
					class="mb-3 flex items-center justify-between gap-2 text-xs font-bold uppercase tracking-wide text-tan"
				>
					{crownsHeading}
					<PlayersGuide />
				</h3>
				<div class="grid grid-cols-1 gap-3 md:grid-cols-3">
					{#each CROWN_FORMATS as f (f.key)}
						{@const k = crowns.get(f.key)!}
						<!-- Three across starts at md rather than sm because that is where
						     a card is wide enough for the longest name on the board: at sm
						     the card holds ~160px of line and the widest holder line needs
						     ~180px, where md's ~203px (and ~213px at the page's max width)
						     clears it. -->
						<div
							class="min-w-0 rounded-lg bg-surface-raised p-3 text-xs"
							class:opacity-70={k.holder === null}
						>
							<!-- Header: the crown, and what it is the crown of — ranged left
							     under the panel title, which is the line it answers to. -->
							<div class="mb-2 flex items-center gap-1.5">
								<SpriteIcon
									category="yields"
									value="YIELD_LEGITIMACY"
									size={16}
									alt=""
								/>
								<span class="text-sm font-bold text-tan">{f.label}</span>
							</div>
							<!-- Who holds it, centred under the header: face, name, and the
							     count it is held at. A name too long for the card wraps rather
							     than truncating — a crown holder is the last name to
							     abbreviate. -->
							<div
								class="flex min-w-0 items-center justify-center gap-1.5 text-center"
							>
								{#if k.holder === null}
									<span class="text-tan">Unclaimed</span>
								{:else}
									<img
										src={k.holder.avatar_url}
										alt=""
										class="h-4 w-4 shrink-0 rounded-full"
										width="16"
										height="16"
										loading="lazy"
									/>
									<span class="break-words font-semibold text-gray-200"
										>{k.holder.display_name}</span
									>
									<span class="shrink-0 text-tan">({k.count})</span>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			</div>

			{#if data.user}
				<div
					class="mb-4 rounded-lg border border-border-subtle bg-surface p-3 text-sm"
				>
					<div
						class="flex flex-wrap items-center justify-between gap-x-5 gap-y-1"
					>
						<span class="flex items-center gap-1.5 font-bold text-gray-200">
							<img
								src={data.user.avatar_url}
								alt=""
								class="h-5 w-5 shrink-0 rounded-full"
								width="20"
								height="20"
							/>
							{viewerName}
							{#if viewerCognomen}
								<span class="font-semibold italic text-orange"
									>{viewerCognomen}</span
								>
							{/if}
						</span>
						{#if viewerTotal > 0}
							<span class="text-xs text-tan">{viewerTally}</span>
						{/if}
					</div>
					{#if nextRung}
						<!-- Progress to the next cognomen: the bar spans the current
						     rung's range, so every game played visibly moves it. The
						     sentence beside it carries the same reading, so the bar
						     itself is decorative. -->
						<div class="mt-2 flex items-center gap-3">
							<div
								class="h-2 flex-1 overflow-hidden rounded-sm bg-surface-sunken"
								aria-hidden="true"
							>
								<div
									class="h-full rounded-sm bg-orange transition-[width] duration-200 ease-out"
									style="width: {Math.round(rungProgress * 100)}%;"
								></div>
							</div>
							<span class="whitespace-nowrap text-xs text-tan">
								{nextRung.games - viewerTotal}
								{nextRung.games - viewerTotal === 1 ? "game" : "games"} to reach
								<span class="font-semibold italic text-gray-200"
									>{cognomenName(nextRung.type)}</span
								>
							</span>
						</div>
					{:else}
						<!-- Topping the ladder ends nothing: the crowns stay in play
						     every single game. -->
						<div class="mt-1 text-xs text-tan">
							The ladder is yours — now the crowns: every game still counts.
						</div>
					{/if}
				</div>
			{/if}

			{#if rows.length === 0}
				<p class="p-8 text-center text-sm text-tan opacity-70">
					{#if data.board === "all"}
						No public games yet. Upload a save and set it public to open the
						board.
					{:else if isCurrentSeason}
						No games yet this season.
					{:else}
						No games were played in {data.selected.label}.
					{/if}
				</p>
			{:else}
				<div class="overflow-x-auto rounded-lg bg-blue-gray p-3">
					<table class="w-full border-separate border-spacing-y-1.5 text-sm">
						<thead>
							<tr>
								{@render sortHeader("rank", "#", "text-left")}
								{@render sortHeader("display_name", "Player", "text-left")}
								{#each CROWN_FORMATS as f (f.key)}
									{@render sortHeader(f.key, f.header)}
								{/each}
								{@render sortHeader(
									"other",
									"Other",
									"",
									"Single-player and local (hotseat/LAN) games — a local game with 3+ humans counts as an FFA",
								)}
								{@render sortHeader("total", "Total")}
							</tr>
						</thead>
						<tbody>
							{#each rows as u (u.user_id)}
								{@const cognomen = cognomenOf(u.total)}
								{@const you = u.user_id === viewerId}
								<tr
									class="group cursor-pointer"
									onclick={(e) => openProfile(u, e)}
								>
									<td
										class="{CELL} {ROW_BG} rounded-l-lg border-l-2 text-left {you
											? 'border-orange'
											: 'border-transparent'}">{u.rank}</td
									>
									<td class="{ROW_BG} px-3 py-2 text-left">
										<span class="flex items-center gap-1.5">
											<!-- The row handler would otherwise fire behind the
											     anchor and navigate to the same profile twice. -->
											<ProfileLink
												userId={u.user_id}
												slug={u.slug}
												class="flex items-center gap-1.5 font-semibold {you
													? 'text-orange'
													: 'text-gray-200'} transition-colors hover:text-orange"
												onclick={(e) => e.stopPropagation()}
											>
												<img
													src={u.avatar_url}
													alt=""
													class="h-5 w-5 shrink-0 rounded-full"
													width="20"
													height="20"
													loading="lazy"
												/>
												{u.display_name}
											</ProfileLink>
											{#if cognomen}
												<span class="text-xs italic text-tan">{cognomen}</span>
											{/if}
										</span>
									</td>
									{#each CROWN_FORMATS as f (f.key)}
										{@render countCell(u, f.key, f.label)}
									{/each}
									<td class="{CELL} {ROW_BG}">{num(u.other)}</td>
									<td
										class="{CELL} {ROW_BG} rounded-r-lg font-bold text-gray-200"
										>{num(u.total)}</td
									>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>
	</div>
</main>

{#snippet sortHeader(
	key: SortKey,
	label: string,
	align: string = "",
	title: string = "",
)}
	<th
		class="{HEADER_CELL} cursor-pointer transition-colors hover:text-orange {align}"
		title={title || undefined}
		onclick={() => toggleSort(key)}
	>
		<span class="inline-flex items-center gap-1"
			>{label}{#if sortColumn === key}<span class="text-orange"
					>{sortDirection === "asc" ? "↑" : "↓"}</span
				>{/if}</span
		>
	</th>
{/snippet}

<!-- A counted format's cell. The crown gets a fixed slot ahead of the number,
     reserved crowned or not: in the left gutter of a right-aligned column it
     costs space nothing else wants, where a crown trailing the number would
     shove that row's digits off the tabular grid its column sits on and off
     the right edge its header is aligned to. -->
{#snippet countCell(u: Row, key: FormatKey, label: string)}
	<td class="{CELL} {ROW_BG}"
		><span
			class="mr-1 inline-flex w-5 items-center align-middle"
			title={hasCrown(u, key) ? `${leaderTerm} — ${label}` : undefined}
			>{#if hasCrown(u, key)}<SpriteIcon
					category="yields"
					value="YIELD_LEGITIMACY"
					size={14}
					alt={leaderTerm}
				/>{/if}</span
		>{num(u[key])}</td
	>
{/snippet}

<style>
	/* 200ms to match the segmented control's thumb and the tournament view
	   crossfades. */
	.board {
		transition: opacity 200ms ease-out;
	}

	.board.swapping {
		opacity: 0.3;
		/* What's under the fade is the outgoing board — a click would act on
		   numbers that are about to be replaced. */
		pointer-events: none;
	}

	/* Width-stable label: every option stacked in one grid cell, all but the
	   current one hidden, so the control is as wide as its widest option.
	   Same construct as $lib/stats/GlobalFacetRow.svelte's facet triggers
	   (Svelte styles are component-scoped, so it is spelled again here). */
	.label-stack {
		display: grid;
		justify-items: start;
	}

	.label-stack > span {
		grid-area: 1 / 1;
		white-space: nowrap;
	}

	.label-sizer {
		visibility: hidden;
	}
</style>
