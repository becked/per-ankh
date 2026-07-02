// Zero-padded display form of a match's server-assigned "Match N" (persisted
// `match_number`, migration 0030): append-only per tournament, never
// renumbered — a public handle admins paste into Discord. Read straight off
// `match.match_number` at each display site (bracket-card badge, popover
// header). Byes/placeholders are null and render as empty. e.g. 1 -> "001";
// width grows past 999 if needed.
export function padMatchNumber(n: number | undefined | null): string {
	return n == null ? "" : String(n).padStart(3, "0");
}
