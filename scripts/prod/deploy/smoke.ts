// HTTP probes against live prod. Verifies the deploy didn't break basic
// routing. Functional tests (Discord OAuth, upload flow, etc.) stay manual
// because they need a real browser session — see docs/cloud-deploy-plan.md §5.

export interface SmokeProbe {
	url: string;
	expectStatus: number;
	label: string;
}

export interface SmokeResult {
	probe: SmokeProbe;
	status: "pass" | "fail";
	actualStatus?: number;
	cfRay?: string;
	durationMs: number;
	detail?: string;
}

export const PROBES: SmokeProbe[] = [
	{
		url: "https://per-ankh.app/",
		expectStatus: 200,
		label: "frontend",
	},
	{
		// /v1/auth/me requires session cookies; without them it must 401.
		// Confirms the API is reachable and routing correctly without
		// needing real credentials.
		url: "https://api.per-ankh.app/v1/auth/me",
		expectStatus: 401,
		label: "api",
	},
	{
		url: "https://legacy.per-ankh.app/",
		expectStatus: 200,
		label: "legacy",
	},
];

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
		return {
			probe: p,
			status: "pass",
			actualStatus: r.status,
			cfRay,
			durationMs,
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

export async function runSmokeProbes(): Promise<SmokeResult[]> {
	const results: SmokeResult[] = [];
	for (const p of PROBES) {
		results.push(await probe(p));
	}
	return results;
}
