// `./per-ankh prod deploy` — full deploy: preflight → migrate → worker →
// frontend → smoke. Each step aborts on failure.

import { runAllChecks } from "./preflight";
import { blockingFailures } from "../types";
import type { ProdOpts } from "../types";
import { listPendingMigrations } from "../checks/migrations";
import { applyRemoteMigrations } from "../deploy/migrate";
import { deployWorker } from "../deploy/worker";
import { buildFrontend, deployFrontend } from "../deploy/frontend";
import { runSmokeProbes } from "../deploy/smoke";
import { printResults } from "../results";
import { bold, dim, info, ok, warn } from "../../lib/format";
import { confirmYesNo } from "../../lib/confirm";

export async function run(
	_argv: string[],
	opts: ProdOpts,
): Promise<void> {
	// ─── 1. Preflight ────────────────────────────────────────────────────
	if (!opts.skipChecks) {
		const results = await runAllChecks(opts);
		printResults(results);
		const failures = blockingFailures(results);
		if (failures.length > 0) {
			throw new Error(
				`Pre-flight failed (${failures.length} blocking failure(s)). Fix or override and retry.`,
			);
		}
	} else {
		warn("--skip-checks: skipping pre-flight.");
	}

	// ─── 2. Summary + confirm ────────────────────────────────────────────
	const mig = await listPendingMigrations();
	const pending = mig.pending;

	process.stdout.write(`\n${bold("Deploy plan")}\n`);
	process.stdout.write(`${"─".repeat(33)}\n`);
	process.stdout.write(
		`  Migrations: ${pending.length === 0 ? "none pending" : `${pending.length} pending`}\n`,
	);
	for (const m of pending) process.stdout.write(`    ${m}\n`);
	process.stdout.write(
		`  Worker:     ${opts.skipWorker ? dim("(skipped)") : "deploy"}\n`,
	);
	process.stdout.write(
		`  Frontend:   ${opts.skipFrontend ? dim("(skipped)") : "build + deploy"}\n`,
	);
	process.stdout.write(
		`  Smoke:      ${opts.skipSmoke ? dim("(skipped)") : "3 HTTP probes"}\n`,
	);
	process.stdout.write("\n");

	if (opts.dryRun) {
		info("--dry-run: stopping before any side effects.");
		return;
	}

	if (!opts.yes) {
		const go = await confirmYesNo("Proceed with deploy?");
		if (!go) {
			info("Cancelled.");
			return;
		}
	}

	// ─── 3. Migrate ──────────────────────────────────────────────────────
	if (pending.length > 0) {
		info(`Applying ${pending.length} migration(s)...`);
		await applyRemoteMigrations();
		ok("Migrations applied.");
	}

	// ─── 4. Worker ───────────────────────────────────────────────────────
	if (!opts.skipWorker) {
		info("Deploying API Worker...");
		await deployWorker();
		ok("Worker deployed.");
	}

	// ─── 5. Frontend ─────────────────────────────────────────────────────
	if (!opts.skipFrontend) {
		info("Building frontend...");
		await buildFrontend();
		ok("Frontend built.");
		info("Deploying frontend...");
		await deployFrontend();
		ok("Frontend deployed.");
	}

	// ─── 6. Smoke ────────────────────────────────────────────────────────
	if (!opts.skipSmoke) {
		info("Running smoke probes...");
		const probes = await runSmokeProbes();
		process.stdout.write(`\n${bold("Smoke probes:")}\n`);
		let failed = 0;
		for (const r of probes) {
			const status = r.status === "pass" ? "PASS" : "FAIL";
			const code = r.actualStatus ? ` ${r.actualStatus}` : "";
			process.stdout.write(
				`  ${r.probe.label.padEnd(10)} ${r.probe.url}  ${status}${code}  ${r.durationMs}ms\n`,
			);
			if (r.detail) process.stdout.write(`        ${r.detail}\n`);
			if (r.status === "fail") failed++;
		}
		process.stdout.write("\n");
		if (failed > 0) {
			throw new Error(`${failed} smoke probe(s) failed. Investigate immediately.`);
		}
	}

	ok("Deploy complete.");
}
