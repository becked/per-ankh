// Thin wrappers around `npx wrangler d1 execute` and `wrangler r2 object delete`.
// Spawns the wrangler binary in cloud/ and parses --json output. Used by every
// admin subcommand.
//
// Targets remote (production D1 + R2) by default. Callers can opt into local
// via setLocal(true) at startup — toggled by the `--local` global flag in
// the CLI router. Useful for testing the tournament admin commands against
// the local .wrangler state during development.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLOUD_DIR = resolve(REPO_ROOT, "cloud");
const WRANGLER_BIN = resolve(CLOUD_DIR, "node_modules/.bin/wrangler");

let useLocal = false;

export function setLocal(value: boolean): void {
	useLocal = value;
}

export function isLocal(): boolean {
	return useLocal;
}

function targetFlag(): string {
	return useLocal ? "--local" : "--remote";
}

// Matches cloud/wrangler.toml [d1_databases].database_name and
// [r2_buckets].bucket_name. Hardcoded — there's only one environment, and
// parsing wrangler.toml adds nothing for phase 1.
export const DB_NAME = "per-ankh-share-index";
export const R2_BUCKET = "per-ankh-shares";

interface SpawnResult {
	stdout: string;
	stderr: string;
	code: number;
}

function runWrangler(args: string[]): Promise<SpawnResult> {
	return new Promise((res, rej) => {
		const child = spawn(WRANGLER_BIN, args, {
			cwd: CLOUD_DIR,
			stdio: ["ignore", "pipe", "pipe"],
			shell: false,
			env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
		});
		let stdout = "";
		let stderr = "";
		child.stdout?.on("data", (c: Buffer) => {
			stdout += c.toString("utf8");
		});
		child.stderr?.on("data", (c: Buffer) => {
			stderr += c.toString("utf8");
		});
		child.on("error", rej);
		child.on("close", (code) => res({ stdout, stderr, code: code ?? 0 }));
	});
}

// `wrangler d1 execute --json` returns an array, one entry per statement:
//   [{ results: [...], success: true, meta: {...} }, ...]
interface D1ResultSet<T> {
	results: T[];
	success: boolean;
}

// Strip wrangler's banner / non-JSON noise. With --json wrangler still prints
// a few status lines to stdout before the JSON payload on some versions.
function extractJson(stdout: string): string {
	const trimmed = stdout.trim();
	if (trimmed.startsWith("[") || trimmed.startsWith("{")) return trimmed;
	const idx = stdout.search(/^\s*[[{]/m);
	if (idx === -1) return trimmed;
	return stdout.slice(idx).trim();
}

export async function d1Query<T = Record<string, unknown>>(
	sql: string,
): Promise<T[]> {
	const { stdout, stderr, code } = await runWrangler([
		"d1",
		"execute",
		DB_NAME,
		targetFlag(),
		"--json",
		"--command",
		sql,
	]);
	if (code !== 0) {
		throw new Error(
			`wrangler d1 execute failed (exit ${code}):\n${stderr.trim() || stdout.trim()}`,
		);
	}
	const parsed = JSON.parse(extractJson(stdout)) as D1ResultSet<T>[];
	return parsed[0]?.results ?? [];
}

// Run multiple statements in one wrangler invocation. Returns one results
// array per statement. Callers cast each result to its row type.
//
//   const [usersRaw, gamesRaw] = await d1Batch([sqlA, sqlB]);
//   const users = usersRaw as UserRow[];
export async function d1Batch(sqls: string[]): Promise<unknown[][]> {
	const sql = sqls.join("; ");
	const { stdout, stderr, code } = await runWrangler([
		"d1",
		"execute",
		DB_NAME,
		targetFlag(),
		"--json",
		"--command",
		sql,
	]);
	if (code !== 0) {
		throw new Error(
			`wrangler d1 execute failed (exit ${code}):\n${stderr.trim() || stdout.trim()}`,
		);
	}
	const parsed = JSON.parse(extractJson(stdout)) as D1ResultSet<unknown>[];
	return parsed.map((p) => p.results);
}

// Mutating statement (INSERT/UPDATE/DELETE). Returns void; throws on failure.
export async function d1Exec(sql: string): Promise<void> {
	const { stdout, stderr, code } = await runWrangler([
		"d1",
		"execute",
		DB_NAME,
		targetFlag(),
		"--json",
		"--command",
		sql,
	]);
	if (code !== 0) {
		throw new Error(
			`wrangler d1 execute failed (exit ${code}):\n${stderr.trim() || stdout.trim()}`,
		);
	}
}

// SQLite single-quoted string literal. Doubles embedded quotes, rejects null
// bytes. Operator input is the source — not a security boundary per se, but we
// need correctness for app_keys / reasons that may contain apostrophes.
export function sqlStr(s: string): string {
	if (s.includes("\0")) {
		throw new Error("SQL string contains null byte");
	}
	return "'" + s.replace(/'/g, "''") + "'";
}

// Write a single key/value to the SESSIONS_KV namespace. Used by the
// dev-login command to mint a local session without going through Discord
// OAuth. ttl is in seconds; SESSIONS_KV's app-level TTL is 30d (see
// cloud/src/session.ts SESSION_TTL_SECONDS), so the default matches.
export async function kvPutSession(
	key: string,
	value: string,
	ttlSeconds: number,
): Promise<void> {
	// SESSIONS_KV has both `id` and `preview_id` in wrangler.toml; wrangler
	// refuses an ambiguous put without an explicit --preview flag.
	// `wrangler dev` defaults to the preview namespace in local mode, so
	// we mirror that — otherwise the session lands in a separate local KV
	// store that the running worker can't see.
	const { stdout, stderr, code } = await runWrangler([
		"kv",
		"key",
		"put",
		"--binding",
		"SESSIONS_KV",
		"--preview",
		"--ttl",
		String(ttlSeconds),
		targetFlag(),
		key,
		value,
	]);
	if (code !== 0) {
		throw new Error(
			`wrangler kv put failed (exit ${code}):\n${stderr.trim() || stdout.trim()}`,
		);
	}
}

export async function r2Delete(key: string): Promise<void> {
	const { stderr, code } = await runWrangler([
		"r2",
		"object",
		"delete",
		`${R2_BUCKET}/${key}`,
		targetFlag(),
	]);
	if (code !== 0) {
		throw new Error(
			`wrangler r2 delete failed (exit ${code}): ${stderr.trim()}`,
		);
	}
}

export interface R2DeleteSummary {
	ok: number;
	missing: number;
	failed: number;
	errors: string[];
}

// Bulk delete with bounded concurrency. Missing keys (already deleted) are
// not treated as failures — the typical case for re-running a nuke.
export async function r2DeleteMany(
	keys: string[],
	concurrency = 10,
): Promise<R2DeleteSummary> {
	const summary: R2DeleteSummary = { ok: 0, missing: 0, failed: 0, errors: [] };
	for (let i = 0; i < keys.length; i += concurrency) {
		const batch = keys.slice(i, i + concurrency);
		const results = await Promise.allSettled(batch.map(r2Delete));
		for (let j = 0; j < results.length; j++) {
			const r = results[j];
			if (r.status === "fulfilled") {
				summary.ok++;
			} else {
				const msg = String(r.reason);
				if (/not.?found|404|NoSuchKey/i.test(msg)) {
					summary.missing++;
				} else {
					summary.failed++;
					summary.errors.push(`${batch[j]}: ${msg}`);
				}
			}
		}
	}
	return summary;
}
