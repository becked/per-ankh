// A selection — the typed question a client composes — and its canonical
// serialization.
//
// A selection names catalog keys and literal values and nothing else. It is
// never SQL and never a column name, which is the whole reason the compiler
// downstream has no injection surface to defend.
//
// The serialization is a query string rather than an opaque blob, for the
// reason every other view-state here is: it makes a question a URL, so the
// browser's back button walks the questions and a link to one is a link to the
// answer. `canonicalSelection` is what makes that URL *one* URL — params in a
// fixed order, filters and their values sorted, defaults dropped — so two
// spellings of the same question are one cache key at the edge rather than two.
//
// Parsing is strict, where the /stats facets are deliberately forgiving. The
// difference is which way a bad token fails: an unknown `?slice=` falls back to
// a neighbouring view, but a filter key this version doesn't have would have to
// be *dropped*, and dropping a filter widens the question. A sweep that quietly
// widens is the wrong failure mode (parseAdminGameFilter, games-scope.ts), and
// the same holds for a question — an answer over more games than were asked
// for reads exactly like the right answer. So an unknown key is a 400 naming
// it, and the one value that is clamped rather than refused is the row cap,
// which can only narrow.

import {
	DEFAULT_ROWS,
	MAX_DIMENSIONS,
	MAX_FILTERS,
	MAX_FILTER_VALUES,
	MAX_ROWS,
	dimensionByKey,
	filterByKey,
	measureByKey,
	sourceByKey,
	type CatalogFilter,
	type FilterOp,
	type QuerySource,
} from "./catalog";

export type QuerySort = "measure_desc" | "measure_asc" | "dimension_asc";

const SORTS: readonly QuerySort[] = [
	"measure_desc",
	"measure_asc",
	"dimension_asc",
];

export const DEFAULT_SORT: QuerySort = "measure_desc";

export interface QueryFilter {
	key: string;
	op: FilterOp;
	values: string[];
}

export interface QuerySelection {
	source: string;
	dimensions: string[];
	measure: string;
	filters: QueryFilter[];
	sort: QuerySort;
	limit: number;
}

export type SelectionParse =
	| { ok: true; selection: QuerySelection; source: QuerySource }
	| { ok: false; message: string };

// A filter value's ceiling. Values are bound, never interpolated, so this
// bounds the statement rather than closing a hole: a nation zType is 20
// characters and the longest thing anyone can legitimately filter on — a
// player's in-save name — is bounded by the game's own name field.
const MAX_VALUE_LENGTH = 128;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const NANOID_RE = /^[A-Za-z0-9_-]{21}$/;

// `key:op:v1,v2` — one `f` param per filter. `:` and `,` are the separators
// because no value can contain either: catalog keys are lowercase words, the
// zTypes are `[A-Z0-9_]`, a tournament id is a nanoid (`[A-Za-z0-9_-]`), and
// the two free-text columns are checked against this below rather than assumed.
const FILTER_SEPARATOR = ":";
const VALUE_SEPARATOR = ",";

function parseBool(raw: string): string | null {
	if (raw === "1" || raw === "true") return "1";
	if (raw === "0" || raw === "false") return "0";
	return null;
}

// Normalize a value to its canonical spelling, or return null when the type
// refuses it. Normalizing here rather than at the comparison is what keeps
// `is_human=true` and `is_human=1` one cache entry instead of two.
function normalizeValue(filter: CatalogFilter, raw: string): string | null {
	if (raw.length === 0 || raw.length > MAX_VALUE_LENGTH) return null;
	switch (filter.type) {
		case "boolean":
			return parseBool(raw);
		case "number": {
			const n = Number(raw);
			// Number(), not parseInt(): parseInt("12 cities") is 12, which would
			// let a mangled bound pass as a deliberate one — the same reasoning
			// ceilingFrom uses in read-budget.ts.
			return Number.isFinite(n) ? String(n) : null;
		}
		case "date":
			return DAY_RE.test(raw) ? raw : null;
		case "tournament":
			return NANOID_RE.test(raw) ? raw : null;
		case "enum":
		case "text":
		case "identity":
			// No charset check beyond the separators: a token that names nothing
			// selects nothing, which is the same answer an unknown value would
			// get, and `ps.player_name` is free text out of a save file.
			return raw.includes(FILTER_SEPARATOR) || raw.includes(VALUE_SEPARATOR)
				? null
				: raw;
	}
}

function parseFilter(
	source: QuerySource,
	raw: string,
): { ok: true; filter: QueryFilter } | { ok: false; message: string } {
	// Split into exactly three parts: a value can't contain the separator, so
	// a fourth part is a malformed filter rather than a value with a colon.
	const parts = raw.split(FILTER_SEPARATOR);
	if (parts.length !== 3) {
		return { ok: false, message: `Malformed filter '${raw}'` };
	}
	const [key, opRaw, valuesRaw] = parts;

	const spec = filterByKey(source, key);
	if (!spec) {
		return {
			ok: false,
			message: `Unknown filter '${key}' for source '${source.key}'`,
		};
	}
	const op = spec.ops.find((o) => o === opRaw);
	if (!op) {
		return { ok: false, message: `Filter '${key}' does not support '${opRaw}'` };
	}

	const values: string[] = [];
	for (const part of valuesRaw.split(VALUE_SEPARATOR)) {
		const value = normalizeValue(spec, part);
		if (value === null) {
			return { ok: false, message: `Invalid value for filter '${key}'` };
		}
		values.push(value);
	}
	if (values.length > MAX_FILTER_VALUES) {
		return {
			ok: false,
			message: `Filter '${key}' takes at most ${MAX_FILTER_VALUES} values`,
		};
	}
	// A range bound is one value by definition; two would be an AND the caller
	// meant to write as two filters, and silently taking the first is the kind
	// of quiet widening this parse exists to refuse.
	if ((op === "gte" || op === "lte") && values.length !== 1) {
		return { ok: false, message: `Filter '${key}' takes one value` };
	}

	return { ok: true, filter: { key, op, values } };
}

