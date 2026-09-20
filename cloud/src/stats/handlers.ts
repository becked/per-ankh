// HTTP handlers for the stats endpoints.
//
//   GET /v1/users/:user_id/stats           — user corpus
//   GET /v1/stats                          — global (public) corpus
//   GET /v1/stats/players                  — played-games leaderboard
//   GET /v1/home-summary                   — the home page's slice of the above
//
// The first two resolve corpus → check cache → compute on miss → return
// bundle. The third is not a bundle at all — it counts games played per user
// straight out of D1, uncached — and shares this file for the corpus it reads
// rather than for the shape it returns. The fourth is a trimmed, public
// projection of the second's cached entry that never computes one.

import { CURRENT_PARSER_VERSION } from "../schemas/game";
import { sessionFromRequest } from "../session";
import type { SessionEnv } from "../session";
import { cloudCorsHeaders, errorResponse, jsonResponse } from "../util";
import { buildAvatarUrl } from "../auth";
import { displayNameSql } from "../identity";
import {
	DEFAULT_GLOBAL_PERIOD,
	parseNationParam,
	parsePeriodParam,
	parseScopeParam,
	parseSliceParam,
} from "../games-scope";
import { ceilingFrom, enforceReadRateLimit } from "../read-budget";
import type { ReadBudget } from "../read-budget";
import { logError } from "../log";
import { buildChartBundle } from "./aggregate";
import { getCached, getStaleGlobalCached, putCached } from "./cache";
import type { StatsCacheEnv } from "./cache";
import { buildGlobalSelection } from "./precompute";
import type { PrecomputeEnv } from "./precompute";
import { resolveGlobalCorpus, resolveUserCorpus } from "./resolve";
import type { ChartBundle, ChartBundleCore, UserStatsScope } from "./types";
import type { EventsEnv, QueryableD1 } from "../d1";

export interface UserStatsEnv extends SessionEnv {
	SHARE_DB: QueryableD1;
	SESSIONS_KV: KVNamespace;
	ALLOWED_ORIGINS: string;
}

export interface GlobalStatsEnv extends PrecomputeEnv, EventsEnv {
	ALLOWED_ORIGINS: string;
	// Per-IP hourly ceiling on the /stats read budget. Optional: unset falls
	// back to the constant below. A var rather than a bare const for the same
	// reason the tournament ceilings are — retunable without a redeploy.
	GLOBAL_STATS_VIEW_PER_HOUR?: string;
}

export async function handleUserStats(
	userId: string,
	request: Request,
	env: UserStatsEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);

	if (!/^[A-Za-z0-9_-]{21}$/.test(userId)) {
		return errorResponse("Invalid user_id", 400, cors, "INVALID_USER_ID");
	}

	const session = await sessionFromRequest(env, request);
	const viewerId = session?.data.user_id ?? null;
	const viewerScope: UserStatsScope = viewerId === userId ? "self" : "public";

	const url = new URL(request.url);
	const scope = parseScopeParam(url.searchParams.get("scope"));

	const cacheKey = {
		kind: "user" as const,
		user_id: userId,
		viewerScope,
		scope,
		parser_version: CURRENT_PARSER_VERSION,
	};
	const cached = await getCached<ChartBundle>(env, cacheKey);
	if (cached) {
		return jsonResponse(
			cached as unknown as Record<string, unknown>,
			200,
			cors,
		);
	}

	const corpus = await resolveUserCorpus(env, userId, viewerScope, scope);
	if (!corpus) {
		return errorResponse("User not found", 404, cors, "NOT_FOUND");
	}

	const bundle = await buildChartBundle(
		env,
		corpus,
		CURRENT_PARSER_VERSION,
		"uploader",
	);
	await putCached(env, cacheKey, bundle);
	return jsonResponse(bundle as unknown as Record<string, unknown>, 200, cors);
}

// ---------- GET /v1/stats — the global corpus ----------

// Per-IP budget for the public /stats read, spent one slot per bundle fetched.
//
// Its own budget, deliberately not a share of anon_read: /stats and /games/*
// are different populations, and a shared budget lets whichever is busier
// decide when the other starts refusing — the coupling that took the
// tournament pages down on 2026-08-05. It also ties the abuse ceiling to the
// cold-start ceiling, two knobs that want to move independently.
//
// 600 arrived through the fan-out, not by copying a number across: /stats is
// one read per page load, so 600 is 600 page loads an hour — the same headroom
// TOURNAMENT_LIST_VIEW_PER_HOUR buys at the same number, and the same headroom
// TOURNAMENT_VIEW_PER_HOUR needs 2400 to reach on its four-to-six reads a page.
//
// The default only — read the effective ceiling with globalStatsViewPerHour().
export const GLOBAL_STATS_VIEW_PER_HOUR = 600;

