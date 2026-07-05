<script lang="ts">
	import { padMatchNumber } from "$lib/tournament/match-numbers";
	import { resolve } from "$app/paths";
	import type {
		MapPoolEntry,
		SlotStanding,
		TournamentMatch,
	} from "$lib/api-cloud";
	import { SPRITE_MANIFEST } from "$lib/generated/sprite-manifest";
	import SpriteIcon from "$lib/game-detail/SpriteIcon.svelte";
	import PlayerAvatar from "$lib/tournament/PlayerAvatar.svelte";
	import {
		matchSlotAvatarUrl,
		matchSlotDisplayName,
		matchSlotNation,
	} from "$lib/tournament/match-occupant";
	import { formatEnum } from "$lib/utils/formatting";
	import {
		matchDisplayStatus,
		MATCH_STATUS_LABEL,
	} from "$lib/tournament/parts";
	import { mapScriptLabel } from "$lib/tournament/map-scripts";
	import {
		distinguishingOptions,
		mapPoolLabel,
		poolEntryById,
	} from "$lib/tournament/map-script-options";

	const MAP_ICON = SPRITE_MANIFEST["icons/MAP_OVERVIEW"];

	// Card status chip labels. "unscheduled" is intentionally absent — the most
	// common pending state shows no chip, so only meaningful statuses stand out.

	type Props = {
		winsToAdvance: number;
		lossesToEliminate: number;
		maxRounds: number;
		standings: SlotStanding[];
		// Swiss matches for THIS division only. Caller is responsible for
		// filtering by division before passing in.
		matches: TournamentMatch[];
		tournamentSlug: string;
		// The tournament's map_pool — used to resolve each match's assigned
		// instance (by map_pool_id) for the options tooltip on its map name.
		mapPool: MapPoolEntry[];
		// eslint-disable-next-line no-unused-vars -- param name is documentary
		onMatchClick: (matchId: string) => void;
	};

	let {
		winsToAdvance,
		lossesToEliminate,
		maxRounds,
		standings,
		matches,
		tournamentSlug,
		mapPool,
		onMatchClick,
	}: Props = $props();

	// Options that vary across the pool — drives which variant the compact
	// map label on each match cell surfaces.
	const distinguishing = $derived(distinguishingOptions(mapPool));

	// Hover-trace: the slot whose path through the bracket is currently
	// highlighted. A slot plays exactly one match per round, so setting this
	// lights up that player's card in every round and dims the rest.
	let highlightedSlot = $state<string | null>(null);

	// SVG path-trace overlay. When a slot is hovered we measure its row in
	// each round (plus its final gutter chip) and emit one bezier per hop.
	// Geometry is read from the DOM rather than computed: the grid auto-sizes
	// its buckets, so a card's pixel position isn't known before render.
	let stageEl = $state<HTMLDivElement | undefined>(undefined);
	let connectors = $state<string[]>([]);
	// Bumped by the ResizeObserver to force the overlay to remeasure on reflow.
	let geomVersion = $state(0);

	// Smooth S-curve between two anchor points with horizontal control handles.
	function tracePath(x0: number, y0: number, x1: number, y1: number): string {
		const dx = Math.max(24, (x1 - x0) * 0.5);
		return `M ${x0} ${y0} C ${x0 + dx} ${y0} ${x1 - dx} ${y1} ${x1} ${y1}`;
	}

	$effect(() => {
		// Track deps explicitly: recompute on hover changes and on reflow.
		const slot = highlightedSlot;
		geomVersion;
		const stage = stageEl;
		if (!slot || !stage) {
			connectors = [];
			return;
		}
		const rows = Array.from(
			stage.querySelectorAll<HTMLElement>(`.match-row[data-slot-id="${slot}"]`),
		)
			.map((el) => ({ el, round: Number(el.dataset.round ?? 0) }))
			.sort((a, b) => a.round - b.round);
		if (rows.length === 0) {
			connectors = [];
			return;
		}
		const stageRect = stage.getBoundingClientRect();
		const anchors = rows.map(({ el }) => {
			const r = el.getBoundingClientRect();
			return {
				leftX: r.left - stageRect.left,
				rightX: r.right - stageRect.left,
				y: r.top - stageRect.top + r.height / 2,
			};
		});
		const paths: string[] = [];
		for (let i = 0; i < anchors.length - 1; i++) {
			paths.push(
				tracePath(
					anchors[i].rightX,
					anchors[i].y,
					anchors[i + 1].leftX,
					anchors[i + 1].y,
				),
			);
		}
		// Final hop: last match → the player's advancing/eliminated gutter chip.
		const chip = stage.querySelector<HTMLElement>(
			`.chip[data-slot-id="${slot}"]`,
		);
		if (chip) {
			const last = anchors[anchors.length - 1];
			const cr = chip.getBoundingClientRect();
			paths.push(
				tracePath(
					last.rightX,
					last.y,
					cr.left - stageRect.left,
					cr.top - stageRect.top + cr.height / 2,
				),
			);
		}
		connectors = paths;
	});

	$effect(() => {
		const stage = stageEl;
		if (!stage) return;
		const ro = new ResizeObserver(() => {
			geomVersion += 1;
		});
		ro.observe(stage);
		return () => ro.disconnect();
	});

	function handleMatchClick(matchId: string, e: MouseEvent) {
		if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
		e.preventDefault();
		onMatchClick(matchId);
	}

	const labelOf = $derived.by(() => {
		const out: Record<string, string> = {};
		for (const s of standings) {
			out[s.slot_id] = s.display_name ?? `slot ${s.slot_id.slice(0, 6)}`;
		}
		return out;
	});

	const avatarOf = $derived.by(() => {
		const out: Record<string, string | null> = {};
		for (const s of standings) {
			out[s.slot_id] = s.avatar_url;
		}
		return out;
	});

	type Bucket = {
		round: number;
		wins: number; // entering this round
		losses: number;
		matches: TournamentMatch[];
	};
	type StatusChip = {
		slot_id: string;
		crossedAtRound: number;
		finalWins: number;
		finalLosses: number;
	};

	// Walk matches in round order, tracking each slot's running record so we
	// can bucket each match by the (W, L) the players carried INTO that
	// round. Per-Ankh's Swiss pairs by exactly this bucket (see
	// cloud/src/tournament/pairing.ts), so matches in a round always share
	// an entering record between slot_a and slot_b.
	const layout = $derived.by(() => {
		const sorted = [...matches].sort(
			(a, b) => (a.round_number ?? 0) - (b.round_number ?? 0),
		);
		const record: Record<string, { wins: number; losses: number }> = {};
		for (const s of standings) {
			record[s.slot_id] = { wins: 0, losses: 0 };
		}

		const buckets: Record<string, Bucket> = {};
		const advanced: StatusChip[] = [];
		const eliminated: StatusChip[] = [];
		const declared: Record<string, true> = {};

		let maxRoundSeen = 0;
		for (const m of sorted) {
			const r = m.round_number ?? 0;
			if (r === 0) continue;
			maxRoundSeen = Math.max(maxRoundSeen, r);
			const aRec = record[m.slot_a_id] ?? { wins: 0, losses: 0 };
			const key = `${r}|${aRec.wins}-${aRec.losses}`;
			let bucket = buckets[key];
			if (!bucket) {
				bucket = {
					round: r,
					wins: aRec.wins,
					losses: aRec.losses,
					matches: [],
				};
				buckets[key] = bucket;
			}
			bucket.matches.push(m);

			if (m.status === "complete" || m.status === "forfeit") {
				const aWon = m.winner_slot_id === m.slot_a_id;
				record[m.slot_a_id] = {
					wins: aRec.wins + (aWon ? 1 : 0),
					losses: aRec.losses + (aWon ? 0 : 1),
				};
				if (m.slot_b_id) {
					const bRec = record[m.slot_b_id] ?? { wins: 0, losses: 0 };
					record[m.slot_b_id] = {
						wins: bRec.wins + (aWon ? 0 : 1),
						losses: bRec.losses + (aWon ? 1 : 0),
					};
				}
			} else if (m.status === "bye") {
				record[m.slot_a_id] = {
					wins: aRec.wins + 1,
					losses: aRec.losses,
				};
			}

			// Check threshold crossings after this match. Declaring inside
			// the match loop (not per-round) means a slot that hits the
			// threshold mid-round shows up in the gutter labelled with the
			// round they crossed in.
			for (const slotId of Object.keys(record)) {
				if (declared[slotId]) continue;
				const rec = record[slotId];
				if (rec.wins >= winsToAdvance) {
					advanced.push({
						slot_id: slotId,
						crossedAtRound: r,
						finalWins: rec.wins,
						finalLosses: rec.losses,
					});
					declared[slotId] = true;
				} else if (rec.losses >= lossesToEliminate) {
					eliminated.push({
						slot_id: slotId,
						crossedAtRound: r,
						finalWins: rec.wins,
						finalLosses: rec.losses,
					});
					declared[slotId] = true;
				}
			}
		}

		advanced.sort((a, b) => a.crossedAtRound - b.crossedAtRound);
		eliminated.sort((a, b) => a.crossedAtRound - b.crossedAtRound);

		return {
			buckets: Object.values(buckets),
			advanced,
			eliminated,
			maxRoundSeen,
		};
	});

	// Grid geometry. Top row holds round labels; content rows below run from
	// (W=winsToAdvance-1, L=0) at the top to (W=0, L=lossesToEliminate-1) at
	// the bottom. Bucket row = (winsToAdvance-1) - W + L (header offset +1).
	const totalContentRows = $derived(winsToAdvance + lossesToEliminate - 1);
	const totalCols = $derived(maxRounds + 1); // +1 for advance/eliminate gutter
	const gutterCol = $derived(maxRounds + 1);
	// Split the gutter vertically into advance (top half) and eliminate
	// (bottom half) by content row count. Header row is row 1; content rows
	// are 2..(totalContentRows+1).
	const gutterSplit = $derived(Math.ceil(totalContentRows / 2));
	const roundIndexes = $derived(Array.from({ length: maxRounds }, (_, i) => i));

	function rowForBucket(wins: number, losses: number): number {
		// +2: header row offset (1) + 1-based CSS grid
		return winsToAdvance - 1 - wins + losses + 2;
	}

	// Status-chip label (advance/eliminate gutters) — current occupant, by slot.
	function slotLabel(slotId: string | null): string {
		if (!slotId) return "BYE";
		return labelOf[slotId] ?? "—";
	}

	// Match-cell label — prefer snapshot for non-pending matches so a later
	// substitution doesn't rewrite a historical name.
	function matchSlotLabel(m: TournamentMatch, side: "a" | "b"): string {
		const slotId = side === "a" ? m.slot_a_id : m.slot_b_id;
		if (!slotId) return "BYE";
		return matchSlotDisplayName(m, side, labelOf) ?? "—";
	}
