// GET /v1/games/:id/card.png — the link-preview image for one public game.
//
// What a game's `og:image` points at (src/routes/games/[id]/+layout.ts). The
// URL carries `?v=<updated_at>`, so a card is immutable for its version and
// the TTL below can be long; `games.updated_at` is bumped on every mutation
// that can change what the card draws, the admin reindex included.
//
// On the API Worker rather than the frontend one, because this is a read of
// three D1 tables and D1 is what the API Worker is placement-pinned next to.
// The frontend Worker would have to ask for the payload over HTTP, and
// pinning *it* would drag static-asset serving to ENAM.
//
// This is the one route a link-preview crawler fetches directly. Everywhere
// else Discord arrives as an SSR subrequest whose User-Agent is deliberately
// not forwarded (see the trusted-frontend note in util.ts), so `isScraperUA`
// has never fired in production; here it will, and the exemption it grants is
// the point — refusing a crawler is refusing the unfurl.

import {
	assemblePublicGameCards,
	type GamesEnv,
	type PublicGameCardRow,
} from "../games";
import { displayNameSql } from "../identity";
import {
	ceilingFrom,
	enforceReadRateLimit,
	type ReadBudget,
} from "../read-budget";
import { cloudCorsHeaders, errorResponse } from "../util";
import { buildCardSvg } from "./card-svg";
import { renderCardPng } from "./raster";

// Its own budget rather than a share of `anon_read`. The two populations are
// different: `anon_read` meters humans reading /games/[id], and this meters
// whatever fetched a URL someone pasted into a chat. Pooling them would let a
// link going around a Discord server decide when the game pages start
// refusing, and vice versa — the same argument tournament/limits.ts makes.
// Set high for the same reason SCREENSHOT_VIEW_PER_HOUR is: one card is one
// request, it is behind a long shared-cache TTL, and when the budget does
// fire the unfurl loses its picture rather than the page failing.
//
// The default only — read the effective ceiling with ogCardViewPerHour().
export const OG_CARD_VIEW_PER_HOUR = 600;

export function ogCardViewPerHour(env: GamesEnv): number {
	return ceilingFrom(
		env.OG_CARD_VIEW_PER_HOUR,
		OG_CARD_VIEW_PER_HOUR,
		"OG_CARD_VIEW_PER_HOUR",
	);
}

const CARD_BUDGET: ReadBudget = {
	eventType: "og_card_view",
	message: "Rate limit exceeded. Try again later.",
	code: "RATE_LIMIT",
};

// A year, in both tiers, versioned by `updated_at` in the query string. Long
// because the URL changes whenever the card would — `games.updated_at` is
// bumped by every writer, the admin reindex included — so an unversioned
// re-fetch could only ever learn that nothing had changed.
//
// Spelled as one string literal rather than interpolated from a number: the
// inventory in shared-cache-routes.test.ts scans source for the directive's
// opening, so a template literal would not be counted as a site at all.
const CARD_CACHE_CONTROL =
	"public, max-age=31536000, s-maxage=31536000, immutable";

export async function handleGameCard(
	gameId: string,
	request: Request,
	env: GamesEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);

	const limited = await enforceReadRateLimit(
		env,
		request,
		cors,
		CARD_BUDGET,
		ogCardViewPerHour(env),
	);
	if (limited) return limited;

	// The feed's game-row query, less the two things that differ:
	//
	//   - no `noChallengeRunsSql`. That predicate keeps the *feed* from being
	//     nothing but challenge runs, which are forced public on upload. A
	//     link to a challenge run's own page still has to unfurl.
	//   - `game_id = ?` instead of the newest-N ordering.
	//
	// `is_public = 1` stays: the URL is fetched with no session by whoever
	// holds it, so a private game has no card. Everything downstream of these
	// rows is shared with the feed (assemblePublicGameCards).
	const row = await env.SHARE_DB.prepare(
		`SELECT g.game_id, g.game_name, g.display_name,
		        COALESCE(g.user_nation, (
		            SELECT ps.nation FROM player_summaries ps
		            WHERE ps.game_id = g.game_id AND ps.is_human = 1
		            ORDER BY ps.player_index ASC LIMIT 1
		        )) AS user_nation,
		        g.user_won,
		        g.winner_nation, g.winner_name, g.victory_type,
		        g.map_size, g.map_class, g.difficulty, g.total_turns,
		        g.save_date, g.created_at,
		        g.user_id AS uploader_user_id,
		        ${displayNameSql("u")} AS uploader_display_name,
		        u.slug AS uploader_slug,
		        u.discord_id AS uploader_discord_id,
		        u.avatar_hash AS uploader_avatar_hash
		 FROM games g
		 JOIN users u ON g.user_id = u.user_id
		 WHERE g.game_id = ? AND g.is_public = 1`,
	)
		.bind(gameId)
		.first<PublicGameCardRow>();
	// 404 rather than 401/403 on a private game: this answers a crawler, which
	// has nothing to do with a login prompt, and the distinction would tell an
	// anonymous caller that a private game by that id exists.
	if (!row) return errorResponse("Not found", 404, cors, "NOT_FOUND");

	const [card] = await assemblePublicGameCards(env.SHARE_DB, [row]);
	const png = await renderCardPng(buildCardSvg(card));

	return new Response(png, {
		status: 200,
		headers: {
			"Content-Type": "image/png",
			"Cache-Control": CARD_CACHE_CONTROL,
			...cors,
			Vary: "Origin",
		},
	});
}
