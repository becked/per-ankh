// User-table-shaped endpoints: two searches — the tournament admin's
// autocomplete and the header's people search — plus the public profile
// (the /users/[user_id] page chrome), served by user_id or by slug, and the
// slug set/release pair behind it.
//
// Anything more user-table-shaped that grows beyond a few hundred lines
// can split into its own subdir.
//
// Auth model, shared by both searches:
//   1. session required (anonymous → 401) — a search returns user
//      identity fields, so it's logged-in only.
//   2. per-user rate limit on the user_id, audited via the shared
//      `events` table — same engine as the tournament_view limit.
//
// The two searches are deliberately separate handlers rather than one
// parameterized by audience: they differ in which columns match, which
// columns serialize, which rows are eligible, and how big the budget is.
// Folding them together would put an `isPublic` flag in front of the PII
// decision, which is the one thing that must not be a parameter. See
// handlePublicUserSearch for the three differences.
//
// Privacy: /search returns only the four fields the autocomplete needs
// (user_id, discord_id, discord_username, display_name). No email,
// avatar, or timestamps. Result cap defaults to 10, max 20.

import * as v from "valibot";
import { buildAvatarUrl } from "./auth";
import { countEventsSince } from "./games";
import { noChallengeRunsSql } from "./games-scope";
import { displayNameSql } from "./identity";
import { logError } from "./log";
import { UserSearchQuerySchema } from "./schemas/tournament";
import { ClaimSlugSchema, SlugSchema } from "./schemas/user";
import { sessionFromRequest, type SessionEnv } from "./session";
import { USER_MATCHES_WHERE, type TournamentEnv } from "./tournament/data";
import {
	cloudCorsHeaders,
	errorResponse,
	escapeLikeValue,
	isUniqueViolation,
	jsonResponse,
	parseJsonBody,
} from "./util";
import type { QueryableD1, EventsEnv } from "./d1";

// Generous ceiling — typing 5 chars to find someone, picking from the
// dropdown, costs ~4 requests per slot. An admin adding a 16-player
// tournament makes ~64 requests; 60/hour limits that to one full slot
// list per hour from a single account. Any logged-in user can search, so
// the limit mostly bounds runaway scripts.
export const USER_SEARCH_PER_USER_PER_HOUR = 60;

// The public people search runs off the header's search-as-you-type, so it
// spends one audited call per debounced keystroke past the 2-char floor —
// finding one player costs several requests, and the admin search's 60/hr
// would allow only about seven lookups an hour. 300 keeps the dropdown
// usable across a browsing session while still bounding a runaway script.
export const PUBLIC_USER_SEARCH_PER_USER_PER_HOUR = 300;

const DEFAULT_LIMIT = 10;

// Both searches want the same three things: a session, SHARE_DB for the
// lookup, and EVENTS_DB for the budget.
export interface UserSearchEnv extends SessionEnv, TournamentEnv, EventsEnv {
	ALLOWED_ORIGINS: string;
}

