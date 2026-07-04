import type { Division, TournamentMatch } from "$lib/api-cloud";

// The minimal tournament shape the labelers need: its two configurable division
// names. TournamentDetail satisfies it, so callers pass the whole tournament.
interface DivisionNames {
	division_a_name: string;
	division_b_name: string;
}

// The configured display name for a division. The single source of the
// division→name mapping that was otherwise re-inlined as a
// `d === "A" ? division_a_name : division_b_name` ternary across the signup,
// signed-up, and match views.
export function divisionName(t: DivisionNames, division: Division): string {
	return division === "A" ? t.division_a_name : t.division_b_name;
}

// The bracket a match belongs to, as a short label: "Championship" for a
// championship-phase match, otherwise its division's configured name. Empty
// string when neither applies (a swiss match with no division — not expected,
// rendered as nothing rather than a stray label).
export function matchBracketLabel(
	t: DivisionNames,
	match: Pick<TournamentMatch, "phase" | "division">,
): string {
	if (match.phase === "championship") return "Championship";
	if (match.division) return divisionName(t, match.division);
	return "";
}
