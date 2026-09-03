<script lang="ts">
	// "Records": the leaderboard behind the yield bands — for each series, the
	// player-games holding the biggest numbers, linked to the game.
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
	// The cumulative measure means two different things depending on the series
	// and the card says which — see SPENDABLE.
	import { Toolbar } from "bits-ui";
	import { resolve } from "$app/paths";
	import SpriteIcon from "$lib/game-detail/SpriteIcon.svelte";
	import { nationName } from "$lib/utils/formatting";
	import { YIELD_SERIES } from "./charts/yields";
	import type { ChartBundleCore } from "./types";

	// toolbarFlush pulls the sticky toolbar out of a container's px-4, exactly
	// as it does on the sibling panels — StatsView pads its tab content and
	// opts in, an unpadded caller leaves it off.
	let {
		bundle,
		toolbarFlush = false,
	}: { bundle: ChartBundleCore; toolbarFlush?: boolean } = $props();

	// Same tokens as YieldsStatsPanel's toolbar, which carries the same
	// per-turn / cumulative choice one tab over.
	const itemClass =
		"px-2.5 py-1 text-xs text-tan transition-colors data-[state=off]:bg-surface data-[state=on]:bg-surface-raised";

	// Which of the game's yields are spent, and so carry a stockpile rather
	// than a production total. Everything else only ever climbs.
	//
	// Established from the corpus, not from the manual: over the local
	// game_player_turn rows, money / food / iron / stone / wood / training /
	// civics all have turns where the cumulative column DROPS (wood 34,287
	// times, civics 816, training 474), while science, culture, orders and
	// growth never once decrease. A column that can fall is a stockpile.
	const SPENDABLE = new Set([
		"money_per_turn",
		"food_per_turn",
		"iron_per_turn",
		"stone_per_turn",
		"wood_per_turn",
		"training_per_turn",
		"civics_per_turn",
	]);

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

	const boardCount = $derived(bundle.recordCounts[when] ?? 0);
	// On a checkpoint board every row shares the same turn, so it belongs in
	// the card's header once rather than down the whole column. Peak and
	// end-of-game rows each have their own turn and keep it.
	const fixedTurn = $derived(
		when.startsWith("t") ? Number(when.slice(1)) : null,
	);

	// The record holder first and emphasised, then the rest of the table — a
	// row has to say which side of the game posted the number, and in a duel
	// "Assyria vs Kush" alone doesn't.
	function seats(
		gameId: string,
		playerIndex: number,
	): { holder: boolean; nation: string | null; label: string }[] {
		const all = bundle.recordGames[gameId]?.seats ?? {};
		const rows = Object.entries(all).map(([i, seat]) => ({
			index: Number(i),
			holder: Number(i) === playerIndex,
			nation: seat.nation,
			// The save's handle when it has one, else the nation — an AI seat
			// and an unnamed save both land on the latter.
			label: seat.name ?? (seat.nation ? nationName(seat.nation) : "?"),
		}));
		return [
			...rows.filter((r) => r.holder),
			...rows.filter((r) => !r.holder).sort((a, b) => a.index - b.index),
		];
	}

	// Groups follow the game's own reading of its yields, in the Yields tab's
	// order within each: what an empire produces, what it stockpiles, what it
	// costs, and where it stands.
	const GROUPS: { title: string; keys: string[] }[] = [
		{
			title: "Output",
			keys: [
				"science_per_turn",
				"civics_per_turn",
				"training_per_turn",
				"growth_per_turn",
				"culture_per_turn",
				"orders_per_turn",
			],
		},
		{
			title: "Resources",
			keys: [
				"money_per_turn",
				"food_per_turn",
				"iron_per_turn",
				"stone_per_turn",
				"wood_per_turn",
			],
		},
		{ title: "Standing", keys: ["military_power", "legitimacy"] },
	];

	const byKey = $derived(
		new Map(YIELD_SERIES.map((s) => [s.key as string, s])),
	);
	const groups = $derived(
		GROUPS.map((group) => ({
			title: group.title,
			cards: group.keys
				.flatMap((k) => {
					const series = byKey.get(k);
					return series ? [card(series)] : [];
				})
				.filter((c) => c.rows.length > 0),
		})).filter((g) => g.cards.length > 0),
	);
	type Series = (typeof YIELD_SERIES)[number];
	function card(series: Series) {
		const cum = measure === "cum";
		// Military power and legitimacy are levels, not flows — the aggregate
		// ships them no cumulative board rather than mirroring the rate one, so
		// an absent board is the signal to drop the card. Keeping a list of
		// which series are levels here would be the same fact in two places.
		const key = cum ? `${series.key}:cum` : series.key;
		const rows = bundle.records[key]?.[when] ?? [];
		return {
			...series,
			note: cum ? (SPENDABLE.has(series.key) ? "held" : "produced") : null,
			rows,
		};
	}

	const fmt = (v: number): string =>
		Math.abs(v) >= 1000
			? Math.round(v).toLocaleString("en-US")
			: (Math.round(v * 10) / 10).toString();
</script>

{#if Object.keys(bundle.records).length > 0}
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
			<p class="mb-3 text-xs text-gray-400">
				{boardCount.toLocaleString("en-US")} player-games
			</p>
		{/if}
		{#each groups as group (group.title)}
			<div class="mb-4">
				<div
					class="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400"
				>
					{group.title}
				</div>
				<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
					{#each group.cards as card (card.key)}
						<div class="rounded-lg bg-surface p-3">
							<div class="mb-1 flex items-baseline justify-between gap-2">
								<span class="flex items-baseline gap-1.5">
									<span class="text-xs font-bold" style="color: {card.color};"
										>{card.label}</span
									>
									{#if fixedTurn != null}
										<span class="text-[10px] tabular-nums text-gray-500"
											>T{fixedTurn}</span
										>
									{/if}
								</span>
								{#if card.note}
									<span
										class="text-[10px] uppercase tracking-wide text-gray-400"
										>{card.note}</span
									>
								{/if}
							</div>
							<ol class="text-xs">
								{#each card.rows as row, i (row.game_id + row.player_index)}
									<li class="flex items-baseline gap-2 py-0.5">
										<span class="w-4 shrink-0 text-right text-gray-500"
											>{i + 1}</span
										>
										<a
											class="flex min-w-0 flex-1 items-baseline gap-1 truncate text-gray-400 hover:underline"
											href={resolve("/games/[id]", { id: row.game_id })}
											title="T{row.turn} of {bundle.recordGames?.[row.game_id]
												?.turns ?? '?'} — open the game"
										>
											{#each seats(row.game_id, row.player_index) as seat, si (seat.label + si)}
												{#if si > 0}<span class="text-brown">v</span>{/if}
												{#if seat.nation}
													<SpriteIcon
														category="crests"
														value={seat.nation}
														size={12}
														alt={seat.nation}
													/>
												{/if}
												<span
													class={seat.holder
														? "font-semibold text-tan"
														: "text-gray-500"}>{seat.label}</span
												>
											{/each}
										</a>
										{#if fixedTurn == null}
											<span class="shrink-0 tabular-nums text-gray-500"
												>T{row.turn}</span
											>
										{/if}
										<span class="shrink-0 font-semibold tabular-nums text-tan"
											>{fmt(row.value)}</span
										>
									</li>
								{/each}
							</ol>
						</div>
					{/each}
				</div>
			</div>
		{/each}
	</section>
{/if}
