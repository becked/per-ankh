// Parser parity diff CLI.
//
// Loads a Rust dump and a TS dump (both produced via the harness wire
// format), normalizes and sorts each manifest-listed entity, walks row by
// row, and emits a PerSaveReport.
//
// Usage:
//   tsx scripts/parity/diff.ts \
//     --rust <rust-dump.json> \
//     --ts   <ts-dump.json> \
//     --manifest scripts/parity/parity.config.json \
//     --out  <report.json> \
//     [--terminal]
//     [--rust-bin-sha <sha>] [--ts-source-sha <sha>] [--manifest-sha <sha>]
//     [--rust-dump-ms <n>] [--ts-dump-ms <n>]
//
// Standalone-runnable for ad-hoc debugging: when invoked without
// driver-supplied SHAs/durations, those fields are set to empty / 0 in the
// report.

import { readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { resolveTolerances, comparePrimitives, isAbsent } from "./normalize.js";
import { sortRows } from "./sort.js";
import type {
	DiffCategory,
	DiffEntry,
	EntitySpec,
	EntityStatus,
	ParityConfig,
	PerSaveReport,
	SaveStatus,
} from "./types.js";

const MAX_DIFFS_PER_REPORT = 1000;

type Dump = Record<string, unknown> & {
	schema_version?: number;
	save_path?: string;
	save_sha256?: string;
};

interface CliArgs {
	rust: string;
	ts: string;
	manifest: string;
	out: string;
	terminal: boolean;
	rustBinSha: string;
	tsSourceSha: string;
	manifestSha: string;
	rustDumpMs: number;
	tsDumpMs: number;
}

function parseArgs(argv: string[]): CliArgs {
	const a = {
		rust: "",
		ts: "",
		manifest: "",
		out: "",
		terminal: false,
		rustBinSha: "",
		tsSourceSha: "",
		manifestSha: "",
		rustDumpMs: 0,
		tsDumpMs: 0,
	};
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
			case "--manifest":
				a.manifest = need("--manifest");
				break;
			case "--out":
				a.out = need("--out");
				break;
			case "--terminal":
				a.terminal = true;
				break;
			case "--rust-bin-sha":
				a.rustBinSha = need("--rust-bin-sha");
				break;
			case "--ts-source-sha":
				a.tsSourceSha = need("--ts-source-sha");
				break;
			case "--manifest-sha":
				a.manifestSha = need("--manifest-sha");
				break;
			case "--rust-dump-ms":
				a.rustDumpMs = Number(need("--rust-dump-ms"));
				break;
			case "--ts-dump-ms":
				a.tsDumpMs = Number(need("--ts-dump-ms"));
				break;
			case "-h":
			case "--help":
				console.error(
					"usage: diff.ts --rust <path> --ts <path> --manifest <path> --out <path> [--terminal] [--rust-bin-sha SHA] [--ts-source-sha SHA] [--manifest-sha SHA] [--rust-dump-ms N] [--ts-dump-ms N]",
				);
				process.exit(0);
			default:
				throw new Error(`unknown argument: ${arg}`);
		}
	}
	for (const k of ["rust", "ts", "manifest", "out"] as const) {
		if (!a[k]) throw new Error(`--${k} is required`);
	}
	return a;
}

async function readJson<T>(path: string): Promise<T> {
	const raw = await readFile(path, "utf8");
	return JSON.parse(raw) as T;
}

interface DiffAccumulator {
	entries: DiffEntry[];
	truncated: boolean;
}

function pushDiff(acc: DiffAccumulator, entry: DiffEntry): void {
	if (acc.entries.length >= MAX_DIFFS_PER_REPORT) {
		acc.truncated = true;
		return;
	}
	acc.entries.push(entry);
}

interface CompareContext {
	tolerances: ReturnType<typeof resolveTolerances>;
	ignore: Set<string>;
	acc: DiffAccumulator;
}

