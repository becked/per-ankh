// Security checks:
//   secrets.required — production Worker has the required `wrangler secret`s set
//   secrets.vars     — wrangler.toml [vars] doesn't contain secret-named keys
//                       (vars are baked into the deployed bundle; real secrets
//                       must be `wrangler secret put`)
//   secrets.leak     — regex pass over tracked files for common token shapes

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { runCaptured } from "../../lib/shell";
import type { CheckResult } from "../types";

const REPO_ROOT = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"..",
);
const CLOUD_DIR = resolve(REPO_ROOT, "cloud");

// Required production secrets on the Worker. If any are missing, OAuth
// breaks and every login 500s. Keep this list in sync with the actual
// wrangler.toml comments naming required secrets.
const REQUIRED_SECRETS = [
	"DISCORD_CLIENT_SECRET",
	"ALLOWED_DISCORD_USERNAMES",
];

interface SecretEntry {
	name: string;
	type: string;
}

async function checkRequiredSecrets(): Promise<CheckResult> {
	const r = await runCaptured(
		"npx",
		["wrangler", "secret", "list"],
		{ cwd: CLOUD_DIR },
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
		return {
			name: "secrets.required",
			status: "fail",
			blocking: true,
			details:
				`Missing production secrets: ${missing.join(", ")}\n` +
				`Set with: cd cloud && npx wrangler secret put <NAME>`,
		};
	}
	return { name: "secrets.required", status: "pass", blocking: true };
}

// Find offending KEY = "value" lines under [vars]. Returns the file:line
// pointers so the operator can fix them.
const SECRET_NAME_RE = /_(SECRET|KEY|TOKEN|PASSWORD|PRIVATE)$/i;

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
			inVars = trimmed === "[vars]";
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

async function checkVarsHygiene(): Promise<CheckResult> {
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
	const ls = await runCaptured(
		"git",
		["ls-files", "-z"],
		{ cwd: REPO_ROOT },
	);
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
		if (f === "package-lock.json" || f.endsWith("/package-lock.json"))
			continue;
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

export async function runSecretChecks(): Promise<CheckResult[]> {
	return [
		await checkVarsHygiene(),
		await checkLeakScan(),
		await checkRequiredSecrets(),
	];
}
