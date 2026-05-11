// Shared types for prod preflight + deploy.

export type CheckStatus = "pass" | "fail" | "warn";

export interface CheckResult {
	name: string; // short id: "git.clean", "npm.lint", "secrets.leak"
	status: CheckStatus;
	blocking: boolean; // does a non-pass fail the preflight as a whole?
	details?: string; // multi-line allowed; shown on fail
	durationMs?: number;
}

// Knobs that the orchestrator threads to individual check modules so they
// can decide whether their failure is blocking or warn-only.
export interface CheckContext {
	allowDirty: boolean; // demote git.clean failure to warn
	allowBranch: boolean; // demote git.branch failure to warn
}

// Global flags for prod subcommands.
export interface ProdOpts {
	json: boolean;
	yes: boolean;
	dryRun: boolean;
	allowDirty: boolean;
	allowBranch: boolean;
	skipChecks: boolean;
	skipWorker: boolean;
	skipFrontend: boolean;
	skipSmoke: boolean;
}

export function blockingFailures(results: CheckResult[]): CheckResult[] {
	return results.filter((r) => r.status === "fail" && r.blocking);
}
