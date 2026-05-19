// Git plumbing for the changelog command. Mirrors the small `git()` wrapper
// pattern in scripts/prod/commands/status.ts so error handling stays
// consistent across the prod CLI.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCaptured } from "../../lib/shell";

const REPO_ROOT = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"..",
);

async function git(args: string[]) {
	return runCaptured("git", args, { cwd: REPO_ROOT });
}

// Latest `deploy/*` tag reachable from HEAD, or null if none exist (first
// run after this feature lands). Uses `git describe`, which scopes correctly
// across branches.
export async function lastDeployTag(): Promise<string | null> {
	const r = await git([
		"describe",
		"--tags",
		"--match",
		"deploy/*",
		"--abbrev=0",
	]);
	if (r.code !== 0) return null;
	const tag = r.stdout.trim();
	return tag === "" ? null : tag;
}

// Commits between `since` and HEAD, oldest first, one per line as
// "<full-sha>\t<subject>". Drops merge commits.
export async function commitsSince(since: string): Promise<string[]> {
	const r = await git([
		"log",
		"--no-merges",
		"--reverse",
		`--format=%H%x09%s`,
		`${since}..HEAD`,
	]);
	if (r.code !== 0) {
		throw new Error(
			`git log ${since}..HEAD failed (code ${r.code}): ${r.stderr.trim()}`,
		);
	}
	return r.stdout.split("\n").filter((l) => l.length > 0);
}

export async function shortSha(ref = "HEAD"): Promise<string> {
	const r = await git(["rev-parse", "--short=7", ref]);
	if (r.code !== 0) {
		throw new Error(
			`git rev-parse --short=7 ${ref} failed: ${r.stderr.trim()}`,
		);
	}
	return r.stdout.trim();
}

export async function createDeployTag(stamp: string): Promise<void> {
	const r = await git(["tag", `deploy/${stamp}`]);
	if (r.code !== 0) {
		throw new Error(`git tag deploy/${stamp} failed: ${r.stderr.trim()}`);
	}
}

export async function commitChangelog(stamp: string): Promise<void> {
	const add = await git(["add", "CHANGELOG.md", "package.json"]);
	if (add.code !== 0) {
		throw new Error(`git add failed: ${add.stderr.trim()}`);
	}
	const commit = await git(["commit", "-m", `chore(release): deploy ${stamp}`]);
	if (commit.code !== 0) {
		throw new Error(`git commit failed: ${commit.stderr.trim()}`);
	}
}

export function repoRoot(): string {
	return REPO_ROOT;
}
