// Detect pending D1 migrations on the remote. Inform-only during preflight
// (presence of pending migrations isn't itself a problem; the deploy command
// applies them). The same module exposes the parsed list so the deploy
// summary can show what will be applied.

import { runCaptured } from "../../lib/shell";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { CheckResult } from "../types";
import type { CloudEnv } from "../../lib/environments";

const CLOUD_DIR = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"..",
	"cloud",
);

export interface PendingMigrations {
	pending: string[];
	error?: string;
}

// Returns the list of pending migration filenames, or an error string.
// Output format from wrangler:
//   "✅ No migrations to apply!"           — when nothing pending
//   Markdown table with .sql file names   — when pending
export async function listPendingMigrations(
	env: CloudEnv,
): Promise<PendingMigrations> {
	const r = await runCaptured(
		"npx",
		[
			"wrangler",
			"d1",
			"migrations",
			"list",
			env.dbName,
			...env.wranglerEnvFlag,
			"--remote",
		],
		{ cwd: CLOUD_DIR },
	);
	if (r.code !== 0) {
		return {
			pending: [],
			error: r.stderr.trim() || r.stdout.trim(),
		};
	}
	if (/no migrations to apply/i.test(r.stdout)) {
		return { pending: [] };
	}
	// Extract any .sql filenames from the output.
	const names = Array.from(r.stdout.matchAll(/(\b\d{4}_[\w-]+\.sql)\b/g)).map(
		(m) => m[1],
	);
	const unique = Array.from(new Set(names));
	return { pending: unique };
}

export async function runMigrationChecks(
	env: CloudEnv,
): Promise<CheckResult[]> {
	const r = await listPendingMigrations(env);
	if (r.error) {
		return [
			{
				name: "migrations.list",
				status: "warn",
				blocking: false,
				details: `Could not list migrations: ${r.error}`,
			},
		];
	}
	if (r.pending.length === 0) {
		return [
			{
				name: "migrations.list",
				status: "pass",
				blocking: false,
			},
		];
	}
	return [
		{
			name: "migrations.list",
			status: "warn",
			blocking: false,
			details:
				`${r.pending.length} pending migration(s) will be applied on deploy:\n` +
				r.pending.map((m) => `  ${m}`).join("\n"),
		},
	];
}
