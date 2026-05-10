// Strict numeric semver compare for PARSER_VERSION strings ("X.Y.Z").
// No pre-release/build suffix support — the parser version never carries one.
// Mirrors the `compareSemver` helper in cloud/src/games.ts; intentionally
// not shared via a common module since the two code paths run in different
// runtimes (Worker / browser) and the helper is three lines.

function compare(a: string, b: string): number {
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
	return compare(a, b) > 0;
}
