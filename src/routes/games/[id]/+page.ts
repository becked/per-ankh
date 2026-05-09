import { error, redirect } from "@sveltejs/kit";
import {
	cloudApi,
	ApiError,
	UnauthorizedError,
	type CollectionInfo,
	type GameListItem,
} from "$lib/api-cloud";
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
	let game;
	try {
		game = await cloudApi.getGame(params.id, { fetch });
	} catch (err) {
		if (err instanceof UnauthorizedError) {
			throw redirect(
				303,
				`/login?next=${encodeURIComponent(url.pathname)}`,
			);
		}
		return mapApiErrorToPage(err);
	}

	const isOwner = "is_public" in game;

	// Sidebar data — only meaningful when the viewer owns this game.
	// Non-owners (anonymous or signed-in guests on a public game) don't
	// see the sidebar, so skip the fetches. Anonymous owners can't exist
	// (ownership requires a session), so the listGames 401 path is gone.
	// Other errors propagate so real outages aren't masked.
	let games: GameListItem[] | undefined;
	let collections: CollectionInfo[] | undefined;
	let publicCount = 0;
	if (isOwner) {
		try {
			const [gamesRes, collectionsRes] = await Promise.all([
				cloudApi.listGames({ fetch }),
				cloudApi.listCollections({ fetch }),
			]);
			games = gamesRes.games;
			collections = collectionsRes.collections;
			publicCount = collectionsRes.public_count;
		} catch (err) {
			if (!(err instanceof UnauthorizedError)) throw err;
		}
	}

	return { game, isOwner, games, collections, publicCount };
};
