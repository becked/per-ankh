import { error, redirect } from "@sveltejs/kit";
import {
	cloudApi,
	ApiError,
	UnauthorizedError,
	type CollectionInfo,
	type GameListItem,
} from "$lib/api-cloud";
import type { PageMeta } from "$lib/page-meta";
import { formatEnum } from "$lib/utils/formatting";
import type { PageLoad } from "./$types";

// Build the OG/Twitter description from match metadata. Same shape that
// used to live inline in +page.svelte's <svelte:head>; moved here so
// social-link unfurls work without the page mounting.
function buildMeta(game: {
	game_details: Record<string, unknown>;
	display_name?: string | null;
}): PageMeta {
	const gd = game.game_details as {
		game_name?: string | null;
		winner_civilization?: string | null;
		winner_name?: string | null;
		winner_victory_type?: string | null;
		total_turns?: number;
	};
	const parts: string[] = [];
	if (gd.winner_civilization) {
		parts.push(formatEnum(gd.winner_civilization, "NATION_"));
	} else if (gd.winner_name) {
		parts.push(gd.winner_name);
	}
	if (gd.winner_victory_type) {
		const v = formatEnum(gd.winner_victory_type, "VICTORY_");
		parts.push(`won by ${v}`);
	}
	if (gd.total_turns != null) parts.push(`turn ${gd.total_turns}`);
	const description =
		parts.length > 0 ? parts.join(", ") : "An Old World save game on Per-Ankh.";
	// Prefer the owner's renamed title for the social-share title so
	// unfurled links match what the user sees in the app.
	const gameName = game.display_name ?? gd.game_name ?? "Old World game";
	return { title: `${gameName} — Per-Ankh`, description };
}

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
			throw redirect(303, `/?next=${encodeURIComponent(url.pathname)}`);
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
	let gamesTotal = 0;
	let collections: CollectionInfo[] | undefined;
	let publicCount = 0;
	const SIDEBAR_PAGE_SIZE = 50;
	if (isOwner) {
		try {
			const [gamesRes, collectionsRes] = await Promise.all([
				cloudApi.listGames({ fetch, limit: SIDEBAR_PAGE_SIZE, offset: 0 }),
				cloudApi.listCollections({ fetch }),
			]);
			games = gamesRes.games;
			gamesTotal = gamesRes.total;
			collections = collectionsRes.collections;
			publicCount = collectionsRes.public_count;
		} catch (err) {
			if (!(err instanceof UnauthorizedError)) throw err;
		}
	}

	// Tournament link: cheap public read that returns the linked
	// tournament/match (or null) for any game. Used by the preTabs banner
	// on GameDetailView. Failure here just hides the banner — don't block
	// the page render.
	let tournamentLink = null;
	try {
		const linkRes = await cloudApi.getGameTournamentLink(params.id, { fetch });
		tournamentLink = linkRes.link;
	} catch {
		// fall through
	}

	return {
		game,
		isOwner,
		games,
		gamesTotal,
		gamesPageSize: SIDEBAR_PAGE_SIZE,
		collections,
		publicCount,
		tournamentLink,
		meta: buildMeta(game),
	};
};
