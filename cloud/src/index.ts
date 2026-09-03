// Per-Ankh Worker — the cloud API.
//
// Entry points (browser-first):
//   POST   /v1/auth/discord/start
//   POST   /v1/auth/discord/callback
//   GET    /v1/auth/me
//   POST   /v1/auth/logout
//
// Storage: R2 for blobs, D1 for indices/users, KV for sessions+OAuth state.
//
// Besides `fetch`, the Worker exports a `scheduled` handler running three
// jobs, dispatched by cron pattern (crons in wrangler.toml): the nightly
// events-retention sweep (policy in retention.ts), the public /stats bundle
// precompute, one pattern per slice, and the hourly warm that rebuilds any
// missing unfaceted /stats bundle (both in stats/precompute.ts).

import {
	adoptTrustedFrontend,
	cloudCorsHeaders,
	type TrustedFrontendEnv,
} from "./util";
import { instrumentD1, staleTolerantSession } from "./d1";
import type { QueryableD1 } from "./d1";
import {
	emitAccessLog,
	getRequestId,
	logError,
	logEvent,
	logWarn,
	runWithLogContext,
	setRoute,
} from "./log";
import { RETENTION_CRON, sweepEvents, sweepSecurityEvents } from "./retention";
import { emitSecurityEvent } from "./security-events";
import type { SecurityEventsEnv } from "./security-events";
import {
	handleDevLogin,
	handleDiscordCallback,
	handleDiscordStart,
	handleLogout,
	handleMe,
	handleSettings,
} from "./auth";
import type { AuthEnv } from "./auth";
import {
	handleGameDelete,
	handleGameDetail,
	handleAdminDownload,
	handleAdminListAllGames,
	handleAdminListOutOfDate,
	handleAdminReindex,
	handleAdminReparseUpload,
	handleGameDownload,
	handleGameList,
	handleGamesOutOfDate,
	handleGamePatch,
	handlePublicRecentGames,
	handleGameUpload,
} from "./games";
import type { GamesEnv } from "./games";
import {
	handleChallengeDetail,
	handleChallengeList,
	handleChallengeMap,
	handleCreateChallenge,
	handleDeleteChallenge,
	handleGameChallengeLink,
	handlePatchChallenge,
} from "./challenges/handlers";
import { handleCollectionCreate, handleCollectionsList } from "./collections";
import type { CollectionsEnv } from "./collections";
import { handleListOnlineIds, handleRemoveOnlineId } from "./online-ids";
import type { OnlineIdsEnv } from "./online-ids";
import { handleCspReport } from "./csp";
import {
	handleGameTournamentLink,
	handleTournamentBracket,
	handleTournamentDetail,
	handleTournamentGamesStats,
	handleTournamentList,
	handleTournamentMatchDetail,
	handleTournamentMatches,
	handleTournamentPlaylistVideos,
	handleTournamentRounds,
	handleTournamentStandings,
	handleTournamentStats,
	handleTournamentVideosFeed,
	handleUserTournaments,
} from "./tournament/public";
import type { TournamentPublicEnv } from "./tournament/public";
import { handleTournamentExport } from "./tournament/export";
import {
	handleCastMatchPart,
	handleDismissBanner,
	handleMyAdminTournaments,
	handleMyTournaments,
	handleTournamentSignup,
	handleTournamentWithdraw,
	handleUncastMatchPart,
} from "./tournament/player";
import { handleGlobalStats, handleUserStats } from "./stats/handlers";
import type { GlobalStatsEnv } from "./stats/handlers";
import {
	STATS_PRECOMPUTE_CRONS,
	STATS_WARM_CRON,
	precomputeGlobalSlice,
	warmGlobalSlices,
} from "./stats/precompute";
import { CURRENT_PARSER_VERSION } from "./schemas/game";
import {
	handlePublicUserSearch,
	handleReleaseSlug,
	handleSetSlug,
	handleUserBySlug,
	handleUserProfile,
	handleUserSearch,
} from "./users";
import {
	handleAddChannel,
	handleCreatorVideos,
	handleDeleteChannel,
	handleListMyChannels,
	handleUserVideos,
} from "./channels";
import type { ChannelsEnv } from "./channels";
import {
	handleFeatureVideo,
	handleListFeaturedVideos,
	handlePublicFeaturedVideos,
	handleUnfeatureVideo,
} from "./featured";
import type { FeaturedVideosEnv } from "./featured";
import type { TournamentPlayerEnv } from "./tournament/player";
import {
	handleAddRoundMatch,
	handleBulkCreateSlots,
	handleCreateTournament,
	handleDeleteSlot,
	handleDeleteTournament,
	handleGrantTournamentAdmin,
	handleListTournamentAdmins,
	handlePatchMatchMap,
	handlePatchMatchSchedule,
	handlePatchSlot,
	handlePatchTournament,
	handleReinstateSlot,
	handleReorderSlots,
	handleSwapSlots,
	handleRevokeTournamentAdmin,
	handleRetroEditMatch,
	handleStartTournament,
	handleTransitionChampionship,
	handleWithdrawSlot,
} from "./tournament/admin";
import type { TournamentAdminEnv } from "./tournament/admin";

// The per-request env handlers receive. `SHARE_DB` is a `QueryableD1` because
// `routeEnv` may substitute a Sessions API handle for the raw binding, and
// `EVENTS_DB` is derived rather than bound. See d1.ts for the scheme.
interface Env
	extends
		AuthEnv,
		GamesEnv,
		CollectionsEnv,
		OnlineIdsEnv,
		TournamentPublicEnv,
		TournamentPlayerEnv,
		TournamentAdminEnv,
		ChannelsEnv,
		FeaturedVideosEnv,
		GlobalStatsEnv,
		SecurityEventsEnv,
		TrustedFrontendEnv {
	SHARE_BUCKET: R2Bucket;
	SHARE_DB: QueryableD1;
	EVENTS_DB: D1Database;
	SESSIONS_KV: KVNamespace;
	ALLOWED_ORIGINS: string;
	DISCORD_CLIENT_ID: string;
	DISCORD_CLIENT_SECRET: string;
	SESSION_COOKIE_NAME: string;
}

// What wrangler.toml actually binds, as handed to `fetch` and `scheduled`:
// one real `D1Database`, no `EVENTS_DB`. `routeEnv` bridges this to `Env` and
// is the only place allowed to — deriving the two handles anywhere else would
// put a second, unreviewed replication policy in the codebase.
type RawBindings = Omit<Env, "SHARE_DB" | "EVENTS_DB"> & {
	SHARE_DB: D1Database;
};

