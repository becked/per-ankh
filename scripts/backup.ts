// `./per-ankh backup` — snapshot D1 to a portable SQLite file.
//
// Cloudflare Time Travel covers in-platform point-in-time restore (~30 days).
// This command is the complement: it pulls a full, self-contained copy of the
// D1 database OUT of Cloudflare on demand, for local inspection, ad-hoc
// analytics, and a restore artifact that survives beyond Time Travel's window
// or an account-level problem.
//
// Two artifacts per run, written side by side under backups/:
//   - <base>.sql    — wrangler's native dump; the canonical "restore into D1"
//                     form (`wrangler d1 execute --file <base>.sql`).
//   - <base>.sqlite — the dump materialized into a real binary DB you can open
//                     and query directly.
//
// Targets remote (production D1) by default; `--local` exports the dev
// .wrangler state. The remote path authenticates via wrangler (the
// 1Password prompt), so this is operator-run — see CLAUDE.md.

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

import { parseFlags, flagString } from "./lib/cli";
import { info, ok, warn, err, formatBytes, printTable } from "./lib/format";
import { DB_NAME } from "./admin/wrangler";

// scripts/backup.ts → repo root is one level up. Mirrors the path derivation
// in admin/wrangler.ts (whose CLOUD_DIR/WRANGLER_BIN are module-private).
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLOUD_DIR = resolve(REPO_ROOT, "cloud");
const WRANGLER_BIN = resolve(CLOUD_DIR, "node_modules/.bin/wrangler");

function printHelp(): void {
	process.stdout.write(
		[
			"per-ankh backup — snapshot D1 to a .sql + .sqlite file",
			"",
			"Usage:",
			"  ./per-ankh backup [--local] [--out DIR]",
			"",
			"Writes two artifacts under the output directory:",
			"  <base>.sql      wrangler dump (restore via `wrangler d1 execute --file`)",
			"  <base>.sqlite   the dump materialized into a queryable SQLite DB",
			"",
			"Flags:",
			"  --local         Export the local .wrangler dev state (default: remote prod)",
			"  --out DIR       Output directory (default: backups/ at repo root)",
			"  --help          Show this help",
			"",
		].join("\n"),
	);
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

export async function main(argv: string[]): Promise<void> {
	const { flags } = parseFlags(argv);

	if (flags.help === true) {
		printHelp();
		return;
	}

	const local = flags.local === true;
	const target = local ? "--local" : "--remote";
	const outDir = flagString(flags, "out") ?? join(REPO_ROOT, "backups");

	// Fail before touching wrangler if sqlite3 is missing — otherwise we'd
	// produce a .sql with no way to materialize it.
	if (spawnSync("sqlite3", ["--version"], { stdio: "ignore" }).status !== 0) {
		err(
			"sqlite3 not found on PATH. Install it (macOS ships it at /usr/bin/sqlite3).",
		);
		process.exit(1);
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
		`${DB_NAME}-${local ? "local" : "remote"}-${stamp}`,
	);
	const sqlPath = `${base}.sql`;
	const sqlitePath = `${base}.sqlite`;

	// Step 1: wrangler native dump. Inherit stdio so the auth prompt and
	// wrangler's progress are visible; -y skips its own confirmation.
	info(`Exporting ${DB_NAME} (${local ? "local" : "remote"}) → ${sqlPath}`);
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
		err(`wrangler d1 export failed (exit ${exportRes.status}).`);
		process.exit(1);
	}
	if (!existsSync(sqlPath) || statSync(sqlPath).size === 0) {
		err(`Export produced no data at ${sqlPath}.`);
		process.exit(1);
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
			err(`sqlite3 load failed (exit ${loadRes.status}).`);
			process.exit(1);
		}
	} finally {
		closeSync(fd);
	}

	// Step 3: verify the materialized DB.
	const integrity = sqlite3Query(sqlitePath, "PRAGMA integrity_check;");
	if (integrity !== "ok") {
		warn(`integrity_check did NOT return ok:\n${integrity}`);
		warn("Backup files kept for inspection; treat this snapshot as suspect.");
		process.exit(1);
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
	ok("backup complete");
}
