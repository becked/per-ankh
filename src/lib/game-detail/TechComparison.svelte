<script lang="ts">
	import type { PlayerTech } from "$lib/types/PlayerTech";
	import type { TechDiscoveryHistory } from "$lib/types/TechDiscoveryHistory";
	import { Tooltip } from "bits-ui";
	import { formatEnum } from "$lib/utils/formatting";
	import { TECH_NAMES } from "$lib/generated/tech-names";
	import { TECH_LAWS } from "$lib/generated/science-yields";
	import SpriteIcon from "./SpriteIcon.svelte";
	import {
		type DetailPlayer,
		ownedByPlayer,
		findByPlayer,
		buildOwttUrl,
	} from "./helpers";

	// Side-by-side tech timeline (owglick's "tech — turn by turn" view): one
	// row per turn anyone completed a tech, one column per player, each cell
	// stacking that turn's techs as plain text. A tech everyone researched (and
	// any bonus-card tech) sits in the page's default color; a player's color =
	// not everyone has it (often solo). A trailing law icon marks a tech that
	// unlocks a law pair. Hovering a shared tech turns it gold down every
	// column, so pacing gaps on the same tech read at a glance.
	let {
		players,
		completedTechs,
		techDiscoveryHistory,
	}: {
		// Uploader-first ordered (the caller applies the shared rule).
		players: DetailPlayer[];
		completedTechs: PlayerTech[];
		// Research order feeding each player's tech-tree planner deep link.
		techDiscoveryHistory: TechDiscoveryHistory[];
	} = $props();

	const techName = (tech: string) =>
		TECH_NAMES[tech] ?? formatEnum(tech, "TECH_");

	type Cell = {
		tech: string;
		bonus: boolean;
		laws: readonly string[];
		// Researched by every player in the game.
		shared: boolean;
	};

	// Per-player tech lists (id match, nation fallback — shared idiom).
	const byPlayer = $derived(
		players.map((player) => ({
			player,
			techs: ownedByPlayer(
				completedTechs,
				player,
				(t) => t.player_id,
				(t) => t.nation,
			),
		})),
	);

	// How many players researched each tech — drives the shared (gold) flag.
	const ownerCounts = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, not reactive state
		const counts = new Map<string, number>();
		for (const { techs } of byPlayer) {
			for (const t of techs) counts.set(t.tech, (counts.get(t.tech) ?? 0) + 1);
		}
		return counts;
	});

	// Every player who researched a tech and the turn they finished it, earliest
	// first — feeds the hover panel that lines up each nation's pace on a tech.
	const techOwners = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, not reactive state
		const map = new Map<string, { player: DetailPlayer; turn: number }[]>();
		for (const { player, techs } of byPlayer) {
			for (const t of techs) {
				const arr = map.get(t.tech) ?? [];
				arr.push({ player, turn: t.completed_turn });
				map.set(t.tech, arr);
			}
		}
		for (const arr of map.values()) arr.sort((a, b) => a.turn - b.turn);
		return map;
	});

	// One row per turn anyone completed a tech, cells per player in order.
	const rows = $derived.by(() => {
		const turns = [
			...new Set(byPlayer.flatMap((b) => b.techs.map((t) => t.completed_turn))),
		].sort((a, b) => a - b);
		return turns.map((turn) => ({
			turn,
			cells: byPlayer.map(({ techs }) =>
				techs
					.filter((t) => t.completed_turn === turn)
					.map(
						(t): Cell => ({
							tech: t.tech,
							bonus: t.tech.includes("_BONUS"),
							laws: TECH_LAWS[t.tech] ?? [],
							shared: (ownerCounts.get(t.tech) ?? 0) === players.length,
						}),
					),
			),
		}));
	});

	// Planner deep link per player (their full research order).
	const plannerUrls = $derived(
		players.map((player) =>
			buildOwttUrl(
				player.nation,
				findByPlayer(
					techDiscoveryHistory,
					player,
					(h) => h.player_id,
					(h) => h.nation,
				)?.data ?? [],
			),
		),
	);

	// Hovered tech id — every cell holding it lights up across columns.
	let hovered = $state<string | null>(null);
</script>