// === Router ===
//
// Routes are declared as a typed table so the dispatch loop can:
//   (a) match by exact path or regex,
//   (b) set the route pattern (e.g. "GET /v1/games/:id") on the log
//       context for stable per-route grouping in the log sinks,
//   (c) keep route additions to a single self-describing edit.
//
// More-specific patterns (e.g. /v1/games/:id/download) MUST appear before
// more-generic ones (/v1/games/:id) — first match wins.

type RouteHandler = (
	request: Request,
	env: Env,
	match: RegExpMatchArray | null,
	ctx: ExecutionContext,
) => Promise<Response>;

interface RouteSpec {
	method: string;
	match: { kind: "path"; path: string } | { kind: "regex"; regex: RegExp };
	route: string;
	handler: RouteHandler;
	// Opt this route's `SHARE_DB` into D1 read replication. The session
	// anchors `first-primary` (see d1.ts), so its reads are as fresh as the
	// database was when the request arrived — the route serves replicas, not
	// stale data. Omitted — the default — keeps the route on the primary
	// exactly as before.
	//
	// Two things disqualify a route, and its handler's whole transitive call
	// graph has to clear both:
	//
	//   - It writes to D1. A write anchors the bookmark forward, so every
	//     later read in the request waits for a replica to catch up to it —
	//     the latency cost with none of the benefit.
	//   - It decides something on a *concurrent* request's write (a counter,
	//     a uniqueness probe, a CAS guard). Anchoring at request arrival
	//     can't see what landed mid-flight.
	//
	// The flag is route-level, so it cannot express "read-only for some
	// callers": if either branch disqualifies, the route doesn't qualify.
	// `events` queries are exempt from the audit — they run on EVENTS_DB, off
	// the session, which is what settles the counter case for every route.
	//
	// Adding one here also needs an entry in stale-tolerant-routes.test.ts.
	staleTolerant?: true;
}

