// Build the SvelteKit app and deploy the frontend Worker via wrangler.

import { runStreamed } from "../../lib/shell";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { CloudEnv } from "../../lib/environments";

const REPO_ROOT = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"..",
);

export async function buildFrontend(env: CloudEnv): Promise<void> {
	// frontendBuildEnv carries the per-environment VITE_* vars (staging API
	// origin etc.); empty for prod, where the code defaults already point at
	// production. Both vite (import.meta.env) and svelte.config.js
	// (process.env) read them at build time.
	const code = await runStreamed("npm", ["run", "build"], {
		cwd: REPO_ROOT,
		label: "build",
		color: "magenta",
		env: { ...process.env, ...env.frontendBuildEnv },
	});
	if (code !== 0) {
		throw new Error(`Frontend build failed with exit code ${code}`);
	}
}

export async function deployFrontend(env: CloudEnv): Promise<void> {
	const code = await runStreamed(
		"npx",
		["wrangler", "deploy", ...env.wranglerEnvFlag],
		{
			cwd: REPO_ROOT,
			label: "frontend",
			color: "magenta",
		},
	);
	if (code !== 0) {
		throw new Error(`Frontend deploy failed with exit code ${code}`);
	}
}
