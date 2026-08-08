<script lang="ts">
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import { resolve } from "$app/paths";
	import type { PlayedGamesRow } from "$lib/api-cloud";
	import { COGNOMEN_LADDER } from "$lib/generated/cognomens";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	// Season is the default — the board that resets, so being behind is
	// never more than a few months deep. All-time is the career monument.
	let view = $state<"season" | "all">("season");

	// Activity epithets from the game's cognomen ladder, one per legitimacy
	// decade in the game's own ascending order (the New is the fresh-ruler
	// epithet at the floor; Able 30 … Magnificent 90). Thresholds are games
	// played in the selected season, on the triangular numbers: each rung
	// costs exactly one game more than the last, so the next epithet always
	// feels one push away. The ladder deliberately stops at the Magnificent
	// (36, ~3 games/week — reached by a handful of real quarters); the Great
	// stays unclaimed, reserved for whatever earns it later (tournaments,
	// ratings), and a weekly player lands the Strong. Absolute thresholds —
	// an epithet can't be lost to someone else's grinding, and any number
	// of players can share one.
	const RUNGS: { games: number; type: string }[] = [
		{ games: 1, type: "COGNOMEN_NEW" },
		{ games: 3, type: "COGNOMEN_ABLE" },
		{ games: 6, type: "COGNOMEN_JUST" },
		{ games: 10, type: "COGNOMEN_GOOD" },
		{ games: 15, type: "COGNOMEN_STRONG" },
		{ games: 21, type: "COGNOMEN_NOBLE" },
		{ games: 28, type: "COGNOMEN_GLORIOUS" },
		{ games: 36, type: "COGNOMEN_MAGNIFICENT" },
	];
	const cognomenName = (type: string): string =>
		COGNOMEN_LADDER.find((c) => c.type === type)?.name ?? "";
	const epithetOf = (total: number): string | null => {
		const rung = [...RUNGS].reverse().find((r) => total >= r.games);
		return rung ? cognomenName(rung.type) : null;
	};

	type Row = PlayedGamesRow & { other: number };
	const withOther = (rows: PlayedGamesRow[]): Row[] =>
		rows.map((u) => ({
			...u,
			// Everything that isn't a network duel, a cloud duel, or an FFA:
			// single-player and hotseat/LAN games.
			other: u.total - u.duels_network - u.duels_cloud - u.ffas,
		}));
	const rows = $derived(
		withOther(view === "season" ? data.season : data.allTime),
	);

	// Season navigation: the picker walks the archive (every season since
	// per-ankh's first), and the slug lives in the URL so a past board —
	// its crowns included — is linkable forever.
	const selectedIndex = $derived(
		data.seasons.findIndex((s) => s.slug === data.selected.slug),
	);
	const isCurrentSeason = $derived(selectedIndex === data.seasons.length - 1);
	function gotoSeason(slug: string): void {
		const url = new URL(page.url);
		url.searchParams.set("s", slug);
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- search-param-only update on the current route; URL objects are SvelteKit's documented dynamic-nav API
		void goto(url, { noScroll: true });
	}

	// Crowns of the season — most games played in each format, foursquare-
	// mayor style. Ties share a crown. A past season's crowns are settled;
	// the current season's are up for grabs.
	const CROWN_FORMATS = [
		{ key: "duels_network", label: "Network" },
		{ key: "duels_cloud", label: "Cloud" },
		{ key: "ffas", label: "FFAs" },
	] as const;
	type FormatKey = (typeof CROWN_FORMATS)[number]["key"];
	const seasonRows = $derived(withOther(data.season));
	const crowns = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- built fresh inside $derived, not mutated after
		const out = new Map<FormatKey, { names: string[]; count: number }>();
		for (const f of CROWN_FORMATS) {
			const max = Math.max(0, ...seasonRows.map((r) => r[f.key]));
			if (max > 0) {
				out.set(f.key, {
					names: seasonRows
						.filter((r) => r[f.key] === max)
						.map((r) => r.display_name),
					count: max,
				});
			}
		}
		return out;
	});
	const hasCrown = (u: Row, key: FormatKey): boolean =>
		view === "season" &&
		(crowns.get(key)?.count ?? 0) > 0 &&
		u[key] === crowns.get(key)!.count;

	// The signed-in viewer's arc, ahead of anyone else's: their epithet, a
	// progress bar to the next one, and the player immediately ahead — the
	// rivalry framing, never the summit.
	const viewerId = $derived(data.user?.user_id ?? null);
	const viewerIndex = $derived(
		viewerId == null ? -1 : rows.findIndex((r) => r.user_id === viewerId),
	);
	const viewer = $derived(viewerIndex >= 0 ? rows[viewerIndex] : null);
	const viewerEpithet = $derived(viewer ? epithetOf(viewer.total) : null);
	const currentRung = $derived(
		viewer ? [...RUNGS].reverse().find((r) => viewer.total >= r.games) : null,
	);
	const nextRung = $derived(
		viewer ? RUNGS.find((r) => r.games > viewer.total) : null,
	);
	// Progress within the current rung's span, for the bar — every game
	// played visibly moves it.
	const rungProgress = $derived.by(() => {
		if (!viewer || !nextRung) return 1;
		const floor = currentRung?.games ?? 0;
		return (viewer.total - floor) / (nextRung.games - floor);
	});
	const rival = $derived(viewerIndex > 0 ? rows[viewerIndex - 1] : null);

	const num = (n: number) => (n === 0 ? "—" : n.toLocaleString());

	const TOGGLE_BASE =
		"rounded px-3 py-1 text-xs font-semibold transition-colors";
	const HEADER_CELL =
		"whitespace-nowrap px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wide text-gray-100";
	const CELL = "px-3 py-2 text-right tabular-nums text-tan";