export async function handleUserSearch(
	request: Request,
	env: UserSearchEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const session = await sessionFromRequest(env, request);
	if (!session) {
		return errorResponse("Authentication required", 401, cors, "UNAUTHORIZED");
	}

	// Rate limit per user. Check BEFORE doing any DB work or audit-row
	// insert so a hammered account fails cheaply.
	const count = await countEventsSince(
		env.EVENTS_DB,
		"user_search",
		"user_id",
		session.data.user_id,
	);
	if (count >= USER_SEARCH_PER_USER_PER_HOUR) {
		return errorResponse(
			"User search rate limit exceeded",
			429,
			cors,
			"RATE_LIMIT_USER_SEARCH",
		);
	}

	const url = new URL(request.url);
	const rawQ = url.searchParams.get("q") ?? "";
	const rawLimit = url.searchParams.get("limit");
	const limitNum = rawLimit !== null ? parseInt(rawLimit, 10) : NaN;
	const parsed = v.safeParse(UserSearchQuerySchema, {
		q: rawQ,
		...(Number.isFinite(limitNum) ? { limit: limitNum } : {}),
	});
	if (!parsed.success) {
		return errorResponse(
			`Invalid query: ${parsed.issues[0]?.message ?? "unknown"}`,
			400,
			cors,
			"VALIDATION_ERROR",
		);
	}
	const { q, limit = DEFAULT_LIMIT } = parsed.output;

	// "Still typing" floor — return empty without an audit row, so per-
	// keystroke calls below 2 chars don't churn the rate-limit counter or
	// the events table. Frontend can call /search on every keystroke
	// without thinking.
	if (q.length < 2) {
		return jsonResponse({ users: [] }, 200, cors);
	}

	// Audit row also serves as the rate-limit counter source. async fire-
	// and-forget — failure to audit shouldn't block the lookup.
	env.EVENTS_DB.prepare(
		`INSERT INTO events (event_type, user_id, metadata)
		 VALUES ('user_search', ?, ?)`,
	)
		.bind(session.data.user_id, JSON.stringify({ q_length: q.length }))
		.run()
		.catch((e: unknown) => {
			logError("user_search_audit_failed", e, {
				user_id: session.data.user_id,
			});
		});

	// Match a prefix of either display_name (the global_name fallback to
	// username — what people recognize themselves as) OR discord_username (the
	// lowercased canonical @ handle), so an admin can type whichever they know.
	// Picking a row threads discord_username into the slot via the user_id
	// pre-link path, so the data we store is unchanged. discord_username IS NOT
	// NULL filters out users who haven't logged in since migration 0016 and
	// would therefore be unpickable.
	//
	// LOWER(...) for case-insensitive match against the already-lowercased `q`
	// (discord_username is already stored lowercase). Indexes:
	// idx_users_discord_username covers the handle prefix; display_name has no
	// index. Table is small enough that the scan is fine — promote to a
	// functional index if user count grows past a few thousand.
	//
	// escapeLikeValue + ESCAPE keeps `q` a literal: without it a `%` or `_` in
	// the query is a live wildcard, so `q = "%%"` matches every row and the
	// "prefix only" contract silently becomes "anything".
	const pattern = escapeLikeValue(q) + "%";
	const rows = await env.SHARE_DB.prepare(
		`SELECT user_id, discord_id, discord_username,
		        ${displayNameSql("users")} AS display_name
		 FROM users
		 WHERE (LOWER(display_name) LIKE ? ESCAPE '\\'
		        OR LOWER(discord_username) LIKE ? ESCAPE '\\'
		        OR LOWER(alias) LIKE ? ESCAPE '\\')
		   AND discord_username IS NOT NULL
		   AND display_name IS NOT NULL
		 ORDER BY display_name
		 LIMIT ?`,
	)
		.bind(pattern, pattern, pattern, limit)
		.all<{
			user_id: string;
			discord_id: string;
			discord_username: string;
			display_name: string;
		}>();

	return jsonResponse({ users: rows.results ?? [] }, 200, cors);
}

// GET /v1/users/public-search — the header search's "Players" group.
//
// The public-facing sibling of handleUserSearch above: same auth, same
// rate-limit engine, three deliberate differences.
//
//   1. Matches display_name and alias only, never discord_username. The
//      admin search matches the canonical @ handle so an admin can type
//      whichever name they know; doing that here would let any logged-in
//      caller confirm Discord-handle prefixes, which is the thing the PII
//      stance forbids.
//   2. Serializes no discord_* field. discord_id is still SELECTed —
//      buildAvatarUrl needs it to address the CDN — and is not emitted as a
//      field of its own, the same select-use-don't-serialize shape
//      handleUserProfile uses for the profile header's avatar.
//
//      Not a claim that the id is withheld: buildAvatarUrl returns
//      cdn.discordapp.com/avatars/<discord_id>/<hash>.png, so the snowflake
//      travels inside avatar_url on every row here — as it already does on
//      the public profile, standings, and creator-feed payloads. That is
//      accepted app-wide (a Discord CDN URL is the only way to render the
//      avatar), and it is the *handle* — discord_username — that the PII
//      stance keeps out of public payloads. Difference 1 is what enforces
//      that; this one is only about not adding a discord_* field.
//   3. Returns only users who made something public (the EXISTS block).
//
// Rows are { user_id, display_name, slug, avatar_url }.
interface PublicUserSearchRow {
	user_id: string;
	discord_id: string;
	display_name: string;
	slug: string | null;
	avatar_hash: string | null;
}

