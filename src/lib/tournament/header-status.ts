// Tournament status → display state, for the tournament detail page's header and
// for the status chip on any surface that names a tournament (the player
// profile's Tournaments tab groups).
//
// The four mockup states collapse our status FSM + the signups_open flag into
// one of four display states, each with its own chip label/color and a "hero
// strip" beneath the header:
//
//   setup       — status='setup', signups closed → "Getting started" CTA
//   signups     — status='setup', signups_open   → signed-up count + Start
//   in-progress — status='swiss' | 'championship' → round progress bar
//   complete    — status='complete'              → champion card
//
// Chip styling matches the existing tournament list pills
// (TournamentRowCard): a single muted amber-700/40 background with the text
// color carrying the state — orange for active/attention (sign-ups, in
// progress), tan for neutral setup, dimmed tan for complete. Brand tan +
// orange only; no off-brand teal/green/amber-300.

import type { TournamentStatus } from "$lib/api-cloud";

export type HeaderStatusKey = "setup" | "signups" | "in-progress" | "complete";

export interface HeaderStatusMeta {
	key: HeaderStatusKey;
	label: string;
	// Chip classes: text + border + background, tuned per state.
	chipClass: string;
}

export function headerStatusMeta(
	status: TournamentStatus,
	signupsOpen: boolean,
): HeaderStatusMeta {
	switch (status) {
		case "setup":
			return signupsOpen
				? {
						key: "signups",
						label: "Sign-ups open",
						chipClass: "bg-amber-700/40 text-orange",
					}
				: {
						key: "setup",
						label: "Setup",
						chipClass: "bg-amber-700/40 text-tan",
					};
		case "swiss":
		case "championship":
			return {
				key: "in-progress",
				label: "In progress",
				chipClass: "bg-amber-700/40 text-orange",
			};
		case "complete":
			return {
				key: "complete",
				label: "Complete",
				chipClass: "bg-amber-700/40 text-tan opacity-60",
			};
	}
}

// The hero strip's per-state content. The page computes this from its loaded
// matches/bracket/standings; the header component renders it.
export type HeaderHero =
	| { kind: "setup" }
	| {
			kind: "signups";
			signedUp: number;
			divisionAName: string;
			divisionACount: number;
			divisionBName: string;
			divisionBCount: number;
	  }
	| {
			kind: "in-progress";
			phaseLabel: string;
			// "Round 2" — or "Rounds 2–3" while the divisions' independently
			// generated rounds are split (one finishes its round and starts the
			// next before the other catches up).
			roundLabel: string;
			totalRounds: number;
			// One Swiss lane per division: a cell per Swiss round, the division's
			// OPEN round rendered as per-match pills and the others as solid
			// fills (full for played rounds, empty for ungenerated ones). Byes
			// are excluded throughout. `label` renders beneath the lane;
			// reported/total are the open round's counts for the side column.
			divisions: Array<{
				label: string;
				reported: number;
				total: number;
				rounds: Array<{ done: number; total: number; current: boolean }>;
			}>;
			// The single bar both lanes merge into — the divisions play Swiss
			// apart and reunite in one championship bracket. Pills once the
			// bracket is live; until then `total` is the PROJECTED bracket size
			// (every advancer, single-elim → qualifiers − 1) at the midpoint of
			// its envelope, surfaced as "N matches · awaiting Swiss". `exact` is
			// false while Swiss results still in flight can change the qualifier
			// count.
			championship: {
				reported: number;
				total: number;
				active: boolean;
				exact: boolean;
			};
			// Whole-tournament tally (byes excluded): matches played so far vs the
			// PROJECTED eventual total — existing matches plus a census-walk
			// projection of the remaining Swiss rounds and the qualifiers-sized
			// championship bracket (see projected-totals.ts). The projection is a
			// min/max envelope and this is its MIDPOINT — "~N" reads as "about
			// N", so naming the ceiling would keep the denominator high and
			// progress reading behind. `projectedExact` is false while results
			// still in flight can swing the total (shown as "~N").
			playedOverall: number;
			projectedTotal: number;
			projectedExact: boolean;
	  }
	| {
			kind: "complete";
			champion: string | null;
			finalist: string | null;
			// The accounts behind those two names, so the hero cards can link them,
			// each with the profile slug that shapes its URL. Resolved from the live
			// slot maps by the page, alongside the labels — null for an unclaimed
			// slot, and for the finalist whenever `finalist` is. A slug is null
			// again whenever the account has none; the link still renders,
			// against the id permalink.
			championUserId: string | null;
			championSlug: string | null;
			finalistUserId: string | null;
			finalistSlug: string | null;
			// Champion subtitle, e.g. "Won the final on Duel Continent Mirror in 68
			// turns" — the map name comes from the final's pool entry, the turn
			// count from the linked game (omitted when no game was uploaded).
			finalSummary: string | null;
			// Championship field size, for the runner-up's "Finished 2nd of N".
			fieldSize: number;
	  };
