import { error, redirect } from "@sveltejs/kit";
import {
	cloudApi,
	ApiError,
	UnauthorizedError,
} from "$lib/api-cloud";
import type { PageLoad } from "./$types";

// Game detail load — owner first, public fallback, login redirect last.
//
//   1. Try the authenticated GET. Owner: 200 + full payload.
//   2. On 401 (no session, or session-but-not-owner-of-private-game),
//      try the public GET. Public game: 200 + PII-stripped payload.
//   3. Public path 401 means the game is genuinely private — redirect
//      to /login?next=... so the user can sign in and try again as owner.
//   4. 404 anywhere → standard 404 page.
//
// Returns `isOwner` so the page can conditionally render the visibility
// toggle and other owner-only affordances.
// Translate the API's `ApiError` into the right SvelteKit response —
// either a typed `error()` page or a re-thrown unhandled. Centralized so
// owner and public paths handle the same statuses identically.
function mapApiErrorToPage(err: unknown): never {
	if (err instanceof ApiError && err.status === 404) {
		throw error(404, "Game not found");
	}
	if (err instanceof ApiError && err.status === 403) {
		throw error(403, "You don't have access to this game");
	}
	if (err instanceof ApiError && err.status === 429) {
		// Per-IP read limiter is exhausted. Surface a real 429 page rather
		// than a 500 — re-render is the user's only remedy, and this lets
		// scrapers/CDNs respect the rate limit instead of caching a 500.
		throw error(429, "Too many requests. Try again in a few minutes.");
	}
	throw err;
}

export const load: PageLoad = async ({ params, fetch, url }) => {
	try {
		const game = await cloudApi.getGame(params.id, { fetch });
		return { game, isOwner: true };
	} catch (err) {
		if (err instanceof UnauthorizedError) {
			try {
				const game = await cloudApi.getPublicGame(params.id, { fetch });
				return { game, isOwner: false };
			} catch (publicErr) {
				if (publicErr instanceof UnauthorizedError) {
					throw redirect(
						303,
						`/login?next=${encodeURIComponent(url.pathname)}`,
					);
				}
				return mapApiErrorToPage(publicErr);
			}
		}
		return mapApiErrorToPage(err);
	}
};
