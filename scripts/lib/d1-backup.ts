// Shared D1 backup engine: export a database to a portable .sql dump and
// materialize it into a queryable .sqlite file, verifying integrity.
//
// Two callers:
//   - `./per-ankh backup` (scripts/backup.ts) — the operator backup command.
//   - `./per-ankh staging reclone` (scripts/prod/commands/reclone.ts) — uses
//     the fresh prod export as the import artifact for the staging clone.
//
// Cloudflare Time Travel covers in-platform point-in-time restore (~30 days).
// This is the complement: it pulls a full, self-contained copy of the D1
// database OUT of Cloudflare on demand, for local inspection, ad-hoc
// analytics, and a restore artifact that survives beyond Time Travel's window
// or an account-level problem.
//
// Two artifacts per run, written side by side under the output directory:
//   - <base>.sql    — wrangler's native dump. NOT directly replayable into
//                     D1: wrangler exports tables in creation order, and the
//                     schema's forward FK reference (games → collections)
//                     fails compile-time parent resolution under D1's FK
//                     enforcement. Restore by re-emitting it in FK order —
//                     prepareOrderedImport in scripts/prod/deploy/reclone.ts.
//   - <base>.sqlite — the dump materialized into a real binary DB you can open
//                     and query directly.
//
// Exports production D1 (or the local .wrangler state that simulates it) —
// there's no staging backup; staging data is throwaway by design. The remote
// path authenticates via wrangler (the 1Password prompt), so this is
// operator-run — see CLAUDE.md.
//
// Throws on any failure (partial artifacts are removed first); callers decide
// between exiting (the backup command, via per-ankh's top-level catch) and
// handling (reclone).

import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	openSync,
	closeSync,
	rmSync,
	statSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

import { info, warn, formatBytes, printTable } from "./format";
import { getEnv } from "./environments";

const DB_NAME = getEnv("prod").dbName;

// scripts/lib/d1-backup.ts → repo root is two levels up. Mirrors the path
// derivation in admin/wrangler.ts (whose CLOUD_DIR/WRANGLER_BIN are
// module-private).
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLOUD_DIR = resolve(REPO_ROOT, "cloud");
const WRANGLER_BIN = resolve(CLOUD_DIR, "node_modules/.bin/wrangler");

export interface BackupArtifacts {
	sqlPath: string;
	sqlitePath: string;
}

export interface BackupOpts {
	// Export the local .wrangler dev state instead of remote prod.
	local: boolean;
	// Output directory; defaults to backups/ at repo root.
	outDir?: string;
}

// Run sqlite3 with a SQL command against `db`, returning trimmed stdout.
// Throws on non-zero exit so callers can fail loudly.
function sqlite3Query(db: string, sql: string): string {
	const r = spawnSync("sqlite3", [db, sql], { encoding: "utf8" });
	if (r.status !== 0) {
		throw new Error(
			`sqlite3 query failed (exit ${r.status}): ${(r.stderr || "").trim()}`,
		);
	}
	return (r.stdout || "").trim();
}