export function globalStatsViewPerHour(env: {
	GLOBAL_STATS_VIEW_PER_HOUR?: string;
}): number {
	return ceilingFrom(
		env.GLOBAL_STATS_VIEW_PER_HOUR,
		GLOBAL_STATS_VIEW_PER_HOUR,
		"GLOBAL_STATS_VIEW_PER_HOUR",
	);
}

const GLOBAL_STATS_BUDGET: ReadBudget = {
	eventType: "global_stats_view",
	message: "Stats view rate limit exceeded",
	code: "RATE_LIMIT_GLOBAL_STATS",
};

// The payload is byte-identical for every viewer and changes at most nightly,
// so it takes an edge cache — the same header the other public reads carry
// (channels.ts, featured.ts, tournament/public.ts). No browser cache, so a
// visitor who reloads after the nightly precompute sees the new numbers rather
// than waiting out a client TTL. `cors` already carries Vary: Origin
// (cloudCorsHeaders), which is what keeps the origin-specific CORS headers from
// being served to the wrong origin out of a shared cache.
//
// It is also half the herd control a cold key has: every colo answers its
// second and later requests from the edge, which takes a version bump from
// "one recompute per request" to roughly one per colo. The other half is the
// hourly warm (STATS_WARM_CRON, stats/precompute.ts), which rebuilds any of
// the four unfaceted bundles that a bump orphaned and so bounds the cold
// window to one interval. Design §12 wanted that warm at deploy time instead;
// it is a cron because a deploy step would need an app session the wrangler
// toolchain has no way to mint. Whether the two hold together is the trigger
// for a single-flight lock, which the design defers until they measurably
// don't.
function globalStatsResponse(
	bundle: ChartBundleCore,
	cors: Record<string, string>,
): Response {
	return new Response(JSON.stringify(bundle), {
		status: 200,
		headers: {
			"Content-Type": "application/json",
			"Cache-Control": "public, max-age=0, s-maxage=60",
			...cors,
		},
	});
}

// GET /v1/stats — the chart bundle over the whole public corpus.
//
// Session required. Not because the payload is viewer-dependent — it is not:
// is_public = 1 is the whole visibility rule (it already covers tournament
// games, which linkTournamentMatch forces public), so every signed-in viewer
// reads the same bytes and nothing here consults the session beyond its
// existence. The gate is on who may spend a whole-corpus aggregation, not on
// what they get to see.
//
// Checked before the rate limit, the way handleUserSearch does it: a request
// that never reads anything should not spend an IP's read budget, and an
// anonymous caller with no cookie is refused without touching KV or D1.
//
// One consequence worth naming: enforceReadRateLimit exempts scraper
// User-Agents from the budget, but that exemption was only ever about counting.
// A Discord or Slack link-preview bot carries no session, so it is refused here
// like any other anonymous caller — and the frontend /stats route bounces the
// same visitors to login, so a shared /stats link previews as the home page.
//
// The selection is a composition slice plus an optional nation, both parsed
// forgivingly: an unknown ?slice= falls back to the duel default and an
// unknown ?nation= to no facet, so a stale bookmark or a hand-edited URL
// degrades to a neighbouring view instead of 400ing.
//
// Three ways to answer, in order:
//
//   1. The precomputed entry (stats/precompute.ts warms all 56 of them
//      nightly). The steady state, and a single KV read.
//   2. Last night's entry under a superseded parser_version, served stale
//      while this one rebuilds behind ctx.waitUntil. Available on parser drift
//      only — a BUNDLE_SCHEMA_VERSION bump changes the bundle's shape, and a
//      frontend on the new shape would break on the old bytes (see
//      getStaleGlobalCached).
//   3. Computing it here.
//
// Step 3 is not a vestige of step 1 and never refuses. A schema bump orphans
// all 56 keys at once and step 2 deliberately won't reach across that bump,
// so what warms them back is the hourly cron (STATS_WARM_CRON,
// stats/precompute.ts) — and it covers the four unfaceted slices only. Every
// nation selection asked for between the bump and the night's precompute is
// still served by building it here. Precompute-only is the one shape that
// would make the facet model expensive to change later.
//
// Step 2 is skipped where the selection resolves to no games — see the
// resolve below.
export async function handleGlobalStats(
	request: Request,
	env: GlobalStatsEnv,
	ctx: ExecutionContext,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);

	const session = await sessionFromRequest(env, request);
	if (!session) {
		return errorResponse("Authentication required", 401, cors, "UNAUTHORIZED");
	}

	const limited = await enforceReadRateLimit(
		env,
		request,
		cors,
		GLOBAL_STATS_BUDGET,
		globalStatsViewPerHour(env),
	);
	if (limited) return limited;

	const url = new URL(request.url);
	const slice = parseSliceParam(url.searchParams.get("slice"));
	const nation = parseNationParam(url.searchParams.get("nation"));
	const period = parsePeriodParam(url.searchParams.get("period"));
	// The resolver and the cache key both take a set, even though the UI is
	// single-select, so widening the facet to multi-select later costs the
	// nightly precompute table rather than this call chain.
	const nations = nation === null ? [] : [nation];

	const cacheKey = {
		kind: "global" as const,
		slice,
		nations,
		period,
		parser_version: CURRENT_PARSER_VERSION,
	};
	const cached = await getCached<ChartBundleCore>(env, cacheKey);
	if (cached) return globalStatsResponse(cached, cors);

	// Resolve before reaching for a stale entry, so a selection with no games
	// never pays for the reach. Such a selection is deliberately never cached
	// (precompute.ts — an empty bundle costs no queries, and caching one would
	// be a KV write per distinct string anyone can mint), so it misses forever,
	// and getStaleGlobalCached answers a miss by paginating every `stats:` key
	// in the namespace — user and tournament bundles included — to conclude the
	// same nothing every time.
	//
	// It is not only a hand-edited URL that lands here. The facet offers all 13
	// nations in every slice by design (§9.1), so picking one that nobody has
	// played in the FFA slice is an ordinary click, and it walks the keyspace on
	// every request for as long as the corpus stays that way.
	//
	// Nothing is given up by skipping the lookup: an empty selection was never
	// written under any parser version, so there is no stale entry to find. The
	// cost is one D1 query ahead of a stale response, which already pays for the
	// walk itself.
	const corpus = await resolveGlobalCorpus(env, slice, { nations, period });
	const build = () =>
		buildGlobalSelection(
			env,
			slice,
			nations,
			period,
			CURRENT_PARSER_VERSION,
			corpus,
		);

	if (corpus.gameIds.length === 0) {
		return globalStatsResponse(await build(), cors);
	}

	const stale = await getStaleGlobalCached<ChartBundleCore>(env, cacheKey);
	if (stale) {
		ctx.waitUntil(
			build().catch((e: unknown) => {
				// Nothing awaits this, so the log line is the only signal. The
				// next request misses again and retries it, either from the
				// request path or from the night's cron.
				logError("global_stats_refresh_failed", e, {
					slice,
					nation: nation ?? "",
					period,
				});
			}),
		);
		return globalStatsResponse(stale, cors);
	}

	return globalStatsResponse(await build(), cors);
}