export async function handlePublicUserSearch(
	request: Request,
	env: UserSearchEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const session = await sessionFromRequest(env, request);
	if (!session) {
		return errorResponse("Authentication required", 401, cors, "UNAUTHORIZED");
	}

	// Same ordering as handleUserSearch: budget first, so a hammered account
	// fails before any DB work or audit insert.
	const count = await countEventsSince(
		env.EVENTS_DB,
		"user_search_public",
		"user_id",
		session.data.user_id,
	);
	if (count >= PUBLIC_USER_SEARCH_PER_USER_PER_HOUR) {
		return errorResponse(
			"User search rate limit exceeded",
			429,
			cors,
			"RATE_LIMIT_USER_SEARCH_PUBLIC",
		);
	}

	const url = new URL(request.url);
	const rawQ = url.searchParams.get("q") ?? "";
	const rawLimit = url.searchParams.get("limit");
	const limitNum = rawLimit !== null ? parseInt(rawLimit, 10) : NaN;
	const parsed = v.safeParse(UserSearchQuerySchema, {
		q: rawQ,
		...(Number.isFinite(limitNum) ? { limit: limitNum } : {}),
	});
	if (!parsed.success) {
		return errorResponse(
			`Invalid query: ${parsed.issues[0]?.message ?? "unknown"}`,
			400,
			cors,
			"VALIDATION_ERROR",
		);
	}
	const { q, limit = DEFAULT_LIMIT } = parsed.output;

	// "Still typing" floor — empty result, no audit row, so per-keystroke
	// calls below 2 chars neither churn the events table nor spend budget.
	if (q.length < 2) {
		return jsonResponse({ users: [] }, 200, cors);
	}

	// Audit row doubles as the rate-limit counter. Fire-and-forget, and the
	// metadata is the query's LENGTH only — never its text, which is a
	// person's name being looked up.
	env.EVENTS_DB.prepare(
		`INSERT INTO events (event_type, user_id, metadata)
		 VALUES ('user_search_public', ?, ?)`,
	)
		.bind(session.data.user_id, JSON.stringify({ q_length: q.length }))
		.run()
		.catch((e: unknown) => {
			logError("user_search_public_audit_failed", e, {
				user_id: session.data.user_id,
			});
		});

	// Scoped to users who made something public: a session-gated prefix index
	// over the whole users table would be enumeration with a rate limiter on
	// it, and the product rule is that people are discoverable through the
	// things they chose to publish. `slug IS NOT NULL` leads the disjunction so
	// that a user whose profile URL is their only presence here is still
	// findable — the URL is no use to them if nothing can reach it.
	//
	// That leg used to carry a second argument, that claiming a slug was itself
	// the deliberate act of publishing a name. It isn't one any more: a slug is
	// derived from the display name at first login, so this leg is true for
	// nearly every account and the scoping above no longer narrows much. The
	// practical reach of this endpoint is now "anyone whose display name
	// slugified" — the same accepted consequence as /u/<slug> being an
	// account-existence oracle, and it publishes nothing that a display-name
	// prefix search over public games didn't already.
	//
	// The other three legs still matter — they carry the accounts no slug
	// reached — and each seeks on a user_id index rather than
	// scanning: idx_games_user (0002) filtered down to is_public,
	// idx_slots_user (0006), and user_video_channels' (user_id, platform) PK
	// (0031); verified with EXPLAIN QUERY PLAN against representative row
	// counts. The outer scan over `users` is the same one handleUserSearch
	// does, on the same "table is small enough" reasoning.
	//
	// Prefix match on the two name columns plus the slug (see difference 1
	// above) — never discord_username, which a public endpoint must not
	// confirm. The resolved display_name needs no NOT NULL guard even for a
	// slug-only match: users.display_name is NOT NULL (0002), so the COALESCE
	// always yields a name. LOWER(...) matches the already-lowercased `q`;
	// slugs are stored lowercase, so that leg's LOWER is a no-op kept for
	// symmetry.
	//
	// escapeLikeValue + ESCAPE is load-bearing for the scoping above, not a
	// nicety: an unescaped `%` or `_` in `q` is a live wildcard, so `q = "%%"`
	// would match every row and `q = "%a"` would become a contains-search —
	// turning the deliberately prefix-only lookup into the directory sweep the
	// EXISTS block exists to prevent.
	const pattern = escapeLikeValue(q) + "%";
	const rows = await env.SHARE_DB.prepare(
		`SELECT u.user_id, u.discord_id, u.avatar_hash, u.slug,
		        ${displayNameSql("u")} AS display_name
		 FROM users u
		 WHERE (LOWER(u.display_name) LIKE ? ESCAPE '\\'
		     OR LOWER(u.alias) LIKE ? ESCAPE '\\'
		     OR LOWER(u.slug) LIKE ? ESCAPE '\\')
		   AND (
		        u.slug IS NOT NULL
		     OR EXISTS (SELECT 1 FROM games g
		                 WHERE g.user_id = u.user_id AND g.is_public = TRUE)
		     OR EXISTS (SELECT 1 FROM tournament_slots s WHERE s.user_id = u.user_id)
		     OR EXISTS (SELECT 1 FROM user_video_channels c WHERE c.user_id = u.user_id)
		   )
		 ORDER BY display_name
		 LIMIT ?`,
	)
		.bind(pattern, pattern, pattern, limit)
		.all<PublicUserSearchRow>();

	return jsonResponse(
		{
			users: (rows.results ?? []).map((r) => ({
				user_id: r.user_id,
				display_name: r.display_name,
				// The one identifier here that IS safe to publish: derived from the
				// display name the row already carries, unlike the Discord handle
				// this endpoint refuses to expose. It lets the picked row navigate
				// straight to /u/<slug>.
				slug: r.slug,
				avatar_url: buildAvatarUrl(r.discord_id, r.avatar_hash),
			})),
		},
		200,
		cors,
	);
}

