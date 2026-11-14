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
	| "tournament"
	| "game_mode";

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
	// On the identity dimension: the extra column keys its result rows carry,
	// which is what lets the table link a row to a profile.
	key_columns?: string[];
}

export interface CatalogMeasure {
	key: string;
	label: string;
	unit: MeasureUnit;
}

export interface CatalogFilter {
	key: string;
	label: string;
	type: ValueType;
	ops: FilterOp[];
	vocabulary?: string;
}

export interface CatalogSource {
	key: string;
	label: string;
	// The heading this source sits under in the builder's picker. Sources
	// sharing one arrive contiguously, so the picker groups them by walking
	// the list in order rather than by holding a map of its own.
	group: string;
	dimensions: CatalogDimension[];
	measures: CatalogMeasure[];
	filters: CatalogFilter[];
}

// One value a filter can take, where the Worker is what knows the name for it.
export interface CatalogRosterOption {
	value: string;
	label: string;
	// The picture that names the value, where the Worker has one: the account's
	// Discord avatar on the player roster. A baked vocabulary's icon is a sprite
	// this bundle resolves itself, so only a served roster carries a URL here.
	icon?: string;
}

export interface QueryCatalog {
	sources: CatalogSource[];
	// The vocabularies the Worker supplies, keyed by the `vocabulary` an entry
	// names. Only the ones whose values live in D1 — a tournament, an account —
	// arrive this way; a zType roster is resolved against this bundle's own
	// baked tables ($lib/query/vocabularies). `vocabularyFor` reads both.
	rosters: Record<string, CatalogRosterOption[]>;
	limits: {
		max_rows: number;
		default_rows: number;
		max_dimensions: number;
		max_filters: number;
		max_filter_values: number;
	};
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
	measure: CatalogMeasure;
}
