// How many leaders of each archetype sat the throne, cut by when they took it.
//
// The starting-archetype chart beside this one reads one leader per seat. Over
// the local 116-save corpus that is 214 of the 742 leaders the field's human
// seats actually had, so the distribution it draws is the opening's, not the
// game's — which is the complaint this answers ("it looks like everyone only
// plays Tactician, which is not really true after turn 40").
//
// Counted, one leader at a time, not weighted by how long anyone held the
// throne. The unit the request asks for is leaders ("the leader archetype
// graph not only for starting archetypes, but for all the leaders during the
// game"), and counting them is also what makes this chart and the starting one
// comparable: both bars are a number of things, so reading them side by side
// is what answers "and the non-starting ones?".
//
// A leader falls in the band their ACCESSION turn falls in — one leader, one
// band, nothing double-counted. Measured over the corpus, all 1,219
// <LeaderTurn> values are 1 or more, so these three bands partition every
// accession exactly once; bands with overlapping edges (the request's literal
// "0-40, 40-70") would not.
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

import type { LeaderArchetypeBand, Nullable } from "./types";

// Konstant's bands, as the request framed them: the opening, the middle, and
// what is left. Inclusive turn bounds; a null `to` is open-ended.
//
// Not derived from the corpus's own quantiles, deliberately — a band whose
// edges move with the corpus makes two readings of the same chart
// incomparable, and these edges are where the reported effect lives. Share of
// the band's attributed leaders across the local corpus: Schemer falls
// 19.9% → 6.1% → 4.2% and Tactician 16.8% → 11.2% → 6.5%, while Zealot climbs
// 4.9% → 11.7% → 22.0% and Commander 3.5% → 7.1% → 13.7%.
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
}

export interface SeatInput {
	game_id: string;
	player_index: number;
	is_winner: boolean;
	total_turns: number;
}

// The band an accession turn belongs to. The last band is open-ended, so a
// turn past every bound still lands somewhere and the result is never -1.
function bandIndex(turn: number): number {
	return BANDS.findIndex(({ to }) => to === null || turn <= to);
}

// One band per entry, in turn order, whether or not the corpus reaches it: an
// absent band and an empty one are the same claim here (nobody took the throne
// then), and a stable three-entry array is what lets the panel's switch render
// without branching on which bands exist.
//
// Three cuts and no fourth: the panel's All-turns segment sums these, which is
// the whole distribution exactly because each leader is in one band. A fourth
// field computed here could drift from its parts; a sum cannot.
export function buildLeaderArchetypes(
	reigns: ReignInput[],
	seats: SeatInput[],
): LeaderArchetypeBand[] {
	const seatKey = (game_id: string, player_index: number) =>
		`${game_id}|${player_index}`;
	const seatLookup = new Map(
		seats.map((s) => [seatKey(s.game_id, s.player_index), s]),
	);

	const tallies = BANDS.map(
		() => new Map<string, { leaders: number; wins: number }>(),
	);
	const leaderCounts = BANDS.map(() => 0);

	for (const r of reigns) {
		const seat = seatLookup.get(seatKey(r.game_id, r.player_index));
		// A leader whose seat isn't focal (an opponent's, or a nation the facet
		// excluded) is counted by nobody.
		if (!seat) continue;
		const i = bandIndex(r.start_turn);
		leaderCounts[i]++;
		// Left out of the rows but inside the band's total, so the panel can
		// report how much of the band no archetype could be credited for —
		// 92 of the corpus's 742 leaders — without inventing an eleventh
		// archetype to hold them.
		if (r.archetype === null) continue;
		const t = tallies[i].get(r.archetype) ?? { leaders: 0, wins: 0 };
		t.leaders++;
		if (seat.is_winner) t.wins++;
		tallies[i].set(r.archetype, t);
	}

	return BANDS.map(({ from, to }, i) => {
		// Distinct focal games that ran as far as the band's first turn. The
		// first band's is every game, so comparing a later band against it is
		// what says the 71+ band describes only the games that ran long — 81 of
		// the corpus's 116 reach turn 71.
		const games = new Set<string>();
		for (const s of seats) {
			if (s.total_turns >= from) games.add(s.game_id);
		}

		return {
			from,
			to,
			games: games.size,
			leaders: leaderCounts[i],
			rows: [...tallies[i].entries()].map(([archetype, t]) => ({
				archetype,
				leaders: t.leaders,
				wins: t.wins,
				rate: t.leaders > 0 ? t.wins / t.leaders : 0,
			})),
		};
	});
}