// The public user profile, addressed two ways: GET /v1/users/:user_id (the
// permanent permalink) and GET /v1/users/by-slug/:slug (the /u/<slug> pretty
// URL). Both return the same payload — see buildUserProfile.
//
// Returns identity fields the profile page needs to render its chrome
// (display name + avatar). No auth, no beta gate; 404 if the user doesn't
// exist.
export interface UserProfileEnv extends SessionEnv {
	SHARE_DB: QueryableD1;
	ALLOWED_ORIGINS: string;
}

interface UserProfileRow {
	user_id: string;
	discord_id: string;
	display_name: string;
	avatar_hash: string | null;
	slug: string | null;
}

// One projection, two keys — the routes differ only in what they look the row
// up BY. Keeping the column list here means a field added to the profile
// header can't reach one route and miss the other.
const PROFILE_ROW_SQL = `SELECT user_id, discord_id, ${displayNameSql("users")} AS display_name,
	        avatar_hash, slug
	 FROM users`;

export async function handleUserProfile(
	userId: string,
	request: Request,
	env: UserProfileEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);

	const row = await env.SHARE_DB.prepare(`${PROFILE_ROW_SQL} WHERE user_id = ?`)
		.bind(userId)
		.first<UserProfileRow>();

	if (!row) {
		return errorResponse("User not found", 404, cors, "NOT_FOUND");
	}

	return jsonResponse(await buildUserProfile(row, request, env), 200, cors);
}

// GET /v1/users/by-slug/:slug — the same profile, resolved by the user's
// profile slug. Public, no auth, no rate limit, exactly like the id route
// (the comment inside buildUserProfile explains why the hottest public read
// takes no events INSERT). Since slugs are derived from display names, that
// makes this an account-existence oracle keyed on names — accepted, and the
// reason the route stays a plain read with nothing to enumerate beyond it.
//
// A slug is only ever the CURRENT holder's: releasing one frees it, so a stale
// /u/<name> either 404s or resolves to whoever holds it now.
//
// A malformed slug never arrives: the route regex only admits the stored
// lowercase shape, so anything else falls through the router to a 404 without
// touching D1. Nothing here lowercases the input — one canonical URL per user
// is the point, so /u/Foo is a miss, not a redirect.
export async function handleUserBySlug(
	slug: string,
	request: Request,
	env: UserProfileEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);

	const row = await env.SHARE_DB.prepare(`${PROFILE_ROW_SQL} WHERE slug = ?`)
		.bind(slug)
		.first<UserProfileRow>();

	if (!row) {
		return errorResponse("User not found", 404, cors, "NOT_FOUND");
	}

	return jsonResponse(await buildUserProfile(row, request, env), 200, cors);
}

