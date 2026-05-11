// `./per-ankh prod preflight` — run every safety check, exit non-zero if any
// blocking check failed. No side effects.

import { runGitChecks } from "../checks/git";
import { runNpmChecks } from "../checks/npm";
import { runTypescriptChecks } from "../checks/typescript";
import { runSecretChecks } from "../checks/secrets";
import { runMigrationChecks } from "../checks/migrations";
import { blockingFailures } from "../types";
import type { CheckContext, CheckResult, ProdOpts } from "../types";
import { printResults } from "../results";
import { info } from "../../lib/format";
import { printJson } from "../../lib/cli";

// Exported so `deploy` can reuse the orchestration as its first phase.
export async function runAllChecks(opts: ProdOpts): Promise<CheckResult[]> {
	const ctx: CheckContext = {
		allowDirty: opts.allowDirty,
		allowBranch: opts.allowBranch,
	};
	const results: CheckResult[] = [];
	info("Running pre-flight checks...");
	// Fast / dependency-free checks first so early failures surface quickly.
	results.push(...(await runGitChecks(ctx)));
	results.push(...(await runSecretChecks()));
	results.push(...(await runMigrationChecks()));
	// Slow checks last (these spawn npm/tsc and take seconds each).
	results.push(...(await runNpmChecks()));
	results.push(...(await runTypescriptChecks()));
	return results;
}

export async function run(
	_argv: string[],
	opts: ProdOpts,
): Promise<void> {
	const results = await runAllChecks(opts);
	if (opts.json) {
		printJson(results);
	} else {
		printResults(results);
	}
	const failures = blockingFailures(results);
	if (failures.length > 0) {
		process.exit(1);
	}
}
