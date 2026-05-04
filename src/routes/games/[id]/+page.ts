import { error, redirect } from "@sveltejs/kit";
import { cloudApi, ApiError, UnauthorizedError } from "$lib/api-cloud";
import type { PageLoad } from "./$types";

// Translate the API's `ApiError` into the right SvelteKit response —
// either a typed `error()` page or a re-thrown unhandled.
function mapApiErrorToPage(err: unknown): never {
	if (err instanceof ApiError && err.status === 404) {
		throw error(404, "Game not found");
	}
	if (err instanceof ApiError && err.status === 403) {
		throw error(403, "You don't have access to this game");
	}
	if (err instanceof ApiError && err.status === 429) {
		// Per-IP read limiter exhausted. Surface as 429 (not 500) so re-load
		// is the user's only remedy and CDNs respect the limit instead of
		// caching a 500.
		throw error(429, "Too many requests. Try again in a few minutes.");
	}
	throw err;
}

// Game detail load.
//
// The API's `GET /v1/games/:id` is unified — it serves owners (full
// payload, with `is_public` injected) and anonymous viewers of public
// games (PII-stripped, no `is_public`) on the same endpoint. The signal
// for "I'm the owner" is the presence of the `is_public` field on the
// response, since the Worker injects it only when isOwner is true.
//
// 401 here means a genuinely private game viewed without a valid session
// (or signed-in non-owner of a private game gets 403, handled separately
// — anonymous+private is the only 401 case the load needs to redirect on).
export const load: PageLoad = async ({ params, fetch, url }) => {
	try {
		const game = await cloudApi.getGame(params.id, { fetch });
		const isOwner = "is_public" in game;
		return { game, isOwner };
	} catch (err) {
		if (err instanceof UnauthorizedError) {
			throw redirect(
				303,
				`/login?next=${encodeURIComponent(url.pathname)}`,
			);
		}
		return mapApiErrorToPage(err);
	}
};