</script>

<section
	class="flow-bracket"
	style:--cols={totalCols}
	style:--rows={totalContentRows + 1}
>
	<div class="grid-scroll">
		<div class="grid-stage" bind:this={stageEl}>
			<svg class="connectors" aria-hidden="true">
				{#each connectors as d, i (i)}
					<path {d} class="connector" />
				{/each}
			</svg>
			<div
				class="grid"
				style:grid-template-columns="repeat({maxRounds}, 192px) 132px"
				style:grid-template-rows="auto repeat({totalContentRows}, minmax(0,
				auto))"
			>
				{#each roundIndexes as i (i)}
					<div
						class="round-header"
						style:grid-column={i + 1}
						style:grid-row={1}
					>
						Round {i + 1}
					</div>
				{/each}
				<div
					class="round-header gutter-header"
					style:grid-column={gutterCol}
					style:grid-row={1}
				>
					Status
				</div>

				{#each layout.buckets as b (`${b.round}-${b.wins}-${b.losses}`)}
					<div
						class="bucket"
						style:grid-column={b.round}
						style:grid-row={rowForBucket(b.wins, b.losses)}
					>
						<div class="record-label">{b.wins}-{b.losses}</div>
						<div class="match-list">
							{#each b.matches as m (m.match_id)}
								{@const aWon = m.winner_slot_id === m.slot_a_id}
								{@const bWon = m.winner_slot_id === m.slot_b_id}
								{@const dstatus = matchDisplayStatus(m)}
								{@const aOnPath =
									highlightedSlot !== null && m.slot_a_id === highlightedSlot}
								{@const bOnPath =
									highlightedSlot !== null && m.slot_b_id === highlightedSlot}
								{@const onPath = aOnPath || bOnPath}
								<a
									class="match"
									class:dimmed={highlightedSlot !== null && !onPath}
									class:on-path={onPath}
									data-match-id={m.match_id}
									href="{resolve('/tournaments/[slug]', {
										slug: tournamentSlug,
									})}?match={m.match_id}"
									onclick={(e) => handleMatchClick(m.match_id, e)}
								>
									{#if m.match_number != null}
										<span class="match-num"
											>{padMatchNumber(m.match_number)}</span
										>
									{/if}
									<div
										class="match-row"
										class:row-active={aOnPath}
										data-slot-id={m.slot_a_id}
										data-round={b.round}
									>
										<span
											class="slot-hit"
											role="presentation"
											onmouseenter={() => (highlightedSlot = m.slot_a_id)}
											onmouseleave={() => (highlightedSlot = null)}
										>
											{#if m.slot_a_id}
												{@const aNation = matchSlotNation(m, "a")}
												{#if aNation}
													<SpriteIcon
														category="crests"
														value={aNation}
														size={12}
														alt={formatEnum(aNation, "NATION_")}
													/>
												{/if}
												<PlayerAvatar
													avatarUrl={matchSlotAvatarUrl(m, "a", avatarOf)}
													size={12}
												/>
											{/if}
											<span class="slot" class:winner={aWon}>
												{matchSlotLabel(m, "a")}
											</span>
										</span>
									</div>
									<div
										class="match-row"
										class:row-active={bOnPath}
										data-slot-id={m.slot_b_id}
										data-round={b.round}
									>
										<span
											class="slot-hit"
											role="presentation"
											onmouseenter={() => (highlightedSlot = m.slot_b_id)}
											onmouseleave={() => (highlightedSlot = null)}
										>
											{#if m.slot_b_id}
												{@const bNation = matchSlotNation(m, "b")}
												{#if bNation}
													<SpriteIcon
														category="crests"
														value={bNation}
														size={12}
														alt={formatEnum(bNation, "NATION_")}
													/>
												{/if}
												<PlayerAvatar
													avatarUrl={matchSlotAvatarUrl(m, "b", avatarOf)}
													size={12}
												/>
											{/if}
											<span class="slot" class:winner={bWon}>
												{matchSlotLabel(m, "b")}
											</span>
										</span>
									</div>
									{#if m.map_script}
										{@const entry = poolEntryById(mapPool, m.map_pool_id)}
										{@const fullName = entry
											? mapPoolLabel(entry, distinguishing, false)
											: mapScriptLabel(m.map_script)}
										{@const shortName = entry
											? mapPoolLabel(entry, distinguishing, true)
											: mapScriptLabel(m.map_script)}
										<div class="map-row" title={fullName}>
											<img class="map-icon" src={MAP_ICON} alt="" />
											<span class="map-name">{shortName}</span>
										</div>
									{/if}
									{#if dstatus && dstatus !== "unscheduled"}
										<span class="status-chip status-{dstatus}"
											>{MATCH_STATUS_LABEL[dstatus]}</span
										>
									{/if}
								</a>
							{/each}
						</div>
					</div>
				{/each}

				<div
					class="gutter advance-gutter"
					style:grid-column={gutterCol}
					style:grid-row="2 / span {gutterSplit}"
				>
					<div class="gutter-label gutter-label-advance">Advancing</div>
					{#if layout.advanced.length === 0}
						<p class="gutter-empty">—</p>
					{:else}
						<ul class="chip-list">
							{#each layout.advanced as a (a.slot_id)}
								<li
									class="chip chip-advance"
									data-slot-id={a.slot_id}
									class:dimmed={highlightedSlot !== null &&
										highlightedSlot !== a.slot_id}
									onmouseenter={() => (highlightedSlot = a.slot_id)}
									onmouseleave={() => (highlightedSlot = null)}
								>
									<PlayerAvatar avatarUrl={avatarOf[a.slot_id]} size={12} />
									<span class="chip-name">{slotLabel(a.slot_id)}</span>
									<span class="chip-record">{a.finalWins}-{a.finalLosses}</span>
								</li>
							{/each}
						</ul>
					{/if}
				</div>

				<div
					class="gutter eliminate-gutter"
					style:grid-column={gutterCol}
					style:grid-row="{2 + gutterSplit} / -1"
				>
					<div class="gutter-label gutter-label-eliminate">Eliminated</div>
					{#if layout.eliminated.length === 0}
						<p class="gutter-empty">—</p>
					{:else}
						<ul class="chip-list">
							{#each layout.eliminated as e (e.slot_id)}
								<li
									class="chip chip-eliminate"
									data-slot-id={e.slot_id}
									class:dimmed={highlightedSlot !== null &&
										highlightedSlot !== e.slot_id}
									onmouseenter={() => (highlightedSlot = e.slot_id)}
									onmouseleave={() => (highlightedSlot = null)}
								>
									<PlayerAvatar avatarUrl={avatarOf[e.slot_id]} size={12} />
									<span class="chip-name">{slotLabel(e.slot_id)}</span>
									<span class="chip-record">{e.finalWins}-{e.finalLosses}</span>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			</div>
		</div>
	</div>
</section>

<style>
	.flow-bracket {
		background-color: rgb(var(--color-surface));
		border-radius: 0.5rem;
		/* No left/right padding: the bracket sits inside the division card,
		   which already supplies the horizontal gutter. */
		padding: 1rem 0;
	}

	.grid-scroll {
		overflow-x: auto;
		display: flex;
		/* Center the rounds when they fit; `safe` falls back to start-aligned
		   when they overflow a narrow viewport so the first round isn't
		   clipped out of scroll reach. */
		justify-content: safe center;
	}

	/* Wraps the grid tightly (max-content) so the absolutely-positioned
	   connector overlay can span the grid's full scroll extent and scroll
	   with it. */
	.grid-stage {
		position: relative;
		width: max-content;
	}

	.connectors {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
		overflow: visible;
	}

	.connector {
		fill: none;
		stroke: rgb(var(--color-tan-light) / 0.25);
		stroke-width: 1.5;
	}

	.grid {
		display: grid;
		/* Wider column gap than row gap: gives the round columns (and the
		   hover-trace connector lines between them) room to breathe. */
		row-gap: 0.5rem;
		column-gap: 1.5rem;
		min-width: max-content;
	}

	.round-header {
		color: rgb(var(--color-tan));
		opacity: 0.75;
		font-size: 0.75rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 0 0.25rem 0.25rem;
		border-bottom: 1px solid rgb(var(--color-tan-light) / 0.15);
	}

	.gutter-header {
		text-align: left;
	}

	.bucket {
		background-color: rgb(var(--color-surface-raised));
		border: 1px solid rgb(var(--color-tan-light) / 0.08);
		border-radius: 0.375rem;
		padding: 0.4rem 0.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		align-self: start;
	}

	.record-label {
		color: rgb(var(--color-tan));
		font-size: 0.7rem;
		font-weight: 700;
		opacity: 0.6;
		font-family: ui-monospace, monospace;
	}

	.match-list {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.match {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0.3rem 0.4rem;
		border-radius: 0.25rem;
		background-color: rgb(var(--color-surface));
		color: rgb(var(--color-tan));
		font-size: 0.75rem;
		text-decoration: none;
		transition: background-color 0.1s;
		min-width: 0;
	}
	.match-num {
		position: absolute;
		top: 0.2rem;
		right: 0.35rem;
		font-variant-numeric: tabular-nums;
		font-size: 0.6rem;
		line-height: 1;
		color: rgb(var(--color-tan));
		opacity: 0.45;
		pointer-events: none;
	}

	.match:hover {
		background-color: rgb(var(--color-surface-sunken));
	}

	/* Hover-trace: a player's card stays lit on its path while every other
	   card fades back, so the eye can follow one player across the rounds. */
	.match.dimmed {
		opacity: 0.2;
		transition: opacity 0.12s;
	}

	.match.on-path {
		background-color: rgb(var(--color-surface-raised));
		box-shadow: inset 0 0 0 1px rgb(var(--color-tan-light) / 0.25);
	}

	.match-row.row-active {
		margin: -0.1rem -0.2rem;
		padding: 0.1rem 0.2rem;
		border-radius: 0.2rem;
		background-color: rgb(var(--color-tan-light) / 0.1);
	}

	.match-row {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		min-width: 0;
	}

	/* Hover hit-area: hugs the avatar + name so the trace triggers on the
	   player, not the empty space filling the rest of the card. Still shrinks
	   (flex-shrink) so long names ellipsize within the card. */
	.slot-hit {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		min-width: 0;
		flex: 0 1 auto;
	}

	.slot {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex: 1 1 auto;
	}

	.slot.winner {
		color: rgb(var(--color-orange));
		font-weight: 700;
	}

	.map-row {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		min-width: 0;
		margin-top: 0.15rem;
	}

	.map-icon {
		flex-shrink: 0;
		width: 0.8rem;
		height: 0.8rem;
		object-fit: contain;
		opacity: 0.7;
	}

	.map-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.6rem;
		opacity: 0.6;
		color: rgb(var(--color-tan));
	}

	/* Per-match status chip — scheduled / in progress / completed. Sits at the
	   card's bottom edge; unscheduled matches render none. */
	.status-chip {
		align-self: flex-start;
		margin-top: 0.15rem;
		padding: 0.02rem 0.3rem;
		border-radius: 0.2rem;
		font-size: 0.55rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		line-height: 1.5;
	}
	.status-scheduled {
		background-color: rgb(var(--color-tan-light) / 0.14);
		color: rgb(var(--color-tan-light));
	}
	.status-in_progress {
		background-color: rgb(var(--color-orange) / 0.18);
		color: rgb(var(--color-orange));
	}
	.status-completed {
		background-color: rgb(var(--color-success) / 0.14);
		color: rgb(var(--color-success));
		opacity: 0.85;
	}

	.gutter {
		background-color: rgb(var(--color-surface-raised));
		border-radius: 0.375rem;
		padding: 0.5rem 0.6rem;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		min-width: 0;
	}

	.gutter-label {
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.gutter-label-advance {
		color: rgb(var(--color-success) / 0.95);
	}

	.gutter-label-eliminate {
		color: rgb(var(--color-danger) / 0.95);
	}

	.gutter-empty {
		color: rgb(var(--color-tan));
		opacity: 0.4;
		font-size: 0.75rem;
		margin: 0;
	}

	.chip-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.chip {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.7rem;
		padding: 0.2rem 0.4rem;
		border-radius: 0.25rem;
		border: 1px solid;
	}

	.chip.dimmed {
		opacity: 0.2;
		transition: opacity 0.12s;
	}

	.chip-advance {
		background-color: rgb(var(--color-success) / 0.15);
		border-color: rgb(var(--color-success) / 0.5);
		color: rgb(var(--color-success));
	}

	.chip-eliminate {
		background-color: rgb(var(--color-danger) / 0.12);
		border-color: rgb(var(--color-danger) / 0.45);
		color: rgb(var(--color-danger));
		opacity: 0.85;
	}

	.chip-name {
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.chip-record {
		font-family: ui-monospace, monospace;
		opacity: 0.7;
		flex-shrink: 0;
	}
</style>