/** Compare two row objects field by field. */
function diffRowFields(
	rust: Record<string, unknown>,
	ts: Record<string, unknown>,
	pathPrefix: string,
	ctx: CompareContext,
): number {
	let diffs = 0;
	const fieldNames = new Set<string>();
	for (const k of Object.keys(rust)) fieldNames.add(k);
	for (const k of Object.keys(ts)) fieldNames.add(k);
	// dump_index is an internal stability tag, never diffed against itself.
	fieldNames.delete("dump_index");

	for (const field of fieldNames) {
		if (ctx.ignore.has(field)) continue;
		const path = `${pathPrefix}/${field}`;
		const rv = rust[field];
		const tv = ts[field];

		// nullEqMissing: collapse undefined/null to absent.
		const rAbs = isAbsent(rv, ctx.tolerances.nullEqMissing);
		const tAbs = isAbsent(tv, ctx.tolerances.nullEqMissing);
		if (rAbs && tAbs) continue;
		if (rAbs) {
			pushDiff(ctx.acc, {
				path,
				category: "missing_left",
				rustValue: rv,
				tsValue: tv,
			});
			diffs++;
			continue;
		}
		if (tAbs) {
			pushDiff(ctx.acc, {
				path,
				category: "missing_right",
				rustValue: rv,
				tsValue: tv,
			});
			diffs++;
			continue;
		}

		// Both present. Currently every entity field is a primitive
		// (string/number/bool/null) in our envelope; nested objects/arrays
		// would indicate envelope shape drift and are caught as type
		// mismatches below.
		if (typeof rv !== typeof tv) {
			pushDiff(ctx.acc, {
				path,
				category: "type_mismatch",
				rustValue: rv,
				tsValue: tv,
			});
			diffs++;
			continue;
		}

		const result = comparePrimitives(rv, tv, ctx.tolerances);
		if (!result.equal) {
			pushDiff(ctx.acc, {
				path,
				category: result.suspectEncoding ? "encoding_suspect" : "value_mismatch",
				rustValue: rv,
				tsValue: tv,
			});
			diffs++;
		}
	}
	return diffs;
}

interface EntityDiffResult {
	status: EntityStatus;
	rustRowCount: number;
	tsRowCount: number;
	diffCount: number;
}

function diffEntity(
	entityKey: string,
	spec: EntitySpec,
	implemented: boolean,
	rustDump: Dump,
	tsDump: Dump,
	tolerances: ReturnType<typeof resolveTolerances>,
	acc: DiffAccumulator,
): EntityDiffResult {
	const rustRaw = rustDump[entityKey];
	const tsRaw = tsDump[entityKey];

	if (!Array.isArray(rustRaw)) {
		// Envelope shape bug — Rust dump should always have every entity key
		// as an array. Surface explicitly.
		pushDiff(acc, {
			path: `/${entityKey}`,
			category: "missing_right",
			note: "rust dump is missing or non-array for this entity (envelope shape bug)",
		});
		return { status: "fail", rustRowCount: 0, tsRowCount: 0, diffCount: 1 };
	}

	if (!implemented) {
		return {
			status: "not_ported",
			rustRowCount: rustRaw.length,
			tsRowCount: 0,
			diffCount: 0,
		};
	}

	if (!Array.isArray(tsRaw)) {
		pushDiff(acc, {
			path: `/${entityKey}`,
			category: "missing_right",
			note: "entity is in manifest.implemented but missing from TS dump",
		});
		return {
			status: "not_implemented",
			rustRowCount: rustRaw.length,
			tsRowCount: 0,
			diffCount: 1,
		};
	}

	const rustRows = sortRows(rustRaw as Record<string, unknown>[], spec.sortKeys);
	const tsRows = sortRows(tsRaw as Record<string, unknown>[], spec.sortKeys);
	const ctx: CompareContext = {
		tolerances,
		ignore: new Set(spec.ignoreFields ?? []),
		acc,
	};

	let diffCount = 0;
	if (rustRows.length !== tsRows.length) {
		pushDiff(acc, {
			path: `/${entityKey}`,
			category: "length_mismatch",
			rustValue: rustRows.length,
			tsValue: tsRows.length,
		});
		diffCount++;
	}

	const minLen = Math.min(rustRows.length, tsRows.length);
	for (let i = 0; i < minLen; i++) {
		diffCount += diffRowFields(
			rustRows[i],
			tsRows[i],
			`/${entityKey}/${i}`,
			ctx,
		);
	}

	// Extra rows on either side.
	for (let i = minLen; i < rustRows.length; i++) {
		pushDiff(acc, {
			path: `/${entityKey}/${i}`,
			category: "extra_row",
			rustValue: rustRows[i],
			note: "row present in rust dump but not in ts dump (after sort)",
		});
		diffCount++;
	}
	for (let i = minLen; i < tsRows.length; i++) {
		pushDiff(acc, {
			path: `/${entityKey}/${i}`,
			category: "extra_row",
			tsValue: tsRows[i],
			note: "row present in ts dump but not in rust dump (after sort)",
		});
		diffCount++;
	}

	return {
		status: diffCount === 0 ? "pass" : "fail",
		rustRowCount: rustRows.length,
		tsRowCount: tsRows.length,
		diffCount,
	};
}

