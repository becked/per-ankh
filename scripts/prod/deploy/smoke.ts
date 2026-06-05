// HTTP probes against a live environment. Verifies the deploy didn't break
// basic routing. Functional tests (Discord OAuth, upload flow, etc.) stay
// manual because they need a real browser session — see
// docs/cloud-deploy-plan.md §5.

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readDotVars } from "../../lib/dotvars";
import type { CloudEnv } from "../../lib/environments";

const REPO_ROOT = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"..",
);

export interface SmokeProbe {
	url: string;
	expectStatus: number;
	label: string;
	headers?: Record<string, string>;
	// Extra assertion beyond the status code (e.g. that a redirect points at
	// the Access login). Returns an error string, or null when satisfied.
	verify?: (r: Response) => string | null;
	// Shown on a passing probe — used to flag degraded coverage.
	passNote?: string;
}

export interface SmokeResult {
	probe: SmokeProbe;
	status: "pass" | "fail";
	actualStatus?: number;
	cfRay?: string;
	durationMs: number;
	detail?: string;
}

// Cloudflare Access service-token credentials for the staging frontend
// probe, from the gitignored .staging.vars at the repo root. Returns null
// when absent — the probe then degrades to asserting the Access redirect.
function stagingAccessHeaders(): Record<string, string> | null {
	const vars = readDotVars(resolve(REPO_ROOT, ".staging.vars"));
	const id = vars["CF_ACCESS_CLIENT_ID"];
	const secret = vars["CF_ACCESS_CLIENT_SECRET"];
	if (!id || !secret) return null;
	return {
		"CF-Access-Client-Id": id,
		"CF-Access-Client-Secret": secret,
	};
}

export function probesFor(env: CloudEnv): SmokeProbe[] {
	const probes: SmokeProbe[] = [];

	if (env.name === "staging") {
		// staging.per-ankh.app sits behind Cloudflare Access. With a service
		// token we pass the gate and assert the real app; without one the
		// best anonymous probes can do is confirm the edge answers with the
		// Access login redirect — that proves the hostname is up and gated,
		// NOT that the frontend worker deployed correctly.
		const access = stagingAccessHeaders();
		if (access) {
			probes.push({
				url: `${env.frontendOrigin}/`,
				expectStatus: 200,
				label: "frontend",
				headers: access,
			});
		} else {
			probes.push({
				url: `${env.frontendOrigin}/`,
				expectStatus: 302,
				label: "frontend",
				verify: (r) => {
					const location = r.headers.get("location");
					if (!location) return "302 without a Location header";
					let host: string;
					try {
						host = new URL(location).hostname;
					} catch {
						return `unparseable Location: ${location}`;
					}
					return host.endsWith(".cloudflareaccess.com")
						? null
						: `302 to ${host}, expected *.cloudflareaccess.com`;
				},
				passNote:
					"DEGRADED: no Access service token in .staging.vars — asserted " +
					"the Access login redirect only, not the deployed frontend",
			});
		}
	} else {
		probes.push({
			url: `${env.frontendOrigin}/`,
			expectStatus: 200,
			label: "frontend",
		});
	}

	// /v1/auth/me requires session cookies; without them it must 401.
	// Confirms the API is reachable and routing correctly without needing
	// real credentials. (api-staging is not behind Access — gating it would
	// break browser XHR and SSR fetches.)
	probes.push({
		url: `${env.apiBase}/auth/me`,
		expectStatus: 401,
		label: "api",
	});

	// The legacy share viewer only exists in prod.
	if (env.legacyOrigin != null) {
		probes.push({
			url: `${env.legacyOrigin}/`,
			expectStatus: 200,
			label: "legacy",
		});
	}

	return probes;
}

async function probe(p: SmokeProbe): Promise<SmokeResult> {
	const start = Date.now();
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 5000);
	try {
		// GET, not HEAD — the API Worker routes by method and doesn't
		// register HEAD handlers for most paths (would return 404).
		const r = await fetch(p.url, {
			method: "GET",
			redirect: "manual",
			signal: controller.signal,
			headers: p.headers,
		});
		const durationMs = Date.now() - start;
		const cfRay = r.headers.get("cf-ray") ?? undefined;
		if (r.status !== p.expectStatus) {
			return {
				probe: p,
				status: "fail",
				actualStatus: r.status,
				cfRay,
				durationMs,
				detail: `expected ${p.expectStatus}, got ${r.status}`,
			};
		}
		if (!cfRay) {
			return {
				probe: p,
				status: "fail",
				actualStatus: r.status,
				cfRay,
				durationMs,
				detail: "missing cf-ray header — request may not have hit Cloudflare",
			};
		}
		const verifyError = p.verify?.(r) ?? null;
		if (verifyError) {
			return {
				probe: p,
				status: "fail",
				actualStatus: r.status,
				cfRay,
				durationMs,
				detail: verifyError,
			};
		}
		return {
			probe: p,
			status: "pass",
			actualStatus: r.status,
			cfRay,
			durationMs,
			detail: p.passNote,
		};
	} catch (e) {
		const durationMs = Date.now() - start;
		return {
			probe: p,
			status: "fail",
			durationMs,
			detail: e instanceof Error ? e.message : String(e),
		};
	} finally {
		clearTimeout(timeout);
	}
}

export async function runSmokeProbes(env: CloudEnv): Promise<SmokeResult[]> {
	const results: SmokeResult[] = [];
	for (const p of probesFor(env)) {
		results.push(await probe(p));
	}
	return results;
}
