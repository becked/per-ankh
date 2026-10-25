<script lang="ts">
	// The map view's chrome, laid over the map in the places Old World's own
	// screen puts them: the yield strip across the top, research at top-right,
	// the leader panel at bottom-left, and the turn controls along the bottom.
	// It shows one player's view at the selected turn; the player switcher,
	// which sits atop the leader panel because everything below it is that
	// player's, changes whose. Its panels, yields and menu icons open the
	// game's analysis tabs, each in a lightbox the page renders (onOpenTab).
	import { Tooltip } from "bits-ui";
	import type { cloudApi } from "$lib/api-cloud";
	import Select from "$lib/ui/Select.svelte";
	import {
		archetypeSpriteKey,
		formatArchetype,
		formatEnum,
		nationName,
		turnCount,
	} from "$lib/utils/formatting";
	import SpriteIcon from "./SpriteIcon.svelte";
	import MapYieldStrip from "./MapYieldStrip.svelte";
	import MapTurnControls from "./MapTurnControls.svelte";
	import { gameTabs, type GameTabId } from "./game-tabs.svelte";
	import {
		findByPlayer,
		rulerCognomen,
		rulerName,
		rulerPortrait,
		techName,
		type DetailPlayer,
	} from "./helpers";
	import {
		CHROME_PANEL_CLASS,
		familyCrestFor,
		hasYieldRates,
		nextDiscovery,
		pointAtTurn,
		rulerAt,
		yieldPointAtTurn,
	} from "./map-chrome";

	let {
		game,
		players,
		playerId = $bindable(),
		selectedTurn,
		onTurnChange,
		onOpenTab,
		showPolitical = $bindable(true),
		showUnits = $bindable(true),
	}: {
		game: Awaited<ReturnType<typeof cloudApi.getGame>>;
		players: DetailPlayer[];
		// Whose view the chrome shows; null only for a game with no players.
		playerId: number | null;
		selectedTurn: number;
		// eslint-disable-next-line no-unused-vars -- Callback type signature
		onTurnChange: (turn: number) => Promise<void> | void;
		// eslint-disable-next-line no-unused-vars -- Callback type signature
		onOpenTab: (tab: GameTabId, openAtYield?: string | null) => void;
		showPolitical?: boolean;
		showUnits?: boolean;
	} = $props();

	const finalTurn = $derived(game.game_details.total_turns);
	const tabs = $derived(gameTabs(game));
	const player = $derived(
		players.find((p) => p.playerId === playerId) ?? players[0],
	);
	const playerOptions = $derived(
		players.map((p) => ({ value: String(p.playerId), label: p.label })),
	);

	// The player's standing at the selected turn; the panel reads legitimacy.
	const standing = $derived.by(() => {
		if (!player) return undefined;
		const history = findByPlayer(
			game.player_history,
			player,
			(h) => h.player_id,
			(h) => h.nation,
		);
		return history ? pointAtTurn(history.history, selectedTurn) : undefined;
	});

	const research = $derived.by(() => {
		if (!player) return null;
		const history = findByPlayer(
			game.tech_discovery_history,
			player,
			(h) => h.player_id,
			(h) => h.nation,
		);
		return nextDiscovery(history, selectedTurn);
	});

	// `characters` is absent from blobs parsed before it existed.
	const ruler = $derived(
		player
			? rulerAt(game.characters ?? [], player.playerId, selectedTurn)
			: null,
	);

	// The ruler as the Leaders tab titles them, "Name the Cognomen" —
	// rulerCognomen carries the game's own article, so it reads straight
	// through. One line here, because the name sits above the portrait on its
	// own rather than as two styled elements.
	const rulerLabel = $derived.by(() => {
		if (!ruler) return null;
		const name = rulerName(ruler) ?? "Unknown";
		const cognomen = rulerCognomen(ruler);
		return cognomen ? `${name} ${cognomen}` : name;
	});

	// The portrait at its native size: every one of the 663 baked portraits is
	// 128x128, so anything else resamples it. The art ships for most but not
	// all rulers — 147 of the 149 reigning rulers across test-data/saves/ —
	// so the frame hangs on rulerPortrait, which is null for the rest, rather
	// than on the id, or it would draw an empty box.
	const PORTRAIT_SIZE = 128;
	const portrait = $derived(ruler ? rulerPortrait(ruler) : null);

	const archetype = $derived(
		ruler?.archetype
			? {
					key: archetypeSpriteKey(ruler.archetype),
					label: formatArchetype(ruler.archetype),
				}
			: null,
	);

	// `families` is absent from blobs parsed before it existed, and a ruler
	// need not have a family at all — 93 of those 149 rulers do.
	const family = $derived.by(() => {
		if (!player || !ruler?.family) return null;
		const crest = familyCrestFor(
			game.families ?? [],
			player.playerId,
			ruler.family,
		);
		return crest ? { crest, label: formatEnum(ruler.family, "FAMILY_") } : null;
	});

	// The four Old World ratings, each granting its own yield (rating.xml:
	// Wisdom→Science, Charisma→Civics, Courage→Training, Discipline→Money).
	// PARSER_VERSION 2.8.0+, so an older blob has none and the row drops out
	// rather than printing four dashes.
	const ratings = $derived(
		ruler
			? [
					{ label: "Wisdom", icon: "RATING_WISDOM", value: ruler.wisdom },
					{ label: "Charisma", icon: "RATING_CHARISMA", value: ruler.charisma },
					{ label: "Courage", icon: "RATING_COURAGE", value: ruler.courage },
					{
						label: "Discipline",
						icon: "RATING_DISCIPLINE",
						value: ruler.discipline,
					},
				].filter((r) => r.value != null)
			: [],
	);

	// Orders at the selected turn: the rate, the same quantity the yield
	// strip's Orders slot shows. The save records no stockpile history, so
	// there is no held total to scrub through (MapYieldStrip says why). Whole,
	// and unsigned — the rail reads as a standing beside legitimacy, not as
	// the strip's signed per-turn delta.
	const orders = $derived.by(() => {
		if (!player) return null;
		const rate = yieldPointAtTurn(
			game.yield_history,
			player,
			"YIELD_ORDERS",
			selectedTurn,
		)?.rate;
		return rate == null ? null : Math.round(rate);
	});

	// The four rail slots share one plate and one glyph size, so the pair on
	// the left lines up with the pair on the right. A plate is a cell of its
	// rail rather than a fixed box: `flex-1` splits the rail over the
	// portrait's full height, which is how the game's own panel stacks them —
	// flush against the art, pinned top and bottom, with a hairline between.
	// Width is cut for the widest value the corpus holds: legitimacy reaches
	// 270 and the orders rate 81 across test-data/saves/, so three digits at
	// the value's own size, and the slot doesn't resize under the pointer as
	// playback runs.
	const RAIL_WIDTH_CLASS = "w-11 flex-none";
	const RAIL_SLOT_CLASS =
		"flex flex-1 flex-col items-center justify-center gap-0.5 bg-surface-deep/80";
	// Sized against the cell rather than against the other chrome glyphs: a
	// rail cell is half the portrait's 128px, and the glyph-over-value pair
	// has to read as one plate's worth of content in it.
	const RAIL_ICON_SIZE = 28;
	// The value a right-rail slot carries, sized as the game sizes it: the
	// loudest thing on the rail, against the 12px ratings row under the frame.
	const RAIL_VALUE_CLASS =
		"text-base font-bold leading-none tabular-nums text-bright";

	const value = (n: number | null | undefined): string =>
		n == null ? "—" : n.toLocaleString("en-US");
