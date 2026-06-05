// Deploy the API Worker (cloud/) via `wrangler deploy`. Streams output.

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

export async function deployWorker(env: CloudEnv): Promise<void> {
	const code = await runStreamed(
		"npx",
		["wrangler", "deploy", ...env.wranglerEnvFlag],
		{
			cwd: CLOUD_DIR,
			label: "worker",
			color: "cyan",
		},
	);
	if (code !== 0) {
		throw new Error(`Worker deploy failed with exit code ${code}`);
	}
}