<!-- Styled hover panel for a tech cell: the tech, what it unlocks, and every
     nation that researched it with the turn each finished — so a shared tech's
     pacing gaps read at a glance. -->
{#snippet techPanel(cell: Cell)}
	<div class="min-w-[13rem] max-w-xs space-y-2 text-xs">
		<div class="flex items-center gap-1.5 font-bold text-tan">
			<SpriteIcon category="techs" value={cell.tech} size={16} />
			{techName(cell.tech)}
		</div>
		{#if cell.laws.length > 0}
			<div class="flex items-center gap-1 text-gray-400">
				<SpriteIcon category="icons" value="LAWS" size={12} alt="" />
				Unlocks {cell.laws.map((l) => formatEnum(l, "LAW_")).join(" / ")}
			</div>
		{/if}
		{#if cell.bonus}
			<div class="text-gray-400">Bonus card</div>
		{/if}
		<div class="border-t border-border-subtle pt-1.5">
			<div class="mb-1 text-[10px] uppercase tracking-wide text-gray-400">
				Researched by
			</div>
			<ul class="space-y-1">
				{#each techOwners.get(cell.tech) ?? [] as owner (owner.player.playerId)}
					<li class="flex items-center justify-between gap-4">
						<span
							class="inline-flex items-center gap-1.5 font-semibold"
							style="color: {owner.player.color};"
						>
							{#if owner.player.nation}
								<SpriteIcon
									category="crests"
									value={owner.player.nation}
									size={13}
									alt=""
								/>
							{/if}
							{owner.player.label}
						</span>
						<span class="whitespace-nowrap font-mono text-[10px] text-gray-400">
							T{owner.turn}
						</span>
					</li>
				{/each}
			</ul>
		</div>
	</div>
{/snippet}

<div
	class="mb-4 rounded-lg p-4"
	style="background-color: rgb(var(--color-surface));"
>
	<h3 class="mb-3 text-base font-bold text-tan">Techs by Turn</h3>
	<div class="overflow-x-auto">
		<Tooltip.Provider delayDuration={200} disableHoverableContent>
			<table class="w-full max-w-3xl text-sm">
				<thead>
					<tr>
						<th class="w-12 px-3 pb-2 text-left font-semibold text-gray-400"
							>Turn</th
						>
						{#each players as player, i (player.playerId)}
							<th class="px-3 pb-2 text-left">
								<span class="inline-flex flex-col items-start gap-0.5">
									<span
										class="inline-flex items-center gap-1.5 font-semibold"
										style="color: {player.color};"
									>
										{#if player.nation}
											<SpriteIcon
												category="crests"
												value={player.nation}
												size={15}
												alt={player.label}
											/>
										{/if}
										{player.label}
									</span>
									{#if plannerUrls[i]}
										<!-- External planner link (not an app route), so resolve()
									     doesn't apply; rel guards tabnabbing + referrer leakage. -->
										<!-- eslint-disable svelte/no-navigation-without-resolve -->
										<a
											href={plannerUrls[i]}
											target="_blank"
											rel="noopener noreferrer"
											class="inline-flex items-center gap-1 whitespace-nowrap text-xs font-normal text-tan hover:underline"
											title="Open {player.label}'s full research order in the tech-tree planner"
										>
											Tech path
											<!-- External-link glyph (heroicons), sized to the text -->
											<svg
												xmlns="http://www.w3.org/2000/svg"
												class="h-3 w-3"
												fill="none"
												viewBox="0 0 24 24"
												stroke="currentColor"
												stroke-width="2"
												aria-hidden="true"
											>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
												/>
											</svg>
										</a>
										<!-- eslint-enable svelte/no-navigation-without-resolve -->
									{/if}
								</span>
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each rows as row (row.turn)}
						<tr>
							<td
								class="border-t border-border-subtle px-3 py-1 align-top font-mono text-[10px] text-gray-400"
							>
								T{row.turn}
							</td>
							{#each row.cells as cell, i (players[i].playerId)}
								<td class="border-t border-border-subtle px-3 py-1 align-top">
									{#if cell.length === 0}
										<span class="text-gray-400">—</span>
									{:else}
										<div class="flex flex-col gap-0.5">
											{#each cell as c (c.tech)}
												<!-- Plain text, colored by state: a bonus-card tech always
											     sits in the page's default color (no state coloring). Else a
											     shared tech sits in the default color and turns gold on hover
											     (spotlighting the same tech down every column); a tech not
											     everyone has stays in the player's color. Hovering also opens
											     a styled panel with the tech's full ownership + pacing. -->
												<Tooltip.Root>
													<Tooltip.Trigger>
														{#snippet child({ props })}
															<span
																{...props}
																class="inline-flex cursor-default items-center gap-1.5 text-xs transition-colors"
																style="color: {c.bonus
																	? 'inherit'
																	: c.shared
																		? hovered === c.tech
																			? 'rgb(var(--color-orange))'
																			: 'inherit'
																		: players[i].color};"
																role="img"
																aria-label={techName(c.tech)}
																onmouseenter={() => (hovered = c.tech)}
																onmouseleave={() => (hovered = null)}
															>
																<SpriteIcon
																	category="techs"
																	value={c.tech}
																	size={14}
																/>
																{techName(c.tech)}
																{#if c.laws.length > 0}
																	<SpriteIcon
																		category="icons"
																		value="LAWS"
																		size={12}
																		alt="unlocks a law"
																	/>
																{/if}
															</span>
														{/snippet}
													</Tooltip.Trigger>
													<Tooltip.Portal>
														<Tooltip.Content
															side="top"
															sideOffset={6}
															class="z-50 rounded-lg border-2 border-surface-raised bg-blue-gray px-3 py-2.5 text-tan shadow-lg"
														>
															{@render techPanel(c)}
														</Tooltip.Content>
													</Tooltip.Portal>
												</Tooltip.Root>
											{/each}
										</div>
									{/if}
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</Tooltip.Provider>
	</div>
</div>