// The profile payload, assembled from an already-resolved users row.
//
// Takes the row rather than a user_id because each route resolved it by its
// own key and holds it already — an id parameter would mean re-SELECTing a row
// in hand, a second query on the site's hottest public read. It also leaves
// the 404 where it belongs: "no such user" is each route's own finding, and
// this function never gets the chance to answer it differently per path.
async function buildUserProfile(
	row: UserProfileRow,
	request: Request,
	env: UserProfileEnv,
) {
	const userId = row.user_id;

	// All-time profile summary for the profile-header card. Deliberately
	// over ALL the user's saves — no collection scope, and no game-type scope
	// but one: the header sits above the scope selector and shouldn't move
	// with it, yet challenge runs are out of all three reads below.
	// Visibility is the only other narrowing: owner sees private+public,
	// others public-only.
	//
	// Runs are the exception because a run is not a game the user sat down to
	// play — a challenge fixes its map's nation and seat, so a handful of runs
	// on one map can take over the modal nation the card calls a favourite,
	// and they do it on a map every runner shares. win_rate needs nothing of
	// its own (a run's save has no winner, so user_won is NULL and the
	// denominator skips it already) but shares the query with total.
	//
	// Two consequences. The header's total no longer equals the sum of the
	// scope selector's buckets underneath it, whose `challenge` bucket counts
	// runs on purpose (GAME_TYPE_PREDICATES, games-scope.ts) — that shelf is
	// where runs are meant to be countable. And the home page's "all-time
	// games" line reads this same number (yourSeason, src/routes/+page.ts), so
	// it narrows along with it.
	const session = await sessionFromRequest(env, request);
	const vis = session?.data.user_id === userId ? "" : " AND is_public = 1";
	const noRuns = ` AND ${noChallengeRunsSql()}`;
	const [
		countsRow,
		nationRow,
		dayRow,
		channelsRes,
		participationRow,
		screenshotsRow,
	] = await Promise.all([
		env.SHARE_DB.prepare(
			`SELECT COUNT(*) AS total,
			        CAST(SUM(CASE WHEN user_won = 1 THEN 1 ELSE 0 END) AS REAL)
			          / NULLIF(SUM(CASE WHEN user_won IS NOT NULL THEN 1 ELSE 0 END), 0)
			          AS win_rate
			 FROM games WHERE user_id = ?${vis}${noRuns}`,
		)
			.bind(userId)
			.first<{ total: number; win_rate: number | null }>(),
		env.SHARE_DB.prepare(
			`SELECT user_nation FROM games
			 WHERE user_id = ? AND user_nation IS NOT NULL${vis}${noRuns}
			 GROUP BY user_nation
			 ORDER BY COUNT(*) DESC, user_nation ASC
			 LIMIT 1`,
		)
			.bind(userId)
			.first<{ user_nation: string }>(),
		env.SHARE_DB.prepare(
			`SELECT CAST(strftime('%w', save_date) AS INTEGER) AS weekday
			 FROM games WHERE user_id = ? AND save_date IS NOT NULL${vis}${noRuns}
			 GROUP BY weekday
			 ORDER BY COUNT(*) DESC, weekday ASC
			 LIMIT 1`,
		)
			.bind(userId)
			.first<{ weekday: number | null }>(),
		// Linked video/stream channels — public, so the profile page can decide
		// whether to render the "Videos" tab without a second request. Videos
		// themselves load lazily via GET /v1/users/:id/videos when that tab opens.
		env.SHARE_DB.prepare(
			`SELECT platform, channel_url FROM user_video_channels
			 WHERE user_id = ? ORDER BY platform`,
		)
			.bind(userId)
			.all<{ platform: string; channel_url: string }>(),
		// Does this user appear in tournaments at all — same "render the tab?"
		// role `channels` plays for Videos, with the payload itself loading
		// lazily via GET /v1/users/:id/tournaments when the tab opens.
		//
		// "Has an attributable match OR has cast": exactly the two sections that
		// endpoint returns, so the flag can't disagree with the payload in either
		// direction. Holding a slot is deliberately NOT the test — it's neither
		// sufficient (a seat before round one, or one whose only match was a bye,
		// renders nothing) nor necessary (a substituted-out player holds no slot
		// yet keeps every match they played, via the report-time snapshot). The
		// match half reuses USER_MATCHES_WHERE for that reason: one rule, so a
		// later change to attribution can't leave the tab reachable-but-empty or
		// hidden-but-populated.
		//
		// Two EXISTS, five index-backed legs, no table scan (verified with
		// EXPLAIN QUERY PLAN): idx_matches_slot_a/b_user (0035) for the snapshot
		// halves, idx_slots_user (0006) + idx_matches_slot_a/b (0006) for the live
		// halves, idx_match_casters_user (0034) for the cast. The four attribution
		// legs materialize as a UNION temp b-tree rather than short-circuiting,
		// which the outer EXISTS then probes through the matches PK — bounded by
		// one player's match count, so the cost is the id list, not a scan. The
		// cast half is why that join table exists — the
		// equivalent question against the `parts` blob is a nested json_each
		// fan-out with no possible index, and it would run on every profile view
		// WITHOUT a slot, which is most of them. A rate limit is deliberately NOT
		// the answer here: it would add an `events` INSERT to the site's hottest
		// public read (and newly 429 an endpoint every SSR page load hits) to
		// avoid indexed reads.
		env.SHARE_DB.prepare(
			`SELECT EXISTS (
			          SELECT 1 FROM tournament_matches m WHERE ${USER_MATCHES_WHERE})
			     OR EXISTS (SELECT 1 FROM tournament_match_casters WHERE user_id = ?)
			        AS participates`,
		)
			.bind(userId, userId, userId, userId, userId)
			.first<{ participates: number }>(),
		// Does this user have any screenshot THIS VIEWER can see — the same
		// "render the tab?" role `channels` plays for Videos and
		// `participates` for Tournaments, with the shots themselves loading
		// lazily via GET /v1/users/:id/screenshots when the tab opens.
		//
		// The predicate is the one that read applies, so the flag can't
		// disagree with the payload in either direction. That is what makes
		// it viewer-dependent: a classifier-queued row is a tab for its own
		// uploader, who can delete it from there, and no tab for anybody
		// else. Visibility still needs no leg of its own — a screenshot
		// requires a public game — and the comparison costs nothing extra,
		// since `vis` above already read the session.
		//
		// Index-backed on idx_game_screenshots_user (0050), and an EXISTS
		// rather than a COUNT so it stops at the first row. That matters on
		// the site's hottest public read, which is also why this endpoint
		// carries no rate limit of its own.
		env.SHARE_DB.prepare(
			`SELECT EXISTS (
			          SELECT 1 FROM game_screenshots
			          WHERE user_id = ?
			            AND (hidden_at IS NULL
			                 OR (hidden_by IS NULL AND user_id = ?))
			        ) AS has_screenshots`,
		)
			.bind(userId, session?.data.user_id ?? null)
			.first<{ has_screenshots: number }>(),
	]);

	return {
		user_id: row.user_id,
		display_name: row.display_name,
		avatar_url: buildAvatarUrl(row.discord_id, row.avatar_hash),
		// The profile URL, or null for a user whose display name yielded none and
		// who hasn't set one. Carried on the payload so a link site that already
		// holds the profile can emit /u/<slug> directly instead of the id URL
		// plus a redirect hop.
		slug: row.slug,
		summary: {
			total_games: countsRow?.total ?? 0,
			win_rate: countsRow?.win_rate ?? null,
			favorite_nation: nationRow?.user_nation ?? null,
			favorite_day_of_week: dayRow?.weekday ?? null,
		},
		channels: channelsRes.results ?? [],
		tournament_participant: (participationRow?.participates ?? 0) === 1,
		has_screenshots: (screenshotsRow?.has_screenshots ?? 0) === 1,
	};
}

