// A selection, client side: read out of the URL, written back to it.
//
// The selection lives entirely in the URL, as every other view-state here
// does, so a question is linkable and the back button walks the questions
// you asked. `canonicalQuery` mirrors `canonicalSelection`
// (cloud/src/query/select.ts) — params in a fixed order, filters sorted by key
// then operator, values sorted, defaults dropped — the way `global-facets.ts`
// mirrors the Worker's facet parsers. The mirror earns its keep at the edge:
// the response is stored under its query string, so two spellings of one
// question would be two entries and two scans of the corpus.
//
// Reading is deliberately *lenient* where the Worker's parse is strict. The
// Worker refuses a key it doesn't have, because dropping a filter there would
// widen the question. Here there is no question yet — this is the draft the
// builder edits — so a key the catalog no longer carries is dropped from the
// draft rather than failing the page, and the Worker's 400 (which the load
// surfaces) is what reports it.

import type { CatalogSource, FilterOp, QueryCatalog } from "./types";

export type QuerySort = "measure_desc" | "measure_asc" | "dimension_asc";

export const DEFAULT_SORT: QuerySort = "measure_desc";

// How each sort names itself. A total map rather than a lookup with a
// fallback, so adding one is a type error here until it has a label.
const SORT_LABELS: Readonly<Record<QuerySort, string>> = {
	measure_desc: "Highest first",
	measure_asc: "Lowest first",
	dimension_asc: "By name",
};

export const SORTS: readonly QuerySort[] = [
	"measure_desc",
	"measure_asc",
	"dimension_asc",
];

export function sortLabel(sort: QuerySort): string {
	return SORT_LABELS[sort];
}

const OP_LABELS: Readonly<Record<FilterOp, string>> = {
	in: "is",
	not_in: "is not",
	gte: "at least",
	lte: "at most",
};

export function opLabel(op: FilterOp): string {
	return OP_LABELS[op];
}

export interface DraftFilter {
	key: string;
	op: FilterOp;
	values: string[];
}

export interface Draft {
	source: string;
	dimensions: string[];
	measure: string;
	filters: DraftFilter[];
	sort: QuerySort;
	limit: number;
}

const FILTER_SEPARATOR = ":";
const VALUE_SEPARATOR = ",";

/** The first source in the catalog, as the draft a visitor with no URL gets. */
export function emptyDraft(catalog: QueryCatalog): Draft {
	const source = catalog.sources[0];
	return {
		source: source.key,
		dimensions: [],
		measure: source.measures[0].key,
		filters: [],
		sort: DEFAULT_SORT,
		limit: catalog.limits.default_rows,
	};
}

function sourceOf(catalog: QueryCatalog, key: string | null): CatalogSource {
	return catalog.sources.find((s) => s.key === key) ?? catalog.sources[0];
}

/**
 * Read a draft out of a URL's params, keeping only what this catalog carries.
 *
 * A measure is required for a selection to mean anything, so one the source
 * doesn't have falls back to its first — which is also what makes switching
 * source in the builder a one-click operation rather than an invalid state.
 */
export function draftFromParams(
	catalog: QueryCatalog,
	params: URLSearchParams,
): Draft {
	const source = sourceOf(catalog, params.get("source"));

	const measureKey = params.get("measure");
	const measure =
		source.measures.find((m) => m.key === measureKey) ?? source.measures[0];

	const dimensions = (params.get("dim")?.split(VALUE_SEPARATOR) ?? [])
		.filter((key) => source.dimensions.some((d) => d.key === key))
		.slice(0, catalog.limits.max_dimensions);

	const filters: DraftFilter[] = [];
	for (const raw of params.getAll("f")) {
		const parts = raw.split(FILTER_SEPARATOR);
		if (parts.length !== 3) continue;
		const [key, op, values] = parts;
		const spec = source.filters.find((f) => f.key === key);
		if (!spec || !spec.ops.includes(op as FilterOp)) continue;
		filters.push({
			key,
			op: op as FilterOp,
			values: values.split(VALUE_SEPARATOR).filter((v) => v !== ""),
		});
	}

	const sortRaw = params.get("sort");
	let sort = SORTS.includes(sortRaw as QuerySort)
		? (sortRaw as QuerySort)
		: DEFAULT_SORT;
	if (sort === "dimension_asc" && dimensions.length === 0) sort = DEFAULT_SORT;

	const limitRaw = Number(params.get("limit"));
	const limit =
		Number.isInteger(limitRaw) && limitRaw >= 1
			? Math.min(limitRaw, catalog.limits.max_rows)
			: catalog.limits.default_rows;

	return {
		source: source.key,
		dimensions,
		measure: measure.key,
		filters: filters.slice(0, catalog.limits.max_filters),
		sort,
		limit,
	};
}

/**
 * The one spelling of a draft, as a query string.
 *
 * Mirrors `canonicalSelection` in the Worker, down to leaving the two
 * separators unescaped: both are legal in a query string, and a URL whose
 * whole job is to be pasted somewhere reads better without `%3A` in it.
 *
 * A filter with no values is dropped rather than sent: the builder adds a
 * filter row before anything has been typed into it, and an empty one is a
 * row the person is still filling in, not a question about the empty string.
 */
export function canonicalQuery(draft: Draft, catalog: QueryCatalog): string {
	const params = new URLSearchParams();
	params.set("source", draft.source);
	if (draft.dimensions.length > 0) {
		params.set("dim", draft.dimensions.join(VALUE_SEPARATOR));
	}
	params.set("measure", draft.measure);
	const filters = draft.filters
		.filter((f) => f.values.length > 0)
		.sort((a, b) => a.key.localeCompare(b.key) || a.op.localeCompare(b.op));
	for (const f of filters) {
		params.append(
			"f",
			[f.key, f.op, [...f.values].sort().join(VALUE_SEPARATOR)].join(
				FILTER_SEPARATOR,
			),
		);
	}
	if (draft.sort !== DEFAULT_SORT) params.set("sort", draft.sort);
	if (draft.limit !== catalog.limits.default_rows) {
		params.set("limit", String(draft.limit));
	}
	return params.toString().replace(/%3A/g, ":").replace(/%2C/g, ",");
}

/** Whether this filter takes one bound rather than a set of values. */
export function isRangeOp(op: FilterOp): boolean {
	return op === "gte" || op === "lte";
}

/**
 * Whether a filter row can be sent as it stands. A range bound is one value by
 * definition — the Worker refuses two rather than taking the first — so the
 * builder holds the row to that here instead of letting it 400.
 */
export function filterIsComplete(filter: DraftFilter): boolean {
	return isRangeOp(filter.op)
		? filter.values.length === 1
		: filter.values.length > 0;
}
