// `./per-ankh screenshot run` — the whole pass as one command: start the
// Screenshots workflow, wait for its three runners, download what they
// uploaded and write the comparison page over it.
//
// This is the only half an operator has reason to type. `capture` is the
// runners' command — it is in this CLI because the workflow invokes it — and
// `compare` is the end of this one. What `run` replaces is the pair of `gh`
// calls either side of the wait, with a run id copied by hand between them.
//
// `gh` is what buys that: dispatching a workflow and reading an artifact are
// both authenticated GitHub calls, and `gh` already holds the operator's
// credentials. This is the CLI's only shell-out to it, so a missing binary is
// reported here rather than surfacing as a spawn failure.

import { mkdir } from "node:fs/promises";
import path from "node:path";

import { info, ok, warn } from "../lib/format";
import { runCaptured, type CapturedResult } from "../lib/shell";
import { writeComparison } from "./compare";

const WORKFLOW = "screenshot.yml";

// `gh workflow run` answers before the run row exists, so the id can only be
// had by watching for one newer than the newest before dispatch.
const NEW_RUN_POLL_MS = 2_000;
const NEW_RUN_TIMEOUT_MS = 60_000;

// Three runners, each installing Chromium and walking six shots. The workflow
// caps a job at 20 minutes; this caps the wait on the whole run, for the case
// where a leg is never picked up at all.
const STATUS_POLL_MS = 15_000;
const RUN_TIMEOUT_MS = 45 * 60_000;

const sleep = (ms: number): Promise<void> =>
	new Promise((r) => setTimeout(r, ms));

interface RunRow {
	databaseId: number;
	url: string;
	status: string;
}

interface JobView {
	name: string;
	status: string;
	// Empty until the job concludes — `gh` writes "" rather than omitting the
	// field or sending null, so every read of it below tests for empty the way
	// `flagString` does for an empty flag. `??` would pass the blank straight
	// through.
	conclusion: string;
}

interface RunView {
	status: string;
	conclusion: string;
	jobs: JobView[];
}

// What to call a job's current state: its conclusion once it has one, else
// whatever it is doing now ("queued", "in_progress").
function jobState(job: JobView): string {
	return job.conclusion === "" ? job.status : job.conclusion;
}

async function gh(args: string[]): Promise<CapturedResult> {
	try {
		return await runCaptured("gh", args);
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === "ENOENT") {
			throw new Error(
				"`gh` (the GitHub CLI) isn't on PATH. Install it and `gh auth " +
					"login`, or drive the three steps by hand — " +
					"`./per-ankh screenshot --help` spells them out.",
			);
		}
		throw e;
	}
}

async function ghJson<T>(args: string[]): Promise<T> {
	const r = await gh(args);
	if (r.code !== 0) {
		throw new Error(`\`gh ${args.join(" ")}\` failed:\n${r.stderr.trim()}`);
	}
	return JSON.parse(r.stdout) as T;
}

// Always origin, spelled out, rather than the repo `gh` would infer: a clone
// that also has the upstream fork as a remote makes `gh` refuse to guess and
// ask for -R, and origin is the only remote an operator's outbound commands
// should reach.
async function originSlug(): Promise<string> {
	const r = await runCaptured("git", ["remote", "get-url", "origin"]);
	if (r.code !== 0) {
		throw new Error("No `origin` remote in this clone to dispatch against.");
	}
	const url = r.stdout.trim();
	const m = url.match(/[:/]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/);
	if (!m) throw new Error(`No owner/repo in origin's URL: ${url}`);
	return `${m[1]}/${m[2]}`;
}

// The two commands this one wraps, with the id filled in: what to fall back
// to when the wait or the download is the part that failed, rather than
// starting three runners again to recover.
function manualHint(slug: string, id: number, dir: string): string {
	return (
		`  gh run download ${id} -R ${slug} -D ${dir}\n` +
		`  ./per-ankh screenshot compare ${dir}`
	);
}

async function newestRunId(slug: string): Promise<number> {
	const rows = await ghJson<RunRow[]>([
		"run",
		"list",
		"-R",
		slug,
		"--workflow",
		WORKFLOW,
		"--limit",
		"1",
		"--json",
		"databaseId,url,status",
	]);
	return rows[0]?.databaseId ?? 0;
}

