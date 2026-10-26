// Strict numeric semver compare for PARSER_VERSION strings ("X.Y.Z").
// No pre-release/build suffix support — the parser version never carries one.
//
// The one comparator for both runtimes. The Worker reaches it the way it
// reaches gdp-basket.ts and victory-points.ts — a relative import of a module
// that drags nothing with it — rather than keeping a three-line mirror that
// can drift from this one.

/** -1, 0 or 1 for a < b, a == b, a > b. Non-numeric segments compare as 0. */
export function compareSemver(a: string, b: string): number {
	// `|| 0` (not `?? 0`) on purpose: parseInt returns NaN for a non-numeric
	// segment, and NaN is falsy — `?? 0` would let NaN through and poison the
	// comparison.
	const pa = a.split(".").map((s) => parseInt(s, 10) || 0);
	const pb = b.split(".").map((s) => parseInt(s, 10) || 0);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const da = pa[i] ?? 0;
		const db = pb[i] ?? 0;
		if (da < db) return -1;
		if (da > db) return 1;
	}
	return 0;
}

export function isNewer(a: string, b: string): boolean {
	return compareSemver(a, b) > 0;
}
