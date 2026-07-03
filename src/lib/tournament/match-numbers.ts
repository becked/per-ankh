// Zero-padded display form of a match's server-assigned "Match N" (persisted
// `match_number`, migration 0030): append-only per tournament, never
// renumbered — a public handle admins paste into Discord. Callers read
// `match.match_number` straight off the row and guard `!= null` (byes and
// synthesized placeholders are null) before calling, so this takes a definite
// number. Reserved for the column-aligned card badges (Swiss + championship),
// where the fixed width keeps numbers aligned; flowing text like the popover
// header shows the raw number instead. e.g. 1 -> "001"; width grows past 999
// if needed.
export function padMatchNumber(n: number): string {
	return String(n).padStart(3, "0");
}
