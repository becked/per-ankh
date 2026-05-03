// Shared types for the parser parity test harness.
//
// See docs/cloud-rewrite-spec.md §2 ("Parity Test Harness"). The harness is
// transient — it lives until the TypeScript parser port reaches parity, then
// is deleted with the rest of the Rust code.

export interface EntitySpec {
	/** Top-level envelope key (e.g. "families"). */
	key: string;
	/**
	 * Field names to sort rows by, in priority order. Ties are broken by the
	 * `dump_index` field (always present, populated by the dumper). An empty
	 * array means sort by `dump_index` only.
	 */
	sortKeys: string[];
	/**
	 * Field names to ignore when diffing rows of this entity. Use sparingly
	 * (e.g. `event_logs.description` if HTML/CRLF drift is too noisy in early
	 * diffs); always paired with a TODO to remove once parity is reached.
	 */
	ignoreFields?: string[];
}

export interface ParityTolerances {
	/** Default 6 — round floats to this many digits before equality compare. */
	floatPrecisionDigits?: number;
	/** Default true — trim leading/trailing whitespace on strings. */
	trimStrings?: boolean;
	/** Default true — treat `null` and missing key as equivalent. */
	nullEqMissing?: boolean;
}

export interface ParityConfig {
	schemaVersion: 1;
	/** Top-level envelope keys the TS port has implemented and should diff. */
	implemented: string[];
	/** Per-entity sort + ignore config. Populated for every entity. */
	entities: Record<string, EntitySpec>;
	tolerances?: ParityTolerances;
}

export type DiffCategory =
	| "value_mismatch"
	| "type_mismatch"
	| "missing_left"
	| "missing_right"
	| "length_mismatch"
	| "extra_row"
	| "encoding_suspect"
	| "not_ported";

export interface DiffEntry {
	/** JSON-pointer-ish path, e.g. "/families/3/family_name". */
	path: string;
	category: DiffCategory;
	rustValue?: unknown;
	tsValue?: unknown;
	note?: string;
}

export type EntityStatus = "pass" | "fail" | "not_ported" | "not_implemented";
export type SaveStatus = "pass" | "fail" | "error";

export interface PerSaveReport {
	schemaVersion: 1;
	save: { path: string; sha256: string; sizeBytes: number };
	rustBinSha: string;
	tsSourceSha: string;
	manifestSha: string;
	startedAt: string;
	durationMs: { rustDump: number; tsDump: number; diff: number };
	status: SaveStatus;
	/** Set when status="error" (parser threw rather than producing diffs). */
	errorMessage?: string;
	diffCount: number;
	perEntity: Record<
		string,
		{
			status: EntityStatus;
			rustRowCount: number;
			tsRowCount: number;
			diffCount: number;
		}
	>;
	/** Capped at MAX_DIFFS_PER_REPORT (defined in diff.ts). */
	diffs: DiffEntry[];
	diffsTruncated?: boolean;
}

export type CorpusEntityStatus =
	| "implemented_passing"
	| "implemented_failing"
	| "not_ported";

export interface CorpusReport {
	schemaVersion: 1;
	startedAt: string;
	finishedAt: string;
	manifest: { path: string; sha: string; implemented: string[] };
	totals: { saves: number; pass: number; fail: number; error: number };
	saveStatus: Record<SaveStatus, string[]>;
	/**
	 * Path-frequency rollup: which JSON paths fail most often across the
	 * corpus. Numeric array indices are normalized to "*" so siblings
	 * aggregate; e.g. /families/3/seat_city_xml_id and
	 * /families/7/seat_city_xml_id roll up as /families/STAR/seat_city_xml_id
	 * with literal "*" replacing "STAR" at runtime.
	 */
	topFailingPaths: Array<{
		path: string;
		category: DiffCategory;
		occurrences: number;
		affectedSaves: number;
		exampleSaves: string[];
	}>;
	perEntity: Record<
		string,
		{
			status: CorpusEntityStatus;
			savesWithDiffs: number;
			totalDiffs: number;
		}
	>;
}
