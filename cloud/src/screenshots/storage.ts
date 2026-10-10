// Where a screenshot's bytes live, how they are addressed, and how they are
// removed from both the bucket and the edge.
//
// Separate from the handlers because the game-delete path in games.ts is also
// a caller: a game's screenshots are its own, so they go when it does, and
// that cleanup has to name the objects the same way the upload did.
//
// Every public URL a reader can produce is built here, and that is what makes
// removal single-valued: an object has two cached addresses — itself and the
// one thumbnail transformation of it — so a delete that purged only the first
// would leave the tile rendering from the edge.

import { purgeUrls, type ScreenshotPurgeEnv } from "./purge";
import { beginR2Op, logError } from "../log";
import {
	screenshotObjectUrl,
	screenshotPublicUrls as publicUrlsFor,
	screenshotThumbnailUrl,
} from "../../../src/lib/screenshots/public-urls";

export interface ScreenshotStorageEnv extends ScreenshotPurgeEnv {
	// The feature's own bucket, deliberately NOT per-ankh-shares: a public
	// custom domain over that bucket would expose every save blob and ZIP by
	// key.
	SCREENSHOT_BUCKET: R2Bucket;
	// Public base of the R2 custom domain in front of it — img.per-ankh.app
	// in prod, img.staging.per-ankh.app in staging. A var because the host
	// differs per environment, and the URL is built server-side because the
	// key layout is the Worker's.
	SCREENSHOT_BASE_URL: string;
}

// screenshots/{game_id}/{screenshot_id}.webp — one prefix per game, which is
// what lets the game-delete path list and delete by prefix instead of naming
// keys it would have to read from D1 first.
//
// The root is named because a third reader wants it as a root rather than as
// part of a key: the dev image route confines itself to this feature's own
// objects (dev-images.ts).
export const SCREENSHOT_KEY_ROOT = "screenshots/";

export function screenshotKey(gameId: string, screenshotId: string): string {
	return `${SCREENSHOT_KEY_ROOT}${gameId}/${screenshotId}.webp`;
}

export function gameScreenshotPrefix(gameId: string): string {
	return `${SCREENSHOT_KEY_ROOT}${gameId}/`;
}

// The URL shapes themselves live in $lib/screenshots/public-urls, read by the
// admin CLI as well — see that module's header. What these three add is the
// binding of the base URL to this environment's var, which is the only part
// the Worker owns.
export function screenshotUrl(
	env: ScreenshotStorageEnv,
	r2Key: string,
): string {
	return screenshotObjectUrl(env.SCREENSHOT_BASE_URL, r2Key);
}

export function screenshotThumbUrl(
	env: ScreenshotStorageEnv,
	r2Key: string,
): string {
	return screenshotThumbnailUrl(env.SCREENSHOT_BASE_URL, r2Key);
}

// Every cached address of one screenshot. The readers serve both and the purge
// clears both, from one list, so neither can be forgotten at one of the three
// call sites that remove a screenshot (the owner's delete, the game delete,
// and step 6's admin hide).
export function screenshotPublicUrls(
	env: ScreenshotStorageEnv,
	r2Key: string,
): string[] {
	return publicUrlsFor(env.SCREENSHOT_BASE_URL, r2Key);
}

// One object, deleted. Used by the upload path when the D1 insert fails after
// the put: the cleanup failing is logged as an `orphaned_blob` rather than
// swallowed, because nothing else will ever notice the object.
//
// No purge: this runs on bytes that were never served, so there is nothing
// cached to clear. Removing a screenshot that readers could reach goes through
// removeScreenshot below.
export async function deleteScreenshotObject(
	env: ScreenshotStorageEnv,
	r2Key: string,
	screenshotId: string,
): Promise<void> {
	const endDelete = beginR2Op();
	try {
		await env.SCREENSHOT_BUCKET.delete(r2Key);
	} catch (e) {
		logError("orphaned_blob", e, { screenshot_id: screenshotId });
	} finally {
		endDelete();
	}
}

// One screenshot removed from everywhere a viewer can reach it: the object out
// of R2, then both of its URLs out of the edge cache.
//
// The purge is not optional bookkeeping. These objects are public and
// edge-cached with a 30-day Edge TTL, and no Worker sits in the image path, so
// there is no per-request gate to re-evaluate — deleting the object alone
// leaves the edge serving the copy it already has. That is unlike the game
// blobs, where authorization is a fresh D1 read ahead of the cache
// (blob-cache.ts) and so needs no invalidation.
//
// Browser TTL is the part no purge can reach: a viewer who already loaded the
// image can keep seeing it for up to two hours. That is why the Cache Rule
// sets it to 7200 rather than something longer, and why the uploader's own
// tile is removed optimistically.
export async function removeScreenshot(
	env: ScreenshotStorageEnv,
	r2Key: string,
	screenshotId: string,
): Promise<void> {
	await deleteScreenshotObject(env, r2Key, screenshotId);
	await purgeUrls(env, screenshotPublicUrls(env, r2Key), {
		screenshot_id: screenshotId,
	});
}

// Every screenshot of one game, out of the bucket and out of the edge. The D1
// rows cascade with the game; these objects don't, and an orphan here is a
// public image with no row to find it from.
//
// Listed rather than read from D1 because the list is what R2 actually holds:
// a put whose insert failed, or a row deleted some other way, leaves an object
// the table can't name. The list is also what the purge is built from, for the
// same reason — purging the rows' URLs would miss exactly those objects.
//
// The purge runs on the keys that were collected even if a delete threw: an
// object that is still in the bucket is served from the edge either way, and
// re-purging one that is already gone costs nothing.
export async function deleteGameScreenshots(
	env: ScreenshotStorageEnv,
	gameId: string,
): Promise<void> {
	const prefix = gameScreenshotPrefix(gameId);
	const purgeable: string[] = [];
	const endDeletes = beginR2Op();
	try {
		let cursor: string | undefined;
		do {
			const listed = await env.SCREENSHOT_BUCKET.list({ prefix, cursor });
			const keys = listed.objects.map((o) => o.key);
			for (const key of keys) purgeable.push(...screenshotPublicUrls(env, key));
			if (keys.length > 0) await env.SCREENSHOT_BUCKET.delete(keys);
			cursor = listed.truncated ? listed.cursor : undefined;
		} while (cursor);
	} catch (e) {
		// Same stance as the game blob's own delete: logged, not fatal. The
		// D1 cascade still runs, so the game goes away either way.
		logError("r2_delete_failed", e, { game_id: gameId });
	} finally {
		endDeletes();
	}
	if (purgeable.length > 0) {
		await purgeUrls(env, purgeable, { game_id: gameId });
	}
}
