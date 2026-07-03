<script lang="ts">
	import type { Snippet } from "svelte";
	import { resolve } from "$app/paths";
	import type { BracketResponse, MapPoolEntry } from "$lib/api-cloud";
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
		type MatchDisplayStatus,
		MATCH_STATUS_LABEL,
	} from "$lib/tournament/parts";
	import { mapScriptLabel } from "$lib/tournament/map-scripts";
	import { padMatchNumber } from "$lib/tournament/match-numbers";
	import {
		distinguishingOptions,
		mapPoolLabel,
		poolEntryById,
	} from "$lib/tournament/map-script-options";

	const MAP_ICON = SPRITE_MANIFEST["icons/MAP_OVERVIEW"];

	// Card status chip labels (see SwissFlowBracket). "unscheduled" is absent —
	// the default pending state shows no chip.

	let {
		bracket,
		tournamentSlug,
		mapPool,
		onMatchClick,
		footer,
	}: {
		bracket: BracketResponse;
		tournamentSlug: string;
		// The tournament's map_pool — used to resolve each match's assigned
		// instance (by map_pool_id) for its full map name.
		mapPool: MapPoolEntry[];
		// eslint-disable-next-line no-unused-vars -- param name is documentary
		onMatchClick: (matchId: string) => void;
		// Optional content rendered below the bracket, aligned to its first
		// column and centered with it — so it tracks the bracket rather than the
		// full panel width.
		footer?: Snippet;
	} = $props();

	// Options that vary across the pool — drives which variant the compact
	// map label on each match card surfaces.
	const distinguishing = $derived(distinguishingOptions(mapPool));

	function handleMatchClick(matchId: string, e: MouseEvent) {
		if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
		e.preventDefault();
		onMatchClick(matchId);
	}

	// Box / spacing geometry. Match-box height is fixed so the bracket math
	// stays exact regardless of slot name length (long names ellipsize).
	const MATCH_W = 200;
	const MATCH_H = 94; // two slot rows + map-name row + status chip row
	const COL_GAP = 64;
	const R1_GAP = 16; // extra vertical gap between adjacent R1 matches

	// Live (current-occupant) lookup maps used as fall-through for pending
	// matches and for synthesized placeholder cells in unreported rounds.
	const liveLabelBySlot = $derived.by(() => {
		const out: Record<string, string> = {};
		for (const s of bracket.slots) {
			out[s.slot_id] = s.display_name ?? `seed ${s.championship_seed ?? "?"}`;
		}
		return out;
	});

	const liveAvatarBySlot = $derived.by(() => {
		const out: Record<string, string | null> = {};
		for (const s of bracket.slots) {
			out[s.slot_id] = s.avatar_url;
		}
		return out;
	});

	function matchLabel(m: PositionedMatch, side: "a" | "b"): string {
		return matchSlotDisplayName(m, side, liveLabelBySlot) ?? "—";
	}

	function matchAvatar(m: PositionedMatch, side: "a" | "b"): string | null {
		return matchSlotAvatarUrl(m, side, liveAvatarBySlot);
	}

	// Slot text for display. An empty slot in a placeholder (not-yet-generated)
	// match reads "TBD" — its player isn't known until the feeder match decides.
	function slotDisplay(m: PositionedMatch, side: "a" | "b"): string {
		const slotId = side === "a" ? m.slot_a_id : m.slot_b_id;
		if (slotId) return matchLabel(m, side);
		return m.is_placeholder ? "TBD" : "—";
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
		status: "pending" | "complete" | "forfeit" | "bye";
		// Parts-refined status for the card chip (null on placeholders/byes).
		display_status: MatchDisplayStatus | null;
		is_placeholder: boolean;
		// Server-assigned "Match N" (null on byes and synthesized placeholders).
		match_number: number | null;
		// Snapshot-derived fields propagated from the underlying real match
		// (migration 0024). NULL on synthesized placeholders and on
		// still-pending matches.
		slot_a_display_name: string | null;
		slot_a_user_id: string | null;
		slot_a_avatar_url: string | null;
		slot_a_nation: string | null;
		slot_b_display_name: string | null;
		slot_b_user_id: string | null;
		slot_b_avatar_url: string | null;
		slot_b_nation: string | null;
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
		status: "pending" | "complete" | "forfeit" | "bye";
		display_status: MatchDisplayStatus | null;
		is_placeholder: boolean;
		// Server-assigned "Match N" (null on byes and synthesized placeholders).
		match_number: number | null;
		slot_a_display_name: string | null;
		slot_a_user_id: string | null;
		slot_a_avatar_url: string | null;
		slot_a_nation: string | null;
		slot_b_display_name: string | null;
		slot_b_user_id: string | null;
		slot_b_avatar_url: string | null;
		slot_b_nation: string | null;
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
				display_status: matchDisplayStatus(m),
				is_placeholder: false,
				match_number: m.match_number,
				slot_a_display_name: m.slot_a_display_name,
				slot_a_user_id: m.slot_a_user_id,
				slot_a_avatar_url: m.slot_a_avatar_url,
				slot_a_nation: m.slot_a_nation,
				slot_b_display_name: m.slot_b_display_name,
				slot_b_user_id: m.slot_b_user_id,
				slot_b_avatar_url: m.slot_b_avatar_url,
				slot_b_nation: m.slot_b_nation,
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
					display_status: null,
					is_placeholder: true,
					match_number: null,
					slot_a_display_name: null,
					slot_a_user_id: null,
					slot_a_avatar_url: null,
					slot_a_nation: null,
					slot_b_display_name: null,
					slot_b_user_id: null,
					slot_b_avatar_url: null,
					slot_b_nation: null,
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
					display_status: m.display_status,
					is_placeholder: m.is_placeholder,
					match_number: m.match_number,
					slot_a_display_name: m.slot_a_display_name,
					slot_a_user_id: m.slot_a_user_id,
					slot_a_avatar_url: m.slot_a_avatar_url,
					slot_a_nation: m.slot_a_nation,
					slot_b_display_name: m.slot_b_display_name,
					slot_b_user_id: m.slot_b_user_id,
					slot_b_avatar_url: m.slot_b_avatar_url,
					slot_b_nation: m.slot_b_nation,
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
					<!-- Both real matches and synthesized placeholder cells render as
					     anchors so admins can open the match popover from either. The
					     popover detects placeholders by match_id and renders a
					     stripped-down preview (no map / no retro / no upload; the
					     substitute pencil stays live on resolved feeder sides). -->
					<a
						class="match"
						class:placeholder={m.is_placeholder}
						class:decided={m.status === "complete" || m.status === "forfeit"}
						data-match-id={m.match_id}
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
				{/each}
			</div>
		</div>
		{#if footer}
			<div class="bracket-footer" style:width="{layout.width}px">
				{@render footer()}
			</div>
		{/if}
	</div>
{/if}

{#snippet matchBody(m: PositionedMatch)}
	{@const aWon = m.winner_slot_id === m.slot_a_id && m.winner_slot_id !== null}
	{@const bWon = m.winner_slot_id === m.slot_b_id && m.winner_slot_id !== null}
	{@const aNation = matchSlotNation(m, "a")}
	{@const bNation = matchSlotNation(m, "b")}
	{#if m.match_number != null}
		<span class="match-num">{padMatchNumber(m.match_number)}</span>
	{/if}
	<div
		class="slot"
		class:winner={aWon}
		class:tbd={m.is_placeholder && !m.slot_a_id}
	>
		{#if m.slot_a_id}
			{#if aNation}
				<SpriteIcon
					category="crests"
					value={aNation}
					size={14}
					alt={formatEnum(aNation, "NATION_")}
				/>
			{/if}
			<PlayerAvatar avatarUrl={matchAvatar(m, "a")} size={14} />
		{/if}
		<span class="slot-name">{slotDisplay(m, "a")}</span>
	</div>
	<div
		class="slot"
		class:winner={bWon}
		class:tbd={m.is_placeholder && !m.slot_b_id}
	>
		{#if m.status !== "bye" && m.slot_b_id}
			{#if bNation}
				<SpriteIcon
					category="crests"
					value={bNation}
					size={14}
					alt={formatEnum(bNation, "NATION_")}
				/>
			{/if}
			<PlayerAvatar avatarUrl={matchAvatar(m, "b")} size={14} />
		{/if}
		<span class="slot-name" class:bye-label={m.status === "bye"}
			>{m.status === "bye" ? "Bye" : slotDisplay(m, "b")}</span
		>
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
	{#if m.display_status && m.display_status !== "unscheduled"}
		<span class="cm-status cm-status-{m.display_status}"
			>{MATCH_STATUS_LABEL[m.display_status]}</span
		>
	{/if}
{/snippet}

<style>
	.empty {
		color: rgb(var(--color-tan));
		opacity: 0.7;
		font-size: 0.875rem;
	}

	.bracket-scroll {
		overflow-x: auto;
		padding-bottom: 0.125rem;
	}

	.bracket {
		position: relative;
		/* Center within the scroll container when it fits; margins collapse to 0
		   and it scrolls from the left when wider than the view. */
		margin-inline: auto;
	}

	/* Centered with the bracket (so it tracks the first card's left edge), then
	   shifted 100px left so the note begins to the left of the first round cards.
	   The transform shifts it without disturbing the centering margins. */
	.bracket-footer {
		margin-inline: auto;
		padding-top: 2rem;
		transform: translateX(-100px);
	}

	.round-headers {
		position: relative;
		height: 1.75rem;
		margin-bottom: 0.25rem;
	}

	.round-header {
		position: absolute;
		top: 0;
		color: rgb(var(--color-tan));
		opacity: 0.75;
		font-size: 0.75rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		text-align: center;
		padding-bottom: 0.25rem;
		border-bottom: 1px solid rgb(var(--color-tan-light) / 0.15);
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
		stroke: rgb(var(--color-tan-light) / 0.25);
		stroke-width: 1.5;
	}

	.match {
		position: absolute;
		display: flex;
		flex-direction: column;
		justify-content: stretch;
		background-color: rgb(var(--color-surface-raised));
		border: 1px solid rgb(var(--color-tan-light) / 0.12);
		border-radius: 0.375rem;
		text-decoration: none;
		overflow: hidden;
		transition: background-color 0.1s;
	}

	/* Server-assigned "Match N" badge, mirrored from SwissFlowBracket so the
	   two bracket surfaces read the same. Absolutely positioned in the card's
	   top-right (the card is position:absolute, so it's the containing block);
	   sits above the slot rows and stays out of hit-testing. */
	.match-num {
		position: absolute;
		top: 0.2rem;
		right: 0.35rem;
		font-family: ui-monospace, monospace;
		font-size: 0.6rem;
		line-height: 1;
		color: rgb(var(--color-tan));
		opacity: 0.45;
		pointer-events: none;
	}

	.match:hover {
		background-color: rgb(var(--color-surface));
	}

	/* Placeholder matches stand in for rounds the backend hasn't generated
	   yet. A dashed border + flatter background marks them as not-yet-live
	   without dimming the whole box, so any already-known advancer stays
	   legible (TBD slots are muted separately via .slot.tbd). They're still
	   clickable — the popover opens in preview mode so admins can substitute
	   a resolved feeder ahead of the round being generated. */
	.match.placeholder {
		background-color: rgb(var(--color-surface-sunken));
		border-style: dashed;
	}
	.match.placeholder:hover {
		background-color: rgb(var(--color-surface-sunken-hover));
	}

	.slot {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0 0.6rem;
		color: rgb(var(--color-tan));
		font-size: 0.8rem;
		overflow: hidden;
	}

	.slot-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* The bye placeholder reads as a label, not a player name — same size,
	   weight, and color as the player text (inherited from .slot), italic. */
	.bye-label {
		font-style: italic;
	}

	.slot + .slot {
		border-top: 1px solid rgb(var(--color-tan-light) / 0.08);
	}

	.slot.winner {
		color: rgb(var(--color-orange));
		font-weight: 700;
	}

	/* An undetermined slot in a placeholder match. */
	.slot.tbd {
		color: rgb(var(--color-tan-light) / 0.4);
		font-style: italic;
	}

	.map-row {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		min-width: 0;
		padding: 0.2rem 0.6rem;
		border-top: 1px solid rgb(var(--color-tan-light) / 0.08);
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

	/* Per-match status chip — scheduled / in progress / completed (see
	   SwissFlowBracket for the shared palette). Unscheduled renders none. */
	.cm-status {
		align-self: flex-start;
		margin: 0.15rem 0.4rem 0;
		padding: 0.02rem 0.3rem;
		border-radius: 0.2rem;
		font-size: 0.55rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		line-height: 1.5;
	}
	.cm-status-scheduled {
		background-color: rgb(var(--color-tan-light) / 0.14);
		color: rgb(var(--color-tan-light));
	}
	.cm-status-in_progress {
		background-color: rgb(var(--color-orange) / 0.18);
		color: rgb(var(--color-orange));
	}
	.cm-status-completed {
		background-color: rgb(var(--color-success) / 0.14);
		color: rgb(var(--color-success));
		opacity: 0.85;
	}
</style>
