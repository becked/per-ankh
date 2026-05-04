// Share-parity diff CLI. Compares a Rust SharedGameData JSON
// (`dump_shared` output) against a TS share-dump JSON, emitting a per-field
// PASS/FAIL report.
//
// Usage:
//   tsx scripts/parity/share-diff.ts \
//     --rust <rust-shared.json> --ts <ts-shared.json> --out <report.json>
//     [--terminal]
//
// Differences from entity-parity (`diff.ts`):
//   - Recurses into nested objects + arrays (`game_details.players`, etc.).
//   - Per-field config: outer sort keys, nested-array sort keys, ignored
//     fields. IDs (player_id, city_id, log_id, event_id) are always ignored
//     because Rust assigns DB sequence ids while TS uses XML ids.
//   - Reuses `normalize.ts` for primitive comparison tolerances.

import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { comparePrimitives, isAbsent, resolveTolerances } from "./normalize.js";

const MAX_DIFFS = 1000;

interface CliArgs {
	rust: string;
	ts: string;
	out: string;
	terminal: boolean;
}

function parseArgs(argv: string[]): CliArgs {
	const a = { rust: "", ts: "", out: "", terminal: false };
	const it = argv[Symbol.iterator]();
	for (let next = it.next(); !next.done; next = it.next()) {
		const arg = next.value;
		const need = (label: string): string => {
			const v = it.next();
			if (v.done) throw new Error(`${label} requires a value`);
			return v.value;
		};
		switch (arg) {
			case "--rust":
				a.rust = need("--rust");
				break;
			case "--ts":
				a.ts = need("--ts");
				break;
			case "--out":
				a.out = need("--out");
				break;
			case "--terminal":
				a.terminal = true;
				break;
			case "-h":
			case "--help":
				console.error(
					"usage: share-diff.ts --rust <path> --ts <path> --out <path> [--terminal]",
				);
				process.exit(0);
			default:
				throw new Error(`unknown argument: ${arg}`);
		}
	}
	for (const k of ["rust", "ts", "out"] as const) {
		if (!a[k]) throw new Error(`--${k} is required`);
	}
	return a;
}

// ---------- Field specs ----------
//
// Each top-level SharedGameData field gets a spec describing its shape and
// how to normalize it for comparison. `ignoreFields` is the set of field
// names dropped at every level (recursive). `nestedArrays` configures
// per-nested-array sorting (e.g., `game_details.players`).

interface FieldSpec {
	/**
	 * Shape:
	 *   - array: top-level value is an array of rows (e.g., player_history).
	 *   - object: top-level value is a single object (e.g., game_details).
	 *   - wrapper: top-level value is an object wrapping one array
	 *     (e.g., city_statistics → { cities: [...] }).
	 */
	type: "array" | "object" | "wrapper";
	/** For type=array: sort keys for the outer array. */
	outerSortKeys?: string[];
	/** Custom comparator for the outer array (overrides outerSortKeys). */
	outerComparator?: (a: Row, b: Row) => number;
	/** For type=wrapper: the single nested-array key. */
	wrapperKey?: string;
	/** For type=wrapper: sort keys for the wrapped array. */
	wrapperSortKeys?: string[];
	/** Field names to drop at every level of recursion. */
	ignoreFields?: string[];
	/** Per-nested-array config (key on the row → sort keys). */
	nestedArrays?: Record<string, { sortKeys: string[] }>;
}

type Row = Record<string, unknown>;

// Player/city/log/event ids are always ignored: Rust assigns DB-sequence
// ids; TS uses XML ids. Rows are joined positionally after sorting on
// stable keys (player_name, city_name, etc.).
const ALWAYS_IGNORED = [
	"player_id",
	"city_id",
	"log_id",
	"event_id",
	// Save-owner-derived fields. The desktop runs `determine_save_owner`
	// before assembling SharedGameData, so its output reflects the resolved
	// save-owner's player_id / difficulty. The cloud parser produces blobs
	// before save-owner stamping (which the upload server does post-parse
	// via `uploader_player_indexes`). These fields will always diverge
	// here; verifying their values is out of scope for parser parity.
	"winner_player_id",
	"difficulty",
];

