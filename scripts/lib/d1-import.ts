// Shared D1 import engine: reset a D1 database and replay a wrangler dump into
// it, re-emitted in foreign-key dependency order so it survives D1's FK
// enforcement. The counterpart to lib/d1-backup.ts (export), split out of the
// staging-reclone command so both remote and local callers share one code
// path.
//
// Two callers:
//   - `./per-ankh staging reclone` (scripts/prod/commands/reclone.ts) — the
//     remote half of the clone: drop + import against staging's D1, followed
//     by R2 sync (which stays in scripts/prod/deploy/reclone.ts).
//   - `./per-ankh restore --local` (scripts/restore.ts) — load a backup into
//     the local .wrangler dev state. A strict subset: drop + import only, no
//     R2, no fresh export.
//
// Everything here operates on a D1Target rather than a CloudEnv, because
// "local" is not a cloud environment (see lib/environments.ts) yet needs the
// same drop/import primitives. A target carries the three facts wrangler needs
// (db name, --env flag, --local vs --remote) plus the disposability guard.

import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { runCaptured, runStreamed } from "./shell";
import { getEnv, type CloudEnv } from "./environments";

// scripts/lib/d1-import.ts → repo root is two levels up. Mirrors the path
// derivation in lib/d1-backup.ts.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLOUD_DIR = resolve(REPO_ROOT, "cloud");

// The facts that differ between a remote D1 (prod/staging) and the local
// .wrangler dev state, from wrangler's point of view. Decoupled from CloudEnv
// so local — which isn't a cloud environment — can be a target too.
export interface D1Target {
	// D1 database_name (matches the wrangler.toml binding). For local this is
	// prod's name: there is one local DB, and the admin CLI's --local uses the
	// same mapping.
	dbName: string;
	// Splices into wrangler arg arrays: [] for prod/local (top-level config),
	// ["--env", "staging"] for staging.
	wranglerEnvFlag: string[];
	// Whether wrangler hits remote Cloudflare (--remote) or the local
	// .wrangler dev state (--local).
	mode: "local" | "remote";
	// Whether this target's data is throwaway. The reset/import steps are
	// destructive; this is the guard that stops a future caller pointing them
	// at prod. Never true for prod; true for staging and for local.
	disposable: boolean;
	// Human label for messages ("staging", "local .wrangler state").
	label: string;
}

// A remote D1 target derived from a cloud environment (prod/staging).
export function remoteTarget(env: CloudEnv): D1Target {
	return {
		dbName: env.dbName,
		wranglerEnvFlag: env.wranglerEnvFlag,
		mode: "remote",
		disposable: env.disposableData,
		label: env.name,
	};
}

// The local .wrangler dev state. Maps to prod's D1 name (there is a single
// local database; the admin CLI's --local target uses the same mapping) and
// is inherently disposable — it's dev scratch state.
export const LOCAL_D1_TARGET: D1Target = {
	dbName: getEnv("prod").dbName,
	wranglerEnvFlag: [],
	mode: "local",
	disposable: true,
	label: "local .wrangler state",
};

function wranglerTargetFlag(target: D1Target): string {
	return target.mode === "local" ? "--local" : "--remote";
}

// Misuse guard for the destructive steps below: nothing but this assert stops
// a future caller from passing prod. Same spirit as the admin CLI's local-only
// gates on seed/dev-login.
function assertDisposable(target: D1Target): void {
	if (!target.disposable) {
		throw new Error(
			`refusing to reset/import into "${target.label}" — its data is not disposable`,
		);
	}
}

// `wrangler d1 execute --json` returns an array, one entry per statement:
//   [{ results: [...], success: true, meta: {...} }, ...]
interface D1ResultSet<T> {
	results: T[];
	success: boolean;
}

