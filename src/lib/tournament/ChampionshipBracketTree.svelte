<script lang="ts">
	import { resolve } from "$app/paths";
	import type { BracketResponse, BracketSlot } from "$lib/api-cloud";

	let {
		bracket,
		tournamentSlug,
		onMatchClick,
	}: {
		bracket: BracketResponse;
		tournamentSlug: string;
		// eslint-disable-next-line no-unused-vars -- param name is documentary
		onMatchClick: (matchId: string) => void;
	} = $props();

	function handleMatchClick(matchId: string, e: MouseEvent) {
		if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
		e.preventDefault();
		onMatchClick(matchId);
	}

	// Box / spacing geometry. Match-box height is fixed so the bracket math
	// stays exact regardless of slot name length (long names ellipsize).
	const MATCH_W = 200;
	const MATCH_H = 56;
	const COL_GAP = 64;
	const R1_GAP = 16; // extra vertical gap between adjacent R1 matches

	const slotsById = $derived.by(() => {
		const out: Record<string, BracketSlot> = {};
		for (const s of bracket.slots) out[s.slot_id] = s;
		return out;
	});

	function slotLabel(slotId: string | null): string {
		if (!slotId) return "—";
		const s = slotsById[slotId];
		if (!s) return "—";
		return s.discord_username ?? `seed ${s.championship_seed ?? "?"}`;
	}

	function roundTitle(roundNumber: number, totalRounds: number): string {
		if (roundNumber === totalRounds) return "Final";
		if (roundNumber === totalRounds - 1) return "Semifinal";
		if (roundNumber === totalRounds - 2) return "Quarterfinal";
		return `Round ${roundNumber}`;
	}

	// Build positioned match list + connector path list.
	type PositionedMatch = {
		match_id: string;
		round_index: number; // 0-based
		match_index: number; // 0-based within the round
		slot_a_id: string | null;
		slot_b_id: string | null;
		winner_slot_id: string | null;
		left: number;
		top: number;
		centerY: number;
		status: string;
	};

	const layout = $derived.by(() => {
		const rounds = [...bracket.rounds].sort(
			(a, b) => a.round_number - b.round_number,
		);
		if (rounds.length === 0) {
			return {
				matches: [] as PositionedMatch[],
				connectors: [] as string[],
				width: 0,
				height: 0,
			};
		}
		const r1Count = rounds[0].matches.length;
		// Unit cell = match height + r1 gap, so adjacent R1 matches sit
		// MATCH_H + R1_GAP apart center-to-center.
		const cell = MATCH_H + R1_GAP;

		const positions: PositionedMatch[] = [];
		// Index per round of match positions for connector wiring.
		const centersByRound: number[][] = rounds.map(() => []);

		rounds.forEach((round, rIdx) => {
			const span = Math.pow(2, rIdx); // R1 matches per match in this round
			round.matches.forEach((m, kIdx) => {
				const centerY = (kIdx + 0.5) * span * cell;
				const top = centerY - MATCH_H / 2;
				const left = rIdx * (MATCH_W + COL_GAP);
				positions.push({
					match_id: m.match_id,
					round_index: rIdx,
					match_index: kIdx,
					slot_a_id: m.slot_a_id,
					slot_b_id: m.slot_b_id,
					winner_slot_id: m.winner_slot_id,
					left,
					top,
					centerY,
					status: m.status,
				});
				centersByRound[rIdx][kIdx] = centerY;
			});
		});

		// Connectors: for each match in round R+1, draw two elbow paths from
		// the right edge of feeder matches 2k and 2k+1 in round R, into the
		// left edge of the target match.
		const connectors: string[] = [];
		for (let r = 1; r < rounds.length; r++) {
			rounds[r].matches.forEach((_target, kIdx) => {
				const targetCenter = centersByRound[r][kIdx];
				if (targetCenter == null) return;
				const targetLeft = r * (MATCH_W + COL_GAP);
				const sourceRight = (r - 1) * (MATCH_W + COL_GAP) + MATCH_W;
				const midX = (sourceRight + targetLeft) / 2;
				for (const fk of [2 * kIdx, 2 * kIdx + 1]) {
					const sourceCenter = centersByRound[r - 1]?.[fk];
					if (sourceCenter == null) continue;
					connectors.push(
						`M ${sourceRight} ${sourceCenter} L ${midX} ${sourceCenter} L ${midX} ${targetCenter} L ${targetLeft} ${targetCenter}`,
					);
				}
			});
		}

		const width = rounds.length * MATCH_W + (rounds.length - 1) * COL_GAP;
		const height = r1Count * cell - R1_GAP; // last row doesn't need trailing gap

		return { matches: positions, connectors, width, height };
	});
