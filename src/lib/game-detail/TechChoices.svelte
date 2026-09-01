<script lang="ts">
	// "Tech draws": for every tech a player took, the cards they passed over in
	// the same draw — and, for the techs that never came from a draw, which
	// kind of gift they were. One column per player, side by side while the
	// field is small enough for the columns to stay readable.
	//
	// Hovering any tech name lights up every other draw it appeared in, on
	// BOTH sides, with a readout of how often each player was offered it and
	// whether they took it. A tech's real cost is the hands it kept turning up
	// in, and that is invisible when each row is read on its own.
	import type { PlayerTech } from "$lib/types/PlayerTech";
	import type { TechChoiceInfo } from "$lib/parser/types";
	import { techChoiceRows, type TechChoiceRow } from "./tech-choices";
	import { ownedByPlayer, techName, type DetailPlayer } from "./helpers";

	let {
		players,
		techChoices = [],
		completedTechs,
	}: {
		players: DetailPlayer[];
		// Empty for saves from an Old World build that recorded no choice
		// history, and for blobs parsed before 2.16.0.
		techChoices?: TechChoiceInfo[];
		completedTechs: PlayerTech[];
	} = $props();

	const columns = $derived(
		players
			.map((player) => ({
				player,
				rows: techChoiceRows(
					techChoices.filter((c) => c.player_xml_id === player.playerId),
					ownedByPlayer(
						completedTechs,
						player,
						(t) => t.player_id,
						(t) => t.nation,
					),
					player.nation,
				),
			}))
			.filter((c) => c.rows.length > 0)
			.map((c) => ({
				...c,
				drafted: c.rows.filter((r) => r.origin === "drafted").length,
				granted: c.rows.filter((r) => r.origin === "granted").length,
			})),
	);
	// Two columns read comfortably; more than four and each would be too
	// narrow for a tech name plus its alternates, so they stack.
	const columnClass = $derived(
		columns.length >= 3 ? "lg:grid-cols-3" : "lg:grid-cols-2",
	);
	const originLabel: Record<TechChoiceRow["origin"], string> = {
		drafted: "",
		starting: "nation starting tech",
		granted: "free tech",
	};

	let hovered = $state<string | null>(null);
	// What the hovered tech cost each player: how many draws it turned up in,
	// and whether they ever took it. A tech offered six times and never taken
	// is a different story from one taken the first time it appeared.
	const hoverSummary = $derived.by(() => {
		const tech = hovered;
		if (tech == null) return null;
		return {
			tech,
			perPlayer: columns.map((col) => {
				let offers = 0;
				let takenTurn: number | null = null;
				let taken = false;
				for (const row of col.rows) {
					if (row.tech === tech) {
						taken = true;
						takenTurn = row.turn;
						// The draw it was taken from counts as an offer too.
						if (row.origin === "drafted") offers += 1;
					}
					if (row.alternates.includes(tech)) offers += 1;
				}
				return { player: col.player, offers, taken, takenTurn };
			}),
		};
	});
</script>

{#if columns.length > 0}
	<div
		class="mb-4 rounded-lg p-4"
		style="background-color: rgb(var(--color-surface));"
	>
		<div class="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
			<h3 class="text-base font-bold text-tan">Tech draws</h3>
			<!-- The hover readout replaces itself in place; the row keeps its
			     height either way so the table below never jumps. -->
			<div class="min-h-[1.25rem] text-xs text-gray-400">
				{#if hoverSummary}
					<span class="font-semibold text-bright"
						>{techName(hoverSummary.tech)}</span
					>
					{#each hoverSummary.perPlayer as p (p.player.playerId)}
						<span class="ml-2">
							<span style="color: {p.player.color};">{p.player.label}</span>
							{p.offers === 0
								? "never offered"
								: `offered ${p.offers}×`}{p.taken
								? p.takenTurn == null
									? ", taken"
									: `, taken T${p.takenTurn}`
								: ""}
						</span>
					{/each}
				{/if}
			</div>
		</div>
		<div class="grid grid-cols-1 gap-x-8 gap-y-5 {columnClass}">
			{#each columns as col (col.player.playerId)}
				<div class="min-w-0">
					<div
						class="flex items-baseline gap-2 text-sm font-semibold"
						style="color: {col.player.color};"
					>
						{col.player.label}
						<span class="text-xs font-normal text-gray-400">
							{col.drafted} drafted{col.granted > 0
								? ` · ${col.granted} free`
								: ""}
						</span>
					</div>
					<table class="w-full text-xs">
						<thead>
							<tr
								class="border-b border-border-subtle text-[10px] uppercase tracking-wide text-gray-400"
							>
								<th class="w-9 py-1 text-right font-normal">Turn</th>
								<th class="py-1 pl-2 text-left font-normal">Tech taken</th>
								<th class="py-1 pl-3 text-left font-normal">Passed over</th>
							</tr>
						</thead>
						<tbody>
							{#each col.rows as row (row.tech)}
								<tr class="align-baseline hover:bg-white/5">
									<td class="py-0.5 text-right tabular-nums text-gray-400">
										{row.turn == null ? "" : `T${row.turn}`}
									</td>
									<td class="whitespace-nowrap py-0.5 pl-2">
										<span
											class="cursor-default rounded px-1 font-semibold {hovered ===
											row.tech
												? 'bg-orange/25 text-bright'
												: 'text-tan'}"
											role="img"
											aria-label={techName(row.tech)}
											onmouseenter={() => (hovered = row.tech)}
											onmouseleave={() => (hovered = null)}
										>
											{techName(row.tech)}
										</span>
									</td>
									<td class="py-0.5 pl-3 text-gray-400">
										{#if row.origin === "drafted"}
											{#each row.alternates as alt, i (alt)}
												<span
													class="cursor-default rounded px-1 {hovered === alt
														? 'bg-orange/25 text-bright'
														: ''}"
													role="img"
													aria-label={techName(alt)}
													onmouseenter={() => (hovered = alt)}
													onmouseleave={() => (hovered = null)}
												>
													{techName(alt)}
												</span>{#if i < row.alternates.length - 1}<span
														class="text-gray-500">·</span
													>{/if}
											{/each}
										{:else}
											<span class="italic">{originLabel[row.origin]}</span>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/each}
		</div>
	</div>
{/if}
