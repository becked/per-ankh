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
//   secrets.ssr_trust — SSR_TRUSTED_KEY is on BOTH Workers (API + frontend).
//                       Non-blocking: unset on both is a working state, and
//                       the only one whose failure mode is otherwise silent

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

// The names of the secrets set on one Worker, or why we couldn't find out.
// Both secret checks below go through this — `secrets.ssr_trust` has to ask
// the same question of a second Worker, and two copies of the banner-slicing
// and parse handling would be two places to fix when wrangler's output shifts.
type SecretListing =
	{ ok: true; names: Set<string> } | { ok: false; reason: string };

async function listSecrets(env: CloudEnv, cwd: string): Promise<SecretListing> {
	const r = await runCaptured(
		"npx",
		["wrangler", "secret", "list", ...env.wranglerEnvFlag],
		{ cwd },
	);
	if (r.code !== 0) {
		return {
			ok: false,
			reason: `wrangler secret list failed: ${r.stderr.trim() || r.stdout.trim()}`,
		};
	}
	// `wrangler secret list` may print non-JSON banner lines before the
	// JSON array. Slice from first '['.
	const idx = r.stdout.indexOf("[");
	try {
		const parsed = JSON.parse(
			idx >= 0 ? r.stdout.slice(idx) : r.stdout,
		) as SecretEntry[];
		return { ok: true, names: new Set(parsed.map((s) => s.name)) };
	} catch {
		return {
			ok: false,
			reason: `Could not parse secret list:\n${r.stdout.slice(0, 300)}`,
		};
	}
}

async function checkRequiredSecrets(env: CloudEnv): Promise<CheckResult> {
	const listing = await listSecrets(env, CLOUD_DIR);
	if (!listing.ok) {
		return {
			name: "secrets.required",
			status: "fail",
			blocking: true,
			details: listing.reason,
		};
	}
	const missing = REQUIRED_SECRETS.filter((s) => !listing.names.has(s));
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
// r2_buckets, ai) into named envs — [env.staging] must redefine all of them. A
// var or binding added to the top level but forgotten in [env.staging] fails
// silently at runtime, not at deploy. This check compares the prod and
// staging definitions in the static tomls (key sets for vars — values may
// legitimately differ; binding names for each binding kind).

// Repeatable bindings, declared as [[table]] once per instance.
const BINDING_TABLES = ["d1_databases", "kv_namespaces", "r2_buckets"];

// Single-instance bindings, declared as one [section] with a `binding` key.
// Wrangler doesn't inherit these either, and they are easy to miss precisely
// because there is only ever one of them: a staging Worker with no [env.staging.ai]
// has no AI binding at all, and the screenshot upload gate fails closed on
// every request there while prod is fine.
const BINDING_SECTIONS = ["ai"];

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
		const headers: [string, string][] = [
			...BINDING_TABLES.map((t): [string, string] => [
				`[[${t}]]`,
				`[[env.staging.${t}]]`,
			]),
			...BINDING_SECTIONS.map((t): [string, string] => [
				`[${t}]`,
				`[env.staging.${t}]`,
			]),
		];
		for (const [prodHeader, stagingHeader] of headers) {
			const prod = bindingNames(text, prodHeader);
			const staging = bindingNames(text, stagingHeader);
			// Skip kinds the file doesn't use at all (the root toml has none).
			if (prod.size === 0 && staging.size === 0) continue;
			for (const b of setDiff(prod, staging)) {
				problems.push(
					`${path}: binding ${b} in ${prodHeader} but missing from ${stagingHeader}`,
				);
			}
			for (const b of setDiff(staging, prod)) {
				problems.push(
					`${path}: binding ${b} in ${stagingHeader} but missing from ${prodHeader}`,
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

// ─── secrets.ssr_trust ──────────────────────────────────────────────────────
// SSR_TRUSTED_KEY is the one secret that has to be the same value on *both*
// Workers, and the only one whose absence is invisible at runtime. The API
// believes the visitor address the frontend forwards only when both hold it;
// with either side missing, nothing is forwarded and every per-IP budget
// silently counts every server-rendered visitor into one bucket again — the
// 2026-08-05 outage. The logs say nothing, because a Worker with no key has
// nothing to reject (`ssr_forward_rejected` fires on a *mismatch*).
//
// So this is the check that stands in for the missing runtime signal, and it
// grades the three states differently:
//
//   both set      → pass.
//   neither set   → warn. This is the documented deploy window (§3.2 of
//                   docs/cloud-deploy-plan.md) and a working state, so it must
//                   not block. It is also how the window silently becomes
//                   permanent, so it must not be silent.
//   exactly one   → fail. Never an intentional state: somebody did half a
//                   rollout or half a rotation. Non-blocking, because the
//                   deploy in front of it is probably unrelated and refusing
//                   to ship is worse than shipping the state we already have.
//
// Values aren't compared — `wrangler secret list` returns names only. A
// mismatch between two set values is the case `ssr_forward_rejected` does
// cover.
const SSR_TRUST_SECRET = "SSR_TRUSTED_KEY";

export async function checkSsrTrustKey(env: CloudEnv): Promise<CheckResult> {
	const [api, frontend] = await Promise.all([
		listSecrets(env, CLOUD_DIR),
		listSecrets(env, REPO_ROOT),
	]);
	if (!api.ok || !frontend.ok) {
		return {
			name: "secrets.ssr_trust",
			status: "warn",
			blocking: false,
			details:
				`${SSR_TRUST_SECRET} must be set, with the same value, on the API ` +
				"Worker (cloud/) and the frontend Worker (repo root). Could not " +
				`check: ${(api.ok ? frontend : api).reason}`,
		};
	}

	const onApi = api.names.has(SSR_TRUST_SECRET);
	const onFrontend = frontend.names.has(SSR_TRUST_SECRET);
	if (onApi && onFrontend) {
		return { name: "secrets.ssr_trust", status: "pass", blocking: false };
	}

	const envFlag = env.wranglerEnvFlag.length
		? ` ${env.wranglerEnvFlag.join(" ")}`
		: "";
	const howTo =
		`Set the same value on both:\n` +
		`  cd cloud && npx wrangler secret put ${SSR_TRUST_SECRET}${envFlag}\n` +
		`  npx wrangler secret put ${SSR_TRUST_SECRET}${envFlag}   # repo root`;

	if (!onApi && !onFrontend) {
		return {
			name: "secrets.ssr_trust",
			status: "warn",
			blocking: false,
			details:
				`${SSR_TRUST_SECRET} is set on neither Worker, so SSR visitor ` +
				"forwarding is off: every server-rendered request counts against " +
				"Cloudflare's egress address instead of the visitor, and one " +
				"crawler can spend the whole site's per-IP budget.\n" +
				howTo,
		};
	}

	const missing = onApi
		? "the frontend Worker (repo root)"
		: "the API Worker (cloud/)";
	return {
		name: "secrets.ssr_trust",
		status: "fail",
		blocking: false,
		details:
			`${SSR_TRUST_SECRET} is set on only one of the two Workers — missing ` +
			`on ${missing}. Forwarding needs both, so it is currently off and ` +
			"every server-rendered visitor shares one rate-limit bucket.\n" +
			howTo,
	};
}

export async function runSecretChecks(env: CloudEnv): Promise<CheckResult[]> {
	return [
		await checkVarsHygiene(),
		await checkVarsParity(),
		await checkLeakScan(),
		await checkRequiredSecrets(env),
		await checkSsrTrustKey(env),
	];
}