async function waitForNewRun(slug: string, before: number): Promise<RunRow> {
	const deadline = Date.now() + NEW_RUN_TIMEOUT_MS;
	while (Date.now() < deadline) {
		await sleep(NEW_RUN_POLL_MS);
		const rows = await ghJson<RunRow[]>([
			"run",
			"list",
			"-R",
			slug,
			"--workflow",
			WORKFLOW,
			"--limit",
			"10",
			"--json",
			"databaseId,url,status",
		]);
		// Newest of whatever is newer than the pre-dispatch high-water mark: a
		// second operator dispatching at the same moment is the only way more
		// than one qualifies, and then neither of us wants the older row.
		const fresh = rows
			.filter((r) => r.databaseId > before)
			.sort((a, b) => b.databaseId - a.databaseId)[0];
		if (fresh) return fresh;
	}
	throw new Error(
		`Dispatched, but no new run appeared within ${
			NEW_RUN_TIMEOUT_MS / 1000
		}s. It may still start:\n` +
			`  gh run list -R ${slug} --workflow ${WORKFLOW}`,
	);
}

async function waitForCompletion(
	slug: string,
	id: number,
	runDir: string,
): Promise<RunView> {
	const deadline = Date.now() + RUN_TIMEOUT_MS;
	// Printed per job as its state changes, rather than on every poll: three
	// legs over ten-odd minutes is a handful of lines this way, against the
	// repeated full table `gh run watch` redraws. Watching through `gh` would
	// also conflate "one leg failed" with "nothing to compare" in its exit
	// status, and a partial run is exactly what this command still wants.
	const seen = new Map<string, string>();
	for (;;) {
		const view = await ghJson<RunView>([
			"run",
			"view",
			String(id),
			"-R",
			slug,
			"--json",
			"status,conclusion,jobs",
		]);
		for (const job of view.jobs) {
			const state = jobState(job);
			if (seen.get(job.name) !== state) {
				seen.set(job.name, state);
				info(`  ${job.name}: ${state}`);
			}
		}
		if (view.status === "completed") return view;
		if (Date.now() >= deadline) {
			throw new Error(
				`Still running after ${RUN_TIMEOUT_MS / 60_000} minutes. Once it ` +
					`finishes:\n${manualHint(slug, id, runDir)}`,
			);
		}
		await sleep(STATUS_POLL_MS);
	}
}

export interface RunOpts {
	// Absent leaves the workflow input empty, which is what falls through to
	// its own staging default.
	baseUrl: string | undefined;
	outDir: string;
}

export async function run(opts: RunOpts): Promise<void> {
	const slug = await originSlug();
	const before = await newestRunId(slug);

	const args = ["workflow", "run", WORKFLOW, "-R", slug];
	// Omitted rather than passed empty: an empty `-f base-url=` would reach
	// the runner as "", which `flagString` reads as absent anyway — one layer
	// later than it needs to be read.
	if (opts.baseUrl) args.push("-f", `base-url=${opts.baseUrl}`);
	info(
		`Starting ${WORKFLOW} on ${slug} against ` +
			`${opts.baseUrl ?? "staging (the workflow's default)"}…`,
	);
	const dispatched = await gh(args);
	if (dispatched.code !== 0) {
		throw new Error(`\`gh workflow run\` failed:\n${dispatched.stderr.trim()}`);
	}

	const row = await waitForNewRun(slug, before);
	info(row.url);

	// One directory per run id, rather than clearing a shared one: `--out` is
	// whatever the flag holds, so a recursive remove of it is a `rm -rf` on an
	// unvalidated path — the reason capture.ts clears only its `shots/` — and
	// two runs' artifacts in one directory would render as each other's
	// columns.
	const runDir = path.join(opts.outDir, String(row.databaseId));
	const view = await waitForCompletion(slug, row.databaseId, runDir);
	if (view.conclusion === "success") {
		ok("Every runner finished.");
	} else {
		// Not fatal. A failed leg still uploads (`if: always()` on the step),
		// and the pages it did capture are still worth seeing beside the
		// others; the ones it missed render as error cells.
		const how = view.conclusion === "" ? "with no conclusion" : view.conclusion;
		warn(`The run concluded ${how} — comparing what it did upload.`);
	}

	await mkdir(runDir, { recursive: true });
	info(`Downloading artifacts → ${runDir}/`);
	const dl = await gh([
		"run",
		"download",
		String(row.databaseId),
		"-R",
		slug,
		"-D",
		runDir,
	]);
	if (dl.code !== 0) {
		throw new Error(
			`\`gh run download\` failed:\n${dl.stderr.trim()}\n` +
				`The run is at ${row.url}; once it holds artifacts:\n` +
				manualHint(slug, row.databaseId, runDir),
		);
	}

	const outFile = path.join(runDir, "index.html");
	const columns = await writeComparison(runDir, outFile);
	ok(`Wrote ${outFile} — ${columns.length} columns (${columns.join(", ")}).`);
}
