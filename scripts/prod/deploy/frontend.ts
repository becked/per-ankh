// Build the SvelteKit app and deploy the frontend Worker via wrangler.

import { runStreamed } from "../../lib/shell";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const REPO_ROOT = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"..",
);

export async function buildFrontend(): Promise<void> {
	const code = await runStreamed("npm", ["run", "build"], {
		cwd: REPO_ROOT,
		label: "build",
		color: "magenta",
	});
	if (code !== 0) {
		throw new Error(`Frontend build failed with exit code ${code}`);
	}
}

export async function deployFrontend(): Promise<void> {
	const code = await runStreamed("npx", ["wrangler", "deploy"], {
		cwd: REPO_ROOT,
		label: "frontend",
		color: "magenta",
	});
	if (code !== 0) {
		throw new Error(`Frontend deploy failed with exit code ${code}`);
	}
}
