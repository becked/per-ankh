// Apply pending D1 migrations to remote. Caller is expected to have listed
// + confirmed pending migrations first (via prod/checks/migrations.ts).

import { runStreamed } from "../../lib/shell";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { CloudEnv } from "../../lib/environments";

const CLOUD_DIR = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"..",
	"cloud",
);

export async function applyRemoteMigrations(env: CloudEnv): Promise<void> {
	const code = await runStreamed(
		"npx",
		[
			"wrangler",
			"d1",
			"migrations",
			"apply",
			env.dbName,
			...env.wranglerEnvFlag,
			"--remote",
		],
		{ cwd: CLOUD_DIR, label: "migrate", color: "yellow" },
	);
	if (code !== 0) {
		throw new Error(`Migration apply failed with exit code ${code}`);
	}
}
