// `./per-ankh staging reclone` — destroy staging data and re-clone it from
// production: a fresh prod D1 export (or a --from artifact) imported over a
// dropped staging schema, then prod R2 synced into the staging bucket.
// Staging data is disposable by design; the periodic reclone is also what
// propagates prod deletions. See docs/cloud-deploy-plan.md §9.3.

import { existsSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { runBackup } from "../../lib/d1-backup";
import {
	checkSqlite3Installed,
	prepareOrderedImport,
	resetD1,
	importDump,
	remoteTarget,
} from "../../lib/d1-import";
import { parseFlags, flagString } from "../../lib/cli";
import { bold, dim, formatBytes, info, ok, warn } from "../../lib/format";
import { confirmTyping } from "../../lib/confirm";
import { getEnv, type CloudEnv } from "../../lib/environments";
import type { ProdOpts } from "../types";
import { listPendingMigrations } from "../checks/migrations";
import {
	checkRcloneInstalled,
	loadRecloneCreds,
	syncR2FromProd,
} from "../deploy/reclone";

export async function run(
	argv: string[],
	opts: ProdOpts,
	env: CloudEnv,
): Promise<void> {
	const { flags } = parseFlags(argv);
	const fromFlag = flagString(flags, "from");
	// Resolve --from against the invoking cwd right away: the import step
	// later runs wrangler with cwd=cloud/ (so it finds its config), and
	// wrangler would resolve a relative --file against that — not against
	// where the operator typed the path. (The fresh-export path is immune:
	// runBackup returns absolute paths.)
	const fromPath = fromFlag !== undefined ? resolve(fromFlag) : undefined;
	const prodBucket = getEnv("prod").r2Bucket;

	// ─── 1. Local preflight — fail before any side effect ───────────────
	const problems: string[] = [];
	if (!(await checkRcloneInstalled())) {
		problems.push(
			"rclone not found on PATH. Install it (e.g. `brew install rclone`).",
		);
	}
	if (!checkSqlite3Installed()) {
		problems.push(
			"sqlite3 not found on PATH. Install it (macOS ships it at /usr/bin/sqlite3).",
		);
	}
	const credsResult = loadRecloneCreds();
	if (!credsResult.ok) {
		problems.push(
			`.staging.vars is missing R2 sync credentials: ${credsResult.missing.join(", ")}\n` +
				"    (two R2 API tokens — prod read-only, staging read-write; " +
				"see docs/cloud-deploy-plan.md §9.3)",
		);
	}
	if (flags.from === true) {
		problems.push("--from requires a path to a backups/*.sql artifact");
	} else if (fromPath !== undefined) {
		if (!existsSync(fromPath)) {
			problems.push(`--from: no such file: ${fromPath}`);
		} else if (statSync(fromPath).size === 0) {
			problems.push(`--from: empty file: ${fromPath}`);
		} else if (!fromPath.endsWith(".sql")) {
			problems.push(
				`--from: expected the .sql dump artifact (not .sqlite): ${fromPath}`,
			);
		}
	}
	if (problems.length > 0 || !credsResult.ok) {
		throw new Error(
			`reclone preflight failed:\n${problems.map((p) => `  - ${p}`).join("\n")}`,
		);
	}
	const creds = credsResult.creds;

	// ─── 2. Acquire the prod dump ────────────────────────────────────────
	// Fresh export by default — read-only against prod, and its integrity
	// check + row-count table double as the "what you're about to import"
	// preview. --from reuses an artifact: the retry loop for a failed
	// migration rehearsal. Dry-run never exports (stays fully local).
	let sqlPath: string | null = null;
	if (fromPath !== undefined) {
		const st = statSync(fromPath);
		info(
			`Using existing dump: ${fromPath} (${formatBytes(st.size)}, exported ${st.mtime.toISOString()})`,
		);
		sqlPath = fromPath;
	} else if (!opts.dryRun) {
		info("Exporting production D1 (a fresh backup artifact)...");
		sqlPath = (await runBackup({ local: false })).sqlPath;
	}

	// ─── 3. Summary + confirm ────────────────────────────────────────────
	process.stdout.write(`\n${bold(`Reclone plan (prod → ${env.name})`)}\n`);
	process.stdout.write(`${"─".repeat(33)}\n`);
	process.stdout.write(
		`  Source dump:  ${sqlPath ?? dim("(fresh prod export, written under backups/)")}\n`,
	);
	process.stdout.write(
		`  D1:           drop every table in ${env.dbName}, import the dump\n`,
	);
	process.stdout.write(
		`  R2:           rclone sync ${prodBucket} → ${env.r2Bucket} (staging-only objects deleted)\n`,
	);
	process.stdout.write(
		`  KV:           untouched — stale ${env.name} sessions self-heal; log in again\n`,
	);
	process.stdout.write("\n");

	if (opts.dryRun) {
		info("--dry-run: stopping before any side effects.");
		return;
	}
	if (sqlPath === null) {
		// Unreachable: every non-dry-run path above assigned sqlPath.
		throw new Error("reclone: no dump artifact resolved");
	}

	if (!opts.yes) {
		const go = await confirmTyping(
			`This DESTROYS all ${env.name} data: every table in ${env.dbName} is dropped and ` +
				`replaced with the prod dump, and ${env.r2Bucket} is overwritten to mirror prod.`,
			"reclone",
		);
		if (!go) {
			info("Cancelled.");
			return;
		}
	}

	// ─── 4. Prepare the FK-ordered import file ───────────────────────────
	// Local-only (between confirm and the first destructive step): a dump
	// that fails to materialize or order aborts before anything is touched.
	info("Preparing FK-ordered import file...");
	const prepared = prepareOrderedImport(sqlPath);
	try {
		// ─── 5. Reset + import D1 ────────────────────────────────────────
		const target = remoteTarget(env);
		info(`Resetting ${env.dbName} (drop all tables)...`);
		const dropped = await resetD1(target);
		ok(
			dropped === 0
				? "Nothing to drop (empty database)."
				: `Dropped ${dropped} table(s)/view(s).`,
		);

		info(`Importing dump into ${env.dbName}...`);
		await importDump(target, prepared.orderedPath);
		ok("D1 import complete.");

		// ─── 6. Sync R2 ──────────────────────────────────────────────────
		info(`Syncing R2 ${prodBucket} → ${env.r2Bucket}...`);
		await syncR2FromProd(env, creds);
		ok("R2 sync complete.");

		// ─── 7. Next steps ───────────────────────────────────────────────
		// The point of the whole exercise: the dump carried prod's
		// d1_migrations bookkeeping, so staging now reports exactly the
		// migrations prod hasn't applied yet — rehearse them before they run
		// for real.
		const exportedAt = statSync(sqlPath).mtime.toISOString();
		process.stdout.write(`\n${bold("Next steps")}\n`);
		const mig = await listPendingMigrations(env);
		if (mig.error) {
			warn(`Could not list pending migrations: ${mig.error}`);
		} else if (mig.pending.length === 0) {
			info("No pending migrations — nothing to rehearse right now.");
		} else {
			info(`${mig.pending.length} pending migration(s) to rehearse:`);
			for (const m of mig.pending) process.stdout.write(`    ${m}\n`);
			info(
				`Run \`./per-ankh ${env.name} migrate\` to rehearse them (or \`./per-ankh ${env.name} deploy\`, ` +
					"which applies them while deploying current code).",
			);
		}
		ok(`Reclone complete — ${env.name} mirrors prod as of ${exportedAt}.`);
	} finally {
		rmSync(prepared.tempDir, { recursive: true, force: true });
	}
}