const ROUTES: RouteSpec[] = [
	// Cloud rewrite: /v1/auth/*
	{
		method: "POST",
		match: { kind: "path", path: "/v1/auth/discord/start" },
		route: "POST /v1/auth/discord/start",
		handler: (r, e) => handleDiscordStart(r, e),
	},
	{
		method: "POST",
		match: { kind: "path", path: "/v1/auth/discord/callback" },
		route: "POST /v1/auth/discord/callback",
		handler: (r, e) => handleDiscordCallback(r, e),
	},
	{
		method: "GET",
		match: { kind: "path", path: "/v1/auth/me" },
		route: "GET /v1/auth/me",
		handler: (r, e) => handleMe(r, e),
	},
	{
		// Local-only login bypass; returns 404 in prod (gated in handleDevLogin
		// on DEV_LOGIN + non-HTTPS). GET so it works from the browser bar.
		method: "GET",
		match: { kind: "path", path: "/v1/auth/dev/login" },
		route: "GET /v1/auth/dev/login",
		handler: (r, e) => handleDevLogin(r, e),
	},
	{
		method: "POST",
		match: { kind: "path", path: "/v1/auth/settings" },
		route: "POST /v1/auth/settings",
		handler: (r, e) => handleSettings(r, e),
	},
	// Self-service video/stream channels (see cloud/src/channels.ts). Grouped
	// with /v1/auth/settings — both are session-scoped account writes.
	{
		method: "GET",
		match: { kind: "path", path: "/v1/auth/channels" },
		route: "GET /v1/auth/channels",
		handler: (r, e) => handleListMyChannels(r, e),
	},
	{
		method: "POST",
		match: { kind: "path", path: "/v1/auth/channels" },
		route: "POST /v1/auth/channels",
		handler: (r, e) => handleAddChannel(r, e),
	},
	{
		method: "DELETE",
		match: { kind: "regex", regex: /^\/v1\/auth\/channels\/([a-z]+)$/ },
		route: "DELETE /v1/auth/channels/:platform",
		handler: (r, e, m) => handleDeleteChannel(m![1], r, e),
	},
	{
		method: "POST",
		match: { kind: "path", path: "/v1/auth/logout" },
		route: "POST /v1/auth/logout",
		handler: (r, e) => handleLogout(r, e),
	},

	// Cloud rewrite: /v1/games/*
	{
		method: "POST",
		match: { kind: "path", path: "/v1/games" },
		route: "POST /v1/games",
		handler: (r, e) => handleGameUpload(r, e),
	},
	{
		method: "GET",
		match: { kind: "path", path: "/v1/games" },
		route: "GET /v1/games",
		handler: (r, e) => handleGameList(r, e),
	},
	{
		method: "GET",
		match: { kind: "path", path: "/v1/games/public-recent" },
		route: "GET /v1/games/public-recent",
		handler: (r, e) => handlePublicRecentGames(r, e),
	},
	{
		method: "GET",
		match: { kind: "path", path: "/v1/games/out-of-date" },
		route: "GET /v1/games/out-of-date",
		handler: (r, e) => handleGamesOutOfDate(r, e),
	},
	{
		method: "GET",
		match: {
			kind: "regex",
			regex: /^\/v1\/games\/([A-Za-z0-9_-]{21})\/download$/,
		},
		route: "GET /v1/games/:id/download",
		handler: (r, e, m) => handleGameDownload(m![1], r, e),
	},
	{
		method: "GET",
		match: { kind: "regex", regex: /^\/v1\/games\/([A-Za-z0-9_-]{21})$/ },
		route: "GET /v1/games/:id",
		// Passes ctx so the per-POP blob cache can fill in the background.
		handler: (r, e, m, c) => handleGameDetail(m![1], r, e, c),
	},
	{
		method: "GET",
		match: {
			kind: "regex",
			regex: /^\/v1\/games\/([A-Za-z0-9_-]{21})\/tournament-link$/,
		},
		route: "GET /v1/games/:id/tournament-link",
		handler: (r, e, m) => handleGameTournamentLink(m![1], r, e),
	},
	{
		method: "GET",
		match: {
			kind: "regex",
			regex: /^\/v1\/games\/([A-Za-z0-9_-]{21})\/challenge-link$/,
		},
		route: "GET /v1/games/:id/challenge-link",
		handler: (r, e, m) => handleGameChallengeLink(m![1], r, e),
	},
	{
		method: "PATCH",
		match: { kind: "regex", regex: /^\/v1\/games\/([A-Za-z0-9_-]{21})$/ },
		route: "PATCH /v1/games/:id",
		handler: (r, e, m) => handleGamePatch(m![1], r, e),
	},
	{
		method: "DELETE",
		match: { kind: "regex", regex: /^\/v1\/games\/([A-Za-z0-9_-]{21})$/ },
		route: "DELETE /v1/games/:id",
		handler: (r, e, m) => handleGameDelete(m![1], r, e),
	},

	// Site-admin: bulk reparse across all users. Gated by ADMIN_DISCORD_ID
	// secret inside each handler; failures return 404 to avoid leaking the
	// endpoints' existence.
	{
		method: "GET",
		match: { kind: "path", path: "/v1/admin/games/out-of-date" },
		route: "GET /v1/admin/games/out-of-date",
		handler: (r, e) => handleAdminListOutOfDate(r, e),
	},
	{
		method: "GET",
		match: { kind: "path", path: "/v1/admin/games/all" },
		route: "GET /v1/admin/games/all",
		handler: (r, e) => handleAdminListAllGames(r, e),
	},
	{
		method: "POST",
		match: {
			kind: "regex",
			regex: /^\/v1\/admin\/games\/([A-Za-z0-9_-]{21})\/reindex$/,
		},
		route: "POST /v1/admin/games/:id/reindex",
		handler: (r, e, m) => handleAdminReindex(m![1], r, e),
	},
	{
		method: "GET",
		match: {
			kind: "regex",
			regex: /^\/v1\/admin\/games\/([A-Za-z0-9_-]{21})\/download$/,
		},
		route: "GET /v1/admin/games/:id/download",
		handler: (r, e, m) => handleAdminDownload(m![1], r, e),
	},
	{
		method: "POST",
		match: {
			kind: "regex",
			regex: /^\/v1\/admin\/games\/([A-Za-z0-9_-]{21})\/reparse-upload$/,
		},
		route: "POST /v1/admin/games/:user_id/reparse-upload",
		handler: (r, e, m) => handleAdminReparseUpload(m![1], r, e),
	},

	// Site-admin: the curated featured-video set (see cloud/src/featured.ts).
	// Same gate as the reparse endpoints above — 404 to everyone else.
	{
		method: "GET",
		match: { kind: "path", path: "/v1/admin/featured-videos" },
		route: "GET /v1/admin/featured-videos",
		handler: (r, e) => handleListFeaturedVideos(r, e),
	},
	{
		method: "POST",
		match: { kind: "path", path: "/v1/admin/featured-videos" },
		route: "POST /v1/admin/featured-videos",
		handler: (r, e) => handleFeatureVideo(r, e),
	},
	{
		// Platform + provider-native video id (YouTube's is 11 chars of the
		// same alphabet); bounded here so the id never reaches the query as
		// arbitrary path text.
		method: "DELETE",
		match: {
			kind: "regex",
			regex: /^\/v1\/admin\/featured-videos\/([a-z]+)\/([A-Za-z0-9_-]{1,64})$/,
		},
		route: "DELETE /v1/admin/featured-videos/:platform/:video_id",
		handler: (r, e, m) => handleUnfeatureVideo(m![1], m![2], r, e),
	},

	// Cloud rewrite: /v1/collections
	{
		method: "GET",
		match: { kind: "path", path: "/v1/collections" },
		route: "GET /v1/collections",
		handler: (r, e) => handleCollectionsList(r, e),
	},
	{
		method: "POST",
		match: { kind: "path", path: "/v1/collections" },
		route: "POST /v1/collections",
		handler: (r, e) => handleCollectionCreate(r, e),
	},

	// Cloud rewrite: /v1/users/me/online-ids
	{
		method: "GET",
		match: { kind: "path", path: "/v1/users/me/online-ids" },
		route: "GET /v1/users/me/online-ids",
		handler: (r, e) => handleListOnlineIds(r, e),
	},
	{
		method: "DELETE",
		match: { kind: "regex", regex: /^\/v1\/users\/me\/online-ids\/(.+)$/ },
		route: "DELETE /v1/users/me/online-ids/:id",
		handler: (r, e, m) => handleRemoveOnlineId(decodeURIComponent(m![1]), r, e),
	},

	// Set or release the caller's profile URL (/u/<slug>) — account
	// self-service, so it sits with the other /v1/users/me/* account routes
	// rather than with the public profile reads. One path, two methods: POST
	// claims or renames, DELETE releases. The handlers own the conflicts and
	// the rename cooldown.
	{
		method: "POST",
		match: { kind: "path", path: "/v1/users/me/slug" },
		route: "POST /v1/users/me/slug",
		handler: (r, e) => handleSetSlug(r, e),
	},
	{
		method: "DELETE",
		match: { kind: "path", path: "/v1/users/me/slug" },
		route: "DELETE /v1/users/me/slug",
		handler: (r, e) => handleReleaseSlug(r, e),
	},

	// CSP violation reports — unauthenticated; the browser POSTs here
	// directly when the page's CSP triggers. See cloud/src/csp.ts.
	{
		method: "POST",
		match: { kind: "path", path: "/v1/csp-report" },
		route: "POST /v1/csp-report",
		handler: (r) => handleCspReport(r),
	},

	// Cloud rewrite: /v1/tournaments/* — more-specific patterns first
	// Challenge maps (challenges/handlers.ts). Public reads; create/patch/
	// delete are creator-only; the map download is session-gated.
	{
		method: "GET",
		match: { kind: "path", path: "/v1/challenges" },
		route: "GET /v1/challenges",
		handler: (r, e) => handleChallengeList(r, e),
	},
	{
		method: "POST",
		match: { kind: "path", path: "/v1/challenges" },
		route: "POST /v1/challenges",
		handler: (r, e) => handleCreateChallenge(r, e),
	},
	{
		method: "GET",
		match: { kind: "regex", regex: /^\/v1\/challenges\/(\d{1,6})$/ },
		route: "GET /v1/challenges/:number",
		handler: (r, e, m) => handleChallengeDetail(m![1], r, e),
	},
	{
		method: "PATCH",
		match: { kind: "regex", regex: /^\/v1\/challenges\/(\d{1,6})$/ },
		route: "PATCH /v1/challenges/:number",
		handler: (r, e, m) => handlePatchChallenge(m![1], r, e),
	},
	{
		method: "DELETE",
		match: { kind: "regex", regex: /^\/v1\/challenges\/(\d{1,6})$/ },
		route: "DELETE /v1/challenges/:number",
		handler: (r, e, m) => handleDeleteChallenge(m![1], r, e),
	},
	{
		method: "GET",
		match: { kind: "regex", regex: /^\/v1\/challenges\/(\d{1,6})\/map$/ },
		route: "GET /v1/challenges/:number/map",
		handler: (r, e, m) => handleChallengeMap(m![1], r, e),
	},

	{
		method: "GET",
		match: { kind: "path", path: "/v1/tournaments" },
		route: "GET /v1/tournaments",
		handler: (r, e) => handleTournamentList(r, e),
	},
	{
		method: "POST",
		match: { kind: "path", path: "/v1/tournaments" },
		route: "POST /v1/tournaments",
		handler: (r, e) => handleCreateTournament(r, e),
	},
	{
		method: "GET",
		match: {
			kind: "regex",
			regex: /^\/v1\/tournaments\/([A-Za-z0-9_-]{21})\/standings$/,
		},
		route: "GET /v1/tournaments/:id/standings",
		handler: (r, e, m) => handleTournamentStandings(m![1], r, e),
	},
	{
		method: "GET",
		match: {
			kind: "regex",
			regex: /^\/v1\/tournaments\/([A-Za-z0-9_-]{21})\/bracket$/,
		},
		route: "GET /v1/tournaments/:id/bracket",
		handler: (r, e, m) => handleTournamentBracket(m![1], r, e),
	},
	{
		method: "GET",
		match: {
			kind: "regex",
			regex: /^\/v1\/tournaments\/([A-Za-z0-9_-]{21})\/stats\/games$/,
		},
		route: "GET /v1/tournaments/:id/stats/games",
		handler: (r, e, m) => handleTournamentGamesStats(m![1], r, e),
	},
	{
		method: "GET",
		match: {
			kind: "regex",
			regex: /^\/v1\/tournaments\/([A-Za-z0-9_-]{21})\/stats$/,
		},
		route: "GET /v1/tournaments/:id/stats",
		handler: (r, e, m) => handleTournamentStats(m![1], r, e),
	},
	{
		method: "GET",
		match: {
			kind: "regex",
			regex: /^\/v1\/tournaments\/([A-Za-z0-9_-]{21})\/rounds$/,
		},
		route: "GET /v1/tournaments/:id/rounds",
		handler: (r, e, m) => handleTournamentRounds(m![1], r, e),
	},
	{
		method: "GET",
		match: {
			kind: "regex",
			regex: /^\/v1\/tournaments\/([A-Za-z0-9_-]{21})\/videos$/,
		},
		route: "GET /v1/tournaments/:id/videos",
		// Passes ctx so the video cache can refresh in the background (SWR).
		handler: (r, e, m, c) => handleTournamentPlaylistVideos(m![1], r, e, c),
	},
	{
		method: "GET",
		match: {
			kind: "regex",
			regex: /^\/v1\/tournaments\/([A-Za-z0-9_-]{21})\/matches$/,
		},
		route: "GET /v1/tournaments/:id/matches",
		handler: (r, e, m) => handleTournamentMatches(m![1], r, e),
	},
	{
		method: "GET",
		match: {
			kind: "regex",
			regex: /^\/v1\/tournaments\/([A-Za-z0-9_-]{21})\/export$/,
		},
		route: "GET /v1/tournaments/:id/export",
		handler: (r, e, m) => handleTournamentExport(m![1], r, e),
	},
	{
		method: "GET",
		match: {
			kind: "regex",
			regex:
				/^\/v1\/tournaments\/([A-Za-z0-9_-]{21})\/matches\/([A-Za-z0-9_-]{21})$/,
		},
		route: "GET /v1/tournaments/:id/matches/:match_id",
		handler: (r, e, m) => handleTournamentMatchDetail(m![1], m![2], r, e),
	},
	// Player + admin mutations on matches (more specific than detail GET above)
	{
		method: "PATCH",
		match: {
			kind: "regex",
			regex:
				/^\/v1\/tournaments\/([A-Za-z0-9_-]{21})\/matches\/([A-Za-z0-9_-]{21})\/map$/,
		},
		route: "PATCH /v1/tournaments/:id/matches/:match_id/map",
		handler: (r, e, m) => handlePatchMatchMap(m![1], m![2], r, e),
	},
	{
		method: "PATCH",
		match: {
			kind: "regex",
			regex:
				/^\/v1\/tournaments\/([A-Za-z0-9_-]{21})\/matches\/([A-Za-z0-9_-]{21})\/schedule$/,
		},
		route: "PATCH /v1/tournaments/:id/matches/:match_id/schedule",
		handler: (r, e, m) => handlePatchMatchSchedule(m![1], m![2], r, e),
	},
	{
		method: "POST",
		match: {
			kind: "regex",
			regex:
				/^\/v1\/tournaments\/([A-Za-z0-9_-]{21})\/matches\/([A-Za-z0-9_-]{21})\/parts\/([A-Za-z0-9_-]{1,40})\/casters\/me$/,
		},
		route:
			"POST /v1/tournaments/:id/matches/:match_id/parts/:part_id/casters/me",
		handler: (r, e, m) => handleCastMatchPart(m![1], m![2], m![3], r, e),
	},
	{
		method: "DELETE",
		match: {
			kind: "regex",
			regex:
				/^\/v1\/tournaments\/([A-Za-z0-9_-]{21})\/matches\/([A-Za-z0-9_-]{21})\/parts\/([A-Za-z0-9_-]{1,40})\/casters\/me$/,
		},
		route:
			"DELETE /v1/tournaments/:id/matches/:match_id/parts/:part_id/casters/me",
		handler: (r, e, m) => handleUncastMatchPart(m![1], m![2], m![3], r, e),
	},
	{
		method: "PATCH",
		match: {
			kind: "regex",
			regex:
				/^\/v1\/tournaments\/([A-Za-z0-9_-]{21})\/matches\/([A-Za-z0-9_-]{21})$/,
		},
		route: "PATCH /v1/tournaments/:id/matches/:match_id",
		handler: (r, e, m) => handleRetroEditMatch(m![1], m![2], r, e),
	},
	// Slots
	{
		method: "POST",
		match: {
			kind: "regex",
			regex: /^\/v1\/tournaments\/([A-Za-z0-9_-]{21})\/slots$/,
		},
		route: "POST /v1/tournaments/:id/slots",
		handler: (r, e, m) => handleBulkCreateSlots(m![1], r, e),
	},
	{
		method: "POST",
		match: {
			kind: "regex",
			regex: /^\/v1\/tournaments\/([A-Za-z0-9_-]{21})\/slots\/reorder$/,
		},
		route: "POST /v1/tournaments/:id/slots/reorder",
		handler: (r, e, m) => handleReorderSlots(m![1], r, e),
	},
	{
		method: "POST",
		match: {
			kind: "regex",
			regex: /^\/v1\/tournaments\/([A-Za-z0-9_-]{21})\/slots\/swap$/,
		},
		route: "POST /v1/tournaments/:id/slots/swap",
		handler: (r, e, m) => handleSwapSlots(m![1], r, e),
	},
	{
		method: "PATCH",
		match: {
			kind: "regex",
			regex:
				/^\/v1\/tournaments\/([A-Za-z0-9_-]{21})\/slots\/([A-Za-z0-9_-]{21})$/,
		},
		route: "PATCH /v1/tournaments/:id/slots/:slot_id",
		handler: (r, e, m) => handlePatchSlot(m![1], m![2], r, e),
	},
	{
		method: "DELETE",
		match: {
			kind: "regex",
			regex:
				/^\/v1\/tournaments\/([A-Za-z0-9_-]{21})\/slots\/([A-Za-z0-9_-]{21})$/,
		},
		route: "DELETE /v1/tournaments/:id/slots/:slot_id",
		handler: (r, e, m) => handleDeleteSlot(m![1], m![2], r, e),
	},
	{
		method: "POST",
		match: {
			kind: "regex",
			regex:
				/^\/v1\/tournaments\/([A-Za-z0-9_-]{21})\/slots\/([A-Za-z0-9_-]{21})\/withdraw$/,
		},
		route: "POST /v1/tournaments/:id/slots/:slot_id/withdraw",
		handler: (r, e, m) => handleWithdrawSlot(m![1], m![2], r, e),
	},
	{
		method: "DELETE",
		match: {
			kind: "regex",
			regex:
				/^\/v1\/tournaments\/([A-Za-z0-9_-]{21})\/slots\/([A-Za-z0-9_-]{21})\/withdraw$/,
		},
		route: "DELETE /v1/tournaments/:id/slots/:slot_id/withdraw",
		handler: (r, e, m) => handleReinstateSlot(m![1], m![2], r, e),
	},
	// Late pairing: add a match to an open Swiss round (admin). Completes
	// the withdraw -> substitute -> reinstate workflow with a catch-up game.
	{
		method: "POST",
		match: {
			kind: "regex",
			regex:
				/^\/v1\/tournaments\/([A-Za-z0-9_-]{21})\/rounds\/([A-Za-z0-9_-]{21})\/matches$/,
		},
		route: "POST /v1/tournaments/:id/rounds/:round_id/matches",
		handler: (r, e, m) => handleAddRoundMatch(m![1], m![2], r, e),
	},
	// Lifecycle — single admin gate (the second is /transition-championship).
	// Round 1 for both Swiss divisions is generated in this same call;
	// subsequent rounds auto-spawn when the prior one is fully reported,
	// and the tournament auto-completes on the championship final.
	{
		method: "POST",
		match: {
			kind: "regex",
			regex: /^\/v1\/tournaments\/([A-Za-z0-9_-]{21})\/start$/,
		},
		route: "POST /v1/tournaments/:id/start",
		handler: (r, e, m) => handleStartTournament(m![1], r, e),
	},
	{
		method: "POST",
		match: {
			kind: "regex",
			regex:
				/^\/v1\/tournaments\/([A-Za-z0-9_-]{21})\/transition-championship$/,
		},
		route: "POST /v1/tournaments/:id/transition-championship",
		handler: (r, e, m) => handleTransitionChampionship(m![1], r, e),
	},
	// Player self-service signup/withdraw.
	{
		method: "POST",
		match: {
			kind: "regex",
			regex: /^\/v1\/tournaments\/([A-Za-z0-9_-]{21})\/signup$/,
		},
		route: "POST /v1/tournaments/:id/signup",
		handler: (r, e, m) => handleTournamentSignup(m![1], r, e),
	},
	{
		method: "DELETE",
		match: {
			kind: "regex",
			regex: /^\/v1\/tournaments\/([A-Za-z0-9_-]{21})\/signup$/,
		},
		route: "DELETE /v1/tournaments/:id/signup",
		handler: (r, e, m) => handleTournamentWithdraw(m![1], r, e),
	},
	// Admin roster management. Creator + co-admins; the management endpoints
	// are gated by requireTournamentAdmin inside the handlers.
	{
		method: "GET",
		match: {
			kind: "regex",
			regex: /^\/v1\/tournaments\/([A-Za-z0-9_-]{21})\/admins$/,
		},
		route: "GET /v1/tournaments/:id/admins",
		handler: (r, e, m) => handleListTournamentAdmins(m![1], r, e),
	},
	{
		method: "POST",
		match: {
			kind: "regex",
			regex: /^\/v1\/tournaments\/([A-Za-z0-9_-]{21})\/admins$/,
		},
		route: "POST /v1/tournaments/:id/admins",
		handler: (r, e, m) => handleGrantTournamentAdmin(m![1], r, e),
	},
	{
		method: "DELETE",
		match: {
			kind: "regex",
			regex:
				/^\/v1\/tournaments\/([A-Za-z0-9_-]{21})\/admins\/([A-Za-z0-9_-]{21})$/,
		},
		route: "DELETE /v1/tournaments/:id/admins/:user_id",
		handler: (r, e, m) => handleRevokeTournamentAdmin(m![1], m![2], r, e),
	},
	{
		method: "PATCH",
		match: {
			kind: "regex",
			regex: /^\/v1\/tournaments\/([A-Za-z0-9_-]{21})$/,
		},
		route: "PATCH /v1/tournaments/:id",
		handler: (r, e, m) => handlePatchTournament(m![1], r, e),
	},
	// Delete (cancel == delete). Creator or site admin only; completed
	// tournaments are CLI-only. Authz lives in the handler, not the route.
	{
		method: "DELETE",
		match: {
			kind: "regex",
			regex: /^\/v1\/tournaments\/([A-Za-z0-9_-]{21})$/,
		},
		route: "DELETE /v1/tournaments/:id",
		handler: (r, e, m) => handleDeleteTournament(m![1], r, e),
	},
	// Tournament detail by slug (must come AFTER all /tournaments/:id/... routes;
	// slug regex is broader)
	{
		method: "GET",
		match: {
			kind: "regex",
			regex: /^\/v1\/tournaments\/([a-z0-9][a-z0-9-]{0,63})$/,
		},
		route: "GET /v1/tournaments/:slug",
		handler: (r, e, m) => handleTournamentDetail(m![1], r, e),
	},

	// User search — autocomplete source for the slot-creation form.
	// Must come before any /v1/users/me/... regex routes so the exact-
	// path match wins.
	{
		method: "GET",
		match: { kind: "path", path: "/v1/users/search" },
		route: "GET /v1/users/search",
		handler: (r, e) => handleUserSearch(r, e),
	},
	// People search for the header dropdown — the public-facing sibling of
	// /search above (no discord_* in the response, scoped to users with
	// public activity). Same exact-path-before-nanoid-regex placement.
	{
		method: "GET",
		match: { kind: "path", path: "/v1/users/public-search" },
		route: "GET /v1/users/public-search",
		handler: (r, e) => handlePublicUserSearch(r, e),
	},
	// The same public profile as /v1/users/:user_id, resolved by the user's
	// slug — what /u/<slug> reads. The literal `by-slug/` segment
	// can't be swallowed by the nanoid regex below ("/" isn't in its class),
	// but specific-before-generic is the house rule. The pattern admits only
	// the stored lowercase shape, so a malformed slug 404s here rather than
	// reaching D1.
	{
		method: "GET",
		match: {
			kind: "regex",
			regex: /^\/v1\/users\/by-slug\/([a-z0-9][a-z0-9-]{1,28}[a-z0-9])$/,
		},
		route: "GET /v1/users/by-slug/:slug",
		handler: (r, e, m) => handleUserBySlug(m![1], r, e),
	},
	// Public user profile. Regex match — the 21-char constraint distinguishes
	// nanoid user_ids from the other /v1/users/{search,me,…} routes above.
	{
		method: "GET",
		match: { kind: "regex", regex: /^\/v1\/users\/([A-Za-z0-9_-]{21})$/ },
		route: "GET /v1/users/:user_id",
		handler: (r, e, m) => handleUserProfile(m![1], r, e),
	},
	// User-corpus aggregate stats — public, owner sees their own private
	// games included, visitor / anon sees public-only.
	{
		method: "GET",
		match: {
			kind: "regex",
			regex: /^\/v1\/users\/([A-Za-z0-9_-]{21})\/stats$/,
		},
		route: "GET /v1/users/:user_id/stats",
		handler: (r, e, m) => handleUserStats(m![1], r, e),
		// The one route with no D1 write anywhere in its call graph:
		// stats/resolve.ts and stats/aggregate.ts are SELECT-only and the
		// bundle cache lives in KV (stats/cache.ts), not D1. Its 11 query
		// sites all ride the one session: two sequential in resolveUserCorpus,
		// then eight loaders in a single Promise.all (loadYieldCurves is
		// itself two). The KV cache is a reason for care rather than
		// comfort: a bundle is stored for 24h, so whatever this route reads is
		// served for a day, which is why the session anchors first-primary.
		staleTolerant: true,
	},
	// Public recent videos merged across the user's linked channels — feeds
	// the profile "Videos" tab. Passes ctx so the cache can refresh in the
	// background (stale-while-revalidate).
	{
		method: "GET",
		match: {
			kind: "regex",
			regex: /^\/v1\/users\/([A-Za-z0-9_-]{21})\/videos$/,
		},
		route: "GET /v1/users/:user_id/videos",
		handler: (r, e, m, c) => handleUserVideos(m![1], r, e, c),
	},
	// Public tournament record for one player — enrollment + played/upcoming
	// matches + cast appearances, in one lazy fetch for the profile's
	// Tournaments tab. The 21-char user_id can't collide with the
	// /v1/users/me/tournaments path route registered further down.
	{
		method: "GET",
		match: {
			kind: "regex",
			regex: /^\/v1\/users\/([A-Za-z0-9_-]{21})\/tournaments$/,
		},
		route: "GET /v1/users/:user_id/tournaments",
		handler: (r, e, m) => handleUserTournaments(m![1], r, e),
	},
	// The chart bundle over the whole public corpus — what /stats reads.
	// Session-gated, and not because the payload is viewer-dependent: it isn't.
	// is_public = 1 is the whole visibility rule, so every signed-in caller
	// reads the same bytes. What the session gates is who may spend a
	// whole-corpus aggregation, and it is checked ahead of the budget so a
	// refused call spends none of it. ?slice= picks the roster composition,
	// ?nation= facets it. Its own per-IP budget (GLOBAL_STATS_VIEW_PER_HOUR),
	// not a share of anon_read. Passes ctx so a stale-served bundle can rebuild
	// in the background.
	{
		method: "GET",
		match: { kind: "path", path: "/v1/stats" },
		route: "GET /v1/stats",
		handler: (r, e, _m, c) => handleGlobalStats(r, e, c),
	},
	// Cross-creator home feed — newest uploads across all users' linked
	// channels, merged newest-first for the home page's "Latest from creators"
	// strip. One pre-assembled KV entry (SWR); passes ctx for background refresh.
	{
		method: "GET",
		match: { kind: "path", path: "/v1/creator-videos" },
		route: "GET /v1/creator-videos",
		handler: (r, e, _m, c) => handleCreatorVideos(r, e, c),
	},
	// The other half of that strip — newest uploads across every visible
	// tournament's admin-set playlist, merged newest-first. Per-playlist KV
	// entries (SWR), shared with each tournament's own Videos tab; passes ctx for
	// background refresh.
	{
		method: "GET",
		match: { kind: "path", path: "/v1/tournament-videos" },
		route: "GET /v1/tournament-videos",
		handler: (r, e, _m, c) => handleTournamentVideosFeed(r, e, c),
	},
	// The third home video feed — the site-admin featured set (see
	// cloud/src/featured.ts), newest first. Read straight from D1 rather than
	// KV: the set is a small curated table, not a platform fan-out. Public;
	// only the writes under /v1/admin/featured-videos are gated.
	{
		method: "GET",
		match: { kind: "path", path: "/v1/featured-videos" },
		route: "GET /v1/featured-videos",
		handler: (r, e) => handlePublicFeaturedVideos(r, e),
	},
	// User-facing tournament endpoints
	{
		method: "GET",
		match: { kind: "path", path: "/v1/users/me/tournaments" },
		route: "GET /v1/users/me/tournaments",
		handler: (r, e) => handleMyTournaments(r, e),
	},
	{
		method: "GET",
		match: { kind: "path", path: "/v1/users/me/admin-tournaments" },
		route: "GET /v1/users/me/admin-tournaments",
		handler: (r, e) => handleMyAdminTournaments(r, e),
	},
	{
		method: "POST",
		match: {
			kind: "regex",
			regex:
				/^\/v1\/users\/me\/tournaments\/([A-Za-z0-9_-]{21})\/dismiss-banner$/,
		},
		route: "POST /v1/users/me/tournaments/:id/dismiss-banner",
		handler: (r, e, m) => handleDismissBanner(m![1], r, e),
	},
];

