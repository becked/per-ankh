// Orchestrator for changelog generation. Shared by the standalone
// `./per-ankh prod changelog` command and the deploy pipeline so they
// produce identical output.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	groupByType,
	parseCommit,
	prependToChangelog,
	renderEntry,
	type Commit,
} from "./generate";
import {
	commitChangelog,
	commitsSince,
	createDeployTag,
	lastDeployTag,
	repoRoot,
	shortSha,
} from "./git";

// First-run fallback. After the backfill commit lands, every subsequent run
// will pick up a real `deploy/*` tag and ignore this.
const BACKFILL_SINCE = "v0.3.0";

export interface ChangelogRunOpts {
	since?: string;
	write: boolean;
	edit: boolean;
}

export interface ChangelogResult {
	since: string;
	stamp: string;
	entry: string;
	commits: Commit[];
	skipped: boolean;
	wrote: boolean;
	committed: boolean;
	tagged: boolean;
}

function todayLocal(): string {
	const d = new Date();
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

function bumpPackageVersion(stamp: string): void {
	const path = resolve(repoRoot(), "package.json");
	const content = readFileSync(path, "utf8");
	const updated = content.replace(
		/^(\t"version"\s*:\s*)"[^"]*"/m,
		`$1"${stamp}"`,
	);
	if (updated === content) {
		throw new Error("package.json top-level `version` field not found");
	}
	writeFileSync(path, updated);
}

function openInEditor(filePath: string): void {
	const editor = process.env.EDITOR ?? "vi";
	const r = spawnSync(editor, [filePath], { stdio: "inherit" });
	if (r.status !== 0) {
		throw new Error(
			`Editor (${editor}) exited with code ${r.status}; aborting.`,
		);
	}
}

export async function runChangelog(
	opts: ChangelogRunOpts,
): Promise<ChangelogResult> {
	const since = opts.since ?? (await lastDeployTag()) ?? BACKFILL_SINCE;

	const lines = await commitsSince(since);
	const commits: Commit[] = [];
	for (const l of lines) {
		const c = parseCommit(l);
		if (c) commits.push(c);
	}

	const date = todayLocal();
	const sha = await shortSha("HEAD");
	const stamp = `${date}-${sha}`;

	if (commits.length === 0) {
		return {
			since,
			stamp,
			entry: "",
			commits,
			skipped: true,
			wrote: false,
			committed: false,
			tagged: false,
		};
	}

	const groups = groupByType(commits);
	const entry = renderEntry({ stamp, date, groups });

	if (!opts.write) {
		return {
			since,
			stamp,
			entry,
			commits,
			skipped: false,
			wrote: false,
			committed: false,
			tagged: false,
		};
	}

	const changelogPath = resolve(repoRoot(), "CHANGELOG.md");
	const existing = readFileSync(changelogPath, "utf8");
	const next = prependToChangelog(existing, entry);
	writeFileSync(changelogPath, next);
	bumpPackageVersion(stamp);

	if (opts.edit) {
		openInEditor(changelogPath);
	}

	await commitChangelog(stamp);
	await createDeployTag(stamp);

	return {
		since,
		stamp,
		entry,
		commits,
		skipped: false,
		wrote: true,
		committed: true,
		tagged: true,
	};
}
