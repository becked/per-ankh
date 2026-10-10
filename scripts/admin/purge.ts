// Cache purge for the admin CLI (issue #289).
//
// Screenshot objects are public and edge-cached with a 30-day Edge TTL, and no
// Worker sits in the image path — so deleting an object does not stop it being
// served. Every surface that removes one has to purge, and `delete-game` /
// `nuke-user` are surfaces: they delete a game's rows straight out of D1, so
// the Worker's own delete path never runs.
//
// The two inputs come from different places, because they are different kinds
// of thing.
//
// The ZONE ID is read out of cloud/wrangler.toml, the same file the Worker gets
// it from — not asked of the operator. It is committed config, so requiring an
// export would make someone type a value that is sitting in the repo, and a
// mistyped one would purge a zone this app does not own. Read per target, so
// `--staging` resolves [env.staging.vars] exactly as dbName() and r2Bucket()
// resolve their own names.
//
// The TOKEN comes from the environment, because it is a credential and the CLI
// has no secret store of its own; the Worker holds its own copy as a
// `wrangler secret`. Unset, the purge is SKIPPED LOUDLY: the delete still
// happens, and the warning says what is still being served and for how long.
// That is the honest outcome — refusing the delete would leave both the row and
// the image in place, which is worse.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { getEnv } from "../lib/environments";
import { screenshotPublicUrls } from "../../src/lib/screenshots/public-urls";
import { info, warn } from "../lib/format";
import { getTarget } from "./wrangler";

// The API's own ceiling on a purge-by-URL call.
const MAX_URLS_PER_PURGE = 30;

const WRANGLER_TOML = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"cloud/wrangler.toml",
);

// `KEY = "value"` under an exact section header. The same minimal
// line-oriented scan the deploy preflight's toml checks use
// (scripts/prod/checks/secrets.ts): it understands `[section]` headers and
// `KEY = value` lines, which is all wrangler.toml's flat shape needs. Keep that
// file flat — an inline table for vars would be missed here too.
function tomlVar(text: string, header: string, key: string): string | null {
	let inSection = false;
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.startsWith("#")) continue;
		if (trimmed.startsWith("[")) {
			inSection = trimmed === header;
			continue;
		}
		if (!inSection) continue;
		const m = trimmed.match(/^(\w+)\s*=\s*"([^"]*)"/);
		if (m && m[1] === key) return m[2] === "" ? null : m[2];
	}
	return null;
}

function zoneId(): string | null {
	const header = getTarget() === "staging" ? "[env.staging.vars]" : "[vars]";
	try {
		return tomlVar(
			readFileSync(WRANGLER_TOML, "utf8"),
			header,
			"CLOUDFLARE_ZONE_ID",
		);
	} catch {
		return null;
	}
}

function imageHost(): string {
	const target = getTarget();
	return getEnv(target === "staging" ? "staging" : "prod").imageHost;
}

// Both cached URLs of every one of these object keys, through the same
// builders the Worker uses — so the CLI purges the addresses production
// actually serves rather than a second guess at them.
export function screenshotUrlsFor(r2Keys: string[]): string[] {
	const host = imageHost();
	return r2Keys.flatMap((key) => screenshotPublicUrls(host, key));
}

// Purge a set of URLs from the edge. Reports rather than throws: the deletes
// these follow have already happened and are not undoable.
export async function purgeUrls(urls: string[]): Promise<void> {
	if (urls.length === 0) return;

	const zone = zoneId();
	const token = process.env.CLOUDFLARE_PURGE_TOKEN;
	if (!zone || !token) {
		// Named separately, because the two have different fixes: one is a
		// missing export, the other an unset var in a committed file.
		const missing = [
			!token && "CLOUDFLARE_PURGE_TOKEN (export it in this shell)",
			!zone &&
				"CLOUDFLARE_ZONE_ID (unset in cloud/wrangler.toml for this target)",
		].filter(Boolean);
		warn(
			`Not purging ${urls.length} screenshot URL(s) — missing ${missing.join(" and ")}. ` +
				`The objects are deleted, but the edge will keep serving them for ` +
				`up to 30 days (Edge TTL). Fix and re-run, or purge by URL from the ` +
				`Cloudflare dashboard.`,
		);
		return;
	}

	info(`Purging ${urls.length} screenshot URL(s) from the edge...`);
	let purged = 0;
	for (let i = 0; i < urls.length; i += MAX_URLS_PER_PURGE) {
		const files = urls.slice(i, i + MAX_URLS_PER_PURGE);
		try {
			const res = await fetch(
				`https://api.cloudflare.com/client/v4/zones/${zone}/purge_cache`,
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${token}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ files }),
				},
			);
			if (res.ok) {
				purged += files.length;
			} else {
				warn(
					`Purge failed (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`,
				);
			}
		} catch (e) {
			warn(`Purge failed: ${String(e)}`);
		}
	}
	info(`Purge: ok=${purged} of ${urls.length}`);
}
