// npm-script-based checks: lint, svelte-check, prettier format check,
// `npm audit --audit-level=high` for both root and cloud/.

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

interface AuditAdvisory {
	severity: "info" | "low" | "moderate" | "high" | "critical";
}
interface AuditReport {
	vulnerabilities?: Record<string, AuditAdvisory>;
}

async function npmAudit(
	cwd: string,
	resultName: string,
): Promise<CheckResult> {
	const start = Date.now();
	// `npm audit --json` exits non-zero when vulnerabilities exist, but the
	// JSON is still printed. We treat any high+critical as failure regardless
	// of the exit code, so we ignore code and rely on parsed counts.
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
	const vulns = parsed.vulnerabilities ?? {};
	const high: string[] = [];
	const critical: string[] = [];
	for (const [pkg, info] of Object.entries(vulns)) {
		if (info.severity === "high") high.push(pkg);
		else if (info.severity === "critical") critical.push(pkg);
	}
	if (high.length === 0 && critical.length === 0) {
		return {
			name: resultName,
			status: "pass",
			blocking: true,
			durationMs,
		};
	}
	const detail =
		(critical.length > 0
			? `Critical: ${critical.join(", ")}\n`
			: "") + (high.length > 0 ? `High: ${high.join(", ")}` : "");
	return {
		name: resultName,
		status: "fail",
		blocking: true,
		details: detail.trim(),
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
