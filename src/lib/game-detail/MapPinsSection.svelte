<script lang="ts">
	// Map Pins — a collapsed-by-default section above the Events tab's log,
	// listing every pin the save still carried at its final turn. "Map Pin" is
	// the game's own name for the system (`TEXT_UI_PLACE_MAP_PIN`); a Note is
	// text its author typed, an Improvement pin names what they meant to build.
	//
	// Beside the event log rather than in a tab of its own because a pin is the
	// same row shape the log already renders — a turn, a seat, a line of text —
	// and a fifteenth tab wrapped the strip. It stays a SECTION rather than
	// extra log rows: a pin's turn is a FLOOR on when it was on the map (see
	// PIN_REMOVAL_NOTE) while the log is a complete record, and no one column
	// header can label both honestly.
	//
	// Renders nothing for a game with no pins, which is the gate the `pins` tab
	// carried in GAME_TABS — a blob parsed before 2.30.0 has no `pings` at all,
	// a game nobody pinned has an empty one (55 of the 116 saves in
	// `test-data/saves/`), and a non-owner read of someone else's game can be
	// left with none once the Worker drops every seat but the uploader's
	// (`stripForeignPings`).
	//
	// That leaves one empty state: pins nothing can place. `resolveMapPins`
	// answers null without `map_width`, and drops a pin whose tile the snapshot
	// has no row for. Both are rare — all 116 corpus saves carry root
	// `@_MapWidth` — and neither is a seat the viewer isn't shown.
	//
	// The whole game, never the map's selected turn: both views render a tab the
	// same way (#269), and the analyst view has no turn to read.
	import { Select } from "bits-ui";
	import type { FullGameData } from "$lib/parser/types";
	import { PING_TYPES } from "$lib/generated/ping-types";
	import SpriteIcon from "./SpriteIcon.svelte";
	import TableFilterColumn from "./TableFilterColumn.svelte";
	import { PIN_REMOVAL_NOTE, resolveMapPins, type MapPin } from "./map-pins";
	import {
		type TableState,
		type DetailPlayer,
		TABLE_FRAME_CLASS,
		TABLE_CLASS,
		TABLE_HEADER_TH_CLASS,
		TABLE_CELL_TD_CLASS,
		toggleSort,
	} from "./helpers";

	let {
		game,
		players,
		tableState = $bindable<TableState>({
			search: "",
			sortColumn: "turn",
			sortDirection: "desc",
			filters: [],
		}),
	}: {
		game: Pick<FullGameData, "pings" | "map_tiles" | "game_details">;
		players: DetailPlayer[];
		tableState?: TableState;
	} = $props();

	let open = $state(false);

	// Does the blob carry a pin at all — the question GAME_TABS used to ask
	// before offering the tab, asked here before offering the section.
	const hasPins = $derived((game.pings ?? []).length > 0);

	// Null on a blob whose pins can't be placed; the empty array it becomes is
	// what the note below renders.
	const pins = $derived<MapPin[]>(resolveMapPins(game, players) ?? []);

	const playerById = $derived(new Map(players.map((p) => [p.playerId, p])));

	// The seats that dropped a pin, and the kinds they used — the filter's
	// options, so neither offers a row the table can't show. Kind order is
	// `ping.xml`'s, which is the order the game's own picker lists them in.
	const pinPlayerIds = $derived(new Set(pins.map((p) => p.playerXmlId)));
	const filterablePlayers = $derived(
		players.filter((p) => pinPlayerIds.has(p.playerId)),
	);
	const pinTypes = $derived(new Set(pins.map((p) => p.pingType)));
	const filterableKinds = $derived(
		PING_TYPES.filter((t) => pinTypes.has(t.type)),
	);

	const selectedPlayerIds = $derived(
		tableState.filters
			.filter((f) => f.startsWith("player:"))
			.map((f) => Number(f.replace("player:", ""))),
	);
	const selectedKinds = $derived(
		tableState.filters
			.filter((f) => f.startsWith("kind:"))
			.map((f) => f.replace("kind:", "")),
	);

	// Row-major, so a tile sort reads the way the map does. x and y come off
	// the same tile, so a pin on no tile has neither and sorts last.
	function tileOrder(pin: MapPin): number | null {
		return pin.x === null || pin.y === null ? null : pin.y * 1000 + pin.x;
	}

	const filteredPins = $derived.by(() => {
		const rows = pins.filter((pin) => {
			if (tableState.search) {
				const term = tableState.search.toLowerCase();
				const matches =
					pin.text.toLowerCase().includes(term) ||
					pin.kindName.toLowerCase().includes(term) ||
					pin.ownerLabel.toLowerCase().includes(term);
				if (!matches) return false;
			}
			if (
				selectedPlayerIds.length > 0 &&
				!selectedPlayerIds.includes(pin.playerXmlId)
			) {
				return false;
			}
			if (selectedKinds.length > 0 && !selectedKinds.includes(pin.pingType)) {
				return false;
			}
			return true;
		});

		return [...rows].sort((a, b) => {
			let aVal: string | number | null;
			let bVal: string | number | null;

			switch (tableState.sortColumn) {
				case "kind":
					aVal = a.kindName;
					bVal = b.kindName;
					break;
				case "player":
					aVal = a.ownerLabel;
					bVal = b.ownerLabel;
					break;
				case "tile":
					aVal = tileOrder(a);
					bVal = tileOrder(b);
					break;
				case "note":
					aVal = a.text;
					bVal = b.text;
					break;
				case "turn":
				default:
					aVal = a.turn;
					bVal = b.turn;
			}

			if (aVal == null && bVal == null) return 0;
			if (aVal == null) return 1;
			if (bVal == null) return -1;

			const cmp =
				typeof aVal === "string" && typeof bVal === "string"
					? aVal.localeCompare(bVal)
					: (aVal as number) - (bVal as number);

			return tableState.sortDirection === "asc" ? cmp : -cmp;
		});
	});
