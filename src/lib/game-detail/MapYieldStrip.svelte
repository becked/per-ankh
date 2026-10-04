<script lang="ts">
	// The map view's yield strip: the game's top-bar yields for one player at
	// the selected turn, in the bar's own two groups (TOP_BAR_YIELD_GROUPS).
	// Each slot shows the rate alone, signed and colored as the game's does.
	// The game's own slot leads with the stockpile (getYieldStockpileWhole,
	// ClientUI.cs:9591), which we can't follow: the save writes a player's
	// stockpile as one scalar per yield (Player.cs:2559) and no history of it,
	// and a stockpile isn't the running sum of the rate — spending leaves the
	// rate untouched. So the final turn's stockpile and the lifetime total go
	// in the tooltip, each labelled, rather than into a slot whose meaning
	// would change as you scrub. Clicking a slot opens its yield's tab, at
	// that yield: the Yields tab stacks a chart per yield, and the five slots
	// that open it name charts deep in that stack — Food is the eighth of the
	// fourteen, Wood the thirteenth.
	import { Tooltip } from "bits-ui";
	import type { YieldHistory } from "$lib/types/YieldHistory";
	import type { PlayerResourceInfo, YieldPriceEntry } from "$lib/parser/types";
	import SpriteIcon from "./SpriteIcon.svelte";
	import type { GameTabId } from "./game-tabs.svelte";
	import {
		YIELD_CHART_CONFIG,
		cumulativeIsGameTotal,
		type DetailPlayer,
	} from "./helpers";
	import { STOCKPILE_SCALE, pricesByTurn } from "./economy";
	import {
		CHROME_PANEL_CLASS,
		TOP_BAR_YIELD_GROUPS,
		type TopBarYield,
		yieldPointAtTurn,
	} from "./map-chrome";

	let {
		allYields,
		yieldPrices,
		playerResources,
		player,
		turn,
		finalTurn,
		onOpenTab,
	}: {
		allYields: YieldHistory[];
		yieldPrices: YieldPriceEntry[];
		playerResources: PlayerResourceInfo[];
		player: DetailPlayer;
		turn: number;
		finalTurn: number;
		// eslint-disable-next-line no-unused-vars -- Callback type signature
		onOpenTab: (tab: GameTabId, atYield?: string) => void;
	} = $props();

	// Game-wide, so independent of the player and the turn. Only the four
	// commodities the market prices (Food, Iron, Stone, Wood) have a curve.
	const prices = $derived(pricesByTurn(yieldPrices, finalTurn));

	// A yield's name, from the Yields tab's own chart config, so the strip and
	// that tab call a yield the same thing. Every top-bar entry has a
	// config — both are fixed lists — so a miss is a programming error, not a
	// case to fall back on.
	function yieldTitle(yieldType: string): string {
		const config = YIELD_CHART_CONFIG.find((c) => c.yieldType === yieldType);
		if (!config) throw new Error(`no chart config for yield: ${yieldType}`);
		return config.title;
	}

	function slotFor({ yieldType, stockpiled, tab }: TopBarYield) {
		const point = yieldPointAtTurn(allYields, player, yieldType, turn);
		const held = stockpiled
			? playerResources.find(
					(r) =>
						r.player_xml_id === player.playerId && r.yield_type === yieldType,
				)
			: undefined;
		return {
			yieldType,
			tab,
			title: yieldTitle(yieldType),
			rate: point?.rate ?? null,
			total: cumulativeIsGameTotal(allYields, yieldType)
				? (point?.cumulative ?? null)
				: null,
			price: prices.get(yieldType)?.[turn] ?? null,
			stockpile: held != null ? held.amount / STOCKPILE_SCALE : null,
		};
	}

	const groups = $derived(
		TOP_BAR_YIELD_GROUPS.map((group) => group.map(slotFor)),
	);

	// Signed, and whole unless the rate is under 1: the game formats `iRate`
	// (tenths) with its decimal only between ±10, and divides it away above
	// that (ClientUI.cs:9571-9578; YIELDS_MULTIPLIER = 10, Constants.cs:47).
	const rate = (value: number | null): string => {
		if (value == null) return "—";
		const text =
			Math.abs(value) < 1
				? value.toLocaleString("en-US", { maximumFractionDigits: 1 })
				: Math.round(value).toLocaleString("en-US");
		return value > 0 ? `+${text}` : text;
	};
	// The game colors the rate by its sign, zero included
	// (buildColorTextOptionalScope(rate, iRate >= 0), ClientUI.cs:9569).
	const rateColor = (value: number | null): string =>
		value == null ? "text-tan" : value < 0 ? "text-danger" : "text-success";
	const amount = (value: number): string =>
		Math.round(value).toLocaleString("en-US");
	// Prices sit around 2–100 money, so whole numbers would hide their movement.
	const price = (value: number): string => value.toFixed(1);
</script>

<Tooltip.Provider delayDuration={200} disableHoverableContent>
	<!-- Two panels, as the game's bar is: the goods group, then the rates. -->
	<div class="flex items-stretch gap-1">
		{#each groups as group, i (i)}
			<div
				class="flex h-8 items-stretch divide-x divide-tan/20 overflow-hidden {CHROME_PANEL_CLASS}"
			>
				{#each group as slot (slot.yieldType)}
					<Tooltip.Root>
						<Tooltip.Trigger
							class="flex cursor-pointer items-center gap-1.5 px-2 text-left transition-colors hover:bg-tan/15"
							aria-label={slot.title}
							onclick={() => onOpenTab(slot.tab, slot.yieldType)}
						>
							<SpriteIcon category="yields" value={slot.yieldType} size={16} />
							<!-- Width reserved for the widest rate the corpus holds —
							     Money at +3,183, six characters, where every other
							     top-bar yield stays inside four — so a panel doesn't
							     resize under the pointer as playback runs. -->
							<span
								class="min-w-[6ch] whitespace-nowrap text-[11px] font-bold tabular-nums leading-tight {rateColor(
									slot.rate,
								)}"
							>
								{rate(slot.rate)}
							</span>
						</Tooltip.Trigger>
						<Tooltip.Portal>
							<Tooltip.Content
								side="bottom"
								sideOffset={6}
								class="z-50 min-w-40 px-3 py-2 text-xs {CHROME_PANEL_CLASS}"
							>
								<p
									class="mb-1.5 flex items-center gap-1.5 font-bold text-bright"
								>
									<!-- 14 against the header's 12px type, the pairing the
									     ratings row and the city popover's rows already use. -->
									<SpriteIcon
										category="yields"
										value={slot.yieldType}
										size={14}
									/>
									{slot.title}
								</p>
								<dl class="chrome-rows">
									<dt>Per turn</dt>
									<dd class="text-right tabular-nums">{rate(slot.rate)}</dd>
									{#if slot.total != null}
										<dt>Total</dt>
										<dd class="text-right tabular-nums">
											{amount(slot.total)}
										</dd>
									{/if}
									{#if slot.price != null}
										<dt>Market price</dt>
										<dd class="text-right tabular-nums">
											{price(slot.price)}
										</dd>
									{/if}
									{#if slot.stockpile != null}
										<dt>Stockpile, turn {finalTurn}</dt>
										<dd class="text-right tabular-nums">
											{amount(slot.stockpile)}
										</dd>
									{/if}
								</dl>
							</Tooltip.Content>
						</Tooltip.Portal>
					</Tooltip.Root>
				{/each}
			</div>
		{/each}
	</div>
</Tooltip.Provider>
