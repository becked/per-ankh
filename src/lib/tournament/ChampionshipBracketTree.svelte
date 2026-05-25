<script lang="ts">
	import { resolve } from "$app/paths";
	import type {
		BracketResponse,
		BracketSlot,
		MapPoolEntry,
	} from "$lib/api-cloud";
	import { SPRITE_MANIFEST } from "$lib/generated/sprite-manifest";
	import PlayerAvatar from "$lib/tournament/PlayerAvatar.svelte";
	import { mapScriptLabel } from "$lib/tournament/map-scripts";
	import {
		mapFullName,
		poolEntryById,
	} from "$lib/tournament/map-script-options";

	const MAP_ICON = SPRITE_MANIFEST["icons/MAP_OVERVIEW"];

	let {
		bracket,
		tournamentSlug,
		mapPool,
		onMatchClick,
	}: {
		bracket: BracketResponse;
		tournamentSlug: string;
		// The tournament's map_pool — used to resolve each match's assigned
		// instance (by map_pool_id) for its full map name.
		mapPool: MapPoolEntry[];
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
	const MATCH_H = 78; // two slot rows + a full-width map-name row
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

	function slotAvatar(slotId: string | null): string | null {
		if (!slotId) return null;
		return slotsById[slotId]?.avatar_url ?? null;
	}

	// Slot text for display. An empty slot in a placeholder (not-yet-generated)
	// match reads "TBD" — its player isn't known until the feeder match decides.
	function slotDisplay(slotId: string | null, isPlaceholder: boolean): string {
		if (slotId) return slotLabel(slotId);
		return isPlaceholder ? "TBD" : "—";
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
		map_pool_id: string | null;
		map_script: string | null;
		left: number;
		top: number;
		centerY: number;
		status: string;
		is_placeholder: boolean;
	};

	// A match in the bracket model: either a real DB match or a synthesized
	// placeholder standing in for a future round.
	type BracketMatch = {
		match_id: string; // real match_id, or a synthetic key for placeholders
		slot_a_id: string | null;
		slot_b_id: string | null;
		winner_slot_id: string | null;
		map_pool_id: string | null;
		map_script: string | null;
		status: string;
		is_placeholder: boolean;
	};

	type BracketRoundModel = {
		round_id: string;
		round_number: number;
		matches: BracketMatch[];
	};

	// The championship's full round structure, including rounds the backend
	// hasn't generated yet. Future rounds are materialized lazily server-side
	// (a round is only created once the prior round completes), so to render
	// the complete bracket we synthesize the missing rounds here.
	//
	// Bracket depth is fixed by round 1's match count: R1 holds bracket_size/2
	// matches and the field halves each round down to a single final, so
	// totalRounds = log2(r1Count) + 1. bracket_size is always a power of two,
	// so r1Count is too and the log is exact.
	//
	// A synthesized match pre-fills a slot only when its feeder match already
	// has a winner (a completed match or a bye); otherwise the slot stays null
	// and renders as "TBD". Synthesized matches never carry a winner of their
	// own, so prefill only ever propagates outward from real, decided matches.
	const fullRounds = $derived.by<BracketRoundModel[]>(() => {
		const real = [...bracket.rounds].sort(
			(a, b) => a.round_number - b.round_number,
		);
		if (real.length === 0) return [];

		const model: BracketRoundModel[] = real.map((r) => ({
			round_id: r.round_id,
			round_number: r.round_number,
			matches: r.matches.map((m) => ({
				match_id: m.match_id,
				slot_a_id: m.slot_a_id,
				slot_b_id: m.slot_b_id,
				winner_slot_id: m.winner_slot_id,
				map_pool_id: m.map_pool_id,
				map_script: m.map_script,
				status: m.status,
				is_placeholder: false,
			})),
		}));

		const r1Count = model[0].matches.length;
		const totalRounds = Math.round(Math.log2(r1Count)) + 1;

		// Append synthesized rounds until the bracket reaches full depth. Round
		// numbers are contiguous from 1, so the next round's number is always
		// the current model length + 1, and its feeder is the prior round.
		for (
			let roundNumber = model.length + 1;
			roundNumber <= totalRounds;
			roundNumber++
		) {
			const prior = model[roundNumber - 2];
			const matches: BracketMatch[] = [];
			for (let k = 0; k < prior.matches.length / 2; k++) {
				const feederA = prior.matches[2 * k];
				const feederB = prior.matches[2 * k + 1];
				matches.push({
					match_id: `placeholder-r${roundNumber}-m${k}`,
					slot_a_id: feederA?.winner_slot_id ?? null,
					slot_b_id: feederB?.winner_slot_id ?? null,
					winner_slot_id: null,
					map_pool_id: null,
					map_script: null,
					status: "pending",
					is_placeholder: true,
				});
			}
			model.push({
				round_id: `placeholder-round-${roundNumber}`,
				round_number: roundNumber,
				matches,
			});
		}

		return model;
	});

	const layout = $derived.by(() => {
		const rounds = fullRounds;
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
					map_pool_id: m.map_pool_id,
					map_script: m.map_script,
					left,
					top,
					centerY,
					status: m.status,
					is_placeholder: m.is_placeholder,
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
				{#each fullRounds as round, i (round.round_id)}
					<div
						class="round-header"
						style:left="{i * (MATCH_W + COL_GAP)}px"
						style:width="{MATCH_W}px"
					>
						{roundTitle(round.round_number, fullRounds.length)}
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
					<!-- Real matches link to their match modal; placeholder matches
					     (future rounds the backend hasn't generated yet) aren't
					     clickable, so they render as a plain, non-interactive box.
					     Both share the same inner layout via the matchBody snippet. -->
					{#if m.is_placeholder}
						<div
							class="match placeholder"
							style:left="{m.left}px"
							style:top="{m.top}px"
							style:width="{MATCH_W}px"
							style:height="{MATCH_H}px"
						>
							{@render matchBody(m)}
						</div>
					{:else}
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
							{@render matchBody(m)}
						</a>
					{/if}
				{/each}
			</div>
		</div>
	</div>
{/if}

{#snippet matchBody(m: PositionedMatch)}
	{@const aWon = m.winner_slot_id === m.slot_a_id && m.winner_slot_id !== null}
	{@const bWon = m.winner_slot_id === m.slot_b_id && m.winner_slot_id !== null}
	<div
		class="slot"
		class:winner={aWon}
		class:tbd={m.is_placeholder && !m.slot_a_id}
	>
		{#if m.slot_a_id}
			<PlayerAvatar avatarUrl={slotAvatar(m.slot_a_id)} size={14} />
		{/if}
		<span class="slot-name">{slotDisplay(m.slot_a_id, m.is_placeholder)}</span>
	</div>
	<div
		class="slot"
		class:winner={bWon}
		class:tbd={m.is_placeholder && !m.slot_b_id}
	>
		{#if m.status !== "bye" && m.slot_b_id}
			<PlayerAvatar avatarUrl={slotAvatar(m.slot_b_id)} size={14} />
		{/if}
		<span class="slot-name"
			>{m.status === "bye"
				? "BYE"
				: slotDisplay(m.slot_b_id, m.is_placeholder)}</span
		>
	</div>
	{#if m.map_script}
		{@const entry = poolEntryById(mapPool, m.map_pool_id)}
		{@const mapName = entry
			? mapFullName(entry.options, entry.script)
			: mapScriptLabel(m.map_script)}
		<div class="map-row" title={mapName}>
			<img class="map-icon" src={MAP_ICON} alt="" />
			<span class="map-name">{mapName}</span>
		</div>
	{/if}
{/snippet}

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
		padding-bottom: 0.25rem;
		border-bottom: 1px solid rgba(232, 216, 184, 0.15);
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
		transition: background-color 0.1s;
	}

	.match:hover {
		background-color: #2a2622;
	}

	/* Bye matches are pre-decided — dim them to keep the visual focus on
	   the real R1 contests. The winner slot keeps full opacity via .winner. */
	.match.bye {
		opacity: 0.6;
	}
	.match.bye .winner {
		opacity: 1;
	}

	/* Placeholder matches stand in for rounds the backend hasn't generated
	   yet. A dashed border + flatter background marks them as not-yet-live
	   without dimming the whole box, so any already-known advancer stays
	   legible (TBD slots are muted separately via .slot.tbd). */
	.match.placeholder {
		background-color: #2b2723;
		border-style: dashed;
		cursor: default;
	}
	.match.placeholder:hover {
		background-color: #2b2723;
	}

	.slot {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0 0.6rem;
		color: var(--color-tan, #e8d8b8);
		font-size: 0.8rem;
		overflow: hidden;
	}

	.slot-name {
		min-width: 0;
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

	/* An undetermined slot in a placeholder match. */
	.slot.tbd {
		color: rgba(232, 216, 184, 0.4);
		font-style: italic;
	}

	.map-row {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		min-width: 0;
		padding: 0.2rem 0.6rem;
		border-top: 1px solid rgba(232, 216, 184, 0.08);
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
		color: var(--color-tan, #e8d8b8);
	}
</style>
