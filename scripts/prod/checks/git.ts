// Git state checks: clean working tree, on main, in sync with origin/main.

import { runCaptured } from "../../lib/shell";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { CheckContext, CheckResult } from "../types";

const REPO_ROOT = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"..",
);

async function git(args: string[]) {
	return runCaptured("git", args, { cwd: REPO_ROOT });
}

export async function runGitChecks(ctx: CheckContext): Promise<CheckResult[]> {
	const results: CheckResult[] = [];

	// 1. Working tree clean
	const status = await git(["status", "--porcelain"]);
	if (status.code !== 0) {
		results.push({
			name: "git.clean",
			status: "fail",
			blocking: true,
			details: `git status failed: ${status.stderr.trim()}`,
		});
	} else if (status.stdout.trim() !== "") {
		results.push({
			name: "git.clean",
			status: "fail",
			blocking: !ctx.allowDirty,
			details:
				`Working tree has uncommitted changes:\n${status.stdout.trimEnd()}` +
				(ctx.allowDirty ? "\n(demoted to warn by --allow-dirty)" : ""),
		});
	} else {
		results.push({ name: "git.clean", status: "pass", blocking: true });
	}

	// 2. On main
	const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
	const currentBranch = branch.stdout.trim();
	if (currentBranch !== "main") {
		results.push({
			name: "git.branch",
			status: "fail",
			blocking: !ctx.allowBranch,
			details:
				`Current branch is '${currentBranch}', expected 'main'` +
				(ctx.allowBranch ? " (demoted to warn by --allow-branch)" : ""),
		});
	} else {
		results.push({ name: "git.branch", status: "pass", blocking: true });
	}

	// 3. In sync with origin/main. Fetch first so the comparison is current.
	const fetched = await git(["fetch", "origin", "main", "--quiet"]);
	if (fetched.code !== 0) {
		results.push({
			name: "git.upstream",
			status: "warn",
			blocking: false,
			details: `git fetch failed (offline?): ${fetched.stderr.trim()}`,
		});
	} else {
		const ahead = await git(["rev-list", "--count", "origin/main..HEAD"]);
		const behind = await git(["rev-list", "--count", "HEAD..origin/main"]);
		const aheadN = parseInt(ahead.stdout.trim(), 10) || 0;
		const behindN = parseInt(behind.stdout.trim(), 10) || 0;
		if (behindN > 0) {
			results.push({
				name: "git.upstream",
				status: "fail",
				blocking: true,
				details: `HEAD is ${behindN} commit(s) behind origin/main. Pull before deploying.`,
			});
		} else if (aheadN > 0) {
			results.push({
				name: "git.upstream",
				status: "warn",
				blocking: false,
				details: `HEAD is ${aheadN} commit(s) ahead of origin/main (will deploy unpushed work).`,
			});
		} else {
			results.push({
				name: "git.upstream",
				status: "pass",
				blocking: true,
			});
		}
	}

	return results;
}