// ─── Played-games leaderboard ────────────────────────────────────────
//
//   GET /v1/stats/players — public site-wide leaderboard of games PLAYED
//   per user, split by category: network duels, cloud duels, FFAs (3+
//   humans, any mode), and other (single-player, hotseat/LAN). Playing is
//   what's counted, not uploading: anyone's upload credits every human
//   seat in it — the uploader via their claimed seat, everyone else by
//   matching the seat's online id against user_online_ids. The same match
//   uploaded by both players (separate game rows, same save GameId)
//   counts once per player, deduped on xml_game_id. Only display names,
//   Discord avatars, and counts are exposed.

export interface PlayerLeaderboardEnv {
	SHARE_DB: QueryableD1;
	EVENTS_DB: D1Database;
	ALLOWED_ORIGINS: string;
	// Per-IP hourly ceiling on the /players read budget. Optional: unset falls
	// back to the constant below. A var rather than a bare const for the same
	// reason the other read ceilings are — retunable without a redeploy.
	SEASON_VIEW_PER_HOUR?: string;
}

// Per-IP budget for the public /players reads, spent one slot per board.
//
// Its own budget, deliberately not a share of anon_read. /players and /games/*
// are different populations, and a shared budget lets whichever is busier
// decide when the other starts refusing — the coupling that took the
// tournament pages down on 2026-08-05, and the reason tournament/limits.ts
// says to give a public read the budget of the page that fetches it rather
// than of the feature it belongs to. anon_read is also the wrong size and the
// wrong shape for this page: its 200/hr is already shared with the home feed
// and every game-detail view, and it is a bare constant, so the season read
// would be the only budgeted public read an operator can't retune without a
// redeploy.
//
// Not a share of global_stats_view either, close as the two surfaces sound:
// /players is anonymous where /stats is session-gated, so pooling them would
// let a crawl of the public board decide when signed-in visitors stop getting
// charts.
//
// 1200 arrived through the fan-out, not by copying a number across: the
// /players page fetches two boards per load — all-time plus the selected
// season (src/routes/players/+page.ts) — and each step through the archive
// costs another two. So 1200 is ~600 page loads an hour, the same headroom
// GLOBAL_STATS_VIEW_PER_HOUR buys at 600 on one read a load and
// TOURNAMENT_VIEW_PER_HOUR at 2400 on four to six.
//
// The default only — read the effective ceiling with seasonViewPerHour().
export const SEASON_VIEW_PER_HOUR = 600;

export function seasonViewPerHour(env: {
	SEASON_VIEW_PER_HOUR?: string;
}): number {
	return ceilingFrom(
		env.SEASON_VIEW_PER_HOUR,
		SEASON_VIEW_PER_HOUR,
		"SEASON_VIEW_PER_HOUR",
	);
}

