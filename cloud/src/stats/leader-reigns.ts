// Which archetypes actually sat the throne, cut by turn band.
//
// The starting-archetype chart beside this one reads one leader per seat. That
// leader holds 8,578 of the local corpus's 18,055 leader-turns (47.5%) and is
// 214 of its 742 human-seat reigns, so the distribution it draws is the
// opening's, not the game's — which is the complaint this answers ("it looks
// like everyone only plays Tactician, which is not really true after turn 40").
// The median first reign is 39 turns, so that complaint lands one turn off the
// first band's edge.
//
// Weighted by LEADER-TURNS, not by reigns. A band is not single-valued per
// seat — of the 201 corpus seats that reach turns 41-70, 57 hold one leader
// through it, 89 hold two, 44 three and 10 four or more — so counting reigns
// equally would let a two-turn leader and a forty-turn leader say the same
// thing, which is the distortion the request is about. Leader-turns is the only
// weighting under which "share of the 41-70 band" is a well-formed sentence.
//
// What the bands describe, mechanically: a successor's archetype is a
// constrained player CHOICE, not a free pick and not a roll. Events carry a
// <SetArchetype> bonus applied through `PlayerBonus.doBonus`
// (PlayerBonus.cs:3038), which calls `Game.canAddTrait` with
// `bSetArchetype: true` — the flag that bypasses the "already has an
// archetype" refusal in `Game.canAddTrait` (Game.cs:10550). Counted over the
// current XML: 27 bonuses carry a <SetArchetype>, 105 event options grant one,
// and 14 event stories offer two or more archetypes as alternatives — the heir
// tutor family being the clearest (EVENTSTORY_STUDY_TACTICS_ARCHETYPES_RIVAL →
// Schemer/Zealot, STUDY_PHILOSOPHY → Builder/Zealot, STUDY_COMMERCE →
// Commander/Schemer, STUDY_MASTER_ORATION → Judge/Orator/Zealot).
//
// The weighted roll in `Character.generateArchetype` (Character.cs:8882) is the
// fallback: `Character.checkLifeEvent` (Character.cs:7621) runs doEventTrigger
// and doAddTrait first and returns if either fires, and
// `Character.doArchetype` (Character.cs:7758) refuses outright for a HUMAN
// player's sitting leader and for anyone at or below ADULT_AGE — so no archetype
// on this chart was rolled onto a throne already occupied by a human's leader.
// It can still have been rolled onto an adult heir before they acceded.
// `CHOOSE_ARCHETYPE` proper is setup-only (`Player.isAnyPickLater`,
// Player.cs:7468, gated on `!hasLeader()`).
//
// So this chart reports decisions players made, under a constraint that varies
// with what the tutor events dealt them — not the same claim as the
// starting-pick bar beside it.

import type { ArchetypeThroneTimeBand, Nullable } from "./types";

// Konstant's bands, as the request framed them: the opening, the middle, and
// what is left. Inclusive turn bounds; a null `to` is open-ended.
//
// Not derived from the corpus's own quantiles, deliberately — a band whose
// edges move with the corpus makes two readings of the same chart
// incomparable, and these edges are where the reported effect lives: across
// the local corpus Judge holds 5.8% → 18.7% → 15.4% of attributed throne-time,
// Zealot 5.0% → 7.0% → 20.0%, while Schemer falls 23.0% → 9.2% → 5.3% and
// Tactician 19.4% → 13.2% → 10.3%.
const BANDS: Array<{ from: number; to: Nullable<number> }> = [
	{ from: 1, to: 40 },
	{ from: 41, to: 70 },
	{ from: 71, to: null },
];

export interface ReignInput {
	game_id: string;
	player_index: number;
	archetype: string | null;
	start_turn: number;
	// Exclusive — see derive-leader-reigns.ts.
	end_turn: number;
}

export interface SeatInput {
	game_id: string;
	player_index: number;
	is_winner: boolean;
	total_turns: number;
}

// Leader-turns a reign spent inside [from, to]. Half-open on both sides: the
// reign covers [start_turn, end_turn) and the band covers [from, to + 1).
function overlap(
	reign: Pick<ReignInput, "start_turn" | "end_turn">,
	from: number,
	to: Nullable<number>,
): number {
	const bandEnd = to === null ? Number.POSITIVE_INFINITY : to + 1;
	return Math.max(
		0,
		Math.min(reign.end_turn, bandEnd) - Math.max(reign.start_turn, from),
	);
}

// One band per entry, in turn order, whether or not the corpus reaches it: an
// absent band and an empty one are the same claim here (nobody held the throne
// then), and a stable three-entry array is what lets the panel's band switch
// render without branching on which bands exist.
export function buildArchetypeThroneTime(
	reigns: ReignInput[],
	seats: SeatInput[],
): ArchetypeThroneTimeBand[] {
	const seatKey = (game_id: string, player_index: number) =>
		`${game_id}|${player_index}`;
	const seatLookup = new Map(
		seats.map((s) => [seatKey(s.game_id, s.player_index), s]),
	);

	return BANDS.map(({ from, to }) => {
		// Distinct games that reached the band's first turn. This is the
		// denominator the survivorship caveat needs: only 81 of the corpus's 116
		// games reach turn 71, so the last band describes the games that ran
		// long, and the panel says so beside the value.
		const games = new Set<string>();
		for (const s of seats) {
			if (s.total_turns >= from) games.add(s.game_id);
		}

		const tally = new Map<string, { turns: number; win_turns: number }>();
		let turns = 0;
		let unattributed = 0;
		for (const r of reigns) {
			const seat = seatLookup.get(seatKey(r.game_id, r.player_index));
			// A reign whose seat isn't focal (an opponent's, or a nation the
			// facet excluded) contributes nothing.
			if (!seat) continue;
			const held = overlap(r, from, to);
			if (held === 0) continue;
			turns += held;
			if (r.archetype === null) {
				unattributed += held;
				continue;
			}
			const t = tally.get(r.archetype) ?? { turns: 0, win_turns: 0 };
			t.turns += held;
			if (seat.is_winner) t.win_turns += held;
			tally.set(r.archetype, t);
		}

		return {
			from,
			to,
			games: games.size,
			turns,
			unattributed_turns: unattributed,
			rows: [...tally.entries()].map(([archetype, t]) => ({
				archetype,
				turns: t.turns,
				win_turns: t.win_turns,
				rate: t.turns > 0 ? t.win_turns / t.turns : 0,
			})),
		};
	});
}
