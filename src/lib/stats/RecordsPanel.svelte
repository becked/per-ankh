<script lang="ts">
	// "Records": the leaderboard behind the yield bands — for each series, the
	// biggest numbers anyone has posted, linked to the game they were posted in.
	//
	// Two selectors, because the same series has seven honest answers and they
	// disagree:
	//
	//   Best ever / End of game favour long matches — yields compound, so these
	//   are partly a "who played the most turns" board. Kept because they're the
	//   ones people actually ask for, and sat beside the checkpoints so nobody
	//   mistakes them for a like-for-like comparison.
	//
	//   T20 / T40 / T60 / T80 / T100 compare everyone who reached that turn AT
	//   that turn, the only length-blind boards of the seven.
	//
	// A row names one player: the one who set the record. Duel, FFA and
	// single-player rows are therefore the same shape, with no per-mode branch —
	// the alternative renders a single-player game as six crests on a line.
	import { Toolbar } from "bits-ui";
	import { resolve } from "$app/paths";
	import SpriteIcon from "$lib/game-detail/SpriteIcon.svelte";
	import { nationName } from "$lib/utils/formatting";
	import { YIELD_SERIES } from "./charts/yields";
	import type { RecordsBundle } from "./types";

	// The panel fetches its own payload: the records are ~60-70 KB gzipped and
	// only this tab reads them, so they have their own endpoint per surface
	// (GET /v1/stats/records and siblings) instead of riding the bundle.
	//
	// `load` is the caller's closure over its own selection — build it with
	// $derived.by reading the selection eagerly, so a facet or scope change
	// produces a new closure and the effect below refetches. `active` is the
	// gate: bits-ui keeps inactive Tabs.Content mounted and merely hidden, so
	// mounting is not the signal that a tab was opened.
	//
	// toolbarFlush pulls the sticky toolbar out of a container's px-4, exactly
	// as it does on the sibling panels — StatsView pads its tab content and
	// opts in, an unpadded caller leaves it off.
	let {
		load,
		active,
		countLabel,
		toolbarFlush = false,
	}: {
		load: () => Promise<RecordsBundle>;
		active: boolean;
		countLabel?: string;
		toolbarFlush?: boolean;
	} = $props();

	let payload = $state<RecordsBundle | null>(null);
	let failed = $state(false);
	// The closure the payload in hand came from. One fetch per selection, so
	// leaving the tab and coming back reads nothing — the panel is mounted the
	// whole time either way, and a second read of the same key would spend the
	// budget the split exists to save. A failed fetch leaves this null, so
	// reopening the tab retries.
	let loadedFrom = $state<(() => Promise<RecordsBundle>) | null>(null);

	$effect(() => {
		// All three read unconditionally: an early return past `load` would
		// leave it untracked, and a later selection change would never refetch.
		const fetchRecords = load;
		const open = active;
		const inHand = loadedFrom;
		if (!open || inHand === fetchRecords) return;

		let current = true;
		payload = null;
		failed = false;
		fetchRecords()
			.then((r) => {
				if (!current) return;
				payload = r;
				loadedFrom = fetchRecords;
			})
			.catch(() => {
				if (current) failed = true;
			});
		// A selection changed while its fetch was in flight — drop the answer
		// rather than let it land under the new selection's toolbar.
		return () => {
			current = false;
		};
	});

	// Same tokens as YieldsStatsPanel's toolbar, which carries the same
	// per-turn / cumulative choice one tab over.
	const itemClass =
		"px-2.5 py-1 text-xs text-tan transition-colors data-[state=off]:bg-surface data-[state=on]:bg-surface-raised";

	const WHENS = [
		{ key: "peak", label: "Best ever" },
		{ key: "final", label: "End of game" },
		{ key: "t20", label: "At T20" },
		{ key: "t40", label: "At T40" },
		{ key: "t60", label: "At T60" },
		{ key: "t80", label: "At T80" },
		{ key: "t100", label: "At T100" },
	] as const;

	let measure = $state<"rate" | "cum">("rate");
	let when = $state<(typeof WHENS)[number]["key"]>("peak");

	const boardCount = $derived(payload?.recordCounts[when] ?? 0);
	// On a checkpoint board every row shares the same turn, so it belongs in
	// the card's header once rather than down the whole column. Peak and
	// end-of-game rows each have their own turn and keep it.
	const fixedTurn = $derived(
		when.startsWith("t") ? Number(when.slice(1)) : null,
	);

	// The seat that set the record. The save's handle when it has one, else the
	// nation — the same fallback RecentSaveCard's winner label makes, and by
	// truthiness for the same reason: a single-player save records the human
	// seat's player_name as "", not null, so `??` would print an empty row.
	function holder(
		gameId: string,
		playerIndex: number,
	): { nation: string | null; label: string } {
		const seat = payload?.recordGames[gameId]?.seats[playerIndex];
		return {
			nation: seat?.nation ?? null,
			label: seat?.name || (seat?.nation ? nationName(seat.nation) : "?"),
		};
	}

	type Series = (typeof YIELD_SERIES)[number];
	function card(series: Series) {
		const cum = measure === "cum";
		// Military power and legitimacy are levels, not flows — the aggregate
		// ships them no cumulative board rather than mirroring the rate one, so
		// an absent board is the signal to drop the card. Keeping a list of
		// which series are levels here would be the same fact in two places.
		const key = cum ? `${series.key}:cum` : series.key;
		return {
			...series,
			// What the cumulative column means for this series, from the one
			// list that holds that fact (YIELD_SERIES).
			note: cum ? series.cumulative : null,
			rows: payload?.records[key]?.[when] ?? [],
		};
	}

	// Flat, in YIELD_SERIES order — the order the Yields tab stacks its charts,
	// so the same series sit in the same places one tab over.
	const cards = $derived(
		YIELD_SERIES.map(card).filter((c) => c.rows.length > 0),
	);

	const fmt = (v: number): string =>
		Math.abs(v) >= 1000
			? Math.round(v).toLocaleString("en-US")
			: (Math.round(v * 10) / 10).toString();