const SEASON_BUDGET: ReadBudget = {
	eventType: "season_view",
	message: "Season view rate limit exceeded",
	code: "RATE_LIMIT_SEASON",
};

// The D1 row. discord_id and avatar_hash are SELECTed to address the Discord
// CDN and are folded into avatar_url below rather than emitted as fields of
// their own — the same select-use-don't-serialize shape handlePublicUserSearch
// and the featured-video attribution use. `slug` is the exception: it IS
// emitted, for the same reason handlePublicUserSearch emits it — it is
// derived from the display name the row already carries, so it publishes
// nothing the board doesn't, and it lets a row link straight to /u/<slug>
// instead of bouncing every profile link through the id permalink's 307.
// The three `*_reach` columns are the crown tiebreak, packed one string per
// format: the match time the player reached their count at, with their result
// in that match as a trailing '1'/'0'. Packed rather than emitted as six
// columns because both halves come from one MAX() — the aggregate has to pick
// a match before either value means anything — and splitting a pair the
// database computed together into two aggregates invites them to disagree.
// `reachOf` below unpacks them into the two fields the board actually reads.
interface PlayedGamesQueryRow {
	user_id: string;
	display_name: string;
	slug: string | null;
	discord_id: string;
	avatar_hash: string | null;
	duels_network: number;
	duels_cloud: number;
	ffas: number;
	total: number;
	duels_network_reach: string | null;
	duels_cloud_reach: string | null;
	ffas_reach: string | null;
	// Packed like the three `*_reach` columns above, and ordered by rather
	// than serialized — the same select-use-don't-serialize shape as
	// discord_id. The board's rank is the row's position in this order, so
	// the client reads it off the array and needs no field. Never null: a row
	// exists only because it has at least one match.
	total_reach: string;
}

// One packed `*_reach` column as the board reads it: when the player reached
// that format's count, and whether they won the match that got them there.
// Null for a format they have no games in, which is every format at count 0.
function reachOf(packed: string | null): {
	at: string | null;
	won: boolean;
} {
	if (packed == null) return { at: null, won: false };
	// Split off the trailing flag rather than slicing at a fixed offset:
	// created_at's width is a convention of how rows were written, not a
	// guarantee this function gets to make.
	return { at: packed.slice(0, -1), won: packed.endsWith("1") };
}