// POST /v1/users/me/slug — set the caller's profile URL, claiming a name for an
// account that has none or renaming the one it has. DELETE releases it.
//
// Most accounts arrive here already holding a slug: one is derived from the
// display name at first login (assignDerivedUserSlug, identity.ts). So this
// endpoint's real job is the correction — a name that slugified into something
// its owner doesn't want, collided with an existing one, or didn't survive at
// all — plus renames afterwards. It has to work identically for a caller with a
// slug and one without, which is why "you already have one" is no longer an
// error condition and SLUG_ALREADY_SET is gone.
//
// A released or overwritten name goes straight back into the pool, so
// /u/<old-name> can later belong to someone else. Accepted, and the same trade
// `admin clear-slug` already makes: /users/<user_id> is the permanent permalink
// and every internal link resolves through it (profileHref).
//
// Rate-limited on *attempts*, not successes, and the two bounds are separate on
// purpose. Every well-formed request is a real D1 write whether or not it
// lands — a name-availability probe, cheap in itself since slugs are public,
// but unbounded writes — so the hourly budget counts calls. How often the
// column can actually CHANGE is bounded instead by the cooldown predicate
// below, in the same statement as the write, which is where the set-once
// `slug IS NULL` predicate used to sit. Successes stay bounded by a race-safe
// property of the UPDATE rather than by a count someone could race.
//
// Hence its own counter (`slug_claim_attempt`, 24h retention) rather than
// counting `slug_claim` rows: those are the durable success record, at most one
// a week, so they can't bound a per-hour budget. The ceiling only has to leave
// room for a few rejected names in a sitting.
export const SLUG_CLAIM_ATTEMPTS_PER_USER_PER_HOUR = 15;

// How long after changing their profile URL a user waits before changing it
// again. What's being priced is name-cycling: a released name is immediately
// claimable by anyone, so a user who renames on a whim leaves a trail of live
// /u/<name> links pointing at whoever picks each one up next, and a determined
// one could park on a series of recognizable names. A week makes a rename a
// decision without making it a commitment — long enough that the churn above is
// not a usable pattern, short enough that a typo costs a wait rather than a
// support ticket.
//
// The clock starts at the last *self-service* change, so the derived slug a new
// account is handed costs nothing: users.slug_changed_at is NULL until this
// endpoint writes it (migration 0040), which makes the first correction — the
// case this endpoint mostly exists for — immediate. Operator writes
// (`admin set-slug`/`clear-slug`) leave it alone for the same reason.
export const SLUG_RENAME_COOLDOWN_DAYS = 7;

export interface ClaimSlugEnv extends UserProfileEnv, EventsEnv {}

// The cooldown as the pair of things every reader of it needs: the SQLite
// modifier for the UPDATE predicate, and the JS milliseconds for the "try again
// in …" message. One constant, so a changed window can't move one and not the
// other.
const COOLDOWN_MODIFIER = `-${SLUG_RENAME_COOLDOWN_DAYS} days`;
const COOLDOWN_MS = SLUG_RENAME_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

interface SlugStateRow {
	slug: string | null;
	slug_changed_at: string | null;
}

