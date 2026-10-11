// Thin wrappers around `npx wrangler d1 execute` and `wrangler r2 object get/delete`.
// Spawns the wrangler binary in cloud/ and parses --json output. Used by every
// admin subcommand.
//
// Targets remote (production D1 + R2) by default. Callers can opt into the
// local .wrangler state (`--local`, useful for testing tournament admin
// commands during development) or the staging environment (`--staging`) —
// toggled by the global flags in the CLI router via setTarget().

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { getEnv } from "../lib/environments";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLOUD_DIR = resolve(REPO_ROOT, "cloud");
const WRANGLER_BIN = resolve(CLOUD_DIR, "node_modules/.bin/wrangler");

export type AdminTarget = "local" | "prod" | "staging";

let target: AdminTarget = "prod";

export function setTarget(value: AdminTarget): void {
	target = value;
}

export function getTarget(): AdminTarget {
	return target;
}

// The dev-only commands (dev-login, tournament seed) gate on this — both
// prod and staging count as "remote" and are refused.
export function isLocal(): boolean {
	return target === "local";
}

function targetFlags(): string[] {
	switch (target) {
		case "local":
			return ["--local"];
		case "prod":
			return ["--remote"];
		case "staging":
			// --env selects the [env.staging] bindings; the resources live remote.
			return ["--env", "staging", "--remote"];
	}
}

// D1 database_name / R2 bucket_name for the current target, from the shared
// environment table. The local .wrangler state simulates prod, so `local`
// resolves to the prod names.
function dbName(): string {
	return getEnv(target === "staging" ? "staging" : "prod").dbName;
}

function r2Bucket(): string {
	return getEnv(target === "staging" ? "staging" : "prod").r2Bucket;
}

// The screenshots bucket (issue #289) — a second bucket, so every R2 call
// below takes which one it means. Exported because the one caller that wants
// it, the game delete, reads the keys out of D1 and so names the bucket
// itself; the public host those keys are served from lives in purge.ts, with
// the URL building that needs it.
export function screenshotBucketName(): string {
	return getEnv(target === "staging" ? "staging" : "prod").screenshotBucket;
}

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
		dbName(),
		...targetFlags(),
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
		dbName(),
		...targetFlags(),
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
		dbName(),
		...targetFlags(),
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

// Namespace selection for every SESSIONS_KV call. SESSIONS_KV declares both
// `id` and `preview_id` in wrangler.toml, so --preview must be passed
// explicitly — wrangler otherwise can't tell which of the two is meant.
// `wrangler dev` binds the preview namespace in local mode, so --local mirrors
// that (otherwise reads and writes land in a separate local store the running
// worker can't see); remote targets take the production namespace.
function kvFlags(): string[] {
	return [
		"--binding",
		"SESSIONS_KV",
		"--preview",
		isLocal() ? "true" : "false",
		...targetFlags(),
	];
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
	const { stdout, stderr, code } = await runWrangler([
		"kv",
		"key",
		"put",
		...kvFlags(),
		"--ttl",
		String(ttlSeconds),
		key,
		value,
	]);
	if (code !== 0) {
		throw new Error(
			`wrangler kv put failed (exit ${code}):\n${stderr.trim() || stdout.trim()}`,
		);
	}
}

export interface KvKey {
	name: string;
	// Unix epoch seconds. Absent for keys written without a TTL.
	expiration?: number;
}

// Every key under a prefix. `wrangler kv key list` walks the list cursor
// itself and emits the whole set as one JSON array, so there's no pagination
// to do here.
export async function kvList(prefix: string): Promise<KvKey[]> {
	const { stdout, stderr, code } = await runWrangler([
		"kv",
		"key",
		"list",
		...kvFlags(),
		"--prefix",
		prefix,
	]);
	if (code !== 0) {
		throw new Error(
			`wrangler kv key list failed (exit ${code}):\n${stderr.trim() || stdout.trim()}`,
		);
	}
	return JSON.parse(extractJson(stdout)) as KvKey[];
}

// Cloudflare's bulk endpoint caps a single request at 10k keys.
const KV_BULK_LIMIT = 10_000;

// Delete many keys. `wrangler kv bulk delete` takes a JSON file of key names,
// so each chunk is staged in a temp file and cleaned up after.
export async function kvBulkDelete(keys: string[]): Promise<void> {
	for (let i = 0; i < keys.length; i += KV_BULK_LIMIT) {
		const chunk = keys.slice(i, i + KV_BULK_LIMIT);
		const file = join(tmpdir(), `per-ankh-kv-delete-${process.pid}-${i}.json`);
		await writeFile(file, JSON.stringify(chunk), "utf8");
		try {
			const { stdout, stderr, code } = await runWrangler([
				"kv",
				"bulk",
				"delete",
				file,
				...kvFlags(),
				// Skip wrangler's own prompt — the command already confirmed.
				"--force",
			]);
			if (code !== 0) {
				throw new Error(
					`wrangler kv bulk delete failed (exit ${code}):\n${stderr.trim() || stdout.trim()}`,
				);
			}
		} finally {
			await rm(file, { force: true });
		}
	}
}

// Fetch one object into a local file. `destPath` must be absolute — wrangler
// runs with its cwd set to cloud/, so a relative --file would land there.
// A missing key returns false rather than throwing (the same case the two
// download routes 404 on), so a sweep can count misses instead of aborting.
export async function r2Get(
	key: string,
	destPath: string,
	bucket: string = r2Bucket(),
): Promise<boolean> {
	const { stdout, stderr, code } = await runWrangler([
		"r2",
		"object",
		"get",
		`${bucket}/${key}`,
		"--file",
		destPath,
		...targetFlags(),
	]);
	if (code === 0) return true;
	// wrangler surfaces R2's own wording for an absent object — "The specified
	// key does not exist." — so matching only the S3 error name would push
	// every miss into the caller's failure path instead of its miss count.
	if (/does not exist|not.?found|404|NoSuchKey/i.test(`${stderr}\n${stdout}`)) {
		return false;
	}
	throw new Error(`wrangler r2 get failed (exit ${code}): ${stderr.trim()}`);
}

export async function r2Delete(
	key: string,
	bucket: string = r2Bucket(),
): Promise<void> {
	const { stderr, code } = await runWrangler([
		"r2",
		"object",
		"delete",
		`${bucket}/${key}`,
		...targetFlags(),
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
	bucket: string = r2Bucket(),
): Promise<R2DeleteSummary> {
	const summary: R2DeleteSummary = { ok: 0, missing: 0, failed: 0, errors: [] };
	for (let i = 0; i < keys.length; i += concurrency) {
		const batch = keys.slice(i, i + concurrency);
		const results = await Promise.allSettled(
			batch.map((key) => r2Delete(key, bucket)),
		);
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
