// npm-script-based checks: lint, svelte-check, prettier format check, and an
// npm-audit gate for both root and cloud/. The audit gate blocks the deploy on
// any high/critical advisory except those explicitly allowlisted in
// AUDIT_EXCEPTIONS (reported as a non-blocking WARN, never hidden).

import { runCaptured } from "../../lib/shell";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { CheckResult } from "../types";

const REPO_ROOT = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"..",
);
const CLOUD_DIR = resolve(REPO_ROOT, "cloud");

// Run an npm script. On non-zero exit, the script's combined output is
// included in details so the operator sees the actual lint/check error.
async function npmScript(
	name: string,
	cwd: string,
	resultName: string,
): Promise<CheckResult> {
	const start = Date.now();
	const r = await runCaptured("npm", ["run", name, "--silent"], { cwd });
	const durationMs = Date.now() - start;
	if (r.code === 0) {
		return {
			name: resultName,
			status: "pass",
			blocking: true,
			durationMs,
		};
	}
	const out = `${r.stdout}\n${r.stderr}`.trim();
	return {
		name: resultName,
		status: "fail",
		blocking: true,
		details: out || `npm run ${name} exited ${r.code}`,
		durationMs,
	};
}

type Severity = "info" | "low" | "moderate" | "high" | "critical";

// One link in a vulnerability's `via` chain from `npm audit --json`. A string
// references another vulnerable package by name (a transitive hop up the tree);
// an object is the actual advisory — it carries the GHSA url + severity and
// appears only on the leaf package that is genuinely vulnerable.
interface AuditVia {
	title?: string;
	url?: string;
	severity?: Severity;
}
interface AuditVulnerability {
	severity: Severity;
	via?: (string | AuditVia)[];
}
interface AuditReport {
	vulnerabilities?: Record<string, AuditVulnerability>;
}

// High/critical advisories intentionally exempted from the deploy gate. Each
// entry is scoped to a single GHSA id, with the reason and the condition that
// retires it. The gate still blocks on any high/critical advisory NOT listed
// here — including a *different* future advisory on the same package, since a
// new advisory carries a new id. Exempted advisories surface as a WARN, never
// hidden. Keep this list short and delete entries the moment the real fix ships.
interface AuditException {
	ghsa: string;
	reason: string;
}
const AUDIT_EXCEPTIONS: AuditException[] = [
	{
		ghsa: "GHSA-96hv-2xvq-fx4p",
		// `ws` memory-exhaustion DoS, reachable only via wrangler → miniflare —
		// the local dev/test simulator, which never runs in production (the
		// deployed Worker uses Cloudflare's runtime, not miniflare). miniflare
		// pins ws@8.20.1 exactly; the fix is ws@8.21.0. Remove once
		// wrangler/miniflare bumps its ws pin (follow-up to
		// cloudflare/workers-sdk#13978, which only reached 8.20.1).
		reason:
			"ws DoS reachable only via miniflare (dev/test sim, no prod reach); fixed in ws@8.21.0, awaiting a wrangler/miniflare bump",
	},
];

async function npmAudit(cwd: string, resultName: string): Promise<CheckResult> {
	const start = Date.now();
	// `npm audit --json` exits non-zero whenever any vulnerability exists, but
	// still prints the report. We classify advisories ourselves and ignore the
	// exit code.
	const r = await runCaptured("npm", ["audit", "--json"], { cwd });
	const durationMs = Date.now() - start;
	let parsed: AuditReport;
	try {
		parsed = JSON.parse(r.stdout) as AuditReport;
	} catch {
		return {
			name: resultName,
			status: "fail",
			blocking: true,
			details: `Could not parse npm audit output:\n${r.stdout.slice(0, 500)}`,
			durationMs,
		};
	}

	const allowed = new Set(AUDIT_EXCEPTIONS.map((e) => e.ghsa));
	// Walk every vulnerability's `via` chain and collect the distinct high/
	// critical *advisories*. The advisory object lives only on the leaf package
	// that is actually vulnerable; transitive packages reference it by name, so
	// counting advisories (not packages) yields each one exactly once and
	// collapses an inherited chain (ws → miniflare → wrangler) to its single
	// root advisory.
	const blocking: string[] = [];
	const exempted: string[] = [];
	const seen = new Set<string>();
	for (const info of Object.values(parsed.vulnerabilities ?? {})) {
		for (const via of info.via ?? []) {
			if (typeof via === "string") continue;
			if (via.severity !== "high" && via.severity !== "critical") continue;
			const id = via.url?.split("/").pop() ?? via.title ?? "unknown";
			if (seen.has(id)) continue;
			seen.add(id);
			const label = `${id} (${via.severity})${via.title ? ` ${via.title}` : ""}`;
			if (allowed.has(id)) exempted.push(label);
			else blocking.push(label);
		}
	}

	if (blocking.length > 0) {
		return {
			name: resultName,
			status: "fail",
			blocking: true,
			details: `High/critical advisories:\n${blocking.map((b) => `  ${b}`).join("\n")}`,
			durationMs,
		};
	}
	if (exempted.length > 0) {
		// Every high/critical advisory present is explicitly allowlisted: pass the
		// gate but warn so the exemptions stay visible in every preflight.
		return {
			name: resultName,
			status: "warn",
			blocking: true,
			details: `Allowlisted advisories (AUDIT_EXCEPTIONS — remove when upstream fixes land):\n${exempted
				.map((e) => `  ${e}`)
				.join("\n")}`,
			durationMs,
		};
	}
	return {
		name: resultName,
		status: "pass",
		blocking: true,
		durationMs,
	};
}

export async function runNpmChecks(): Promise<CheckResult[]> {
	return [
		await npmScript("format:check", REPO_ROOT, "npm.format"),
		await npmScript("lint", REPO_ROOT, "npm.lint"),
		await npmScript("check", REPO_ROOT, "npm.check"),
		await npmAudit(REPO_ROOT, "npm.audit.root"),
		await npmAudit(CLOUD_DIR, "npm.audit.cloud"),
	];
}
