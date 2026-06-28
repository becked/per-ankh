// Build the SvelteKit app and deploy the frontend Worker via wrangler.

import { runStreamed } from "../../lib/shell";
import { ok } from "../../lib/format";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readdirSync, readFileSync } from "node:fs";
import type { CloudEnv } from "../../lib/environments";

const REPO_ROOT = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"..",
);

// The browser-shipped client bundle (adapter-cloudflare assets). The API base
// is a build-time constant inlined here from VITE_API_URL; we scan it rather
// than the SSR `_worker.js` so the hardcoded PROD_API_ORIGIN fallback in
// hooks.server.ts can't false-positive the check.
const CLIENT_BUNDLE_DIR = resolve(REPO_ROOT, ".svelte-kit/cloudflare/_app");

// Any Per-Ankh API base, e.g. https://api.per-ankh.app/v1 or
// https://api-staging.per-ankh.app/v1. Global: collect every occurrence.
const API_BASE_RE = /https:\/\/api[a-z-]*\.per-ankh\.app\/v1/g;

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
	assertFrontendApiOrigin(env);
}

// Guard against a frontend bundle that talks to the wrong backend. The API
// origin is inlined at build time from VITE_API_URL (src/lib/api-cloud.ts),
// defaulting to PROD when the var is unset. A staging build that somehow ships
// without the var would then silently point staging.per-ankh.app at the prod
// API — a footgun that fails in the safe-looking direction (no error, wrong
// backend). We require the only Per-Ankh API base baked into the client bundle
// to be exactly this environment's expected one; this also catches the inverse
// (a prod build accidentally carrying the staging origin).
function assertFrontendApiOrigin(env: CloudEnv): void {
	const found = new Set<string>();
	for (const entry of readdirSync(CLIENT_BUNDLE_DIR, { recursive: true })) {
		const rel = entry.toString();
		if (!rel.endsWith(".js")) continue;
		const text = readFileSync(resolve(CLIENT_BUNDLE_DIR, rel), "utf8");
		for (const m of text.matchAll(API_BASE_RE)) found.add(m[0]);
	}
	const origins = [...found].sort();
	if (origins.length === 1 && origins[0] === env.apiBase) {
		ok(`Frontend bundle targets ${env.apiBase}`);
		return;
	}
	const referenced = origins.length
		? origins.map((o) => `"${o}"`).join(", ")
		: "no Per-Ankh API base";
	throw new Error(
		`Frontend bundle API-origin check failed for ${env.name}: expected exactly ` +
			`"${env.apiBase}" but the client bundle references ${referenced}. ` +
			`VITE_API_URL was likely not injected at build time — refusing to deploy a ` +
			`bundle that may point ${env.name} at the wrong backend.`,
	);
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
