// `./per-ankh prod deploy` — full deploy: preflight → changelog → migrate →
// worker → frontend → smoke. Each step aborts on failure.

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
import { runChangelog } from "../changelog/run";

export async function run(_argv: string[], opts: ProdOpts): Promise<void> {
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

	// Preview-only run so the plan summary can show what the changelog step
	// will record. Re-run after confirm with write=true; the second pass
	// uses HEAD-at-that-moment which is what actually gets tagged.
	const changelogPreview = opts.skipChangelog
		? null
		: await runChangelog({ write: false, edit: false });

	process.stdout.write(`\n${bold("Deploy plan")}\n`);
	process.stdout.write(`${"─".repeat(33)}\n`);
	process.stdout.write(
		`  Migrations: ${pending.length === 0 ? "none pending" : `${pending.length} pending`}\n`,
	);
	for (const m of pending) process.stdout.write(`    ${m}\n`);
	process.stdout.write(
		`  Changelog:  ${changelogSummary(opts, changelogPreview)}\n`,
	);
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

	// ─── 3. Changelog ────────────────────────────────────────────────────
	if (!opts.skipChangelog && changelogPreview && !changelogPreview.skipped) {
		info("Writing changelog and tagging deploy...");
		const result = await runChangelog({
			write: true,
			edit: opts.editChangelog,
		});
		ok(`Changelog committed and tagged deploy/${result.stamp}.`);
	}

	// ─── 4. Migrate ──────────────────────────────────────────────────────
	if (pending.length > 0) {
		info(`Applying ${pending.length} migration(s)...`);
		await applyRemoteMigrations();
		ok("Migrations applied.");
	}

	// ─── 5. Worker ───────────────────────────────────────────────────────
	if (!opts.skipWorker) {
		info("Deploying API Worker...");
		await deployWorker();
		ok("Worker deployed.");
	}

	// ─── 6. Frontend ─────────────────────────────────────────────────────
	if (!opts.skipFrontend) {
		info("Building frontend...");
		await buildFrontend();
		ok("Frontend built.");
		info("Deploying frontend...");
		await deployFrontend();
		ok("Frontend deployed.");
	}

	// ─── 7. Smoke ────────────────────────────────────────────────────────
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
			throw new Error(
				`${failed} smoke probe(s) failed. Investigate immediately.`,
			);
		}
	}

	ok("Deploy complete.");
}

function changelogSummary(
	opts: ProdOpts,
	preview: Awaited<ReturnType<typeof runChangelog>> | null,
): string {
	if (opts.skipChangelog) return dim("(skipped)");
	if (!preview) return dim("(skipped)");
	if (preview.skipped) {
		return `no commits since ${preview.since} ${dim("(skip)")}`;
	}
	const editNote = opts.editChangelog ? dim(" (edit before commit)") : "";
	return `${preview.commits.length} commits → deploy/${preview.stamp}${editNote}`;
}