</script>

{#if bracket.rounds.length === 0}
	<p class="empty">The championship bracket hasn't started yet.</p>
{:else}
	<div class="bracket-scroll">
		<div
			class="bracket"
			style:width="{layout.width}px"
			style:height="{layout.height + 32}px"
		>
			<div class="round-headers" style:width="{layout.width}px">
				{#each bracket.rounds as round, i (round.round_id)}
					<div
						class="round-header"
						style:left="{i * (MATCH_W + COL_GAP)}px"
						style:width="{MATCH_W}px"
					>
						{roundTitle(round.round_number, bracket.rounds.length)}
					</div>
				{/each}
			</div>

			<div class="canvas" style:height="{layout.height}px">
				<svg
					class="connectors"
					viewBox="0 0 {layout.width} {layout.height}"
					preserveAspectRatio="none"
					style:width="{layout.width}px"
					style:height="{layout.height}px"
					aria-hidden="true"
				>
					{#each layout.connectors as d, i (i)}
						<path {d} class="connector" />
					{/each}
				</svg>

				{#each layout.matches as m (m.match_id)}
					{@const aWon =
						m.winner_slot_id === m.slot_a_id && m.winner_slot_id !== null}
					{@const bWon =
						m.winner_slot_id === m.slot_b_id && m.winner_slot_id !== null}
					<a
						class="match"
						class:decided={m.status === "complete" || m.status === "forfeit"}
						class:bye={m.status === "bye"}
						href="{resolve('/tournaments/[slug]', {
							slug: tournamentSlug,
						})}?match={m.match_id}"
						onclick={(e) => handleMatchClick(m.match_id, e)}
						style:left="{m.left}px"
						style:top="{m.top}px"
						style:width="{MATCH_W}px"
						style:height="{MATCH_H}px"
					>
						<div class="slot" class:winner={aWon}>
							{slotLabel(m.slot_a_id)}
						</div>
						<div class="slot" class:winner={bWon}>
							{m.status === "bye" ? "BYE" : slotLabel(m.slot_b_id)}
						</div>
					</a>
				{/each}
			</div>
		</div>
	</div>
{/if}

<style>
	.empty {
		color: var(--color-tan, #e8d8b8);
		opacity: 0.7;
		font-size: 0.875rem;
	}

	.bracket-scroll {
		overflow-x: auto;
		padding-bottom: 0.5rem;
	}

	.bracket {
		position: relative;
	}

	.round-headers {
		position: relative;
		height: 1.75rem;
		margin-bottom: 0.25rem;
	}

	.round-header {
		position: absolute;
		top: 0;
		color: var(--color-tan, #e8d8b8);
		opacity: 0.75;
		font-size: 0.75rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		text-align: center;
	}

	.canvas {
		position: relative;
	}

	.connectors {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}

	.connector {
		fill: none;
		stroke: rgba(232, 216, 184, 0.25);
		stroke-width: 1.5;
	}

	.match {
		position: absolute;
		display: flex;
		flex-direction: column;
		justify-content: stretch;
		background-color: #35302b;
		border: 1px solid rgba(232, 216, 184, 0.12);
		border-radius: 0.375rem;
		text-decoration: none;
		overflow: hidden;
		transition: border-color 0.1s;
	}

	.match:hover {
		border-color: var(--color-orange, #d97706);
	}

	/* Bye matches are pre-decided — dim them to keep the visual focus on
	   the real R1 contests. The winner slot keeps full opacity via .winner. */
	.match.bye {
		opacity: 0.6;
	}
	.match.bye .winner {
		opacity: 1;
	}

	.slot {
		flex: 1;
		display: flex;
		align-items: center;
		padding: 0 0.6rem;
		color: var(--color-tan, #e8d8b8);
		font-size: 0.8rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.slot + .slot {
		border-top: 1px solid rgba(232, 216, 184, 0.08);
	}

	.slot.winner {
		color: var(--color-orange, #d97706);
		font-weight: 700;
	}
</style>
