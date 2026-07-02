// `./per-ankh restore --local` — load a D1 backup artifact into the local
// .wrangler dev state. The inverse of `./per-ankh backup`, and a local-only
// subset of `staging reclone`: drop every local table, then replay a
// backups/*.sql dump re-emitted in FK-dependency order (see lib/d1-import.ts).
//
// Local-only by construction — like `admin dev-login` / `admin tournament
// seed`, it refuses any remote target. Restoring over a live D1 is disaster
// recovery that Cloudflare Time Travel covers (see lib/d1-backup.ts), not a
// casual CLI verb; keeping this offline also means it never triggers wrangler's
// remote auth.
//
// Scope is D1 only — R2 and KV are untouched. Tournament and all other D1 data
// restores fully; game-detail pages whose parsed blobs live only in R2 will
// 404 locally against a fresh restore. Source is a local backups/*.sql
// artifact (never a fresh prod export), so the whole operation stays offline.

import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { parseFlags, flagString } from "./lib/cli";
import { bold, dim, formatBytes, info, ok } from "./lib/format";
import { confirmYesNo } from "./lib/confirm";
import {
	LOCAL_D1_TARGET,
	checkSqlite3Installed,
	prepareOrderedImport,
	resetD1,
	importDump,
} from "./lib/d1-import";

// scripts/restore.ts → repo root is one level up.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BACKUPS_DIR = join(REPO_ROOT, "backups");

function printHelp(): void {
	process.stdout.write(
		[
			"per-ankh restore — load a D1 backup into the local .wrangler dev state",
			"",
			"Usage:",
			"  ./per-ankh restore --local [--from FILE] [--yes]",
			"",
			"Drops every table in the local D1 and replays a backup dump, re-emitted",
			"in FK-dependency order. The inverse of `./per-ankh backup`; a local-only",
			"subset of `staging reclone` (D1 only — R2 and KV are untouched).",
			"",
			"Flags:",
			"  --local         Required. Load into local .wrangler state; refuses remote.",
			"  --from FILE     The .sql dump to import (default: newest backups/*.sql).",
			"  --yes           Skip the confirmation prompt.",
			"  --help          Show this help",
			"",
		].join("\n"),
	);
}

// Newest backups/*.sql. The UTC stamp in the filename sorts lexically, so a
// reverse sort puts the most recent first. Excludes .sqlite (the materialized
// query DB, not an ingest artifact).
function newestBackup(): string | undefined {
	if (!existsSync(BACKUPS_DIR)) return undefined;
	const sqls = readdirSync(BACKUPS_DIR)
		.filter((f) => f.endsWith(".sql"))
		.sort()
		.reverse();
	return sqls[0] !== undefined ? join(BACKUPS_DIR, sqls[0]) : undefined;
}

export async function main(argv: string[]): Promise<void> {
	const { flags } = parseFlags(argv);

	if (flags.help === true) {
		printHelp();
		return;
	}

	// Hard local-only gate — mirrors admin dev-login / tournament seed.
	if (flags.local !== true) {
		throw new Error(
			"restore is local-only — pass --local to load into the .wrangler dev state.\n" +
				"  (Restoring a remote D1 is disaster recovery — use Cloudflare Time Travel.)",
		);
	}
	if (flags.remote === true || flags.staging === true) {
		throw new Error(
			"restore refuses remote targets; it only writes local .wrangler state.",
		);
	}

	if (!checkSqlite3Installed()) {
		throw new Error(
			"sqlite3 not found on PATH. Install it (macOS ships it at /usr/bin/sqlite3).",
		);
	}

	// Resolve the source dump: --from (against the invoking cwd — the import
	// step later runs wrangler with cwd=cloud/) or the newest backup.
	if (flags.from === true) {
		throw new Error("--from requires a path to a backups/*.sql artifact");
	}
	const fromFlag = flagString(flags, "from");
	const sqlPath = fromFlag !== undefined ? resolve(fromFlag) : newestBackup();
	if (sqlPath === undefined) {
		throw new Error(
			`No .sql backup found under ${BACKUPS_DIR}. ` +
				"Run `./per-ankh backup` first, or pass --from FILE.",
		);
	}
	if (!existsSync(sqlPath)) {
		throw new Error(`no such file: ${sqlPath}`);
	}
	if (statSync(sqlPath).size === 0) {
		throw new Error(`empty file: ${sqlPath}`);
	}
	if (!sqlPath.endsWith(".sql")) {
		throw new Error(
			`expected the .sql dump artifact (not .sqlite): ${sqlPath}`,
		);
	}

	// Summary + confirm.
	const st = statSync(sqlPath);
	process.stdout.write(
		`\n${bold("Restore plan (dump → local .wrangler state)")}\n`,
	);
	process.stdout.write(`${"─".repeat(33)}\n`);
	process.stdout.write(
		`  Source dump:  ${sqlPath} (${formatBytes(st.size)}, dumped ${st.mtime.toISOString()})\n`,
	);
	process.stdout.write(
		`  D1:           drop every table in local ${LOCAL_D1_TARGET.dbName}, import the dump\n`,
	);
	process.stdout.write(`  R2 / KV:      untouched (D1 only)\n\n`);

	if (flags.yes !== true) {
		const go = await confirmYesNo(
			"This WIPES the local D1 (.wrangler state) and replaces it with the dump. Continue?",
		);
		if (!go) {
			info("Cancelled.");
			return;
		}
	}

	// Prepare the FK-ordered import file before touching anything — a dump
	// that fails to materialize or order aborts before any side effect.
	info("Preparing FK-ordered import file...");
	const prepared = prepareOrderedImport(sqlPath);
	try {
		info(`Resetting local ${LOCAL_D1_TARGET.dbName} (drop all tables)...`);
		const dropped = await resetD1(LOCAL_D1_TARGET);
		ok(
			dropped === 0
				? "Nothing to drop (empty database)."
				: `Dropped ${dropped} table(s)/view(s).`,
		);

		info("Importing dump into local D1...");
		await importDump(LOCAL_D1_TARGET, prepared.orderedPath);
		ok("D1 import complete.");

		// The dump carried the source's d1_migrations rows, so local now
		// reports exactly the migrations that DB hasn't applied. If local code
		// has newer migrations, apply them before running the dev server.
		process.stdout.write(`\n${bold("Next steps")}\n`);
		info("If local code has migrations newer than the dump, apply them:");
		process.stdout.write(`    ${dim("(cd cloud && npm run migrate:local)")}\n`);
		ok(
			`Restore complete — local D1 mirrors the dump from ${st.mtime.toISOString()}.`,
		);
	} finally {
		rmSync(prepared.tempDir, { recursive: true, force: true });
	}
}