</script>

<div class="pointer-events-none absolute inset-0 z-10 flex flex-col gap-3 p-3">
	<!-- Top bar: a menu icon per tab, then the yield strip, the way the game's
	     own bar leads with its menu cluster and carries the yields after it. -->
	<div class="flex flex-wrap items-start gap-3">
		<!-- A glyph alone doesn't say which tab it opens, and the native title's
		     delay and OS styling read as outside the chrome, so the cluster
		     carries the yield strip's tooltip instead. -->
		<Tooltip.Provider delayDuration={200} disableHoverableContent>
			<div
				class="pointer-events-auto flex h-8 items-center gap-0.5 px-1.5 {CHROME_PANEL_CLASS}"
			>
				{#each tabs as tab (tab.id)}
					<Tooltip.Root>
						<Tooltip.Trigger
							class="flex cursor-pointer rounded p-1 transition-colors hover:bg-tan/15"
							onclick={() => onOpenTab(tab.id)}
						>
							<SpriteIcon
								category={tab.icon.category}
								value={tab.icon.value}
								size={16}
								alt={tab.label}
							/>
						</Tooltip.Trigger>
						<Tooltip.Portal>
							<Tooltip.Content
								side="bottom"
								sideOffset={6}
								class="z-50 px-2 py-1 text-xs font-bold text-bright {CHROME_PANEL_CLASS}"
							>
								{tab.label}
							</Tooltip.Content>
						</Tooltip.Portal>
					</Tooltip.Root>
				{/each}
			</div>
		</Tooltip.Provider>
		<!-- A save from before the game recorded yield rates leaves every slot
		     empty, so the strip goes rather than reading as nine dashes — its
		     wrapper with it, or the top bar keeps the gap the strip sat in. -->
		{#if player && hasYieldRates(game.yield_history, player)}
			<div class="pointer-events-auto">
				<MapYieldStrip
					allYields={game.yield_history}
					yieldPrices={game.yield_price_history ?? []}
					playerResources={game.player_resources ?? []}
					{player}
					turn={selectedTurn}
					{finalTurn}
					{onOpenTab}
				/>
			</div>
		{/if}
	</div>

	<div class="relative min-h-0 flex-1">
		{#if player}
			<!-- Research (top-right): the next tech discovered after this turn -->
			{#if research}
				<button
					type="button"
					onclick={() => onOpenTab("techs")}
					class="pointer-events-auto absolute right-0 top-0 flex cursor-pointer items-center gap-1.5 px-2 py-1 text-left transition-colors hover:border-tan {CHROME_PANEL_CLASS}"
				>
					<SpriteIcon
						category="techs"
						value={research.tech}
						size={22}
						alt={techName(research.tech)}
					/>
					<span class="leading-tight">
						<span class="block text-[11px] font-bold text-bright">
							{techName(research.tech)}
						</span>
						<span class="block text-[10px] tabular-nums"
							>{turnCount(research.turns)}</span
						>
					</span>
				</button>
			{/if}

			<!-- Leader (bottom-left): the ruler and the realm's standing at the
			     selected turn, laid out as the game's own leader panel is — who the
			     ruler is on the left rail, what the realm holds on the right, the
			     name above the portrait and the ratings below it. The block is one
			     target for the Leaders tab; nothing inside the panel links anywhere
			     else. The switcher sits on top, because everything under it is that
			     player's. -->
			<div
				class="pointer-events-auto absolute bottom-0 left-0 flex w-max flex-col items-center gap-1.5 p-1.5 {CHROME_PANEL_CLASS}"
			>
				<Select
					value={String(player.playerId)}
					onChange={(v) => {
						if (v != null) playerId = Number(v);
					}}
					options={playerOptions}
					ariaLabel="Player"
					class="w-full"
					compact
					icon={nationCrest}
					matchTriggerWidth
				/>

				{#if ruler}
					<button
						type="button"
						onclick={() => onOpenTab("leaders")}
						class="flex cursor-pointer flex-col items-center gap-1 text-center transition-colors hover:text-bright"
						title="Leaders"
					>
						<span class="block text-sm font-bold leading-tight text-bright">
							{rulerLabel}
						</span>

						<!-- One frame over three columns, the way the game builds its
						     own: the rails sit flush against the art instead of
						     floating beside it, and the ratings run as a band under
						     all three. The frame's fill is what shows through the 1px
						     cell gaps, so the hairlines between the cells are its trim
						     rather than a border per plate — tan/20, the weight the
						     yield strip already divides its slots at. -->
						<span
							class="flex flex-col gap-px overflow-hidden rounded border border-tan/50 bg-tan/20"
						>
							<span class="flex items-stretch gap-px">
								<!-- Left rail: who the ruler is — the archetype above, the
								     family crest below. Both are optional, and 75 of the 149
								     rulers across test-data/saves/ carry exactly one, so the
								     rail renders only what resolves and a lone slot takes
								     the whole column: a cell held open for something the
								     ruler hasn't got would leave a hole in the frame the
								     three columns share. The rails need not match each
								     other — the game's own left rail carries three slots
								     against the right's two. Archetype glyphs come from
								     traits-trimmed, the squared copy that fills its box like
								     the plated icons beside it (#85) — the untrimmed tile
								     reads a size smaller at the same px. -->
								{#if archetype || family}
									<span class="flex flex-col gap-px {RAIL_WIDTH_CLASS}">
										{#if archetype}
											<span class={RAIL_SLOT_CLASS} title={archetype.label}>
												<SpriteIcon
													category="traits-trimmed"
													value={archetype.key}
													size={RAIL_ICON_SIZE}
													alt={archetype.label}
												/>
											</span>
										{/if}
										{#if family}
											<span class={RAIL_SLOT_CLASS} title={family.label}>
												<SpriteIcon
													category="crests"
													value={family.crest}
													size={RAIL_ICON_SIZE}
													alt={family.label}
												/>
											</span>
										{/if}
									</span>
								{/if}

								{#if portrait}
									<span class="flex flex-none">
										<SpriteIcon
											category="portraits"
											value={portrait}
											size={PORTRAIT_SIZE}
											alt={rulerLabel ?? ""}
										/>
									</span>
								{/if}

								<!-- Right rail: what the realm holds at this turn. -->
								<span class="flex flex-col gap-px {RAIL_WIDTH_CLASS}">
									<span class={RAIL_SLOT_CLASS} title="Orders">
										<SpriteIcon
											category="yields"
											value="YIELD_ORDERS"
											size={RAIL_ICON_SIZE}
											alt="Orders"
										/>
										<span class={RAIL_VALUE_CLASS}>{value(orders)}</span>
									</span>
									<span class={RAIL_SLOT_CLASS} title="Legitimacy">
										<SpriteIcon
											category="yields"
											value="YIELD_LEGITIMACY"
											size={RAIL_ICON_SIZE}
											alt="Legitimacy"
										/>
										<span class={RAIL_VALUE_CLASS}>
											{value(standing?.legitimacy)}
										</span>
									</span>
								</span>
							</span>

							{#if ratings.length > 0}
								<span
									class="flex items-center justify-center gap-2 bg-surface-deep/80 py-0.5 text-xs tabular-nums"
								>
									{#each ratings as rating (rating.label)}
										<span class="flex items-center gap-1" title={rating.label}>
											<SpriteIcon
												category="icons"
												value={rating.icon}
												size={14}
												alt={rating.label}
											/>
											{rating.value}
										</span>
									{/each}
								</span>
							{/if}
						</span>
					</button>
				{/if}
			</div>
		{/if}

		<!-- Turn and layer controls (bottom) -->
		<div
			class="pointer-events-auto absolute bottom-0 left-1/2 -translate-x-1/2 px-3 py-1 {CHROME_PANEL_CLASS}"
		>
			<MapTurnControls
				totalTurns={finalTurn}
				{selectedTurn}
				{onTurnChange}
				bind:showPolitical
				bind:showUnits
			/>
		</div>
	</div>
</div>

{#snippet nationCrest(option: string)}
	{@const nation = players.find((p) => String(p.playerId) === option)?.nation}
	{#if nation}
		<span class="flex w-4 flex-none">
			<SpriteIcon
				category="crests"
				value={nation}
				size={16}
				alt={nationName(nation)}
			/>
		</span>
	{/if}
{/snippet}