</script>

{#if failed}
	<p class="p-8 text-center italic text-brown">Couldn't load records.</p>
{:else if payload === null}
	<p class="p-8 text-center italic text-brown">Loading records…</p>
{:else if cards.length === 0 && boardCount === 0}
	<p class="p-8 text-center italic text-brown">No record data available.</p>
{:else}
	<section class="mb-6">
		<Toolbar.Root
			class="sticky top-1 z-10 mb-3 flex w-fit flex-wrap items-center gap-3 rounded-lg border border-surface bg-surface-sunken p-2 shadow-lg {toolbarFlush
				? '-ml-4'
				: ''}"
		>
			<Toolbar.Group
				type="single"
				value={measure}
				onValueChange={(v: string) => {
					if (v) measure = v as "rate" | "cum";
				}}
				class="flex overflow-hidden rounded"
			>
				<Toolbar.GroupItem value="rate" class="rounded-l {itemClass}">
					Per Turn
				</Toolbar.GroupItem>
				<Toolbar.GroupItem value="cum" class="rounded-r {itemClass}">
					Cumulative
				</Toolbar.GroupItem>
			</Toolbar.Group>

			<Toolbar.Group
				type="single"
				value={when}
				onValueChange={(v: string) => {
					if (v) when = v as (typeof WHENS)[number]["key"];
				}}
				class="flex overflow-hidden rounded"
			>
				{#each WHENS as w, i (w.key)}
					<Toolbar.GroupItem
						value={w.key}
						class="{i === 0 ? 'rounded-l' : ''} {i === WHENS.length - 1
							? 'rounded-r'
							: ''} {itemClass}"
					>
						{w.label}
					</Toolbar.GroupItem>
				{/each}
			</Toolbar.Group>
		</Toolbar.Root>

		{#if boardCount > 0}
			<p class="mb-3 text-xs text-brown">
				{boardCount.toLocaleString("en-US")}
				{countLabel ?? "Games"}
			</p>
		{/if}

		{#if cards.length === 0}
			<p class="p-8 text-center italic text-brown">
				No records on this board yet.
			</p>
		{:else}
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
				{#each cards as card (card.key)}
					<div class="rounded-lg bg-surface p-3">
						<div class="mb-2 flex items-baseline justify-between gap-2">
							<span class="flex items-baseline gap-2">
								<span class="text-sm font-bold" style="color: {card.color};"
									>{card.label}</span
								>
								{#if fixedTurn != null}
									<span class="text-xs tabular-nums text-brown"
										>T{fixedTurn}</span
									>
								{/if}
							</span>
							{#if card.note}
								<span class="text-xs text-tan">{card.note}</span>
							{/if}
						</div>
						<ol class="text-xs">
							{#each card.rows as row, i (row.game_id + row.player_index)}
								{@const seat = holder(row.game_id, row.player_index)}
								<li class="flex items-baseline gap-2 py-0.5">
									<span class="w-4 shrink-0 text-right text-brown">{i + 1}</span
									>
									<a
										class="flex min-w-0 flex-1 items-baseline gap-1.5 truncate text-tan hover:underline"
										href={resolve("/games/[id]", { id: row.game_id })}
										title="T{row.turn} of {payload.recordGames[row.game_id]
											?.turns ?? '?'} — open the game"
									>
										{#if seat.nation}
											<SpriteIcon
												category="crests"
												value={seat.nation}
												size={12}
												alt={seat.nation}
											/>
										{/if}
										<span class="truncate">{seat.label}</span>
									</a>
									{#if fixedTurn == null}
										<span class="shrink-0 tabular-nums text-brown"
											>T{row.turn}</span
										>
									{/if}
									<span class="shrink-0 font-bold tabular-nums text-tan"
										>{fmt(row.value)}</span
									>
								</li>
							{/each}
						</ol>
					</div>
				{/each}
			</div>
		{/if}
	</section>
{/if}
