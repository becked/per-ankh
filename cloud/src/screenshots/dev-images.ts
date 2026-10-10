// Local-only: serve a screenshot's bytes out of the dev R2 bucket.
//
// WHY THIS EXISTS. In production nothing in this repo serves a screenshot.
// The browser asks img.per-ankh.app for the object key and three zone features
// answer it — the R2 custom domain binding the hostname to the bucket, the
// /cdn-cgi/image/ interception that makes the tile, and the Cache Rule in
// front of both. That is the design: no Worker in the image path, so reads
// cost no invocations and no read budget.
//
// The consequence is that the read path has no local implementation, because
// it has no code. `wrangler dev` simulates the R2 binding, so the WRITE half
// works completely — the upload endpoint stores bytes under .wrangler/state —
// but nothing maps a local hostname to that bucket, there is no local
// transformation layer, and img.per-ankh.app resolves to the real edge from a
// dev machine like anywhere else. So a correct local upload produced a correct
// production URL for an object only the developer's disk had, and the galleries
// rendered 404 placeholders.
//
// This route is the smallest thing that closes that: with SCREENSHOT_BASE_URL
// pointed here (./per-ankh dev passes it), the URLs storage.ts builds resolve
// to the Worker, which streams the object it stored.
//
// IT DOES NOT TRANSFORM. A thumbnail URL is served the ORIGINAL bytes, with
// the transformation options parsed off and discarded. Decoding and
// re-encoding WebP in the Worker would be a lot of non-production code to
// approximate a resampler this will never share, and it would buy nothing:
// the tile's shape is the grid's `aspect-[8/5]` box plus object-cover, so the
// layout is identical either way and only the bytes on the wire differ. What
// stays unverifiable locally is therefore the transformation itself, along with
// the Cache Rule and the purge — all three are zone configuration.

import { SCREENSHOT_KEY_ROOT, type ScreenshotStorageEnv } from "./storage";
import { beginR2Op } from "../log";
import { cloudCorsHeaders, errorResponse, isSecureRequest } from "../util";

export interface DevImagesEnv extends ScreenshotStorageEnv {
	// The same flag that gates the Discord-free dev login, and the same
	// reasoning: prod never sets it. See handleDevLogin in auth.ts.
	DEV_LOGIN?: string;
	ALLOWED_ORIGINS: string;
}

// The leading segment a thumbnail URL carries. Matched so it can be dropped —
// everything after it is the object key.
const TRANSFORM_PREFIX = /^cdn-cgi\/image\/[^/]+\//;

// GET /v1/dev/images/<object key>, where the key may be preceded by the
// thumbnail's /cdn-cgi/image/<options>/ segment.
export async function handleDevScreenshotImage(
	rest: string,
	request: Request,
	env: DevImagesEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);

	// Dark in prod: no flag, or HTTPS. Both conditions, like handleDevLogin —
	// the flag alone would make a mis-set var serve a bucket over the open
	// internet, and this route reads an attacker-supplied key.
	if (!env.DEV_LOGIN || isSecureRequest(request)) {
		return errorResponse("Not found", 404, cors, "NOT_FOUND");
	}

	let key: string;
	try {
		key = decodeURIComponent(rest).replace(TRANSFORM_PREFIX, "");
	} catch {
		return errorResponse("Not found", 404, cors, "NOT_FOUND");
	}
	// Confined to this feature's own prefix. R2 keys are opaque strings with no
	// traversal semantics, so this is not a path-escape guard — it is a guard
	// against the route becoming a general reader of whatever else ends up in
	// the bucket.
	if (!key.startsWith(SCREENSHOT_KEY_ROOT)) {
		return errorResponse("Not found", 404, cors, "NOT_FOUND");
	}

	const endGet = beginR2Op();
	let object: R2ObjectBody | null;
	try {
		object = await env.SCREENSHOT_BUCKET.get(key);
	} finally {
		endGet();
	}
	if (!object) {
		return errorResponse("Not found", 404, cors, "NOT_FOUND");
	}

	// no-store, where prod's Cache Rule sets a 30-day Edge TTL and a 2-hour
	// Browser TTL. Deliberately not an imitation of those: a cached dev image
	// would outlive a delete and make the local gallery disagree with local D1,
	// which is the opposite of what this route is for.
	return new Response(object.body, {
		headers: {
			"Content-Type": object.httpMetadata?.contentType ?? "image/webp",
			"Cache-Control": "no-store",
		},
	});
}