// The registered "METHOD /path" route keys, exported for the api-reference
// drift guard (cloud/src/routes-doc.test.ts): every key here must have a
// matching heading in docs/api-reference.md and vice-versa.
export const ROUTE_KEYS: readonly string[] = ROUTES.map((r) => r.route);

// The routes opted into replica reads, exported for the drift guard in
// cloud/src/stale-tolerant-routes.test.ts. Flagging a route is a decision
// about correctness, not a perf tweak, so it takes two edits: the flag here
// and the reviewed list there.
export const STALE_TOLERANT_ROUTE_KEYS: readonly string[] = ROUTES.filter(
	(r) => r.staleTolerant,
).map((r) => r.route);

// Derive the per-request env from the raw bindings: split the events handle
// off, and give `staleTolerant` routes a Sessions API handle for everything
// else. One session per request — sharing one across requests would let
// bookmarks accumulate globally and defeat the point.
//
// Both handles are then wrapped for timing (instrumentD1, d1.ts), which is
// what puts d1_ms / d1_queries / d1_wall_ms on the access log for every query
// a handler issues through SHARE_DB or EVENTS_DB. SECURITY_DB is deliberately
// outside it — see the coverage note in d1.ts. Wrapping each *final* handle
// rather than the raw binding keeps `withSession()` a call on the binding
// itself, and keeps the events subset attributable — the two handles are the
// same database, so the handle is the only thing that distinguishes an events
// query from a share query.
function routeEnv(env: RawBindings, spec: RouteSpec): Env {
	return {
		...env,
		EVENTS_DB: instrumentD1(env.SHARE_DB, "events"),
		SHARE_DB: instrumentD1(
			spec.staleTolerant ? staleTolerantSession(env.SHARE_DB) : env.SHARE_DB,
			"share",
		),
	};
}

