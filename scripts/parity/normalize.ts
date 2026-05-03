// Primitive value normalization for the parity diff.
//
// The diff tolerates a fixed set of differences that aren't real divergences
// (key ordering, null vs missing key, string whitespace, float precision
// noise). This module isolates those rules so the walker stays focused on
// structural traversal.

import type { ParityTolerances } from "./types.js";

export interface ResolvedTolerances {
	floatPrecisionDigits: number;
	trimStrings: boolean;
	nullEqMissing: boolean;
}

export const DEFAULT_TOLERANCES: ResolvedTolerances = {
	floatPrecisionDigits: 6,
	trimStrings: true,
	nullEqMissing: true,
};

export function resolveTolerances(t?: ParityTolerances): ResolvedTolerances {
	return {
		floatPrecisionDigits: t?.floatPrecisionDigits ?? DEFAULT_TOLERANCES.floatPrecisionDigits,
		trimStrings: t?.trimStrings ?? DEFAULT_TOLERANCES.trimStrings,
		nullEqMissing: t?.nullEqMissing ?? DEFAULT_TOLERANCES.nullEqMissing,
	};
}

export type PrimitiveResult =
	| { equal: true }
	| { equal: false; suspectEncoding?: boolean };

/**
 * Compare two primitive values under the configured tolerances. Both inputs
 * have already passed the null/missing collapse upstream — i.e. callers
 * should not invoke this with `(undefined, null)` if `nullEqMissing` is on.
 */
export function comparePrimitives(
	a: unknown,
	b: unknown,
	t: ResolvedTolerances,
): PrimitiveResult {
	if (a === b) return { equal: true };

	if (typeof a !== typeof b) return { equal: false };

	if (typeof a === "string" && typeof b === "string") {
		const sa = t.trimStrings ? a.trim() : a;
		const sb = t.trimStrings ? b.trim() : b;
		if (sa === sb) return { equal: true };
		// Same code-point length but different content → likely Unicode
		// normalization or encoding drift (NFC vs NFD, CRLF vs LF, etc.).
		// Surface this category distinctly in the report.
		if (sa.length === sb.length) {
			return { equal: false, suspectEncoding: true };
		}
		return { equal: false };
	}

	if (typeof a === "number" && typeof b === "number") {
		if (Number.isInteger(a) && Number.isInteger(b)) {
			return { equal: a === b };
		}
		const factor = Math.pow(10, t.floatPrecisionDigits);
		return { equal: Math.round(a * factor) === Math.round(b * factor) };
	}

	return { equal: false };
}

/** True if a value should be treated as "absent" under nullEqMissing. */
export function isAbsent(v: unknown, nullEqMissing: boolean): boolean {
	if (v === undefined) return true;
	if (nullEqMissing && v === null) return true;
	return false;
}