export async function runBackup(opts: BackupOpts): Promise<BackupArtifacts> {
	const target = opts.local ? "--local" : "--remote";
	const outDir = opts.outDir ?? join(REPO_ROOT, "backups");

	// Fail before touching wrangler if sqlite3 is missing — otherwise we'd
	// produce a .sql with no way to materialize it.
	if (spawnSync("sqlite3", ["--version"], { stdio: "ignore" }).status !== 0) {
		throw new Error(
			"sqlite3 not found on PATH. Install it (macOS ships it at /usr/bin/sqlite3).",
		);
	}

	mkdirSync(outDir, { recursive: true });

	// UTC, punctuation stripped: 2026-05-30T12:34:56.789Z → 20260530T123456Z.
	// Sorts lexically and is unambiguous across machines/timezones.
	const stamp = new Date()
		.toISOString()
		.replace(/[-:]/g, "")
		.replace(/\.\d+Z$/, "Z");
	const base = join(
		outDir,
		`${DB_NAME}-${opts.local ? "local" : "remote"}-${stamp}`,
	);
	const sqlPath = `${base}.sql`;
	const sqlitePath = `${base}.sqlite`;

	// Step 1: wrangler native dump. Inherit stdio so the auth prompt and
	// wrangler's progress are visible; -y skips its own confirmation.
	info(
		`Exporting ${DB_NAME} (${opts.local ? "local" : "remote"}) → ${sqlPath}`,
	);
	const exportRes = spawnSync(
		WRANGLER_BIN,
		["d1", "export", DB_NAME, target, "--output", sqlPath, "-y"],
		{
			cwd: CLOUD_DIR,
			stdio: "inherit",
			env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
		},
	);
	if (exportRes.status !== 0) {
		// Remove a partial dump so it can't be mistaken for a good backup.
		if (existsSync(sqlPath)) rmSync(sqlPath);
		throw new Error(`wrangler d1 export failed (exit ${exportRes.status}).`);
	}
	if (!existsSync(sqlPath) || statSync(sqlPath).size === 0) {
		throw new Error(`Export produced no data at ${sqlPath}.`);
	}

	// Step 2: materialize the dump into a real SQLite DB (`sqlite3 db < dump`).
	info(`Materializing → ${sqlitePath}`);
	const fd = openSync(sqlPath, "r");
	try {
		const loadRes = spawnSync("sqlite3", [sqlitePath], {
			stdio: [fd, "inherit", "inherit"],
		});
		if (loadRes.status !== 0) {
			if (existsSync(sqlitePath)) rmSync(sqlitePath);
			throw new Error(`sqlite3 load failed (exit ${loadRes.status}).`);
		}
	} finally {
		closeSync(fd);
	}

	// Step 3: verify the materialized DB.
	const integrity = sqlite3Query(sqlitePath, "PRAGMA integrity_check;");
	if (integrity !== "ok") {
		warn(`integrity_check did NOT return ok:\n${integrity}`);
		warn("Backup files kept for inspection; treat this snapshot as suspect.");
		throw new Error("integrity_check failed.");
	}

	// Per-table row counts. Exclude sqlite internals, Cloudflare internals,
	// and the migrations bookkeeping table.
	const tables = sqlite3Query(
		sqlitePath,
		"SELECT name FROM sqlite_master WHERE type='table' " +
			"AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' " +
			"AND name NOT LIKE 'd1_%' ORDER BY name;",
	)
		.split("\n")
		.map((s) => s.trim())
		.filter(Boolean);

	const rows: string[][] = [];
	let totalRows = 0;
	if (tables.length > 0) {
		const countSql = tables
			.map((t) => `SELECT '${t}' AS tbl, count(*) AS n FROM "${t}"`)
			.join(" UNION ALL ");
		const out = sqlite3Query(sqlitePath, countSql);
		for (const line of out.split("\n")) {
			const [tbl, n] = line.split("|");
			const count = parseInt(n ?? "0", 10) || 0;
			totalRows += count;
			rows.push([tbl ?? "", count.toLocaleString()]);
		}
	}

	const sqlSize = formatBytes(statSync(sqlPath).size);
	const sqliteSize = formatBytes(statSync(sqlitePath).size);

	process.stdout.write("\n");
	printTable(
		[
			{ header: "table", width: 28 },
			{ header: "rows", width: 14, align: "right" },
		],
		rows,
	);
	process.stdout.write("\n");
	info(`integrity_check: ${integrity}`);
	info(`${tables.length} tables, ${totalRows.toLocaleString()} rows total`);
	info(`SQL:    ${sqlPath} (${sqlSize})`);
	info(`SQLite: ${sqlitePath} (${sqliteSize})`);
	return { sqlPath, sqlitePath };
}
