// R2 sync steps for `./per-ankh staging reclone` — mirror the production R2
// bucket into staging. The D1 half (drop + FK-ordered import) lives in the
// shared engine at scripts/lib/d1-import.ts, which the reclone command drives
// against a remote target; this module holds only what is staging-reclone
// specific: the R2 bucket-to-bucket sync and its credential loading.
//
// R2: rclone over R2's S3-compatible API, both remotes synthesized from env
// vars — no rclone config file. Two least-privilege tokens (prod read-only,
// staging read-write): R2 API tokens carry a single permission level across
// their bucket scope, so one read-prod/write-staging token is impossible.

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { runCaptured, runStreamed } from "../../lib/shell";
import { readDotVars } from "../../lib/dotvars";
import { getEnv, type CloudEnv } from "../../lib/environments";

const REPO_ROOT = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"..",
);

// Misuse guard for the destructive R2 sync: nothing but this assert stops a
// future caller from passing prod as the destination. (The D1 engine has its
// own equivalent guard on its target — see lib/d1-import.ts.)
function assertDisposable(env: CloudEnv): void {
	if (!env.disposableData) {
		throw new Error(
			`refusing to reclone into "${env.name}" — its data is not disposable`,
		);
	}
}

export interface R2SyncCreds {
	accountId: string;
	prodKeyId: string;
	prodSecret: string;
	stagingKeyId: string;
	stagingSecret: string;
}

export type CredsResult =
	| { ok: true; creds: R2SyncCreds }
	| { ok: false; missing: string[] };

const CRED_KEYS = [
	"CF_ACCOUNT_ID",
	"R2_PROD_RO_ACCESS_KEY_ID",
	"R2_PROD_RO_SECRET_ACCESS_KEY",
	"R2_STAGING_RW_ACCESS_KEY_ID",
	"R2_STAGING_RW_SECRET_ACCESS_KEY",
] as const;

// R2 S3 credentials from the gitignored .staging.vars at the repo root — the
// same file that holds the Access service token for staging smoke. Unlike
// smoke's degraded mode, absence here is a hard failure (the R2 sync is half
// the clone); the caller reports the missing keys.
export function loadRecloneCreds(): CredsResult {
	const vars = readDotVars(resolve(REPO_ROOT, ".staging.vars"));
	const missing = CRED_KEYS.filter((k) => !vars[k]);
	if (missing.length > 0) {
		return { ok: false, missing: [...missing] };
	}
	return {
		ok: true,
		creds: {
			accountId: vars.CF_ACCOUNT_ID,
			prodKeyId: vars.R2_PROD_RO_ACCESS_KEY_ID,
			prodSecret: vars.R2_PROD_RO_SECRET_ACCESS_KEY,
			stagingKeyId: vars.R2_STAGING_RW_ACCESS_KEY_ID,
			stagingSecret: vars.R2_STAGING_RW_SECRET_ACCESS_KEY,
		},
	};
}

export async function checkRcloneInstalled(): Promise<boolean> {
	try {
		const r = await runCaptured("rclone", ["version"]);
		return r.code === 0;
	} catch {
		// spawn rejects with ENOENT when the binary is missing.
		return false;
	}
}

// One rclone remote, fully described in env vars (RCLONE_CONFIG_<NAME>_*).
function rcloneRemoteEnv(
	remote: "PRODR2" | "STAGINGR2",
	accountId: string,
	keyId: string,
	secret: string,
): NodeJS.ProcessEnv {
	const prefix = `RCLONE_CONFIG_${remote}`;
	return {
		[`${prefix}_TYPE`]: "s3",
		[`${prefix}_PROVIDER`]: "Cloudflare",
		[`${prefix}_REGION`]: "auto",
		[`${prefix}_ENDPOINT`]: `https://${accountId}.r2.cloudflarestorage.com`,
		[`${prefix}_ACCESS_KEY_ID`]: keyId,
		[`${prefix}_SECRET_ACCESS_KEY`]: secret,
	};
}

// Mirror the prod bucket into staging. `sync` makes the destination identical
// to the source — staging-only objects are deleted (disposable means
// disposable). Incremental: unchanged objects are skipped on re-runs.
export async function syncR2FromProd(
	env: CloudEnv,
	creds: R2SyncCreds,
): Promise<void> {
	assertDisposable(env);
	const prodBucket = getEnv("prod").r2Bucket;
	const code = await runStreamed(
		"rclone",
		[
			"sync",
			`prodr2:${prodBucket}`,
			`stagingr2:${env.r2Bucket}`,
			// Bucket-scoped R2 tokens can't ListBuckets/CreateBucket; skip
			// rclone's destination-bucket existence check.
			"--s3-no-check-bucket",
			// Line-based per-file logging; --progress redraws with \r and
			// fights the [label] prefixer.
			"-v",
		],
		{
			label: "rclone",
			color: "green",
			env: {
				...process.env,
				...rcloneRemoteEnv(
					"PRODR2",
					creds.accountId,
					creds.prodKeyId,
					creds.prodSecret,
				),
				...rcloneRemoteEnv(
					"STAGINGR2",
					creds.accountId,
					creds.stagingKeyId,
					creds.stagingSecret,
				),
			},
		},
	);
	if (code !== 0) {
		throw new Error(`rclone sync failed with exit code ${code}`);
	}
}
