<script lang="ts">
	import { resolve } from "$app/paths";
	import type { SlotStanding, TournamentMatch } from "$lib/api-cloud";
	import { mapScriptLabel } from "$lib/tournament/map-scripts";

	type Props = {
		winsToAdvance: number;
		lossesToEliminate: number;
		maxRounds: number;
		standings: SlotStanding[];
		// Swiss matches for THIS division only. Caller is responsible for
		// filtering by division before passing in.
		matches: TournamentMatch[];
		tournamentSlug: string;
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
		onMatchClick,
	}: Props = $props();

	function handleMatchClick(matchId: string, e: MouseEvent) {
		if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
		e.preventDefault();
		onMatchClick(matchId);
	}

	const labelOf = $derived.by(() => {
		const out: Record<string, string> = {};
		for (const s of standings) {
			out[s.slot_id] = s.discord_username ?? `slot ${s.slot_id.slice(0, 6)}`;
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

	function slotLabel(slotId: string | null): string {
		if (!slotId) return "BYE";
		return labelOf[slotId] ?? "—";
	}
</script>

<section
	class="flow-bracket"
	style:--cols={totalCols}
	style:--rows={totalContentRows + 1}
>
	<div class="grid-scroll">
		<div
			class="grid"
			style:grid-template-columns="repeat({maxRounds}, minmax(140px, 1fr))
			minmax(110px, 0.7fr)"
			style:grid-template-rows="auto repeat({totalContentRows}, minmax(0, auto))"
		>
			{#each roundIndexes as i (i)}
				<div class="round-header" style:grid-column={i + 1} style:grid-row={1}>
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
					class:bucket-advance={b.wins === winsToAdvance - 1 &&
						b.losses < lossesToEliminate}
					class:bucket-eliminate={b.losses === lossesToEliminate - 1 &&
						b.wins < winsToAdvance}
					style:grid-column={b.round}
					style:grid-row={rowForBucket(b.wins, b.losses)}
				>
					<div class="record-label">{b.wins}-{b.losses}</div>
					<div class="match-list">
						{#each b.matches as m (m.match_id)}
							{@const aWon = m.winner_slot_id === m.slot_a_id}
							{@const bWon = m.winner_slot_id === m.slot_b_id}
							{@const aPick = m.pick_order_winner_slot_id === m.slot_a_id}
							{@const bPick =
								m.pick_order_winner_slot_id != null &&
								m.pick_order_winner_slot_id === m.slot_b_id}
							<a
								class="match"
								href="{resolve('/tournaments/[slug]', {
									slug: tournamentSlug,
								})}?match={m.match_id}"
								onclick={(e) => handleMatchClick(m.match_id, e)}
							>
								<div class="match-row">
									<span class="slot" class:winner={aWon}>
										{slotLabel(m.slot_a_id)}
									</span>
									{#if aPick}
										<span class="pick-label">First pick</span>
									{/if}
									{#if m.map_script}
										<span class="map-label">{mapScriptLabel(m.map_script)}</span>
									{/if}
								</div>
								<div class="match-row">
									<span class="slot" class:winner={bWon}>
										{slotLabel(m.slot_b_id)}
									</span>
									{#if bPick}
										<span class="pick-label">First pick</span>
									{/if}
								</div>
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
							<li class="chip chip-advance">
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
							<li class="chip chip-eliminate">
								<span class="chip-name">{slotLabel(e.slot_id)}</span>
								<span class="chip-record">{e.finalWins}-{e.finalLosses}</span>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</div>
	</div>
</section>

<style>
	.flow-bracket {
		background-color: #2a2622;
		border-radius: 0.5rem;
		padding: 1rem;
	}

	.grid-scroll {
		overflow-x: auto;
	}

	.grid {
		display: grid;
		gap: 0.5rem;
		min-width: max-content;
	}

	.round-header {
		color: var(--color-tan, #e8d8b8);
		opacity: 0.75;
		font-size: 0.75rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 0 0.25rem 0.25rem;
		border-bottom: 1px solid rgba(232, 216, 184, 0.15);
	}

	.gutter-header {
		text-align: left;
	}

	.bucket {
		background-color: #35302b;
		border: 1px solid rgba(232, 216, 184, 0.08);
		border-radius: 0.375rem;
		padding: 0.4rem 0.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		align-self: start;
	}

	.bucket-advance {
		border-color: rgba(120, 180, 100, 0.5);
	}

	.bucket-eliminate {
		border-color: rgba(180, 90, 70, 0.5);
	}

	.record-label {
		color: var(--color-tan, #e8d8b8);
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
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0.3rem 0.4rem;
		border-radius: 0.25rem;
		background-color: #2a2622;
		color: var(--color-tan, #e8d8b8);
		font-size: 0.75rem;
		text-decoration: none;
		transition: background-color 0.1s;
		min-width: 0;
	}

	.match:hover {
		background-color: #1f1c19;
	}

	.match-row {
		display: flex;
		align-items: baseline;
		gap: 0.3rem;
		min-width: 0;
	}

	.slot {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex: 1 1 auto;
	}

	.slot.winner {
		color: var(--color-orange, #d97706);
		font-weight: 700;
	}

	.pick-label {
		flex-shrink: 0;
		font-size: 0.55rem;
		opacity: 0.55;
		font-family: ui-monospace, monospace;
		color: var(--color-tan, #e8d8b8);
	}

	.map-label {
		flex-shrink: 0;
		font-size: 0.55rem;
		opacity: 0.55;
		font-family: ui-monospace, monospace;
		color: var(--color-tan, #e8d8b8);
		white-space: nowrap;
	}

	.gutter {
		background-color: #35302b;
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
		color: rgba(140, 200, 120, 0.95);
	}

	.gutter-label-eliminate {
		color: rgba(200, 110, 90, 0.95);
	}

	.gutter-empty {
		color: var(--color-tan, #e8d8b8);
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

	.chip-advance {
		background-color: rgba(120, 180, 100, 0.15);
		border-color: rgba(120, 180, 100, 0.5);
		color: rgba(180, 220, 170, 1);
	}

	.chip-eliminate {
		background-color: rgba(180, 90, 70, 0.12);
		border-color: rgba(180, 90, 70, 0.45);
		color: rgba(220, 170, 160, 1);
		opacity: 0.85;
	}

	.chip-name {
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
