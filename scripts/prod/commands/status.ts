// `./per-ankh prod|staging status` — local git state, deployed worker
// versions, secret presence, pending migrations. Doesn't run checks, doesn't
// make changes.

import { runCaptured } from "../../lib/shell";
import { listPendingMigrations } from "../checks/migrations";
import type { ProdOpts } from "../types";
import type { CloudEnv } from "../../lib/environments";
import { bold, dim, info } from "../../lib/format";
import { printJson } from "../../lib/cli";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const REPO_ROOT = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"..",
);
const CLOUD_DIR = resolve(REPO_ROOT, "cloud");

interface DeploymentRow {
	Version?: string;
	"Version ID"?: string;
	Created?: string;
	"Created on"?: string;
	Author?: string;
	Source?: string;
}

async function git(args: string[]) {
	return runCaptured("git", args, { cwd: REPO_ROOT });
}

async function getLatestWorkerVersion(
	cwd: string,
	env: CloudEnv,
): Promise<string | null> {
	const r = await runCaptured(
		"npx",
		["wrangler", "deployments", "list", ...env.wranglerEnvFlag],
		{
			cwd,
		},
	);
	if (r.code !== 0) return null;
	// `wrangler deployments list` prints one block per deployment, newest at
	// the bottom. Each block has a line like:
	//   "Version(s):  (100%) <uuid>"
	// Grab the last such match — that's the most recently deployed version.
	const matches = Array.from(
		r.stdout.matchAll(/Version\(s\):\s+\(\d+%\)\s+([0-9a-f-]+)/g),
	);
	if (matches.length === 0) return null;
	return matches[matches.length - 1][1];
}

interface SecretRow {
	name: string;
}

async function listSecrets(
	cwd: string,
	env: CloudEnv,
): Promise<string[] | null> {
	const r = await runCaptured(
		"npx",
		["wrangler", "secret", "list", ...env.wranglerEnvFlag],
		{ cwd },
	);
	if (r.code !== 0) return null;
	const idx = r.stdout.indexOf("[");
	if (idx < 0) return null;
	try {
		return (JSON.parse(r.stdout.slice(idx)) as SecretRow[]).map((s) => s.name);
	} catch {
		return null;
	}
}

export async function run(
	_argv: string[],
	opts: ProdOpts,
	env: CloudEnv,
): Promise<void> {
	info(`Gathering ${env.name} status...`);
	const [branch, sha, porcelain, workerVer, frontendVer, secrets, mig] =
		await Promise.all([
			git(["rev-parse", "--abbrev-ref", "HEAD"]),
			git(["rev-parse", "--short", "HEAD"]),
			git(["status", "--porcelain"]),
			getLatestWorkerVersion(CLOUD_DIR, env),
			getLatestWorkerVersion(REPO_ROOT, env),
			listSecrets(CLOUD_DIR, env),
			listPendingMigrations(env),
		]);

	const data = {
		git: {
			branch: branch.stdout.trim(),
			sha: sha.stdout.trim(),
			dirty: porcelain.stdout.trim() !== "",
		},
		deployed: {
			worker_version: workerVer,
			frontend_version: frontendVer,
		},
		secrets,
		pending_migrations: mig.pending,
	};

	if (opts.json) {
		printJson(data);
		return;
	}

	process.stdout.write(
		`\n${bold(`Per-Ankh ${env.name === "prod" ? "Prod" : "Staging"} Status`)}\n`,
	);
	process.stdout.write(`${"─".repeat(33)}\n`);
	process.stdout.write(
		`  Branch:           ${data.git.branch}  (${data.git.sha})${data.git.dirty ? "  " + dim("(dirty)") : ""}\n`,
	);
	process.stdout.write(
		`  Worker version:   ${workerVer ?? dim("(unknown)")}\n`,
	);
	process.stdout.write(
		`  Frontend version: ${frontendVer ?? dim("(unknown)")}\n`,
	);
	process.stdout.write(
		`  Worker secrets:   ${secrets ? secrets.join(", ") : dim("(unknown)")}\n`,
	);
	if (mig.pending.length === 0) {
		process.stdout.write(`  Migrations:       up to date\n`);
	} else {
		process.stdout.write(`  Migrations:       ${mig.pending.length} pending\n`);
		for (const m of mig.pending) {
			process.stdout.write(`                      ${m}\n`);
		}
	}
	process.stdout.write("\n");
}