// How much of the cooldown is left, phrased for a user. `changedAt` is D1's
// datetime('now') text ("YYYY-MM-DD HH:MM:SS", always UTC) — reassembled into
// an ISO instant rather than handed to the Date parser as-is, which would read
// it as local time and shift the answer by the runtime's offset.
function cooldownMessage(changedAt: string): string {
	const readyAt = new Date(`${changedAt.replace(" ", "T")}Z`).getTime();
	const msLeft = readyAt + COOLDOWN_MS - Date.now();
	const hoursLeft = Math.ceil(msLeft / (60 * 60 * 1000));
	const when =
		hoursLeft > 48
			? `${Math.ceil(hoursLeft / 24)} days`
			: hoursLeft > 1
				? `${hoursLeft} hours`
				: "an hour";
	return `You changed your profile URL recently — you can change it again in ${when}`;
}

// The attempts budget, shared by both writers of this column. Returns the 429
// response when the caller is over it, or null to proceed — and spends one
// attempt as it goes, since a rejected write is exactly the case the budget
// exists for and spending it must not depend on the outcome.
//
// The counter row is metadata-free and fire-and-forget: which names a user
// tried is not worth retaining, and the ones that landed are recorded by
// slug_claim / slug_release below.
async function spendSlugAttempt(
	env: ClaimSlugEnv,
	userId: string,
	cors: Record<string, string>,
): Promise<Response | null> {
	const attempts = await countEventsSince(
		env.EVENTS_DB,
		"slug_claim_attempt",
		"user_id",
		userId,
	);
	if (attempts >= SLUG_CLAIM_ATTEMPTS_PER_USER_PER_HOUR) {
		return errorResponse(
			"Too many profile URL attempts — try again later",
			429,
			cors,
			"RATE_LIMIT_SLUG_CLAIM",
		);
	}

	env.EVENTS_DB.prepare(
		`INSERT INTO events (event_type, user_id) VALUES ('slug_claim_attempt', ?)`,
	)
		.bind(userId)
		.run()
		.catch((e: unknown) => {
			logError("slug_claim_attempt_audit_failed", e, { user_id: userId });
		});

	return null;
}

// The durable record of a change to this column, awaited rather than
// fire-and-forget: an un-awaited write can be canceled by response teardown
// (issue #75), and with renames in play this is the only trace of which names
// have been held by whom — the users row shows the current value only, and a
// name released here is claimable by anyone from the next request onward.
//
// The .catch keeps a failed audit from failing a change that has committed.
async function auditSlugChange(
	env: ClaimSlugEnv,
	userId: string,
	eventType: "slug_claim" | "slug_release",
	metadata: Record<string, string | null>,
): Promise<void> {
	await env.EVENTS_DB.prepare(
		`INSERT INTO events (event_type, user_id, metadata) VALUES (?, ?, ?)`,
	)
		.bind(eventType, userId, JSON.stringify(metadata))
		.run()
		.catch((e: unknown) => {
			logError(`${eventType}_audit_failed`, e, { user_id: userId });
		});
}

