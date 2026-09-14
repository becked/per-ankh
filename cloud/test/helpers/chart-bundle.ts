// Canonicalize a chart bundle so two runs over the same fixture compare equal.
//
// Two things stop a bundle from being stable on its own.
//
// Most of its object arrays are assembled by walking a Map whose insertion
// order follows D1 rows returned with no ORDER BY (wonderStats, familyByNation,
// lawTiming, openingLaws, techFirst, techTiming, capitalFamilyWinRate). That
// order is not part of the bundle's contract — the frontend ranks and filters
// these itself — so it must not be part of a snapshot either.
//
// And a few fields carry per-run identifiers: save_dates repeats each game's
// nanoid, and recordGames is *keyed* by one. The caller supplies the mapping
// from those to fixture-stable placeholders, since only the fixture knows
// which id is which; it is applied to object keys as well as values, because
// an id is no more stable for being used as a key.
//
// Only arrays *of objects* are sorted. Arrays of primitives are either
// index-aligned against yieldCurves.turns (every band and count array) or
// already sorted by the aggregator (openingLaws' law sets, a wonder's build
// turns), so reordering one would hide a defect rather than normalize it.
//
// One ordering the aggregator does own is `nations`, sorted by games_played
// descending. Canonicalizing flattens that, so the round-trip test asserts it
// separately rather than relying on the snapshot to carry it.

export function canonicalizeBundle(
	value: unknown,
	redactions: Readonly<Record<string, string>>,
): unknown {
	if (typeof value === "string") return redactions[value] ?? value;

	if (Array.isArray(value)) {
		const items = value.map((v) => canonicalizeBundle(v, redactions));
		if (!items.every(isPlainObject)) return items;
		// Sort on the canonicalized element's own JSON — no per-field key to
		// keep in sync as fields are added, and every field participates in the
		// ordering, so two rows differing anywhere sort stably.
		return items
			.map((item) => ({ item, key: JSON.stringify(item) }))
			.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
			.map(({ item }) => item);
	}

	if (isPlainObject(value)) {
		// Keys sorted so the snapshot doesn't move when a field is declared in a
		// different place. Object key order carries no meaning in JSON.
		const out: Record<string, unknown> = {};
		const keys = Object.keys(value)
			.map((key) => [redactions[key] ?? key, key] as const)
			.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
		for (const [canonical, key] of keys) {
			out[canonical] = canonicalizeBundle(value[key], redactions);
		}
		return out;
	}

	return value;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}
