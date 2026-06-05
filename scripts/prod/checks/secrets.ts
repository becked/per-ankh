// Security checks:
//   secrets.required — the target Worker env has the required `wrangler
//                       secret`s set (secrets are per-environment)
//   secrets.vars     — wrangler.toml [vars] / [env.*.vars] don't contain
//                       secret-named keys (vars are baked into the deployed
//                       bundle; real secrets must be `wrangler secret put`)
//   secrets.parity   — [env.staging.vars] key set and binding names mirror
//                       the top level (wrangler does not inherit vars or
//                       bindings into named envs, so drift is silent)
//   secrets.leak     — regex pass over tracked files for common token shapes

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { runCaptured } from "../../lib/shell";
import type { CheckResult } from "../types";
import type { CloudEnv } from "../../lib/environments";

const REPO_ROOT = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"..",
);
const CLOUD_DIR = resolve(REPO_ROOT, "cloud");

// Required secrets on the Worker (per environment — wrangler secrets are not
// shared between the top level and named envs). If any are missing, OAuth
// breaks and every login 500s. Keep this list in sync with the actual
// wrangler.toml comments naming required secrets.
const REQUIRED_SECRETS = ["DISCORD_CLIENT_SECRET"];

interface SecretEntry {
	name: string;
	type: string;
}

async function checkRequiredSecrets(env: CloudEnv): Promise<CheckResult> {
	const r = await runCaptured(
		"npx",
		["wrangler", "secret", "list", ...env.wranglerEnvFlag],
		{
			cwd: CLOUD_DIR,
		},
	);
	if (r.code !== 0) {
		return {
			name: "secrets.required",
			status: "fail",
			blocking: true,
			details: `wrangler secret list failed: ${r.stderr.trim() || r.stdout.trim()}`,
		};
	}
	// `wrangler secret list` may print non-JSON banner lines before the
	// JSON array. Slice from first '['.
	const idx = r.stdout.indexOf("[");
	let parsed: SecretEntry[];
	try {
		parsed = JSON.parse(
			idx >= 0 ? r.stdout.slice(idx) : r.stdout,
		) as SecretEntry[];
	} catch {
		return {
			name: "secrets.required",
			status: "fail",
			blocking: true,
			details: `Could not parse secret list:\n${r.stdout.slice(0, 300)}`,
		};
	}
	const present = new Set(parsed.map((s) => s.name));
	const missing = REQUIRED_SECRETS.filter((s) => !present.has(s));
	if (missing.length > 0) {
		const envFlag = env.wranglerEnvFlag.length
			? ` ${env.wranglerEnvFlag.join(" ")}`
			: "";
		return {
			name: "secrets.required",
			status: "fail",
			blocking: true,
			details:
				`Missing ${env.name} secrets: ${missing.join(", ")}\n` +
				`Set with: cd cloud && npx wrangler secret put <NAME>${envFlag}`,
		};
	}
	return { name: "secrets.required", status: "pass", blocking: true };
}

// Find offending KEY = "value" lines under [vars] or any [env.<name>.vars]
// block — named envs don't inherit vars, so each env carries its own block
// and all of them are baked into the deployed bundle. Returns the file:line
// pointers so the operator can fix them.
const SECRET_NAME_RE = /_(SECRET|KEY|TOKEN|PASSWORD|PRIVATE)$/i;
const VARS_SECTION_RE = /^\[(?:env\.[^.\]]+\.)?vars\]$/;

async function scanWranglerVars(path: string): Promise<string[]> {
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch {
		return [];
	}
	const lines = text.split("\n");
	const offenders: string[] = [];
	let inVars = false;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const trimmed = line.trim();
		if (trimmed.startsWith("#")) continue;
		if (trimmed.startsWith("[")) {
			inVars = VARS_SECTION_RE.test(trimmed);
			continue;
		}
		if (!inVars) continue;
		const m = trimmed.match(/^(\w+)\s*=/);
		if (m && SECRET_NAME_RE.test(m[1])) {
			offenders.push(`${path}:${i + 1}: ${m[1]}`);
		}
	}
	return offenders;
}