const FIELD_SPECS: Record<string, FieldSpec> = {
	game_details: {
		type: "object",
		ignoreFields: ["match_id", ...ALWAYS_IGNORED],
		// Nation is the tiebreaker when player_name collides (often empty
		// in single-player saves where only the human has a name). Without
		// it the sort is unstable across the two implementations.
		nestedArrays: { players: { sortKeys: ["player_name", "nation"] } },
	},
	player_history: {
		type: "array",
		outerSortKeys: ["player_name", "nation"],
		ignoreFields: ALWAYS_IGNORED,
		nestedArrays: { history: { sortKeys: ["turn"] } },
	},
	yield_history: {
		type: "array",
		outerSortKeys: ["player_name", "nation", "yield_type"],
		ignoreFields: ALWAYS_IGNORED,
		nestedArrays: { data: { sortKeys: ["turn"] } },
	},
	event_logs: {
		type: "array",
		// Rust sorts DESC by turn / log_id; the diff doesn't care about
		// order direction as long as both sides agree, so we use ASC by
		// (turn, log_type, stripped-description) for a stable join key.
		outerComparator: makeEventLogComparator(),
		ignoreFields: ALWAYS_IGNORED,
	},
	law_adoption_history: {
		type: "array",
		outerSortKeys: ["player_name", "nation"],
		ignoreFields: ALWAYS_IGNORED,
		nestedArrays: { data: { sortKeys: ["turn", "law_name"] } },
	},
	current_laws: {
		type: "array",
		outerSortKeys: ["player_name", "nation", "law"],
		ignoreFields: ALWAYS_IGNORED,
	},
	tech_discovery_history: {
		type: "array",
		outerSortKeys: ["player_name", "nation"],
		ignoreFields: ALWAYS_IGNORED,
		nestedArrays: { data: { sortKeys: ["turn", "tech_name"] } },
	},
	completed_techs: {
		type: "array",
		outerSortKeys: ["player_name", "nation", "tech", "completed_turn"],
		ignoreFields: ALWAYS_IGNORED,
	},
	units_produced: {
		type: "array",
		outerSortKeys: ["player_name", "nation", "unit_type"],
		ignoreFields: ALWAYS_IGNORED,
	},
	city_statistics: {
		type: "wrapper",
		wrapperKey: "cities",
		wrapperSortKeys: ["city_name"],
		ignoreFields: ALWAYS_IGNORED,
	},
	improvement_data: {
		type: "wrapper",
		wrapperKey: "improvements",
		// Specialist + resource as tiebreakers for tiles sharing
		// (nation, city_name, improvement) — common when a city has
		// multiple instances of the same improvement type.
		wrapperSortKeys: [
			"nation",
			"city_name",
			"improvement",
			"specialist",
			"resource",
		],
		ignoreFields: ALWAYS_IGNORED,
	},
	map_tiles: {
		type: "array",
		outerSortKeys: ["y", "x"],
		ignoreFields: ALWAYS_IGNORED,
		nestedArrays: { religions: { sortKeys: ["religion_name"] } },
	},
	game_religions: {
		type: "array",
		outerComparator: makeReligionsComparator(),
		ignoreFields: ALWAYS_IGNORED,
	},
	player_wonders: {
		type: "array",
		outerSortKeys: ["nation", "wonder"],
		ignoreFields: ALWAYS_IGNORED,
	},
};

function makeEventLogComparator(): (a: Row, b: Row) => number {
	const stripMarkup = (s: unknown): string =>
		typeof s === "string" ? s.replace(/<[^>]*>/g, "") : "";
	return (a, b) =>
		(Number(a.turn) || 0) - (Number(b.turn) || 0) ||
		String(a.log_type ?? "").localeCompare(String(b.log_type ?? "")) ||
		stripMarkup(a.description).localeCompare(stripMarkup(b.description));
}

function makeReligionsComparator(): (a: Row, b: Row) => number {
	// founded_turn NULLS LAST, then religion_name asc.
	return (a, b) => {
		const aT = a.founded_turn as number | null;
		const bT = b.founded_turn as number | null;
		if (aT === null && bT === null) {
			return String(a.religion_name).localeCompare(String(b.religion_name));
		}
		if (aT === null) return 1;
		if (bT === null) return -1;
		return (
			aT - bT ||
			String(a.religion_name).localeCompare(String(b.religion_name))
		);
	};
}

// ---------- Diff walker ----------

interface DiffEntry {
	path: string;
	category:
		| "value_mismatch"
		| "type_mismatch"
		| "missing_left"
		| "missing_right"
		| "length_mismatch"
		| "extra_row";
	rustValue?: unknown;
	tsValue?: unknown;
	note?: string;
}

interface Acc {
	entries: DiffEntry[];
	truncated: boolean;
}

function pushDiff(acc: Acc, e: DiffEntry): void {
	if (acc.entries.length >= MAX_DIFFS) {
		acc.truncated = true;
		return;
	}
	acc.entries.push(e);
}

const tolerances = resolveTolerances({
	floatPrecisionDigits: 6,
	trimStrings: true,
	nullEqMissing: true,
});

