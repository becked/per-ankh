// Cache purge for the admin CLI (issue #289).
//
// Screenshot objects are public and edge-cached with a 30-day Edge TTL, and no
// Worker sits in the image path — so deleting an object does not stop it being
// served. Every surface that removes one has to purge, and `delete-game` /
// `nuke-user` are surfaces: they delete a game's rows straight out of D1, so
// the Worker's own delete path never runs.
//
// The call is purgeCachedUrls (src/lib/screenshots/purge-cache.ts), shared with
// the Worker, which makes the same request against the same zone. What is here
// is the CLI's half: where the two inputs come from, and what a failure reads
// like on a terminal.
//
// Those inputs come from different places, because they are different kinds of
// thing.
//
// The ZONE ID is committed config, read per target out of the shared
// environment table (scripts/lib/environments.ts) exactly as dbName(),
// r2Bucket() and the image host are — not asked of the operator, because
// requiring an export would make someone type a value that is sitting in the
// repo, and a mistyped one would purge a zone this app does not own.
//
// The TOKEN comes from the environment, because it is a credential and the CLI
// has no secret store of its own; the Worker holds its own copy as a
// `wrangler secret`. Unset, the purge is SKIPPED LOUDLY: the delete still
// happens, and the warning says what is still being served and for how long.
// That is the honest outcome — refusing the delete would leave both the row and
// the image in place, which is worse.

import { getEnv, type CloudEnv } from "../lib/environments";
import {
	purgeCachedUrls,
	type PurgeChunkResult,
} from "../../src/lib/screenshots/purge-cache";
import { screenshotPublicUrls } from "../../src/lib/screenshots/public-urls";
import { info, warn } from "../lib/format";
import { getTarget } from "./wrangler";

// Per-target facts, resolved the way wrangler.ts resolves its own: the local
// .wrangler state simulates prod, so `local` reads the prod entry.
function cloudEnv(): CloudEnv {
	return getEnv(getTarget() === "staging" ? "staging" : "prod");
}

// Both cached URLs of every one of these object keys, through the same
// builders the Worker uses — so the CLI purges the addresses production
// actually serves rather than a second guess at them.
export function screenshotUrlsFor(r2Keys: string[]): string[] {
	const host = cloudEnv().imageHost;
	return r2Keys.flatMap((key) => screenshotPublicUrls(host, key));
}

// The two failures read differently because they have different fixes: a
// refusal is the API answering (a token without Cache Purge on the zone), an
// unreachable chunk is the call never landing.
function describe(
	result: Exclude<PurgeChunkResult, { kind: "purged" }>,
): string {
	return result.kind === "refused"
		? `Purge failed (HTTP ${result.status}): ${result.detail}`
		: `Purge failed: ${String(result.error)}`;
}

// Purge a set of URLs from the edge. Reports rather than throws: the deletes
// these follow have already happened and are not undoable.
export async function purgeUrls(urls: string[]): Promise<void> {
	if (urls.length === 0) return;

	const token = process.env.CLOUDFLARE_PURGE_TOKEN;
	if (!token) {
		warn(
			`Not purging ${urls.length} screenshot URL(s) — CLOUDFLARE_PURGE_TOKEN ` +
				`is unset (export it in this shell). The objects are deleted, but the ` +
				`edge will keep serving them for up to 30 days (Edge TTL). Fix and ` +
				`re-run, or purge by URL from the Cloudflare dashboard.`,
		);
		return;
	}

	info(`Purging ${urls.length} screenshot URL(s) from the edge...`);
	const results = await purgeCachedUrls({
		zoneId: cloudEnv().zoneId,
		token,
		urls,
	});
	let purged = 0;
	for (const result of results) {
		if (result.kind === "purged") purged += result.files.length;
		else warn(describe(result));
	}
	info(`Purge: ok=${purged} of ${urls.length}`);
}