function summaryLine(report: PerSaveReport): string {
	const status = report.status.toUpperCase();
	const nEntities = Object.keys(report.perEntity).length;
	const failing = Object.entries(report.perEntity)
		.filter(([, v]) => v.status === "fail" || v.status === "not_implemented")
		.map(([k]) => k);
	const failPart = failing.length
		? ` failing: ${failing.slice(0, 5).join(", ")}${failing.length > 5 ? `, +${failing.length - 5} more` : ""}`
		: "";
	return `${status} ${report.save.path} (${nEntities} entities, ${report.diffCount} diffs)${failPart}`;
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const startedAt = new Date().toISOString();
	const t0 = Date.now();

	const [rustDump, tsDump, config] = await Promise.all([
		readJson<Dump>(args.rust),
		readJson<Dump>(args.ts),
		readJson<ParityConfig>(args.manifest),
	]);

	const tolerances = resolveTolerances(config.tolerances);
	const implementedSet = new Set(config.implemented);
	const acc: DiffAccumulator = { entries: [], truncated: false };
	const perEntity: PerSaveReport["perEntity"] = {};
	let totalDiffs = 0;

	for (const [entityKey, spec] of Object.entries(config.entities)) {
		const result = diffEntity(
			entityKey,
			spec,
			implementedSet.has(entityKey),
			rustDump,
			tsDump,
			tolerances,
			acc,
		);
		perEntity[entityKey] = result;
		totalDiffs += result.diffCount;
	}

	const errored = false;
	const failed = Object.values(perEntity).some(
		(e) => e.status === "fail" || e.status === "not_implemented",
	);
	const status: SaveStatus = errored ? "error" : failed ? "fail" : "pass";

	let saveSize = 0;
	if (rustDump.save_path) {
		try {
			const s = await stat(rustDump.save_path);
			saveSize = s.size;
		} catch {
			// Save path from rust dump may not exist on this machine (e.g.
			// running diff after dumps were generated elsewhere). Fine.
		}
	}

	const diffMs = Date.now() - t0;

	const report: PerSaveReport = {
		schemaVersion: 1,
		save: {
			path: rustDump.save_path ?? "",
			sha256: rustDump.save_sha256 ?? "",
			sizeBytes: saveSize,
		},
		rustBinSha: args.rustBinSha,
		tsSourceSha: args.tsSourceSha,
		manifestSha: args.manifestSha,
		startedAt,
		durationMs: {
			rustDump: args.rustDumpMs,
			tsDump: args.tsDumpMs,
			diff: diffMs,
		},
		status,
		diffCount: totalDiffs,
		perEntity,
		diffs: acc.entries,
		diffsTruncated: acc.truncated || undefined,
	};

	await mkdir(dirname(args.out), { recursive: true });
	await writeFile(args.out, JSON.stringify(report, null, 2));

	if (args.terminal) {
		console.log(summaryLine(report));
	}

	process.exit(status === "pass" ? 0 : 1);
}

main().catch((err) => {
	console.error(err instanceof Error ? err.stack ?? err.message : String(err));
	process.exit(2);
});