// Exported for standalone verification — pure file inspection, no wrangler.
export async function checkVarsHygiene(): Promise<CheckResult> {
	const offenders = (
		await Promise.all([
			scanWranglerVars(resolve(REPO_ROOT, "wrangler.toml")),
			scanWranglerVars(resolve(CLOUD_DIR, "wrangler.toml")),
		])
	).flat();
	if (offenders.length === 0) {
		return { name: "secrets.vars", status: "pass", blocking: true };
	}
	return {
		name: "secrets.vars",
		status: "fail",
		blocking: true,
		details:
			"Secret-named keys found under [vars] (these are baked into the deployed bundle and visible in the dashboard — use `wrangler secret put` instead):\n" +
			offenders.map((o) => `  ${o}`).join("\n"),
	};
}

// ─── secrets.parity ─────────────────────────────────────────────────────────
// Wrangler does NOT inherit `vars` or bindings (d1_databases, kv_namespaces,
// r2_buckets) into named envs — [env.staging] must redefine all of them. A
// var or binding added to the top level but forgotten in [env.staging] fails
// silently at runtime, not at deploy. This check compares the prod and
// staging definitions in the static tomls (key sets for vars — values may
// legitimately differ; binding names for the three binding kinds).

const BINDING_TABLES = ["d1_databases", "kv_namespaces", "r2_buckets"];

// Minimal line-oriented toml scans, same approach as scanWranglerVars. They
// only understand `[section]` / `[[table]]` headers and `KEY = value` lines —
// enough for wrangler.toml's flat shape. Keep wrangler.toml flat (no inline
// tables for vars/bindings) or these scanners will miss entries.

// KEY names under an exact section header, or null if the section is absent.
function sectionKeys(text: string, header: string): Set<string> | null {
	let inSection = false;
	let seen = false;
	const keys = new Set<string>();
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.startsWith("#")) continue;
		if (trimmed.startsWith("[")) {
			inSection = trimmed === header;
			if (inSection) seen = true;
			continue;
		}
		if (!inSection) continue;
		const m = trimmed.match(/^(\w+)\s*=/);
		if (m) keys.add(m[1]);
	}
	return seen ? keys : null;
}

// `binding = "X"` names across every occurrence of a [[table]] header.
function bindingNames(text: string, header: string): Set<string> {
	let inTable = false;
	const names = new Set<string>();
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.startsWith("#")) continue;
		if (trimmed.startsWith("[")) {
			inTable = trimmed === header;
			continue;
		}
		if (!inTable) continue;
		const m = trimmed.match(/^binding\s*=\s*"([^"]+)"/);
		if (m) names.add(m[1]);
	}
	return names;
}

function setDiff(a: Set<string>, b: Set<string>): string[] {
	return [...a].filter((x) => !b.has(x)).sort();
}

// Exported for standalone verification — unlike the wrangler-backed checks,
// this one is pure file inspection and can run without Cloudflare auth.
export async function checkVarsParity(): Promise<CheckResult> {
	const problems: string[] = [];
	for (const path of [
		resolve(REPO_ROOT, "wrangler.toml"),
		resolve(CLOUD_DIR, "wrangler.toml"),
	]) {
		let text: string;
		try {
			text = await readFile(path, "utf8");
		} catch {
			problems.push(`${path}: could not read`);
			continue;
		}
		// Vars key-set parity. A file with neither block has nothing to keep
		// in sync (the root toml has no [vars] at all).
		const prodVars = sectionKeys(text, "[vars]");
		const stagingVars = sectionKeys(text, "[env.staging.vars]");
		if (prodVars && !stagingVars) {
			problems.push(`${path}: [vars] exists but [env.staging.vars] is missing`);
		} else if (!prodVars && stagingVars) {
			problems.push(`${path}: [env.staging.vars] exists but [vars] is missing`);
		} else if (prodVars && stagingVars) {
			for (const k of setDiff(prodVars, stagingVars)) {
				problems.push(
					`${path}: ${k} in [vars] but missing from [env.staging.vars]`,
				);
			}
			for (const k of setDiff(stagingVars, prodVars)) {
				problems.push(
					`${path}: ${k} in [env.staging.vars] but missing from [vars]`,
				);
			}
		}
		// Binding-name parity for each binding kind.
		for (const table of BINDING_TABLES) {
			const prod = bindingNames(text, `[[${table}]]`);
			const staging = bindingNames(text, `[[env.staging.${table}]]`);
			// Skip kinds the file doesn't use at all (the root toml has none).
			if (prod.size === 0 && staging.size === 0) continue;
			for (const b of setDiff(prod, staging)) {
				problems.push(
					`${path}: binding ${b} in [[${table}]] but missing from [[env.staging.${table}]]`,
				);
			}
			for (const b of setDiff(staging, prod)) {
				problems.push(
					`${path}: binding ${b} in [[env.staging.${table}]] but missing from [[${table}]]`,
				);
			}
		}
	}
	if (problems.length === 0) {
		return { name: "secrets.parity", status: "pass", blocking: true };
	}
	return {
		name: "secrets.parity",
		status: "fail",
		blocking: true,
		details:
			"Prod/staging wrangler config drift (wrangler does not inherit vars or bindings into named envs):\n" +
			problems.map((p) => `  ${p}`).join("\n"),
	};
}

