// The ad-hoc query surface's wire types — the shapes `GET /v1/query/catalog`
// and `GET /v1/query` return (cloud/src/query/catalog.ts, handlers.ts).
//
// Mirrored rather than imported: `cloud/` is a separate package with no shared
// module, the same reason `$lib/stats/types` restates the bundle's shapes.
// What is *not* mirrored is the catalog's contents — those arrive over the
// wire, because a second copy of the allowlist here would drift from the one
// the compiler enforces and the drift would show up as a picker offering a
// column that 400s.

// `enum` means the value is a game zType, so it is displayed through the
// game's own name for it — independent of whether `vocabulary` names a roster
// to pick from. `text` is the two genuinely free-text columns.
export type ValueType =
	| "enum"
	| "text"
	| "number"
	| "boolean"
	| "date"
	| "identity"
	| "tournament";

export type FilterOp = "in" | "not_in" | "gte" | "lte";

// What one counted or averaged thing is. Shown beside the measure, because a
// number that is per-save rather than per-match has to say so where it is read.
export type MeasureUnit = "match" | "save" | "seat" | "event";

export interface CatalogDimension {
	key: string;
	label: string;
	type: ValueType;
	// Names a value list this client resolves against its own baked tables
	// ($lib/query/vocabularies). Absent — or naming one with no roster — means
	// the filter takes a typed token.
	vocabulary?: string;
	help?: string;
	// On the identity dimension: the extra column keys its result rows carry,
	// which is what lets the table link a row to a profile.
	key_columns?: string[];
}

export interface CatalogMeasure {
	key: string;
	label: string;
	unit: MeasureUnit;
	note: string;
}

export interface CatalogFilter {
	key: string;
	label: string;
	type: ValueType;
	ops: FilterOp[];
	vocabulary?: string;
	help?: string;
}

export interface CatalogSource {
	key: string;
	label: string;
	// One line naming what a row is.
	grain: string;
	dimensions: CatalogDimension[];
	measures: CatalogMeasure[];
	filters: CatalogFilter[];
}

export interface QueryCatalog {
	sources: CatalogSource[];
	limits: {
		max_rows: number;
		default_rows: number;
		max_dimensions: number;
		max_filters: number;
		max_filter_values: number;
	};
	// The corpus every selection runs over, in one sentence. Shown beneath the
	// results rather than restated in the page, so this surface cannot
	// describe a scope the compiler isn't applying.
	corpus: string;
}

export interface ResultColumn {
	key: string;
	label: string;
	// `key` columns are the identity dimension's user_id and slug: carried for
	// the profile link, never rendered as a column of their own.
	role: "dimension" | "measure" | "key";
	type: ValueType | "number";
}

export type ResultRow = Record<string, string | number | null>;

export interface QueryResult {
	// The canonical spelling of the question, as the Worker read it.
	selection: string;
	source: string;
	columns: ResultColumn[];
	rows: ResultRow[];
	row_count: number;
	// The row cap was reached, so there may be more groups than are here.
	truncated: boolean;
	limit: number;
	measure: CatalogMeasure;
}