export async function handlePlayerLeaderboard(
	request: Request,
	env: PlayerLeaderboardEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);

	const limited = await enforceReadRateLimit(
		env,
		request,
		cors,
		SEASON_BUDGET,
		seasonViewPerHour(env),
	);
	if (limited) return limited;

	// Optional season window: `since`/`until` (YYYY-MM-DD, until exclusive)
	// count only games UPLOADED in the window — created_at is
	// server-authoritative, unlike the save's own dates. Invalid values are
	// rejected rather than silently ignored so a malformed season picker
	// can't masquerade as all-time.
	//
	// The frontend also sends `v`, its PLAYERS_SHAPE_VERSION (api-cloud.ts).
	// Nothing here reads it and nothing should: it exists to key the browser
	// caches this endpoint's max-age fills, so a shape change doesn't meet a
	// stale-shaped body, and a response that varied on it would defeat that.
	// It is named here so a later tightening of this validation doesn't 400
	// the board's own requests.
	const url = new URL(request.url);
	const sinceRaw = url.searchParams.get("since");
	const untilRaw = url.searchParams.get("until");
	for (const v of [sinceRaw, untilRaw]) {
		if (v != null && !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
			return errorResponse("Invalid window date", 400, cors, "INVALID_QUERY");
		}
	}

	// `played` is (user, match) pairs — the uploader's claimed seat, plus
	// every seat whose online id belongs to a registered user; UNION dedupes
	// both the two credit paths and double-uploaded matches (same
	// xml_game_id). `match_class` classifies each match from its in-window
	// uploads. Duel = exactly two humans, split by game mode; two-human
	// hotseat/LAN lands in `other` (derived client-side).
	//
	// Two uploads of one match agree on the human count — the roster is the
	// same roster — so `n_humans` can take any of them. They do NOT always
	// agree on game_mode: seven public xml_game_ids in the corpus carry two
	// modes, every one of them a local mode against a non-local one
	// (HOTSEAT/NETWORK, HOTSEAT/PLAY_BY_CLOUD, LAN/PLAY_BY_CLOUD). Each
	// upload reports the mode its own client ran in, and a match somebody
	// played over the network is a network match however the other seat sat
	// down at it — so the non-local mode wins, and `any_network`/`any_cloud`
	// carry that as two flags rather than a single winning mode. Picking one
	// mode with MAX() would decide it alphabetically, which lands on the
	// non-local value in all seven of today's conflicts by coincidence and
	// would stop doing so the first time the pair is NETWORK/PLAY_BY_CLOUD.
	// That pair — two non-local modes, which no match in the corpus has yet
	// — resolves network-first, by testing `any_network` before `any_cloud`.
	// Promoting the two known non-local modes rather than demoting a list of
	// local ones is deliberate: game_mode is the save's `@_GameMode` read
	// verbatim (match-metadata.ts) and nothing validates it against an enum,
	// so a mode the game adds later must not be able to outrank a duel.
	//
	// Every arm carries is_public = 1 — the same visibility rule the profile
	// card (users.ts) and the global corpus (stats/resolve.ts) enforce. A
	// private game must not reach a public counter: the increment alone
	// publishes that the game happened, how many humans were in it and its
	// game mode, and — through the online-id arm — that a second player was
	// there, which is a visibility decision that player never made. Windows
	// are caller-supplied down to a single day, so the counters are fine
	// enough to read as an activity log rather than as a season total.
	// `match_class` is the load-bearing arm (the final JOIN is inner, so a
	// match missing from it drops out entirely), but all three carry the
	// predicate rather than resting a visibility guarantee on join
	// semantics. A match uploaded publicly by one player and privately by
	// another stays public — the public upload classifies it, and both
	// players are credited once.
	//
	// The online-id arm credits an id only while it resolves to exactly one
	// user. `user_online_ids` is many-to-many by design (0003: shared
	// account, Discord-account rebuild) and links are captured implicitly
	// from whichever seat an uploader claimed, so an id can name two people
	// without either of them doing anything wrong. Crediting both hands one
	// player the other's entire history, and nothing here distinguishes the
	// real owner — the earliest claimant is not the likelier one. An
	// ambiguous id therefore credits nobody through this arm; both users
	// still get their own uploads through the uploader arm above, and the
	// credit returns on its own once the link is disambiguated.
	//
	// The category counts and the mode flags are CASE-wrapped, not bare
	// predicates, because game_mode is nullable and `x AND NULL` is NULL, not
	// false: a user whose every match is a two-human game with no recorded
	// mode would sum only NULLs and get NULL back for both duel columns, and
	// a MAX over bare predicates would return NULL for a match whose every
	// upload is missing a mode. The response types them as numbers and the
	// board renders them with toLocaleString, so the null wouldn't survive
	// the trip. No save in the corpus is missing a mode today — the column is
	// nullable because the parser reads it from an optional attribute
	// (match-metadata.ts), which is a promise about the data we don't get to
	// make here.
	//
	// The crown a format's leader wears goes to exactly one player, so the
	// board needs a tiebreak for the field tied at the top — which at a
	// season's start is most of it. The rule is: whoever reached that number
	// first, and a head-to-head decides itself.
	//
	// "Reached it first" needs no ranking pass. Everyone tied is tied at the
	// same count C, so each of them has exactly C matches in that format, and
	// the moment they reached C is the timestamp of their C-th — which, having
	// exactly C, is their most recent. So `MAX(match time)` per player is the
	// whole of it, and the earliest such time takes the crown.
	//
	// A match's time is `MIN(created_at)` across its uploads, not any one
	// upload's: a match uploaded by both players has two rows minutes or days
	// apart, and the match happened when it first landed. That also makes the
	// head-to-head case exact rather than approximate — both players read the
	// same instant off the same match, so their reach times are equal to the
	// character, and `p.won` (the seat's is_winner, carried through the same
	// credit arms the count uses) is what separates them.
	//
	// `played` therefore wraps its UNION in a GROUP BY rather than selecting
	// is_winner alongside the pair: the UNION dedupes (user, match), and two
	// uploads of one match that disagree on the winner — one saved before the
	// end, one after — would otherwise dedupe to two rows and count the match
	// twice. Grouping collapses them back to one and takes MAX(won), so a
	// player who won on any upload of a match won it.
	//
	// The same rule orders the board itself, through `total_reach` — the
	// player's newest match in the window, whatever format, packed with that
	// match's result exactly as a format's reach is. Ordering ties on
	// display_name alone made the board's #1 an alphabetical accident: a
	// season opens with its whole field on one game, and the client numbers
	// rows by their position here, so every tie the ORDER BY leaves unbroken
	// is a rank the board can't justify. `total_reach` is never null — a row
	// exists only because the player has a match — so it can't push a row to
	// either end by being missing.
	//
	// The board runs all three steps, not two: whoever reached the total
	// first, then — for the players a timestamp cannot separate, who reached
	// it by playing each other — whoever won that match. A crown settled a
	// head-to-head on the result while the rank beside it fell through to
	// alphabetical, so one board could seat the same two players in two
	// different orders and call both of them earned. The ORDER BY therefore
	// splits the packed pair rather than sorting the string whole: the
	// timestamp ascends and the flag descends, and a single ASC over the
	// concatenation would rank the loser of a head-to-head above the winner.
	//
	// The timestamps this publishes are the public games' own created_at,
	// already served per-game by the discovery feed and game detail, so the
	// board exposes no clock it didn't already.
	//
	// `humans` carries the same public + window predicate as the two arms
	// below rather than grouping the whole table: it only ever reaches
	// match_class through an inner join that applies those anyway, so the
	// rows it drops are rows nothing downstream can use — and without the
	// predicate a one-week board pays for a full scan of every roster ever
	// uploaded, since since/until reduce nothing there.

	// A match packed as both tiebreaks read it: when it landed, and whether
	// this player won it, split back apart by `reachOf`. MAX() over the packed
	// string picks the player's newest match and carries that match's result
	// along with it, which is the pair every `*_reach` column below needs.
	const reach = `mc.first_at || CASE WHEN p.won = 1 THEN '1' ELSE '0' END`;
	// The two halves of a packed reach, for ordering by them separately —
	// earliest first, then the winner. Sliced by length rather than at a fixed
	// offset for `reachOf`'s reason: created_at's width is a convention of how
	// rows were written, not a guarantee this query gets to make.
	const reachAt = `substr(total_reach, 1, length(total_reach) - 1)`;
	const reachWon = `substr(total_reach, -1)`;
	const rows = await env.SHARE_DB.prepare(
		`WITH humans AS (
		   SELECT ps.game_id, SUM(ps.is_human) AS n
		   FROM player_summaries ps
		   JOIN games g ON g.game_id = ps.game_id
		   WHERE g.is_public = 1
		     AND (?1 IS NULL OR g.created_at >= ?1)
		     AND (?2 IS NULL OR g.created_at < ?2)
		   GROUP BY ps.game_id
		 ),
		 played AS (
		   SELECT user_id, xml_game_id, MAX(won) AS won
		   FROM (
		     SELECT g.user_id, g.xml_game_id, ps.is_winner AS won
		     FROM games g
		     JOIN player_summaries ps
		       ON ps.game_id = g.game_id AND ps.is_uploader = 1 AND ps.is_human = 1
		     WHERE g.is_public = 1
		       AND (?1 IS NULL OR g.created_at >= ?1)
		       AND (?2 IS NULL OR g.created_at < ?2)
		     UNION
		     SELECT uo.user_id, g.xml_game_id, ps.is_winner AS won
		     FROM games g
		     JOIN player_summaries ps
		       ON ps.game_id = g.game_id AND ps.is_human = 1
		          AND ps.online_id IS NOT NULL
		     JOIN user_online_ids uo ON uo.online_id = ps.online_id
		       AND NOT EXISTS (
		         SELECT 1 FROM user_online_ids amb
		         WHERE amb.online_id = ps.online_id AND amb.user_id <> uo.user_id
		       )
		     WHERE g.is_public = 1
		       AND (?1 IS NULL OR g.created_at >= ?1)
		       AND (?2 IS NULL OR g.created_at < ?2)
		   ) credited
		   GROUP BY user_id, xml_game_id
		 ),
		 match_class AS (
		   SELECT g.xml_game_id,
		          MIN(g.created_at) AS first_at,
		          MAX(h.n) AS n_humans,
		          MAX(CASE WHEN g.game_mode = 'NETWORK'
		                   THEN 1 ELSE 0 END) AS any_network,
		          MAX(CASE WHEN g.game_mode = 'PLAY_BY_CLOUD'
		                   THEN 1 ELSE 0 END) AS any_cloud
		   FROM games g
		   JOIN humans h ON h.game_id = g.game_id
		   WHERE g.is_public = 1
		     AND (?1 IS NULL OR g.created_at >= ?1)
		     AND (?2 IS NULL OR g.created_at < ?2)
		   GROUP BY g.xml_game_id
		 )
		 SELECT
		   u.user_id,
		   ${displayNameSql("u")} AS display_name,
		   u.slug,
		   u.discord_id,
		   u.avatar_hash,
		   SUM(CASE WHEN mc.n_humans = 2 AND mc.any_network = 1
		            THEN 1 ELSE 0 END) AS duels_network,
		   SUM(CASE WHEN mc.n_humans = 2 AND mc.any_network = 0 AND mc.any_cloud = 1
		            THEN 1 ELSE 0 END) AS duels_cloud,
		   SUM(CASE WHEN mc.n_humans >= 3 THEN 1 ELSE 0 END) AS ffas,
		   COUNT(*) AS total,
		   MAX(CASE WHEN mc.n_humans = 2 AND mc.any_network = 1
		            THEN ${reach} END) AS duels_network_reach,
		   MAX(CASE WHEN mc.n_humans = 2 AND mc.any_network = 0 AND mc.any_cloud = 1
		            THEN ${reach} END) AS duels_cloud_reach,
		   MAX(CASE WHEN mc.n_humans >= 3
		            THEN ${reach} END) AS ffas_reach,
		   MAX(${reach}) AS total_reach
		 FROM played p
		 JOIN match_class mc ON mc.xml_game_id = p.xml_game_id
		 JOIN users u ON u.user_id = p.user_id
		 GROUP BY u.user_id
		 ORDER BY total DESC, ${reachAt} ASC, ${reachWon} DESC, display_name ASC`,
	)
		.bind(sinceRaw, untilRaw)
		.all<PlayedGamesQueryRow>();

	const players = (rows.results ?? []).map((r) => {
		const network = reachOf(r.duels_network_reach);
		const cloud = reachOf(r.duels_cloud_reach);
		const ffa = reachOf(r.ffas_reach);
		return {
			user_id: r.user_id,
			display_name: r.display_name,
			slug: r.slug,
			avatar_url: buildAvatarUrl(r.discord_id, r.avatar_hash),
			duels_network: r.duels_network,
			duels_cloud: r.duels_cloud,
			ffas: r.ffas,
			total: r.total,
			duels_network_at: network.at,
			duels_network_won: network.won,
			duels_cloud_at: cloud.at,
			duels_cloud_won: cloud.won,
			ffas_at: ffa.at,
			ffas_won: ffa.won,
		};
	});

	// Every window caches like public-recent (5min browser, 60s edge),
	// closed seasons included. A finished season's board is not immutable:
	// created_at can't be backdated, but a visibility toggle, a newly linked
	// online id, the reindex sweep that backfills player_summaries.online_id,
	// and a deleted game all move a past window's counters — and toggles alone
	// run every other day. Nothing can recall a response once served, either:
	// unlike the bundle handlers above, this endpoint keeps no KV entry, so
	// neither invalidateStatsCache nor `admin cache clear stats` reaches it.
	// games.ts holds public game detail to the same 60s at the edge for the
	// same reason — a Make Private toggle has to propagate in a minute.
	return new Response(JSON.stringify({ players }), {
		status: 200,
		headers: {
			"Content-Type": "application/json",
			"Cache-Control": "public, max-age=300, s-maxage=60",
			...cors,
			Vary: "Origin",
		},
	});
}