// Leak-scan patterns. Each entry: { name, regex }. Hits become details.
const LEAK_PATTERNS: { name: string; re: RegExp }[] = [
	{ name: "AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/ },
	{
		name: "GitHub PAT",
		re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
	},
	{
		name: "Stripe live key",
		re: /\b(sk|pk|rk)_live_[A-Za-z0-9]{20,}\b/,
	},
	{
		name: "Slack token",
		re: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/,
	},
	{
		name: "Discord bot token",
		re: /\b[MN][A-Za-z\d]{23}\.[\w-]{6}\.[\w-]{27}\b/,
	},
	{
		name: "Google API key",
		re: /\bAIza[0-9A-Za-z_-]{35}\b/,
	},
	{
		name: "Generic high-entropy assigned to *_SECRET/_KEY/_TOKEN",
		// Match e.g.  FOO_SECRET = "abc123..." or const FOO_KEY = 'x...'
		// with a >=30-char base64ish value. Skip obvious placeholders.
		re: /\b\w*_(SECRET|KEY|TOKEN|PASSWORD)\b\s*[:=]\s*["'`]([A-Za-z0-9_\-+/=]{30,})["'`]/,
	},
];

// File extensions to skip. Binary or otherwise irrelevant.
const BINARY_EXTS = new Set([
	"webp",
	"png",
	"jpg",
	"jpeg",
	"gif",
	"ico",
	"woff",
	"woff2",
	"ttf",
	"otf",
	"zip",
	"gz",
	"br",
	"pdf",
	"mp3",
	"mp4",
	"wav",
	"webm",
	"sqlite",
	"db",
]);

async function checkLeakScan(): Promise<CheckResult> {
	const ls = await runCaptured("git", ["ls-files", "-z"], { cwd: REPO_ROOT });
	if (ls.code !== 0) {
		return {
			name: "secrets.leak",
			status: "fail",
			blocking: true,
			details: `git ls-files failed: ${ls.stderr.trim()}`,
		};
	}
	const files = ls.stdout.split("\0").filter((f) => f.length > 0);
	const hits: string[] = [];
	for (const f of files) {
		const ext = f.split(".").pop()?.toLowerCase() ?? "";
		if (BINARY_EXTS.has(ext)) continue;
		// Skip our own scanner: the patterns themselves contain pattern fragments.
		if (f === "scripts/prod/checks/secrets.ts") continue;
		// Skip package-lock / similar generated noise.
		if (f === "package-lock.json" || f.endsWith("/package-lock.json")) continue;
		const full = resolve(REPO_ROOT, f);
		let text: string;
		try {
			text = await readFile(full, "utf8");
		} catch {
			continue;
		}
		// Cheap binary detection — if the file has a null byte, skip.
		if (text.indexOf("\0") !== -1) continue;
		for (const { name, re } of LEAK_PATTERNS) {
			const m = text.match(re);
			if (m) {
				const lineIdx = text.slice(0, m.index ?? 0).split("\n").length;
				const sample = m[0].slice(0, 40);
				hits.push(`${f}:${lineIdx}: ${name} — ${sample}…`);
				break; // one hit per file is enough
			}
		}
	}
	if (hits.length === 0) {
		return { name: "secrets.leak", status: "pass", blocking: true };
	}
	return {
		name: "secrets.leak",
		status: "fail",
		blocking: true,
		details:
			"Potential secret(s) detected in tracked files:\n" +
			hits.map((h) => `  ${h}`).join("\n"),
	};
}

export async function runSecretChecks(env: CloudEnv): Promise<CheckResult[]> {
	return [
		await checkVarsHygiene(),
		await checkVarsParity(),
		await checkLeakScan(),
		await checkRequiredSecrets(env),
	];
}