// Strip wrangler's banner / non-JSON noise. With --json wrangler still prints
// a few status lines to stdout before the JSON payload on some versions.
// (Mirrors scripts/admin/wrangler.ts, whose wrapper is bound to the admin
// CLI's module-global target.)
function extractJson(stdout: string): string {
	const trimmed = stdout.trim();
	if (trimmed.startsWith("[") || trimmed.startsWith("{")) return trimmed;
	const idx = stdout.search(/^\s*[[{]/m);
	if (idx === -1) return trimmed;
	return stdout.slice(idx).trim();
}

// Run a (possibly multi-statement) --command against the target's D1,
// returning one result set per statement. NOTE: the /query endpoint behind
// --command runs every statement in its own implicit transaction, so
// connection-state pragmas like defer_foreign_keys reset at each statement
// boundary — they cannot blanket a batch here. (--file goes through the import
// endpoint instead, which rolls back wholesale on failure — but FK parent
// resolution at statement-compile time applies there too; see
// prepareOrderedImport.)
async function d1Command(
	target: D1Target,
	sql: string,
): Promise<D1ResultSet<unknown>[]> {
	const r = await runCaptured(
		"npx",
		[
			"wrangler",
			"d1",
			"execute",
			target.dbName,
			...target.wranglerEnvFlag,
			wranglerTargetFlag(target),
			"--json",
			"--command",
			sql,
		],
		{ cwd: CLOUD_DIR },
	);
	if (r.code !== 0) {
		throw new Error(
			`wrangler d1 execute failed (exit ${r.code}):\n${r.stderr.trim() || r.stdout.trim()}`,
		);
	}
	return JSON.parse(extractJson(r.stdout)) as D1ResultSet<unknown>[];
}

async function d1ExecuteJson<T = Record<string, unknown>>(
	target: D1Target,
	sql: string,
): Promise<T[]> {
	const sets = await d1Command(target, sql);
	return (sets[0]?.results ?? []) as T[];
}

// SQLite double-quoted identifier. Names come from sqlite_master (our own
// migrations), so this is correctness hygiene, not a security boundary.
function sqlIdent(name: string): string {
	return `"${name.replace(/"/g, '""')}"`;
}

interface SqliteObject {
	name: string;
	type: string;
}

// One row per foreign key from PRAGMA foreign_key_list; `table` is the
// parent (referenced) table.
interface ForeignKeyRow {
	table: string;
}

// Order tables children-first/parents-last via Kahn's algorithm: a table is
// emitted once no remaining table references it. (Reverse the result for
// parents-first.) Throws on an FK cycle — impossible in this schema, but
// anything else would loop or silently drop tables.
function topoChildrenFirst(
	tables: string[],
	parentsOf: Map<string, Set<string>>,
): string[] {
	const childCount = new Map<string, number>(tables.map((t) => [t, 0]));
	for (const parents of parentsOf.values()) {
		for (const p of parents) {
			childCount.set(p, (childCount.get(p) ?? 0) + 1);
		}
	}
	// `order` doubles as the work list.
	const order = tables.filter((t) => childCount.get(t) === 0);
	for (let i = 0; i < order.length; i++) {
		for (const p of parentsOf.get(order[i]) ?? []) {
			const n = (childCount.get(p) ?? 0) - 1;
			childCount.set(p, n);
			if (n === 0) order.push(p);
		}
	}
	if (order.length !== tables.length) {
		const stuck = tables.filter((t) => !order.includes(t));
		throw new Error(
			`cannot order tables — FK cycle among: ${stuck.join(", ")}`,
		);
	}
	return order;
}

// Drop every user table and view so the dump's bare CREATE statements can
// replay. The d1_migrations bookkeeping table is deliberately included: the
// dump carries the source's d1_migrations rows, and those must replace the
// target's so that a later `migrate` reports exactly the migrations the source
// hasn't applied yet. (Do not borrow the `d1_%` filter that d1-backup.ts uses
// for its row-count display.)
//
// Drop order is load-bearing. Each DROP runs with immediate FK enforcement
// (defer_foreign_keys cannot span statements on the /query path — see
// d1Command), and under enforcement DROP TABLE compiles an implicit
// DELETE FROM that must resolve the table's FK parents: dropping a parent
// before any of its children makes the child's later drop fail with
// "no such table: main.<parent>". The saving asymmetry is that FK
// definitions live on the child — once a child is dropped its constraint
// vanishes from the schema, so a parent dropped last compiles with nothing
// left to check. Hence: views first (nothing references them), then tables
// children-first/parents-last, ordered via PRAGMA foreign_key_list. Useful
// invariant: if the batch dies partway, every surviving table still has all
// its parents (parents only ever drop after all their children), so a retry
// is always clean. Triggers drop with their tables (the implicit DELETE does
// not fire them); sqlite_sequence is cleaned by the dump itself (`DELETE
// FROM sqlite_sequence`). Returns the number of objects dropped.
export async function resetD1(target: D1Target): Promise<number> {
	assertDisposable(target);
	const objects = await d1ExecuteJson<SqliteObject>(
		target,
		"SELECT name, type FROM sqlite_master WHERE type IN ('table','view') " +
			"AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
	);
	if (objects.length === 0) return 0;

	const views = objects.filter((o) => o.type === "view").map((o) => o.name);
	const tables = objects.filter((o) => o.type === "table").map((o) => o.name);

	// Each table's FK parents, fetched in one batched call — result sets come
	// back index-aligned with `tables`.
	const parentsOf = new Map<string, Set<string>>();
	if (tables.length > 0) {
		const sets = await d1Command(
			target,
			tables.map((t) => `PRAGMA foreign_key_list(${sqlIdent(t)})`).join("; "),
		);
		if (sets.length !== tables.length) {
			throw new Error(
				`foreign_key_list returned ${sets.length} result sets for ${tables.length} tables`,
			);
		}
		const tableSet = new Set(tables);
		tables.forEach((t, i) => {
			const parents = new Set<string>();
			for (const row of sets[i].results as ForeignKeyRow[]) {
				// Ignore self-references (the constraint drops with its own
				// table) and parents outside the enumerated set (nothing to
				// order against).
				if (row.table !== t && tableSet.has(row.table)) {
					parents.add(row.table);
				}
			}
			parentsOf.set(t, parents);
		});
	}

	const order = topoChildrenFirst(tables, parentsOf);

	const drops = [
		...views.map((v) => `DROP VIEW ${sqlIdent(v)}`),
		...order.map((t) => `DROP TABLE ${sqlIdent(t)}`),
	];
	await d1Command(target, drops.join("; "));
	return objects.length;
}

export function checkSqlite3Installed(): boolean {
	return spawnSync("sqlite3", ["--version"], { stdio: "ignore" }).status === 0;
}

// Run sqlite3 with a SQL command against `db`, returning trimmed stdout.
// (Local copy of the helper in lib/d1-backup.ts — both modules keep their
// spawn wrappers private.)
function sqlite3Query(db: string, sql: string): string {
	const r = spawnSync("sqlite3", [db, sql], { encoding: "utf8" });
	if (r.status !== 0) {
		throw new Error(
			`sqlite3 query failed (exit ${r.status}): ${(r.stderr || "").trim()}`,
		);
	}
	return (r.stdout || "").trim();
}

// Object names get spliced into single-quoted SQL literals and pragma calls
// below — require plain identifiers rather than trying to quote through
// those paths. Everything in this schema qualifies.
function assertPlainIdent(name: string): void {
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
		throw new Error(`unexpected object name in dump: ${JSON.stringify(name)}`);
	}
}

export interface PreparedImport {
	orderedPath: string;
	tempDir: string;
}

// Re-emit a wrangler D1 dump in FK dependency order, because the raw dump
// does not replay under FK enforcement. wrangler exports tables in creation
// order, and this schema has a forward reference: games (migration 0004)
// later gained an FK to collections (migration 0019), so the dump CREATEs
// games — and INSERTs its rows — before collections exists. Compiling those
// INSERTs resolves the FK parent and fails with "no such table:
// main.collections" (observed against remote D1). The dump's leading
// defer_foreign_keys pragma can't help: deferral changes when constraint
// violations are checked, not compile-time table resolution. (Materializing
// the dump locally works only because the sqlite3 CLI defaults
// foreign_keys=OFF.)
//
// So: materialize the dump into a scratch SQLite DB (FKs off — faithful),
// read the real schema and FK graph from it, and write a new import file
// with tables created AND populated parents-first. Every parent fully exists
// before any child statement compiles or runs, so the file replays under any
// FK-enforcement semantics. Section order mirrors the original dump where it
// matters: indexes/views/triggers come after all data (so no trigger fires
// during the replay), and sqlite_sequence is rewritten last to overwrite the
// counters the AUTOINCREMENT inserts auto-created. Caller removes tempDir.
export function prepareOrderedImport(sqlPath: string): PreparedImport {
	const tempDir = mkdtempSync(join(tmpdir(), "per-ankh-reclone-"));
	const db = join(tempDir, "dump.sqlite");
	const orderedPath = join(tempDir, "import-ordered.sql");

	// Materialize — which also proves the artifact is valid SQL before
	// anything remote is touched. Same fd-stdio pattern as lib/d1-backup.ts.
	const sqlFd = openSync(sqlPath, "r");
	try {
		const load = spawnSync("sqlite3", [db], {
			stdio: [sqlFd, "ignore", "inherit"],
		});
		if (load.status !== 0) {
			throw new Error(
				`sqlite3 could not materialize ${sqlPath} (exit ${load.status}).`,
			);
		}
	} finally {
		closeSync(sqlFd);
	}

	const tables = sqlite3Query(
		db,
		"SELECT name FROM sqlite_master WHERE type='table' " +
			"AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
	)
		.split("\n")
		.map((s) => s.trim())
		.filter(Boolean);
	if (tables.length === 0) {
		throw new Error(`no tables found in ${sqlPath}`);
	}
	for (const t of tables) assertPlainIdent(t);

	// Whole FK graph in one query via the pragma table-valued function.
	// Names are plain identifiers (asserted), so '|' is a safe separator.
	const tableSet = new Set(tables);
	const parentsOf = new Map<string, Set<string>>(
		tables.map((t) => [t, new Set<string>()]),
	);
	const fkPairs = sqlite3Query(
		db,
		"SELECT m.name || '|' || f.\"table\" FROM sqlite_master m, " +
			"pragma_foreign_key_list(m.name) f WHERE m.type='table'",
	);
	for (const line of fkPairs.split("\n")) {
		const [child, parent] = line.split("|");
		if (!child || !parent || child === parent) continue;
		if (tableSet.has(child) && tableSet.has(parent)) {
			parentsOf.get(child)?.add(parent);
		}
	}
	const createOrder = topoChildrenFirst(tables, parentsOf).reverse();

	// 1. Schema, parents-first. The defer pragma is harmless belt-and-braces
	// (correct ordering makes it unnecessary).
	const header = ["PRAGMA defer_foreign_keys=TRUE;"];
	for (const t of createOrder) {
		const ddl = sqlite3Query(
			db,
			`SELECT sql FROM sqlite_master WHERE type='table' AND name='${t}'`,
		);
		header.push(`${ddl};`);
	}
	appendFileSync(orderedPath, `${header.join("\n")}\n`);

	// 2. Data, same parents-first order, streamed straight to the file
	// descriptor (the dumps run tens of MB — far past spawnSync's stdout
	// buffer). INSERTs are built with the quote() SQL function — the classic
	// .dump strategy — rather than the CLI's `.mode insert`: sqlite3 ≥3.50
	// emits unistr('…') escapes for strings containing control characters,
	// and D1's engine has no unistr(), so the import fails with "no such
	// function: unistr" (observed). quote() emits plain standard literals
	// (doubled quotes, raw embedded newlines, X'…' blobs) that any SQLite
	// parses.
	const outFd = openSync(orderedPath, "a");
	try {
		for (const t of createOrder) {
			const cols = sqlite3Query(
				db,
				`SELECT name FROM pragma_table_info('${t}') ORDER BY cid`,
			)
				.split("\n")
				.map((s) => s.trim())
				.filter(Boolean);
			if (cols.length === 0) {
				throw new Error(`no columns reported for table ${t}`);
			}
			for (const c of cols) assertPlainIdent(c);
			const exprs = cols
				.map((c) => `quote(${sqlIdent(c)})`)
				.join(" || ',' || ");
			const sel =
				`SELECT 'INSERT INTO ${sqlIdent(t)} VALUES(' || ` +
				`${exprs} || ');' FROM ${sqlIdent(t)}`;
			const dump = spawnSync("sqlite3", [db, sel], {
				stdio: ["ignore", outFd, "inherit"],
			});
			if (dump.status !== 0) {
				throw new Error(
					`sqlite3 data dump failed for ${t} (exit ${dump.status}).`,
				);
			}
		}
	} finally {
		closeSync(outFd);
	}

	// 3. Tail: sqlite_sequence rewrite, then views/indexes/triggers.
	const tail: string[] = [];
	const hasSequence =
		sqlite3Query(
			db,
			"SELECT count(*) FROM sqlite_master WHERE name='sqlite_sequence'",
		) !== "0";
	if (hasSequence) {
		tail.push("DELETE FROM sqlite_sequence;");
		const seqRows = sqlite3Query(
			db,
			"SELECT name || '|' || seq FROM sqlite_sequence",
		);
		for (const line of seqRows.split("\n")) {
			const [name, seq] = line.split("|");
			if (!name || !seq || !/^\d+$/.test(seq)) continue;
			assertPlainIdent(name);
			tail.push(
				`INSERT INTO "sqlite_sequence" ("name","seq") VALUES('${name}',${seq});`,
			);
		}
	}
	for (const type of ["view", "index", "trigger"] as const) {
		const names = sqlite3Query(
			db,
			`SELECT name FROM sqlite_master WHERE type='${type}' ` +
				"AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%'",
		)
			.split("\n")
			.map((s) => s.trim())
			.filter(Boolean);
		for (const n of names) {
			assertPlainIdent(n);
			const ddl = sqlite3Query(
				db,
				`SELECT sql FROM sqlite_master WHERE type='${type}' AND name='${n}'`,
			);
			tail.push(`${ddl};`);
		}
	}
	appendFileSync(orderedPath, `${tail.join("\n")}\n`);

	return { orderedPath, tempDir };
}

// Import the prepared (FK-ordered) file into the target D1. --file routes
// through D1's chunked import API (remote) / the local sqlite (local), which
// handles multi-MB dumps. -y skips wrangler's own prompt — callers have
// already done their own confirmation.
export async function importDump(
	target: D1Target,
	sqlPath: string,
): Promise<void> {
	assertDisposable(target);
	const code = await runStreamed(
		"npx",
		[
			"wrangler",
			"d1",
			"execute",
			target.dbName,
			...target.wranglerEnvFlag,
			wranglerTargetFlag(target),
			"--file",
			sqlPath,
			"-y",
		],
		{ cwd: CLOUD_DIR, label: "import", color: "yellow" },
	);
	if (code !== 0) {
		throw new Error(`D1 import failed with exit code ${code}`);
	}
}