</script>

{#snippet sortableTh(key: string, label: string, extra = "", title = "")}
	<th
		class="{TABLE_HEADER_TH_CLASS} {extra}"
		title={title || undefined}
		onclick={() => toggleSort(tableState, key)}
	>
		<span class="inline-flex items-center gap-1">
			{label}
			{#if tableState.sortColumn === key}
				<span class="text-orange"
					>{tableState.sortDirection === "asc" ? "↑" : "↓"}</span
				>
			{/if}
		</span>
	</th>
{/snippet}

{#if hasPins}
	<section class="mb-4">
		<h3 class="mb-2 mt-0">
			<!-- The app's disclosure affordance, as TournamentMapsPanel,
			     MatchPopover and the tournament videos page draw it: one chevron,
			     rotated when open. -->
			<button
				type="button"
				class="flex cursor-pointer items-center gap-2 font-bold text-tan transition-colors hover:text-orange"
				onclick={() => (open = !open)}
				aria-expanded={open}
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-3.5 w-3.5 shrink-0 opacity-70 transition-transform"
					class:rotate-90={open}
					viewBox="0 0 20 20"
					fill="currentColor"
					aria-hidden="true"
				>
					<path
						fill-rule="evenodd"
						d="M7.21 14.77a.75.75 0 010-1.06L10.94 10 7.21 6.29a.75.75 0 111.06-1.06l4.25 4.25a.75.75 0 010 1.06l-4.25 4.25a.75.75 0 01-1.06-.02z"
						clip-rule="evenodd"
					/>
				</svg>
				Map Pins
				{#if pins.length > 0}
					<span class="font-normal text-gray-400">{pins.length}</span>
				{/if}
			</button>
		</h3>

		{#if open}
			{#if pins.length === 0}
				<p class="italic text-tan">
					No map data available for this game, so its pins can't be placed.
				</p>
			{:else}
				<div class={TABLE_FRAME_CLASS}>
					<TableFilterColumn
						bind:search={tableState.search}
						count={`${filteredPins.length} / ${pins.length} pins`}
						chips={tableState.filters.map((f) =>
							f.startsWith("kind:")
								? (PING_TYPES.find((t) => t.type === f.replace("kind:", ""))
										?.name ?? "")
								: (playerById.get(Number(f.replace("player:", "")))?.label ??
									""),
						)}
					>
						{#snippet filters()}
							<Select.Root type="multiple" bind:value={tableState.filters}>
								<Select.Trigger
									class="flex w-full cursor-pointer items-center justify-between rounded border border-black bg-surface-raised px-2 py-1.5 text-xs text-tan"
								>
									<span class="truncate">Filter</span>
									<span class="ml-2 text-tan opacity-60">▼</span>
								</Select.Trigger>
								<Select.Portal>
									<Select.Content
										class="z-50 max-h-64 overflow-y-auto rounded bg-surface-sunken shadow-lg"
									>
										<Select.Viewport>
											{#if filterablePlayers.length > 0}
												<Select.Group>
													<Select.GroupHeading
														class="border-b border-surface px-3 py-2 text-xs font-bold uppercase tracking-wide text-tan"
													>
														Players
													</Select.GroupHeading>
													{#each filterablePlayers as player (player.playerId)}
														<Select.Item
															value={`player:${player.playerId}`}
															label={player.label}
															class="flex cursor-pointer items-center justify-between px-3 py-2 text-sm text-tan hover:bg-surface-raised data-[highlighted]:bg-surface-raised"
														>
															{#snippet children({ selected })}
																{player.label}
																{#if selected}
																	<span class="font-bold text-orange">✓</span>
																{/if}
															{/snippet}
														</Select.Item>
													{/each}
												</Select.Group>
											{/if}

											{#if filterableKinds.length > 0}
												<Select.Group>
													<Select.GroupHeading
														class="border-b border-surface px-3 py-2 text-xs font-bold uppercase tracking-wide text-tan {filterablePlayers.length >
														0
															? 'border-t border-surface'
															: ''}"
													>
														Kinds
													</Select.GroupHeading>
													{#each filterableKinds as kind (kind.type)}
														<Select.Item
															value={`kind:${kind.type}`}
															label={kind.name}
															class="flex cursor-pointer items-center justify-between px-3 py-2 text-sm text-tan hover:bg-surface-raised data-[highlighted]:bg-surface-raised"
														>
															{#snippet children({ selected })}
																{kind.name}
																{#if selected}
																	<span class="font-bold text-orange">✓</span>
																{/if}
															{/snippet}
														</Select.Item>
													{/each}
												</Select.Group>
											{/if}
										</Select.Viewport>
									</Select.Content>
								</Select.Portal>
							</Select.Root>
						{/snippet}
					</TableFilterColumn>

					<div class="min-w-0 flex-1 overflow-x-auto">
						<table class={TABLE_CLASS}>
							<thead>
								<tr>
									{@render sortableTh(
										"turn",
										"Turn",
										"rounded-l-lg border-l",
										PIN_REMOVAL_NOTE,
									)}
									{@render sortableTh("kind", "Kind")}
									{@render sortableTh("player", "Player")}
									{@render sortableTh("tile", "Tile")}
									{@render sortableTh("note", "Note", "rounded-r-lg border-r")}
								</tr>
							</thead>
							<tbody>
								{#each filteredPins as pin (pin.key)}
									<tr class="group">
										<td
											class="{TABLE_CELL_TD_CLASS} whitespace-nowrap rounded-l-lg tabular-nums"
											title={PIN_REMOVAL_NOTE}>{pin.turn}+</td
										>
										<td class={TABLE_CELL_TD_CLASS}>
											<span class="inline-flex items-center gap-2">
												<!-- Fixed-size slot whether or not the glyph resolves:
												     SpriteIcon renders nothing when the sprite is
												     missing, and a note has none at all, so the column
												     would otherwise unalign (the BuildComparison
												     idiom). -->
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
												<span class="whitespace-nowrap">{pin.kindName}</span>
											</span>
										</td>
										<td
											class="{TABLE_CELL_TD_CLASS} whitespace-nowrap"
											style="color: {pin.ownerColor};">{pin.ownerLabel}</td
										>
										<td
											class="{TABLE_CELL_TD_CLASS} whitespace-nowrap tabular-nums"
											title={pin.x === null
												? "This pin names no tile."
												: undefined}
											>{pin.x === null ? "—" : `${pin.x}, ${pin.y}`}</td
										>
										<td
											class="{TABLE_CELL_TD_CLASS} whitespace-pre-line rounded-r-lg"
											class:italic={pin.isFallback}
											class:text-gray-400={pin.isFallback}>{pin.text}</td
										>
									</tr>
								{:else}
									<tr>
										<td colspan="5" class="p-8 text-center italic text-tan">
											No pins match filters
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</div>
			{/if}
		{/if}
	</section>
{/if}
