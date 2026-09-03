import { error, redirect } from "@sveltejs/kit";
import {
	cloudApi,
	ApiError,
	UnauthorizedError,
	type CollectionInfo,
} from "$lib/api-cloud";
import type { PageMeta } from "$lib/page-meta";
import { formatEnum, formatGameTitle, nationName } from "$lib/utils/formatting";
import { rethrowRateLimit } from "$lib/utils/load-errors";
import { loginBounce } from "$lib/utils/safe-next";
import type { PageLoad } from "./$types";

// Build the OG/Twitter description from match metadata. Same shape that
// used to live inline in +page.svelte's <svelte:head>; moved here so
// social-link unfurls work without the page mounting.
function buildMeta(game: {
	game_details: Record<string, unknown>;
	display_name?: string | null;
	user_nation?: string | null;
}): PageMeta {
	const gd = game.game_details as {
		game_name?: string | null;
		players?: Array<{ is_human?: boolean; nation?: string | null }>;
		match_id?: number;
		winner_civilization?: string | null;
		winner_name?: string | null;
		winner_victory_type?: string | null;
		total_turns?: number;
	};
	const parts: string[] = [];
	if (gd.winner_civilization) {
		parts.push(nationName(gd.winner_civilization));
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
	// Derive the social-share title from the same helper the on-page title
	// uses (+page.svelte), so the <head>/OG title matches what the user
	// sees. This handles the owner rename, the empty / auto-generated
	// "GameN" save name (falling through to "{Nation} - {Turns} turns"),
	// and the bare-fallback cases uniformly — the prior ad-hoc `??` chain
	// passed empty-string save names straight through, yielding a blank
	// " - Per-Ankh" title.
	const gameName = formatGameTitle({
		display_name: game.display_name ?? null,
		game_name: gd.game_name ?? null,
		save_owner_nation:
			game.user_nation ?? gd.players?.find((p) => p.is_human)?.nation ?? null,
		total_turns: gd.total_turns ?? null,
		match_id: gd.match_id ?? 0,
	});
	return { title: `${gameName} - Per-Ankh`, description };
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
	// Per-IP read limiter exhausted — one shared rule across every
	// rate-limited loader.
	rethrowRateLimit(err);
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
	// Start the tournament-link read before awaiting the game. It takes only
	// params.id and reads nothing from the game payload, so the sequence these
	// two used to run in was a false dependency — it charged the page the link
	// handler's D1 round trips *after* the game read's instead of alongside
	// them. The .catch() is attached here rather than at the await below so a
	// getGame throw can't leave this promise rejecting unhandled.
	const linkPromise = cloudApi
		.getGameTournamentLink(params.id, { fetch })
		.then((res) => res.link)
		.catch(() => null);
	// Same shape for the challenge link — a game is a run of at most one
	// challenge, and the banner/breadcrumb only need the number and rank.
	const challengeLinkPromise = cloudApi
		.getGameChallengeLink(params.id, { fetch })
		.then((res) => res.link)
		.catch(() => null);

	let game;
	try {
		game = await cloudApi.getGame(params.id, { fetch });
	} catch (err) {
		if (err instanceof UnauthorizedError) {
			throw redirect(303, loginBounce(url));
		}
		return mapApiErrorToPage(err);
	}

	const isOwner = "is_public" in game;

	// Collections power the owner's move-to-collection action. Only
	// meaningful when the viewer owns this game; non-owners don't see the
	// action. Anonymous owners can't exist (ownership requires a session),
	// so the 401 path is gone. Other errors propagate so real outages
	// aren't masked. (The games list is no longer loaded here — the
	// per-game sidebar was removed; browsing lives on /users/[id]?tab=games.)
	let collections: CollectionInfo[] | undefined;
	if (isOwner) {
		try {
			const collectionsRes = await cloudApi.listCollections({ fetch });
			collections = collectionsRes.collections;
		} catch (err) {
			if (!(err instanceof UnauthorizedError)) throw err;
		}
	}

	// Tournament link: cheap public read that returns the linked
	// tournament/match (or null) for any game. Used by the preTabs banner
	// on GameDetailView. Failure here just hides the banner — don't block
	// the page render. Issued above, concurrently with the game read.
	const tournamentLink = await linkPromise;
	const challengeLink = await challengeLinkPromise;

	return {
		game,
		isOwner,
		collections,
		tournamentLink,
		challengeLink,
		meta: buildMeta(game),
	};
};