// Absence is a property of the isolate, not the request, so warn once rather
// than on every dispatch — a per-request line would double log volume and burn
// export events for one fact. Isolates churn often enough that "once each" is
// still plainly visible in the sinks. Warned at all because silence is the
// failure mode: tracing that quietly stopped reads exactly like tracing that
// works until someone queries for spans that were never sent.
//
// A startActiveSpan that throws is an isolate-level fact for the same reason,
// so it gets its own latch rather than an error line per request. Separate
// latches, not one shared: the two are distinguishable causes with different
// fixes (a compatibility_date bump vs. whatever the throw says), and a shared
// one would let the first swallow the second.
let tracingUnavailableWarned = false;
let tracingFailedWarned = false;

function warnTracingUnavailable(): void {
	if (tracingUnavailableWarned) return;
	tracingUnavailableWarned = true;
	logWarn("tracing_unavailable", {
		detail:
			"ctx.tracing absent or without startActiveSpan — serving untraced, spans will not be sent",
	});
}

function warnTracingFailed(err: unknown): void {
	if (tracingFailedWarned) return;
	tracingFailedWarned = true;
	logError("tracing_start_failed", err, {
		detail:
			"startActiveSpan threw before the handler ran — serving untraced, spans will not be sent",
	});
}

function dispatch(
	request: Request,
	env: RawBindings,
	ctx: ExecutionContext,
): Promise<Response> {
	const url = new URL(request.url);
	for (const r of ROUTES) {
		if (r.method !== request.method) continue;
		// `null` for path routes is the handler's match argument, not a
		// sentinel — path routes have no capture groups to pass.
		let m: RegExpMatchArray | null = null;
		if (r.match.kind === "path") {
			if (r.match.path !== url.pathname) continue;
		} else {
			m = url.pathname.match(r.match.regex);
			if (!m) continue;
		}
		setRoute(r.route);
		// The same normalized route the access line carries, attached to a
		// span. Tracing needs its own copy because nothing the platform emits
		// can stand in: root spans carry url.path, whose cardinality is
		// unbounded (one cell per game id), and there is no http.route
		// attribute. setAttribute only works on spans we create, so wrapping
		// the handler is the only place to put it.
		//
		// Every D1 and R2 span the handler produces nests under this one, and
		// cloudflare.colo is a resource attribute present on all spans — so
		// "p95 by route × colo", the issue #150 question, is a query over
		// this span alone rather than a join back to the access line.
		//
		// startActiveSpan + an explicit end(), not enterSpan. The callback
		// returns a *pending* promise, and the two differ in exactly that case:
		// enterSpan is free to close the span when the callback returns rather
		// than when its promise settles, which would leave a ~0ms span with
		// nothing nested under it — losing both halves of the goal above, and
		// silently, since the route attribute would still be correct. This form
		// is right under either semantics. `.finally()` is total because every
		// entry in ROUTES returns Promise<Response>.
		//
		// Guarded on the method, not just the object, because two different
		// things can be missing. `tracing` is runtime-provided and declared
		// non-optional, but `createExecutionContext()` in
		// @cloudflare/vitest-pool-workers hands back a context without it, and a
		// deployed runtime behind local workerd would have the same shape.
		// startActiveSpan is separately newer than our compatibility_date
		// (2024-12-01, see wrangler.toml) — nothing in this workerd build gates
		// it per-method and enterSpan works at that date, so it is expected to
		// be there, but "expected" is not "checked against the deployed
		// runtime". Either absence unguarded throws for *every* request and the
		// envelope's safety net turns that into a 500 across the whole API —
		// tracing is a measurement, so it must never be able to take the app
		// down. Serving untraced is the right failure, and the warn is what
		// makes it visible instead of silent.
		const tracing: Tracing | undefined = ctx.tracing;
		if (!tracing || typeof tracing.startActiveSpan !== "function") {
			warnTracingUnavailable();
			return r.handler(request, routeEnv(env, r), m, ctx);
		}
		// The check above proves the method is *there*, not that calling it
		// works. Tracing is a beta API and its enablement lives outside this
		// repo, so a throw out of a function that is plainly present is a
		// distinct failure from an absent one — and an unguarded one costs the
		// whole API for exactly the reason the check exists to prevent. Same
		// guard, same fallback: serve untraced.
		//
		// `entered` is what makes that fallback safe to take. Re-running the
		// handler is only correct if it never ran, and the callback is where it
		// runs, so a throw from inside the callback rethrows instead — which is
		// precisely the pre-tracing behaviour (up to the envelope, 500). Set
		// after setAttribute so a throw from *that* is still recoverable, and
		// before the handler call so no synchronous throw out of a handler can
		// re-enter it. Handlers are all `async` and so can't throw
		// synchronously today; a POST run twice is a much worse failure than an
		// untraced one, and this doesn't depend on that staying true.
		let entered = false;
		try {
			return tracing.startActiveSpan(r.route, (span) => {
				span.setAttribute("route", r.route);
				entered = true;
				return r
					.handler(request, routeEnv(env, r), m, ctx)
					.finally(() => span.end());
			});
		} catch (err) {
			if (entered) throw err;
			warnTracingFailed(err);
			return r.handler(request, routeEnv(env, r), m, ctx);
		}
	}
	// 404 — echo the request Origin so error responses still allow the
	// caller that asked.
	const cors = cloudCorsHeaders(env, request);
	return Promise.resolve(
		new Response(JSON.stringify({ error: "Not found" }), {
			status: 404,
			headers: { "Content-Type": "application/json", ...cors },
		}),
	);
}

