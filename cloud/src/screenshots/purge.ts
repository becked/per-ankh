// Cache purge for the screenshot image hosts (issue #289, build-order step 5).
//
// Pulled ahead of the admin queue that first needed it, because step 5 ships
// the readers: until something renders a screenshot no URL is reachable and
// nothing is cached, and from then on every path that removes one has to clear
// the edge as well as the bucket.
//
// Why it exists at all: no Worker sits in the image path. Every object is
// public and served from an R2 custom domain with a 30-day Edge TTL, so there
// is no per-request gate to re-evaluate after a row is hidden or deleted —
// the edge keeps serving the copy it holds. Purge-by-URL is the only
// invalidation there is.
//
// Deliberately not a module that knows what a screenshot is: it takes URLs.
// Which URLs one screenshot has is storage.ts's answer (the object plus its
// one thumbnail transformation), and keeping that out of here is what lets the
// owner's delete, the game delete and the admin hide share one list.

import { logError } from "../log";

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

// The API's own ceiling on a purge-by-URL call. A game delete clears two URLs
// per screenshot against a 5-per-game cap, so a single game is well inside it
// — the chunking is for the list-by-prefix case, which can turn up objects no
// row names.
const MAX_URLS_PER_PURGE = 30;

// Purge a set of URLs, chunked, logging rather than throwing.
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
			if (!res.ok) {
				// The body carries Cloudflare's own error array, which is the
				// difference between a scope problem and a bad URL. Bounded,
				// because an error body is not a size we control.
				const detail = (await res.text()).slice(0, 500);
				logError("screenshot_purge_failed", new Error(`HTTP ${res.status}`), {
					...context,
					urls: files.length,
					detail,
				});
			}
		} catch (e) {
			logError("screenshot_purge_failed", e, {
				...context,
				urls: files.length,
			});
		}
	}
}
