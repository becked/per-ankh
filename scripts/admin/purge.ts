// Cache purge for the admin CLI (issue #289).
//
// Screenshot objects are public and edge-cached with a 30-day Edge TTL, and no
// Worker sits in the image path — so deleting an object does not stop it being
// served. Every surface that removes one has to purge, and `delete-game` /
// `nuke-user` are surfaces: they delete a game's rows straight out of D1, so
// the Worker's own delete path never runs.
//
// Credentials come from the operator's environment rather than from a file in
// the repo, because the token is a credential and the CLI has no secret store
// of its own. The Worker reads the same pair as a var and a `wrangler secret`.
// Unset, the purge is SKIPPED LOUDLY: the delete still happens, and the
// warning says what is still being served and for how long. That is the honest
// outcome — refusing the delete would leave both the row and the image in
// place, which is worse.

import { getEnv } from "../lib/environments";
import { screenshotPublicUrls } from "../../src/lib/screenshots/public-urls";
import { info, warn } from "../lib/format";
import { getTarget } from "./wrangler";

// The API's own ceiling on a purge-by-URL call.
const MAX_URLS_PER_PURGE = 30;

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

	const zoneId = process.env.CLOUDFLARE_ZONE_ID;
	const token = process.env.CLOUDFLARE_PURGE_TOKEN;
	if (!zoneId || !token) {
		warn(
			`Not purging ${urls.length} screenshot URL(s): CLOUDFLARE_ZONE_ID and ` +
				`CLOUDFLARE_PURGE_TOKEN must both be set in the environment. ` +
				`The objects are deleted, but the edge will keep serving them for ` +
				`up to 30 days (Edge TTL). Export both and re-run the purge, or ` +
				`purge by URL from the Cloudflare dashboard.`,
		);
		return;
	}

	info(`Purging ${urls.length} screenshot URL(s) from the edge...`);
	let purged = 0;
	for (let i = 0; i < urls.length; i += MAX_URLS_PER_PURGE) {
		const files = urls.slice(i, i + MAX_URLS_PER_PURGE);
		try {
			const res = await fetch(
				`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`,
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