export async function handleSetSlug(
	request: Request,
	env: ClaimSlugEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const session = await sessionFromRequest(env, request);
	if (!session) {
		return errorResponse("Authentication required", 401, cors, "UNAUTHORIZED");
	}

	// Budget first, same ordering as the two searches: a hammered account fails
	// before any body parse, DB write, or counter insert.
	const overBudget = await spendSlugAttempt(env, session.data.user_id, cors);
	if (overBudget) return overBudget;

	// Shared parse for the envelope — it carries the Content-Type check that
	// keeps a form-encoded cross-origin POST off this endpoint. The slug field
	// is then validated on its own so a bad *name* answers INVALID_SLUG with
	// the format rule, rather than the generic INVALID_BODY a schema failure
	// inside parseJsonBody would produce; the Settings card renders the message
	// verbatim, so it has to read as advice.
	const body = await parseJsonBody(request, ClaimSlugSchema, cors);
	if (!body.ok) return body.response;

	const validated = v.safeParse(SlugSchema, body.body.slug);
	if (!validated.success) {
		return errorResponse(
			validated.issues[0]?.message ?? "Invalid profile URL",
			400,
			cors,
			"INVALID_SLUG",
		);
	}
	const slug = validated.output;

	// Read-then-write in one batch, which D1 runs as a transaction — so the
	// pre-image is the state the UPDATE decided against, not a racing read of
	// it. That pre-image is doing two jobs: it names the slug being released
	// (for the audit row, the only place a released name is recorded) and it
	// distinguishes the two reasons the UPDATE can match nothing, which the
	// UPDATE itself can't tell apart.
	//
	// The predicates, in the order they retire:
	//   * `slug IS NOT ?` — re-submitting the name you already hold changes
	//     nothing, so it must not spend a week of cooldown on a no-op. NULL-safe
	//     `IS NOT`, since the common caller has no slug at all.
	//   * the cooldown pair — successor to the set-once `slug IS NULL`, and it
	//     keeps that predicate's property: how often this can SUCCEED is a
	//     race-safe fact about the statement rather than a count two concurrent
	//     requests could both pass.
	// Uniqueness stays the index's job for the same reason — two simultaneous
	// claims of one name would both clear a pre-SELECT.
	let before: SlugStateRow | undefined;
	let changes: number;
	try {
		const [read, write] = await env.SHARE_DB.batch<SlugStateRow>([
			env.SHARE_DB.prepare(
				`SELECT slug, slug_changed_at FROM users WHERE user_id = ?`,
			).bind(session.data.user_id),
			env.SHARE_DB.prepare(
				`UPDATE users SET slug = ?, slug_changed_at = datetime('now')
				 WHERE user_id = ?
				   AND slug IS NOT ?
				   AND (slug_changed_at IS NULL
				        OR slug_changed_at <= datetime('now', ?))`,
			).bind(slug, session.data.user_id, slug, COOLDOWN_MODIFIER),
		]);
		before = read.results[0];
		changes = write.meta?.changes ?? 0;
	} catch (e) {
		if (isUniqueViolation(e, "users.slug")) {
			return errorResponse(
				`"${slug}" is already taken`,
				409,
				cors,
				"SLUG_TAKEN",
			);
		}
		throw e;
	}

	// No row behind a live session: the account was deleted (admin nuke-user)
	// while it was signed in. The session no longer identifies anyone, and 401
	// is what the client already knows to bounce on.
	if (!before) {
		return errorResponse("Authentication required", 401, cors, "UNAUTHORIZED");
	}

	if (changes === 0) {
		// Already yours — idempotent, so a double-submit reads as success rather
		// than as a cooldown the user didn't spend.
		if (before.slug === slug) return jsonResponse({ slug }, 200, cors);

		// Which leaves the cooldown, and `slug_changed_at` is necessarily set:
		// the row exists and the value would change, so a NULL there would have
		// satisfied every predicate and matched. Asserted rather than branched
		// on — a fallback message here would be for a state the transaction
		// rules out.
		return errorResponse(
			cooldownMessage(before.slug_changed_at!),
			429,
			cors,
			"RATE_LIMIT_SLUG_RENAME",
		);
	}

	await auditSlugChange(env, session.data.user_id, "slug_claim", {
		slug,
		previous_slug: before.slug,
	});

	return jsonResponse({ slug }, 200, cors);
}

// DELETE /v1/users/me/slug — release the caller's profile URL, leaving them at
// the /users/<user_id> permalink until they set another.
//
// Deliberately NOT gated by the rename cooldown, unlike the setter. The one
// thing a user must always be able to do is take their name back out of a
// public URL — a name they were handed at signup rather than chose, at that —
// and making that wait a week to satisfy the symmetry would be the wrong side
// of the trade. It still STAMPS the cooldown, which is what stops
// release-then-claim from being the bypass that makes the setter's gate
// decorative.
//
// 204 and idempotent, matching DELETE /v1/users/me/online-ids/:id: the new
// state is "no slug" whether or not this call is the one that made it so, and
// the account page has nothing to read back.
export async function handleReleaseSlug(
	request: Request,
	env: ClaimSlugEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const session = await sessionFromRequest(env, request);
	if (!session) {
		return errorResponse("Authentication required", 401, cors, "UNAUTHORIZED");
	}

	// Same budget as the setter, and for the same reason: this is the column's
	// other writer, and a hammered account shouldn't get unbounded writes here
	// either.
	const overBudget = await spendSlugAttempt(env, session.data.user_id, cors);
	if (overBudget) return overBudget;

	// Same read-then-write batch as the setter — the pre-image is what names the
	// released slug for the audit row. `slug IS NOT NULL` keeps a repeat call
	// from restamping the cooldown on a no-op.
	const [read, write] = await env.SHARE_DB.batch<SlugStateRow>([
		env.SHARE_DB.prepare(
			`SELECT slug, slug_changed_at FROM users WHERE user_id = ?`,
		).bind(session.data.user_id),
		env.SHARE_DB.prepare(
			`UPDATE users SET slug = NULL, slug_changed_at = datetime('now')
			 WHERE user_id = ? AND slug IS NOT NULL`,
		).bind(session.data.user_id),
	]);

	if ((write.meta?.changes ?? 0) > 0) {
		await auditSlugChange(env, session.data.user_id, "slug_release", {
			previous_slug: read.results[0]?.slug ?? null,
		});
	}

	return new Response(null, { status: 204, headers: cors });
}
