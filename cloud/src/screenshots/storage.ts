// Where a screenshot's bytes live, and how they are addressed and removed.
//
// Separate from the handlers because the game-delete path in games.ts is also
// a caller: a game's screenshots are its own, so they go when it does, and
// that cleanup has to name the objects the same way the upload did.

import { beginR2Op, logError } from "../log";

export interface ScreenshotStorageEnv {
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
export function screenshotKey(gameId: string, screenshotId: string): string {
	return `screenshots/${gameId}/${screenshotId}.webp`;
}

export function gameScreenshotPrefix(gameId: string): string {
	return `screenshots/${gameId}/`;
}

export function screenshotUrl(
	env: ScreenshotStorageEnv,
	r2Key: string,
): string {
	return `${env.SCREENSHOT_BASE_URL.replace(/\/+$/, "")}/${r2Key}`;
}

// One object, deleted. Used by the upload path when the D1 insert fails after
// the put: the cleanup failing is logged as an `orphaned_blob` rather than
// swallowed, because nothing else will ever notice the object.
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

// Every screenshot of one game, deleted by prefix. The D1 rows cascade with
// the game; these objects don't, and an orphan here is a public image with no
// row to find it from.
//
// Listed rather than read from D1 because the list is what R2 actually holds:
// a put whose insert failed, or a row deleted some other way, leaves an object
// the table can't name.
export async function deleteGameScreenshots(
	env: ScreenshotStorageEnv,
	gameId: string,
): Promise<void> {
	const prefix = gameScreenshotPrefix(gameId);
	const endDeletes = beginR2Op();
	try {
		let cursor: string | undefined;
		do {
			const listed = await env.SCREENSHOT_BUCKET.list({ prefix, cursor });
			const keys = listed.objects.map((o) => o.key);
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
}