function compareSortKeys(a: Row, b: Row, keys: string[]): number {
	for (const k of keys) {
		const av = a[k];
		const bv = b[k];
		const aAbsent = av === undefined || av === null;
		const bAbsent = bv === undefined || bv === null;
		if (aAbsent && bAbsent) continue;
		if (aAbsent) return 1;
		if (bAbsent) return -1;
		if (typeof av === "number" && typeof bv === "number") {
			if (av !== bv) return av < bv ? -1 : 1;
			continue;
		}
		const sa = String(av);
		const sb = String(bv);
		if (sa !== sb) return sa < sb ? -1 : 1;
	}
	return 0;
}

function sortRowsByKeys(rows: Row[], keys: string[]): Row[] {
	return [...rows].sort((a, b) => compareSortKeys(a, b, keys));
}

/** Diff two row objects field-by-field with the given ignore + nested-array config. */
function diffRow(
	rust: Row,
	ts: Row,
	pathPrefix: string,
	ignore: Set<string>,
	nestedArrays: Record<string, { sortKeys: string[] }> | undefined,
	acc: Acc,
): void {
	const fieldNames = new Set<string>();
	for (const k of Object.keys(rust)) fieldNames.add(k);
	for (const k of Object.keys(ts)) fieldNames.add(k);

	for (const field of fieldNames) {
		if (ignore.has(field)) continue;
		const path = `${pathPrefix}/${field}`;
		const rv = rust[field];
		const tv = ts[field];

		const rAbs = isAbsent(rv, tolerances.nullEqMissing);
		const tAbs = isAbsent(tv, tolerances.nullEqMissing);
		if (rAbs && tAbs) continue;
		if (rAbs) {
			pushDiff(acc, { path, category: "missing_left", rustValue: rv, tsValue: tv });
			continue;
		}
		if (tAbs) {
			pushDiff(acc, { path, category: "missing_right", rustValue: rv, tsValue: tv });
			continue;
		}

		// Nested array? Sort both sides by the configured keys, then recurse.
		const nestedSpec = nestedArrays?.[field];
		if (nestedSpec) {
			if (!Array.isArray(rv) || !Array.isArray(tv)) {
				pushDiff(acc, { path, category: "type_mismatch", rustValue: rv, tsValue: tv });
				continue;
			}
			diffArrays(
				rv as Row[],
				tv as Row[],
				path,
				(a, b) => compareSortKeys(a, b, nestedSpec.sortKeys),
				ignore,
				undefined,
				acc,
			);
			continue;
		}

		// Nested plain object — recurse without nested-array config.
		if (
			rv !== null &&
			tv !== null &&
			typeof rv === "object" &&
			typeof tv === "object" &&
			!Array.isArray(rv) &&
			!Array.isArray(tv)
		) {
			diffRow(rv as Row, tv as Row, path, ignore, undefined, acc);
			continue;
		}

		// Primitive compare.
		if (typeof rv !== typeof tv) {
			pushDiff(acc, { path, category: "type_mismatch", rustValue: rv, tsValue: tv });
			continue;
		}
		const result = comparePrimitives(rv, tv, tolerances);
		if (!result.equal) {
			pushDiff(acc, { path, category: "value_mismatch", rustValue: rv, tsValue: tv });
		}
	}
}

function diffArrays(
	rust: Row[],
	ts: Row[],
	pathPrefix: string,
	comparator: (a: Row, b: Row) => number,
	ignore: Set<string>,
	nestedArrays: Record<string, { sortKeys: string[] }> | undefined,
	acc: Acc,
): void {
	const r = [...rust].sort(comparator);
	const t = [...ts].sort(comparator);
	if (r.length !== t.length) {
		pushDiff(acc, {
			path: pathPrefix,
			category: "length_mismatch",
			rustValue: r.length,
			tsValue: t.length,
		});
	}
	const minLen = Math.min(r.length, t.length);
	for (let i = 0; i < minLen; i++) {
		diffRow(r[i], t[i], `${pathPrefix}/${i}`, ignore, nestedArrays, acc);
	}
	for (let i = minLen; i < r.length; i++) {
		pushDiff(acc, {
			path: `${pathPrefix}/${i}`,
			category: "extra_row",
			rustValue: r[i],
			note: "row in rust but not ts (after sort)",
		});
	}
	for (let i = minLen; i < t.length; i++) {
		pushDiff(acc, {
			path: `${pathPrefix}/${i}`,
			category: "extra_row",
			tsValue: t[i],
			note: "row in ts but not rust (after sort)",
		});
	}
}

