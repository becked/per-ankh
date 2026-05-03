// Deterministic row sorting for the parity diff.
//
// Diff inputs are sorted on read by configured sort keys, with ties broken
// by `dump_index` (always present per row from the dumper). This absorbs
// HashMap-iteration nondeterminism in the Rust source without touching it.

/**
 * Compare two scalar values that may be number, string, boolean, or null.
 * Null/undefined sort before everything else (consistent across both inputs).
 */
function compareScalars(a: unknown, b: unknown): number {
	const aAbsent = a === null || a === undefined;
	const bAbsent = b === null || b === undefined;
	if (aAbsent && bAbsent) return 0;
	if (aAbsent) return -1;
	if (bAbsent) return 1;

	if (typeof a === "number" && typeof b === "number") {
		if (a < b) return -1;
		if (a > b) return 1;
		return 0;
	}
	if (typeof a === "boolean" && typeof b === "boolean") {
		return Number(a) - Number(b);
	}
	const sa = String(a);
	const sb = String(b);
	if (sa < sb) return -1;
	if (sa > sb) return 1;
	return 0;
}

/**
 * Return a new array sorted by the given sort key fields in priority order.
 * Ties are broken by `dump_index` so identical sort-key tuples preserve a
 * stable order across both sides of the diff.
 */
export function sortRows<T extends Record<string, unknown>>(
	rows: T[],
	sortKeys: string[],
): T[] {
	const copy = rows.slice();
	copy.sort((a, b) => {
		for (const key of sortKeys) {
			const cmp = compareScalars(a[key], b[key]);
			if (cmp !== 0) return cmp;
		}
		const ai = a["dump_index"];
		const bi = b["dump_index"];
		if (typeof ai === "number" && typeof bi === "number") {
			return ai - bi;
		}
		return 0;
	});
	return copy;
}
