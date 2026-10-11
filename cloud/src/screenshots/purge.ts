// Cache purge for the screenshot image hosts (issue #289, build-order step 5).
//
// Pulled ahead of the admin queue that first needed it, because step 5 ships
// the readers: until something renders a screenshot no URL is reachable and
// nothing is cached, and from then on every path that removes one has to clear
// the edge as well as the bucket.
//
// The call itself is purgeCachedUrls (src/lib/screenshots/purge-cache.ts),
// shared with the admin CLI, which makes the same request against the same
// zone from a Node script with no bindings. What is here is the Worker's half:
// where the credentials come from, and what a failure reads like in the log.
//
// Deliberately not a module that knows what a screenshot is: it takes URLs.
// Which URLs one screenshot has is storage.ts's answer (the object plus its
// one thumbnail transformation), and keeping that out of here is what lets the
// owner's delete, the game delete and the admin takedown share one list.

import { logError } from "../log";
import { purgeCachedUrls } from "../../../src/lib/screenshots/purge-cache";

export interface ScreenshotPurgeEnv {
	// The zone the image hosts live in. A var rather than a secret — a zone id
	// is an identifier, not a credential — but still per-deploy, so it is
	// declared in both wrangler blocks.
	CLOUDFLARE_ZONE_ID?: string;
	// A Cache Purge token scoped to the per-ankh.app zone. One token covers
	// both image hostnames, because purge permissions are zone-scoped and both
	// hosts live in that zone.
	CLOUDFLARE_PURGE_TOKEN?: string;
}

// Purge a set of URLs, logging rather than throwing.
//
// Logged in the `orphaned_blob` style, and for the same reason: nothing else
// will ever notice. A failed purge means a deleted or hidden image is still
// being served, which is the one part of a removal that has no other symptom
// — the row is gone, the object is gone, and the picture is still there. So
// the caller is never failed (the removal it was part of has already
// happened and is not undoable), and the line in the log is what says so.
//
// An unconfigured purge is a failed purge in effect, so it logs too, under its
// own name: "nobody set the token" and "the API refused" need different fixes.
export async function purgeUrls(
	env: ScreenshotPurgeEnv,
	urls: string[],
	context: Record<string, unknown>,
): Promise<void> {
	if (urls.length === 0) return;
	const zoneId = env.CLOUDFLARE_ZONE_ID;
	const token = env.CLOUDFLARE_PURGE_TOKEN;
	if (!zoneId || !token) {
		logError(
			"screenshot_purge_unconfigured",
			new Error("missing zone or token"),
			{
				...context,
				urls: urls.length,
				has_zone: Boolean(zoneId),
				has_token: Boolean(token),
			},
		);
		return;
	}

	const results = await purgeCachedUrls({ zoneId, token, urls });
	for (const result of results) {
		if (result.kind === "purged") continue;
		// `detail` carries Cloudflare's own error array, which is the
		// difference between a scope problem and a bad URL; an unreachable
		// chunk has the thrown error instead, so its stack survives into the
		// log.
		if (result.kind === "refused") {
			logError("screenshot_purge_failed", new Error(`HTTP ${result.status}`), {
				...context,
				urls: result.files.length,
				detail: result.detail,
			});
		} else {
			logError("screenshot_purge_failed", result.error, {
				...context,
				urls: result.files.length,
			});
		}
	}
}