/**
 * Read a selection out of a URL's query string, or say why it isn't one.
 *
 * Callers turn `message` into a 400 `INVALID_QUERY` — the same code the admin
 * sweep's filter parse uses, and for the same reason.
 */
export function parseSelection(params: URLSearchParams): SelectionParse {
	const sourceKey = params.get("source");
	if (!sourceKey) return { ok: false, message: "Missing 'source'" };
	const source = sourceByKey(sourceKey);
	if (!source) return { ok: false, message: `Unknown source '${sourceKey}'` };

	const measure = params.get("measure");
	if (!measure) return { ok: false, message: "Missing 'measure'" };
	if (!measureByKey(source, measure)) {
		return {
			ok: false,
			message: `Unknown measure '${measure}' for source '${source.key}'`,
		};
	}

	const dimRaw = params.get("dim");
	const dimensions = dimRaw ? dimRaw.split(VALUE_SEPARATOR) : [];
	if (dimensions.length > MAX_DIMENSIONS) {
		return {
			ok: false,
			message: `At most ${MAX_DIMENSIONS} groupings`,
		};
	}
	for (const key of dimensions) {
		if (!dimensionByKey(source, key)) {
			return {
				ok: false,
				message: `Unknown grouping '${key}' for source '${source.key}'`,
			};
		}
	}
	if (new Set(dimensions).size !== dimensions.length) {
		return { ok: false, message: "A grouping appears twice" };
	}

	const filters: QueryFilter[] = [];
	for (const raw of params.getAll("f")) {
		const parsed = parseFilter(source, raw);
		if (!parsed.ok) return parsed;
		filters.push(parsed.filter);
	}
	if (filters.length > MAX_FILTERS) {
		return { ok: false, message: `At most ${MAX_FILTERS} filters` };
	}

	const sortRaw = params.get("sort");
	if (sortRaw !== null && !SORTS.includes(sortRaw as QuerySort)) {
		return { ok: false, message: `Unknown sort '${sortRaw}'` };
	}
	const sort = (sortRaw as QuerySort | null) ?? DEFAULT_SORT;
	if (sort === "dimension_asc" && dimensions.length === 0) {
		return {
			ok: false,
			message: "Sorting by grouping needs at least one grouping",
		};
	}

	const limitRaw = params.get("limit");
	let limit = DEFAULT_ROWS;
	if (limitRaw !== null) {
		const parsed = Number(limitRaw);
		if (!Number.isInteger(parsed) || parsed < 1) {
			return { ok: false, message: `Invalid 'limit'` };
		}
		// Clamped rather than refused: the cap is the endpoint's own bound, and
		// asking for more rows than it serves can only ever narrow to it.
		limit = Math.min(parsed, MAX_ROWS);
	}

	return {
		ok: true,
		source,
		selection: { source: source.key, dimensions, measure, filters, sort, limit },
	};
}

/**
 * The one spelling of a selection: params in a fixed order, filters sorted by
 * key then operator, values sorted, defaults dropped.
 *
 * Both halves of the app read this. The Worker returns it so a client can show
 * the canonical link for the answer it got, and the builder writes it to the
 * address bar, so the URL a person copies is the key the edge already holds.
 */
export function canonicalSelection(selection: QuerySelection): string {
	const params = new URLSearchParams();
	params.set("source", selection.source);
	if (selection.dimensions.length > 0) {
		params.set("dim", selection.dimensions.join(VALUE_SEPARATOR));
	}
	params.set("measure", selection.measure);
	const filters = [...selection.filters].sort(
		(a, b) => a.key.localeCompare(b.key) || a.op.localeCompare(b.op),
	);
	for (const f of filters) {
		const values = [...f.values].sort();
		params.append(
			"f",
			[f.key, f.op, values.join(VALUE_SEPARATOR)].join(FILTER_SEPARATOR),
		);
	}
	if (selection.sort !== DEFAULT_SORT) params.set("sort", selection.sort);
	if (selection.limit !== DEFAULT_ROWS) {
		params.set("limit", String(selection.limit));
	}
	// The two separators, back in the clear. `URLSearchParams.toString()`
	// form-encodes them (`%3A`, `%2C`) and both are legal unescaped in a query
	// string, so decoding them is a free readability win on a URL whose whole
	// job is to be pasted somewhere. It is also what makes the canonical form
	// canonical for the edge cache: the encoded and decoded spellings are
	// different keys, so there has to be one of them, and the one people can
	// read is the better choice.
	return params.toString().replace(/%3A/g, ":").replace(/%2C/g, ",");
}