// ─── GET /v1/home-summary — the home page's stats panels ─────────────
//
// A small public projection of the precomputed global `duel` bundle: the three
// fields the home page's three stats panels draw.
//
// Its own endpoint rather than an anonymous door onto /v1/stats. The session
// gate above is not about what the bytes contain — it is about who may spend a
// whole-corpus aggregation — and home is anonymous, so opening that gate would
// hand every crawler the right to trigger a 96-query build. This handler cannot
// build one: see the env type below.
//
// The trim is the other half of the difference. The full bundle's bulk is
// wonderStats / yieldCurves / lawTiming, none of which home reads, and home is
// the page most likely to be a visitor's first byte of the site.

// The archetype floor, server-side, because it is a correctness filter rather
// than a presentation choice: without it the headline reads "Diplomat 73%" off
// eleven games. It ships with the data so the number the panel shows is the
// number the corpus supports, and so the frontend can't quietly render an
// unfloored row by slicing differently.
//
// The consequence is accepted knowingly: home's archetype panel and /stats'
// show different rows for the same corpus, with no caveat text saying so.
// /stats is the surface for reading the whole distribution, thin samples
// included, and startingArchetypeWinLossOption stays unchanged for it.
export const HOME_ARCHETYPE_MIN_GAMES = 50;

