// GET /v1/games/:id/card.png — the link-preview image for one public game.
//
// What a game's `og:image` points at (src/routes/games/[id]/+layout.ts). The
// URL carries `?v=<updated_at>&c=<OG_CARD_VERSION>`, so the card at that pair
// never changes and the TTL below can be long. `games.updated_at` is bumped by
// every writer of a game row, the admin reindex included; `c` covers the one
// thing it cannot, a deploy that changed the renderer. Anything else the card
// draws — most visibly the uploader's display name, which `users` refreshes on
// every Discord login — moves neither, and reaches an already-stored card only
// when the game is next written.
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

import { OG_CARD_VERSION } from "../../../src/lib/og-card";
import {
	assemblePublicGameCards,
	publicGameCardSelectSql,
	type GamesEnv,
	type PublicGameCardRow,
} from "../games";
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

// A day at the edge, a year in the browser, and only ever on the canonical
// URL.
//
// The version pair makes the card's *content* immutable: a re-fetch of this
// URL could only ever learn that nothing had changed. What it cannot make
// immutable is whether the game should be served at all. Making a game private
// (handleUpdateGame) or deleting it (handleGameDelete) bumps or drops the row,
// so the next render is a 404 — but the entry stored under the pair that was
// canonical while it was public keeps answering, and neither path purges it.
// Nor could a purge reach every one: each `updated_at` a game has held was its
// own canonical URL and its own stored entry, and nothing records the old ones.
//
// The screenshot objects have the same shape — public, edge-cached, no
// per-request gate — and the repo's answer there is to refuse the unpublish
// outright (games.ts, "a game with screenshots stays public"). That is not
// available here: every public game has a card, so the refusal would be a ban
// on going private.
//
// So the edge TTL is what bounds it, and a day is the window a withdrawn card
// is still served for. The cost is a re-render — ~60 ms and five SELECTs —
// once per cache key per day per cache tier that asks for it. It also caps
// forced re-renders: the scraper-UA exemption (read-budget.ts) is unmetered,
// so a caller claiming to be Discordbot can spend one render per canonical URL
// per day per tier and no more.
//
// `immutable` goes with it, being a promise the shared copy can no longer
// keep. The browser's own year stays: a copy already downloaded belongs to the
// viewer, as it does for any image.
//
// Spelled as one string literal rather than interpolated from a number: the
// inventory in shared-cache-routes.test.ts scans source for the directive's
// opening, so a template literal would not be counted as a site at all.
const CARD_CACHE_CONTROL = "public, max-age=31536000, s-maxage=86400";

// The redirect that sends every other version pair to the canonical one.
// Storable, so a URL doing the rounds in a chat costs one D1 read an hour
// rather than one per fetch, and shorter than the card's own entry, so a game
// written during that hour is picked up by the next crawl.
const REDIRECT_CACHE_CONTROL = "public, max-age=3600, s-maxage=3600";

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

	// The feed's columns and joins (publicGameCardSelectSql), plus the two
	// things that differ here:
	//
	//   - no `noChallengeRunsSql`. That predicate keeps the *feed* from being
	//     nothing but challenge runs, which are forced public on upload. A
	//     link to a challenge run's own page still has to unfurl.
	//   - `game_id = ?` instead of the newest-N ordering.
	//
	// `updated_at` rides along for the canonical-URL check below; the feed has
	// no use for it. `is_public = 1` stays: the URL is fetched with no session
	// by whoever holds it, so a private game has no card. Everything
	// downstream of this row is shared with the feed (assemblePublicGameCards).
	const row = await env.SHARE_DB.prepare(
		`${publicGameCardSelectSql(["g.updated_at"])}
		 WHERE g.game_id = ? AND g.is_public = 1`,
	)
		.bind(gameId)
		.first<PublicGameCardRow & { updated_at: string }>();
	// 404 rather than 401/403 on a private game: this answers a crawler, which
	// has nothing to do with a login prompt, and the distinction would tell an
	// anonymous caller that a private game by that id exists.
	if (!row) return errorResponse("Not found", 404, cors, "NOT_FOUND");

	// Only the canonical query string is rendered. Everything else — a `v` from
	// an embed posted before the last reindex, a missing or stale `c`, a value
	// someone made up, a right pair with a third parameter bolted on — is
	// answered with a redirect to the string this row says is current.
	//
	// Two things turn on that. The read budget above exempts scraper UAs
	// (read-budget.ts), and that test is a prefix match on a header anyone can
	// send, so without this check a caller claiming to be Discordbot could
	// spend ~60 ms of raster per request on an endless supply of fresh cache
	// keys — this is the one exempt route that does real CPU rather than a
	// cheap D1 or R2-cached read. And every URL already in circulation has to
	// keep answering: Discord re-fetches the image for an embed in chat history
	// without re-reading the page's meta tags, so a 404 on a stale `v` would
	// blank embeds that are already posted. A redirect answers both, on the one
	// D1 read already spent.
	//
	// The whole search string is compared, not the two parameters read out of
	// it, because the search string is what the edge keys on: `?v=…&c=1&x=1`
	// and `?v=…&c=1&x=2` carry the canonical pair and are still two cache
	// entries and two renders. A URL the frontend built matches byte for byte
	// — it encodes `v` the same way (gameCardImageUrl in api-cloud.ts) — and
	// anything that doesn't costs one cacheable redirect. No loop is possible:
	// the redirect target is this string, whatever the request carried.
	const url = new URL(request.url);
	const canonicalSearch = `v=${encodeURIComponent(row.updated_at)}&c=${OG_CARD_VERSION}`;
	if (url.search !== `?${canonicalSearch}`) {
		url.search = canonicalSearch;
		return new Response(null, {
			status: 302,
			headers: {
				Location: url.toString(),
				"Cache-Control": REDIRECT_CACHE_CONTROL,
				...cors,
				Vary: "Origin",
			},
		});
	}

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