export default {
	async fetch(
		request: Request,
		env: RawBindings,
		ctx: ExecutionContext,
	): Promise<Response> {
		return runWithLogContext(request, async () => {
			// Settle who the caller is before anything reads the request: on an
			// SSR subrequest that proves it came from our frontend Worker, this
			// swaps in the visitor's address so every per-IP counter
			// downstream is keyed on a person rather than on Cloudflare's SSR
			// egress. See util.ts.
			//
			// Inside the log context, because the one line this can emit
			// (`ssr_forward_rejected`) is what an operator greps during a
			// botched key rotation, and outside the context it carries no
			// request_id or path to join it to anything. The context itself is
			// still built from the inbound request — `cf` (colo) lives on that
			// object and doesn't survive the rewrite.
			const req = adoptTrustedFrontend(request, env);
			const url = new URL(request.url);
			let response: Response;

			try {
				if (request.method === "OPTIONS") {
					const headers = cloudCorsHeaders(env, request);
					response = new Response(null, { status: 204, headers });
				} else {
					response = await dispatch(req, env, ctx);
				}
			} catch (err) {
				// Top-level safety net. Any uncaught throw becomes a 500 with
				// the request_id in the body so the caller can include it in
				// a bug report. Error class is captured for the access log.
				logError("unhandled_handler_error", err);
				const requestId = getRequestId();
				const cors = cloudCorsHeaders(env, request);
				response = new Response(
					JSON.stringify({
						error: "Internal server error",
						request_id: requestId,
					}),
					{
						status: 500,
						headers: { "Content-Type": "application/json", ...cors },
					},
				);
			}

			// Surface request_id to the client. Re-wrap so headers are mutable
			// even when the handler returned a Response with frozen headers
			// (e.g. R2 streams).
			response = new Response(response.body, response);
			response.headers.set("X-Request-Id", getRequestId() ?? "");
			emitAccessLog(response);
			// Skiff security-event tee (issue #71). Reads the same log context,
			// writes to the dedicated SECURITY_DB via ctx.waitUntil. Fully
			// wrapped — runs on the safety-net 500 path too, and can never alter
			// or fail the response above.
			emitSecurityEvent(req, response, env, ctx);
			return response;
		});
	},

	// Not a dispatch path, so it never goes through `routeEnv`, and every job
	// runs on the primary binding. That is automatic for the sweep, which is a
	// DELETE, and deliberate for the read-only stats jobs: `routeEnv` is the
	// only place allowed to derive a replica handle (d1.ts), and a cron with no
	// client waiting on it has no latency budget worth a second replication
	// policy for.
	async scheduled(
		controller: ScheduledController,
		env: RawBindings,
		_ctx: ExecutionContext,
	): Promise<void> {
		// No runWithLogContext: log.ts is safe without a request context
		// (request_id logs as null, which is accurate for a cron run).
		//
		// Every job is matched by exact pattern and there is no fallback: an
		// unrecognized cron logs and does nothing. A fall-through to the sweep
		// would be the one shape that can't be allowed — staging declares the
		// stats patterns and not the sweep's, so any drift between what is
		// matched here and wrangler.toml would start deleting staging's events,
		// which is exactly what keeping it off the cron protects.
		const slice = STATS_PRECOMPUTE_CRONS[controller.cron];
		if (slice !== undefined) {
			logEvent("info", "stats_precompute_started", {
				cron: controller.cron,
				slice,
			});
			try {
				const result = await precomputeGlobalSlice(
					env,
					slice,
					CURRENT_PARSER_VERSION,
				);
				logEvent("info", "stats_precompute_completed", {
					slice,
					selections: result.selections,
					games: result.games,
				});
			} catch (err) {
				// Rethrown for the same reason the sweep's is: nothing awaits a
				// cron, so the dashboard's run history is the only signal.
				logError("stats_precompute_failed", err, { slice });
				throw err;
			}
			return;
		}

		// The hourly warm, which covers all four unfaceted slices in one run and
		// so has no row in the table above — see STATS_WARM_CRON for why it is a
		// constant rather than a second table or a sentinel.
		if (controller.cron === STATS_WARM_CRON) {
			logEvent("info", "stats_warm_started", { cron: controller.cron });
			try {
				const result = await warmGlobalSlices(env, CURRENT_PARSER_VERSION);
				logEvent("info", "stats_warm_completed", {
					checked: result.checked,
					// Empty on an ordinary pass; all four on the first run after a
					// deploy that moved either version segment.
					built: result.built,
				});
			} catch (err) {
				// Rethrown for the same reason the other two are: nothing awaits a
				// cron, so the dashboard's run history is the only signal.
				logError("stats_warm_failed", err);
				throw err;
			}
			return;
		}

		if (controller.cron !== RETENTION_CRON) {
			logWarn("cron_unrecognized", { cron: controller.cron });
			return;
		}

		logEvent("info", "retention_sweep_started", { cron: controller.cron });
		try {
			const result = await sweepEvents(env.SHARE_DB);
			// Safety-floor age-out for the Skiff drain table (separate DB).
			const securityDeleted = await sweepSecurityEvents(env.SECURITY_DB);
			logEvent("info", "retention_sweep_completed", {
				deleted: result.deleted,
				unknown_types: result.unknownTypes,
				security_events_deleted: securityDeleted,
			});
		} catch (err) {
			logError("retention_sweep_failed", err);
			// Rethrow so the run records as failed in the Workers dashboard's
			// cron history — there's no client awaiting a response, and a
			// swallowed error would leave no signal beyond the log line.
			throw err;
		}
	},
} satisfies ExportedHandler<RawBindings>;