// The wire shape: the bundle's own three fields and nothing beside them. Not
// even meta — the corpus size and the parser version are things the full
// bundle carries for a consumer that branches on them, and no home panel does.
//
// The envelope below is what makes the set atomic. One KV entry answers for
// all three, so they are present together or not at all, and a single nullable
// `summary` makes any other combination unrepresentable.
export type HomeStatsSummary = Pick<
	ChartBundleCore,
	"nationWinRate" | "capitalFamilyWinRate" | "startingArchetypeWinRate"
>;

export interface HomeSummaryResponse {
	summary: HomeStatsSummary | null;
}

// Each field ships whole apart from the archetype floor. The row caps the
// panels apply (top 7, by games played) are the frontend's: the floor is a
// correctness filter and belongs with the data, where the cap is a decision
// about how many rows fit in a panel the width of the season standings — and
// keeping it client-side moves the number without a Worker deploy.
export function homeSummaryFrom(bundle: ChartBundleCore): HomeStatsSummary {
	return {
		nationWinRate: bundle.nationWinRate,
		capitalFamilyWinRate: bundle.capitalFamilyWinRate,
		startingArchetypeWinRate: bundle.startingArchetypeWinRate.filter(
			(r) => r.games >= HOME_ARCHETYPE_MIN_GAMES,
		),
	};
}

// Per-IP budget for the public home-summary read, one slot per home page load.
//
// Its own budget, not a share of anon_read's or global_stats_view's. anon_read
// is the home page's own tightest ceiling already (the discovery feed spends
// it), so pooling would halve the page's headroom against itself; and
// global_stats_view belongs to a session-gated surface, where this one is
// anonymous — pooling those would let a crawl of the home page decide when
// signed-in visitors stop getting charts. The rule and the outage behind it are
// in tournament/limits.ts.
//
// 600 arrived through the fan-out: one read per home page load, so 600 is 600
// loads an hour — the same headroom SEASON_VIEW_PER_HOUR and
// GLOBAL_STATS_VIEW_PER_HOUR buy at the same number on the same one-read
// arithmetic, not a number copied across from them.
//
// The default only — read the effective ceiling with homeSummaryViewPerHour().
export const HOME_SUMMARY_VIEW_PER_HOUR = 600;

