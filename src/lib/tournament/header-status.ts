// Header status derivation for the tournament detail page.
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
			round: number;
			totalRounds: number;
			// Current-round match reporting (the actionable detail shown as text).
			reported: number;
			total: number;
			// Whole-tournament progress (0–1) for the header bar. Swiss occupies
			// 0–0.5 and the championship 0.5–1, each filled by completed rounds plus
			// partial credit for the in-progress round, so reaching the bracket
			// reads as half-done regardless of the current round's reporting.
			overall: number;
	  }
	| {
			kind: "complete";
			champion: string | null;
			finalist: string | null;
			// Champion subtitle, e.g. "Won the final on Duel Continent Mirror in 68
			// turns" — the map name comes from the final's pool entry, the turn
			// count from the linked game (omitted when no game was uploaded).
			finalSummary: string | null;
			// Championship field size, for the runner-up's "Finished 2nd of N".
			fieldSize: number;
	  };
