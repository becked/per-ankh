import type { TournamentMatch } from "$lib/api-cloud";

// Global "Match N" numbering, shared by the bracket cards and the match
// popover so every surface agrees. The number itself is SERVER-assigned
// (persisted `match_number`, migration 0030) — append-only per tournament at
// round-generation, never renumbered — because it's a public handle admins
// paste into Discord. This helper just collects the field into the id→number
// map the display sites consume; byes carry null and drop out.
export function matchNumbers(matches: TournamentMatch[]): Map<string, number> {
	const map = new Map<string, number>();
	for (const m of matches) {
		if (m.match_number != null) map.set(m.match_id, m.match_number);
	}
	return map;
}

// Zero-padded display form, e.g. 1 -> "001". Width grows past 999 if needed.
export function padMatchNumber(n: number | undefined | null): string {
	return n == null ? "" : String(n).padStart(3, "0");
}