interface FieldResult {
	status: "pass" | "fail";
	diffCount: number;
}

function diffField(
	key: string,
	spec: FieldSpec,
	rust: unknown,
	ts: unknown,
	acc: Acc,
): FieldResult {
	const startCount = acc.entries.length;
	const path = `/${key}`;
	const ignore = new Set([...(spec.ignoreFields ?? [])]);

	if (spec.type === "object") {
		if (rust === null || ts === null || typeof rust !== "object" || typeof ts !== "object") {
			pushDiff(acc, { path, category: "type_mismatch", rustValue: rust, tsValue: ts });
		} else {
			diffRow(
				rust as Row,
				ts as Row,
				path,
				ignore,
				spec.nestedArrays,
				acc,
			);
		}
	} else if (spec.type === "array") {
		if (!Array.isArray(rust) || !Array.isArray(ts)) {
			pushDiff(acc, { path, category: "type_mismatch", rustValue: rust, tsValue: ts });
		} else {
			const comparator =
				spec.outerComparator ??
				((a: Row, b: Row) => compareSortKeys(a, b, spec.outerSortKeys ?? []));
			diffArrays(
				rust as Row[],
				ts as Row[],
				path,
				comparator,
				ignore,
				spec.nestedArrays,
				acc,
			);
		}
	} else if (spec.type === "wrapper") {
		const wKey = spec.wrapperKey;
		if (!wKey) throw new Error(`wrapper spec for ${key} missing wrapperKey`);
		if (rust === null || ts === null || typeof rust !== "object" || typeof ts !== "object") {
			pushDiff(acc, { path, category: "type_mismatch", rustValue: rust, tsValue: ts });
		} else {
			const rustArr = (rust as Row)[wKey];
			const tsArr = (ts as Row)[wKey];
			if (!Array.isArray(rustArr) || !Array.isArray(tsArr)) {
				pushDiff(acc, {
					path: `${path}/${wKey}`,
					category: "type_mismatch",
					rustValue: rustArr,
					tsValue: tsArr,
				});
			} else {
				diffArrays(
					rustArr as Row[],
					tsArr as Row[],
					`${path}/${wKey}`,
					(a, b) => compareSortKeys(a, b, spec.wrapperSortKeys ?? []),
					ignore,
					spec.nestedArrays,
					acc,
				);
			}
		}
	}

	const diffCount = acc.entries.length - startCount;
	return { status: diffCount === 0 ? "pass" : "fail", diffCount };
}

// ---------- Main ----------

interface Report {
	schemaVersion: 1;
	rustPath: string;
	tsPath: string;
	startedAt: string;
	durationMs: number;
	status: "pass" | "fail";
	diffCount: number;
	perField: Record<string, FieldResult>;
	diffs: DiffEntry[];
	diffsTruncated?: boolean;
}

async function readJson<T>(path: string): Promise<T> {
	const raw = await readFile(path, "utf8");
	return JSON.parse(raw) as T;
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const startedAt = new Date().toISOString();
	const t0 = Date.now();

	const [rust, ts] = await Promise.all([
		readJson<Record<string, unknown>>(args.rust),
		readJson<Record<string, unknown>>(args.ts),
	]);

	const acc: Acc = { entries: [], truncated: false };
	const perField: Record<string, FieldResult> = {};

	for (const [key, spec] of Object.entries(FIELD_SPECS)) {
		perField[key] = diffField(key, spec, rust[key], ts[key], acc);
	}

	const totalDiffs = Object.values(perField).reduce(
		(s, r) => s + r.diffCount,
		0,
	);
	const status: "pass" | "fail" = totalDiffs === 0 ? "pass" : "fail";
	const durationMs = Date.now() - t0;

	const report: Report = {
		schemaVersion: 1,
		rustPath: args.rust,
		tsPath: args.ts,
		startedAt,
		durationMs,
		status,
		diffCount: totalDiffs,
		perField,
		diffs: acc.entries,
		diffsTruncated: acc.truncated || undefined,
	};

	await mkdir(dirname(args.out), { recursive: true });
	await writeFile(args.out, JSON.stringify(report, null, 2));

	if (args.terminal) {
		const failing = Object.entries(perField)
			.filter(([, v]) => v.status === "fail")
			.map(([k, v]) => `${k}(${v.diffCount})`);
		const failPart = failing.length > 0 ? ` failing: ${failing.join(", ")}` : "";
		console.log(`${status.toUpperCase()} ${totalDiffs} diffs${failPart}`);
	}

	process.exit(status === "pass" ? 0 : 1);
}

main().catch((err) => {
	console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
	process.exit(2);
});