export function homeSummaryViewPerHour(env: {
	HOME_SUMMARY_VIEW_PER_HOUR?: string;
}): number {
	return ceilingFrom(
		env.HOME_SUMMARY_VIEW_PER_HOUR,
		HOME_SUMMARY_VIEW_PER_HOUR,
		"HOME_SUMMARY_VIEW_PER_HOUR",
	);
}

const HOME_SUMMARY_BUDGET: ReadBudget = {
	eventType: "home_summary_view",
	message: "Home summary rate limit exceeded",
	code: "RATE_LIMIT_HOME_SUMMARY",
};

// Deliberately no SHARE_DB. "Never computes on a cache miss" is the whole
// reason this endpoint exists rather than an anonymous /v1/stats, and typing
// the env without the games database makes it a property the compiler holds:
// buildChartBundle and resolveGlobalCorpus both need SHARE_DB, so this handler
// structurally cannot reach them. A future edit that tries has to widen this
// interface first, which is the review this decision wants.
//
// Serving stale doesn't touch that property: getStaleGlobalCached reads KV and
// takes StatsCacheEnv, so reaching for last night's entry is still only ever a
// read of something a cron built.
export interface HomeSummaryEnv extends StatsCacheEnv, EventsEnv {
	ALLOWED_ORIGINS: string;
	// Per-IP hourly ceiling on the home-summary read. Optional: unset falls
	// back to the constant above. A var rather than a bare const for the same
	// reason the other read ceilings are — retunable without a redeploy.
	HOME_SUMMARY_VIEW_PER_HOUR?: string;
}

// GET /v1/home-summary — the three bundle fields the home page's stats panels
// draw, over the unfaceted `duel` slice (the /stats default, and ~94% of the
// corpus).
//
// Three ways to answer, and only the first two exist here — /v1/stats' step 3,
// computing the bundle in the request, is the one this endpoint refuses:
//
//   1. The current entry. The steady state, and a single KV read. The nightly
//      precompute writes one per slice and the hourly warm (STATS_WARM_CRON)
//      rebuilds the four unfaceted bundles a version bump orphaned — and this
//      reads the same entry the signed-in /stats default view does, so it is
//      the last of them to be cold.
//   2. Last night's entry under a superseded parser_version. A Worker deploy
//      that bumps CURRENT_PARSER_VERSION orphans the key at once, and the warm
//      that fixes it runs at :37 — so without this, home loses its whole stats
//      region for up to an hour while /v1/stats, which does reach across, keeps
//      serving. Same asymmetry the two pages had no reason to have.
//   3. Absent both, `{ summary: null }` and the page drops the stats region
//      rather than rendering three empty boxes.
//
// Unlike /v1/stats, nothing is kicked off behind the stale answer: rebuilding
// is what this handler structurally cannot do (see the env type above), so the
// warm cron is what ends the stale window. That is also what makes the reach
// safe to take unguarded — /v1/stats guards it because a *faceted* selection
// resolving to no games is never written under any parser version and would
// walk the keyspace forever. This key is the unfaceted `duel` slice, which is
// written by two crons and a request path; the only corpus where it is
// permanently absent is one with no public duel in it, and that namespace is
// small enough to walk.
//
// Edge-cached like globalStatsResponse, and for the same reasons: the payload
// is byte-identical for every viewer and changes at most nightly, and the edge
// is what keeps a cold key from being one miss per request per colo. No browser
// cache, so a reload after the nightly precompute shows the new numbers.
export async function handleHomeSummary(
	request: Request,
	env: HomeSummaryEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);

	const limited = await enforceReadRateLimit(
		env,
		request,
		cors,
		HOME_SUMMARY_BUDGET,
		homeSummaryViewPerHour(env),
	);
	if (limited) return limited;

	const cacheKey = {
		kind: "global" as const,
		slice: "duel" as const,
		nations: [],
		// The all-time window, which is the only one the crons warm — and this
		// endpoint can only ever read what a cron built. A narrowed window is
		// keyed separately (stats/cache.ts) and has no entry to find here.
		period: DEFAULT_GLOBAL_PERIOD,
		parser_version: CURRENT_PARSER_VERSION,
	};
	const bundle =
		(await getCached<ChartBundleCore>(env, cacheKey)) ??
		(await getStaleGlobalCached<ChartBundleCore>(env, cacheKey));

	const body: HomeSummaryResponse = {
		summary: bundle ? homeSummaryFrom(bundle) : null,
	};
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: {
			"Content-Type": "application/json",
			"Cache-Control": "public, max-age=0, s-maxage=60",
			...cors,
		},
	});
}
