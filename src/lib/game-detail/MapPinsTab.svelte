<script lang="ts">
	// Map Pins tab — every pin the save still carried at its final turn, newest
	// first. "Map Pin" is the game's own name for the system; a Note is text
	// its author typed, an Improvement pin names what they meant to build.
	//
	// A gated tab: `GAME_TABS` hides it on a game with no pins to list, the way
	// Leaders is hidden on a game with no rulers. The gate reads the blob the
	// viewer was SERVED, so a non-owner whose read `stripForeignPings` left
	// empty never reaches this component at all. What it does not cover is a
	// blob whose pins nothing can place: `resolveMapPins` answers null without
	// `map_width`, and drops a pin whose tile the snapshot has no row for — so
	// pins plus no usable map leaves the list empty, which is the one empty
	// state below. Both arms are rare (all 116 saves in `test-data/saves/`
	// carry root `@_MapWidth`), and neither is a seat the viewer isn't shown.
	//
	// The whole game, never the map's selected turn: both views render a tab
	// the same way (#269), and the analyst view has no turn to read.
	import SpriteIcon from "./SpriteIcon.svelte";
	import { type DetailPlayer } from "./helpers";
	import { PIN_REMOVAL_NOTE, resolveMapPins, type MapPin } from "./map-pins";
	import type { FullGameData } from "$lib/parser/types";

	let {
		game,
		players,
	}: {
		game: Pick<FullGameData, "pings" | "map_tiles" | "game_details">;
		players: DetailPlayer[];
	} = $props();

	// Null on the blob the header describes — pins the grid can't place. The
	// empty array it becomes is what the `{:else}` below renders.
	const pins = $derived<MapPin[]>(resolveMapPins(game, players) ?? []);

	// One group per seat, in roster order, so a pin's author is a heading
	// rather than a repeated cell. A seat the roster has no row for keeps the
	// label `resolveMapPins` gave it and sorts after the rest.
	const groups = $derived.by(() => {
		const order = new Map(players.map((p, i) => [p.playerId, i]));
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- locally-scoped Map, not reactive state
		const byPlayer = new Map<number, MapPin[]>();
		for (const pin of pins) {
			const list = byPlayer.get(pin.playerXmlId);
			if (list) list.push(pin);
			else byPlayer.set(pin.playerXmlId, [pin]);
		}
		return [...byPlayer.entries()]
			.map(([playerXmlId, list]) => ({
				playerXmlId,
				label: list[0].ownerLabel,
				color: list[0].ownerColor,
				pins: list,
			}))
			.sort(
				(a, b) =>
					(order.get(a.playerXmlId) ?? players.length) -
					(order.get(b.playerXmlId) ?? players.length),
			);
	});
</script>

<div class="flex flex-col gap-4">
	{#each groups as group (group.playerXmlId)}
		<section class="rounded-lg bg-surface p-3">
			<h2 class="mb-3 text-base font-bold" style="color: {group.color};">
				{group.label}
				<span class="font-normal text-gray-400"
					>· {group.pins.length}
					{group.pins.length === 1 ? "pin" : "pins"}</span
				>
			</h2>
			<ul class="flex flex-col gap-1.5">
				{#each group.pins as pin (pin.key)}
					<li
						class="flex items-start gap-3 rounded bg-surface-deep px-3 py-1.5 text-sm"
					>
						<span
							class="w-12 flex-none text-right text-xs tabular-nums text-gray-400"
							title={PIN_REMOVAL_NOTE}>T{pin.turn}+</span
						>
						<!-- Fixed-size slot whether or not the glyph resolves:
						     SpriteIcon renders nothing when the sprite is missing,
						     and a note has none at all, so the column would
						     otherwise unalign (the BuildComparison idiom). -->
						<span class="flex w-4 flex-none justify-center">
							{#if pin.improvementSprite}
								<SpriteIcon
									category="improvements"
									value={pin.improvementSprite}
									size={16}
									alt={pin.kindName}
								/>
							{/if}
						</span>
						<span
							class="w-16 flex-none text-xs tabular-nums text-gray-400"
							title={pin.x === null ? "This pin names no tile." : undefined}
							>{pin.x === null ? "—" : `${pin.x}, ${pin.y}`}</span
						>
						<span
							class="min-w-0 flex-1 whitespace-pre-line"
							class:italic={pin.isFallback}
							class:text-gray-400={pin.isFallback}>{pin.text}</span
						>
					</li>
				{/each}
			</ul>
		</section>
	{:else}
		<p class="italic text-tan">
			No map data available for this game, so its pins can't be placed.
		</p>
	{/each}
</div>
