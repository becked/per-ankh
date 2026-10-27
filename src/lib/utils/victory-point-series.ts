// A per-turn victory-points series ends on the game's end state, not on its
// own last sample.
//
// The save's `<PointsHistory>` records `countVP()` at the START of each seat's
// turn, and `setTurnPoints` writes only on a change, so the last recorded
// sample can predate the save by many turns and misses everything the final
// turn did — `$lib/game-detail/victory-points` carries the game-source
// citations and recomputes the real total. A line left ending on that sample
// contradicts the total the same page's Victory Points metric bar shows for
// the same seat (#340).
//
// Three charts draw such a series — the game page's Victory Points chart, the
// tournament match popover's sparkline, the home card's sparkline — and they
// have to answer a missing total the same way, which is why the rule is here
// and not three times over. Where there is no total the series stands exactly
// as recorded: a blob too old to recompute from, a game that cannot be won on
// points, a mod that grants points of its own, or a `final_points` column
// written before the recomputation shipped.
//
// Nothing marks the substituted point. Every game-detail time-series line
// runs symbols-on-hover-only (`filledLineStyle`), and the number the reader
// is being shown is the one the metric bar, the stat tile and the stats
// corpus all already carry — so the line ends where those say it ends.

/**
 * `data` — the `[turn, value]` pairs an ECharts line series takes — with the
 * value of its last point replaced by `endStateTotal`. Returned unchanged
 * when there is no total to substitute, or no point to carry it.
 */
export function withEndStateTotal(
	data: Array<[number, number | null]>,
	endStateTotal: number | null | undefined,
): Array<[number, number | null]> {
	if (endStateTotal == null || data.length === 0) return data;
	const [turn] = data[data.length - 1];
	return [...data.slice(0, -1), [turn, endStateTotal]];
}