</script>

<svelte:head>
	<title>{data.selected.label} — Per Ankh</title>
</svelte:head>

<main class="mx-auto w-full max-w-3xl flex-1 overflow-y-auto px-4 pb-10 pt-6">
	<div class="mb-1 flex flex-wrap items-baseline justify-between gap-3">
		<h1 class="text-2xl font-bold text-gray-200">Season</h1>
		<div class="flex items-center gap-2">
			<!-- Season picker: chevrons walk the archive; the label names the
			     selected season. Disabled ends rather than hidden, so the
			     control keeps its footprint. -->
			<div class="flex items-center rounded-lg bg-surface-sunken p-1">
				<button
					type="button"
					class="{TOGGLE_BASE} {selectedIndex > 0
						? 'text-tan hover:text-orange'
						: 'cursor-default text-gray-600'}"
					aria-label="Previous season"
					disabled={selectedIndex <= 0}
					onclick={() => gotoSeason(data.seasons[selectedIndex - 1].slug)}
					>‹</button
				>
				<button
					type="button"
					class="{TOGGLE_BASE} {view === 'season'
						? 'bg-surface text-orange'
						: 'text-tan hover:text-orange'}"
					onclick={() => (view = "season")}
				>
					{data.selected.label} · {data.selected.range}
				</button>
				<button
					type="button"
					class="{TOGGLE_BASE} {!isCurrentSeason
						? 'text-tan hover:text-orange'
						: 'cursor-default text-gray-600'}"
					aria-label="Next season"
					disabled={isCurrentSeason}
					onclick={() => gotoSeason(data.seasons[selectedIndex + 1].slug)}
					>›</button
				>
			</div>
			<div class="flex rounded-lg bg-surface-sunken p-1">
				<button
					type="button"
					class="{TOGGLE_BASE} {view === 'all'
						? 'bg-surface text-orange'
						: 'text-tan hover:text-orange'}"
					onclick={() => (view = "all")}
				>
					All time
				</button>
			</div>
		</div>
	</div>
	<p class="mb-5 text-sm text-tan">
		Games played, by player and category. Wins and losses count the same, and
		any player's upload counts for everyone who played in it.
	</p>

	{#if crowns.size > 0 && view === "season"}
		<!-- The season's format crowns: most games played in each format. -->
		<div
			class="mb-4 flex flex-wrap items-baseline gap-x-6 gap-y-1 rounded-lg bg-surface p-3 text-sm"
		>
			<span class="text-[10px] font-bold uppercase tracking-wide text-tan"
				>Crowns of {data.selected.name}
				{isCurrentSeason ? "(so far)" : data.selected.year}</span
			>
			{#each CROWN_FORMATS as f (f.key)}
				{@const k = crowns.get(f.key)}
				{#if k}
					<span class="text-tan">
						👑 <span class="font-semibold text-gray-200"
							>{k.names.join(" & ")}</span
						>
						— {f.label} ({k.count})
					</span>
				{/if}
			{/each}
		</div>
	{/if}

	{#if viewer && viewerEpithet}
		<div
			class="mb-4 rounded-lg border border-border-subtle bg-surface p-3 text-sm"
		>
			<div class="flex flex-wrap items-baseline gap-x-5 gap-y-1">
				<span class="font-bold text-gray-200">
					{viewer.display_name}
					<span class="font-semibold italic text-orange">{viewerEpithet}</span>
					— {viewer.total}
					{viewer.total === 1 ? "game" : "games"}
					{view === "season" ? `this ${data.selected.name}` : "all time"}
				</span>
				{#if rival}
					<span class="text-tan"
						>{rival.total - viewer.total === 0
							? `tied with ${rival.display_name}`
							: `${rival.total - viewer.total} behind ${rival.display_name}`}</span
					>
				{/if}
			</div>
			{#if nextRung}
				<!-- Progress to the next epithet: the bar spans the current
				     rung's range, so every game played visibly moves it. -->
				<div class="mt-2 flex items-center gap-3">
					<div
						class="h-2 flex-1 overflow-hidden rounded-sm"
						style="background-color: rgb(var(--color-surface-sunken));"
					>
						<div
							class="h-full rounded-sm bg-orange transition-all"
							style="width: {Math.round(rungProgress * 100)}%;"
						></div>
					</div>
					<span class="whitespace-nowrap text-xs text-tan">
						{nextRung.games - viewer.total}
						{nextRung.games - viewer.total === 1 ? "game" : "games"} to become
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

	<div class="overflow-x-auto rounded-lg bg-blue-gray p-3">
		<table class="w-full border-separate border-spacing-y-1.5">
			<thead>
				<tr>
					<th class="{HEADER_CELL} text-left">#</th>
					<th class="{HEADER_CELL} text-left">Player</th>
					<th class={HEADER_CELL}>Duels (Network)</th>
					<th class={HEADER_CELL}>Duels (Cloud)</th>
					<th class={HEADER_CELL}>FFAs</th>
					<th class={HEADER_CELL} title="Single-player and local (hotseat/LAN) games — a local game with 3+ humans counts as an FFA"
						>Other</th
					>
					<th class={HEADER_CELL}>Total</th>
				</tr>
			</thead>
			<tbody>
				{#each rows as u, i (u.user_id)}
					{@const epithet = epithetOf(u.total)}
					{@const you = u.user_id === viewerId}
					<tr class="group">
						<td
							class="{CELL} rounded-l-lg bg-surface text-left {you
								? 'border-l-2 border-orange'
								: ''}">{i + 1}</td
						>
						<td class="bg-surface px-3 py-2 text-left">
							<a
								href={resolve(`/users/${u.user_id}`)}
								class="font-semibold {you
									? 'text-orange'
									: 'text-gray-200'} transition-colors hover:text-orange"
								>{u.display_name}</a
							>
							{#if epithet}
								<span class="text-xs italic text-tan">{epithet}</span>
							{/if}
						</td>
						<td class="{CELL} bg-surface"
							>{num(u.duels_network)}{hasCrown(u, "duels_network")
								? " 👑"
								: ""}</td
						>
						<td class="{CELL} bg-surface"
							>{num(u.duels_cloud)}{hasCrown(u, "duels_cloud") ? " 👑" : ""}</td
						>
						<td class="{CELL} bg-surface"
							>{num(u.ffas)}{hasCrown(u, "ffas") ? " 👑" : ""}</td
						>
						<td class="{CELL} bg-surface">{num(u.other)}</td>
						<td class="{CELL} rounded-r-lg bg-surface font-bold text-gray-200"
							>{u.total}</td
						>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</main>
