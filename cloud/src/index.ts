// Per-Ankh Worker — legacy share endpoints + cloud rewrite endpoints.
//
// Legacy (desktop, being decommissioned):
//   POST   /v1/share       — Upload a shared game blob
//   GET    /v1/share/{id}  — Download a shared game blob
//   DELETE /v1/share/{id}  — Delete a shared game blob
//
// Cloud rewrite (browser-first):
//   POST   /v1/auth/discord/start
//   POST   /v1/auth/discord/callback
//   GET    /v1/auth/me
//   POST   /v1/auth/logout
//
// Storage: R2 for blobs, D1 for indices/users, KV for sessions+OAuth state.
//
// Besides `fetch`, the Worker exports a `scheduled` handler: the nightly
// events-retention sweep (cron in wrangler.toml, policy in retention.ts).

import { cloudCorsHeaders, legacyCorsHeaders } from "./util";
import {
	emitAccessLog,
	getRequestId,
	logError,
	logEvent,
	runWithLogContext,
	setRoute,
} from "./log";
import { sweepEvents, sweepSecurityEvents } from "./retention";
import { emitSecurityEvent } from "./security-events";
import type { SecurityEventsEnv } from "./security-events";
import { handleDelete, handleDownload, handleUpload } from "./share-legacy";
import type { ShareLegacyEnv } from "./share-legacy";
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
import { handleCollectionCreate, handleCollectionsList } from "./collections";
import type { CollectionsEnv } from "./collections";
import { handleListOnlineIds, handleRemoveOnlineId } from "./online-ids";
import type { OnlineIdsEnv } from "./online-ids";
import { handleCspReport } from "./csp";
import {
	handleGameTournamentLink,
	handleTournamentBracket,
	handleTournamentDetail,
	handleTournamentList,
	handleTournamentMatchDetail,
	handleTournamentMatches,
	handleTournamentRounds,
	handleTournamentStandings,
} from "./tournament/public";
import type { TournamentPublicEnv } from "./tournament/public";
import { handleTournamentExport } from "./tournament/export";
import {
	handleDismissBanner,
	handleMyAdminTournaments,
	handleMyMatches,
	handleMyTournaments,
	handleTournamentSignup,
	handleTournamentWithdraw,
} from "./tournament/player";
import { handleUserStats } from "./stats/handlers";
import { handleUserProfile, handleUserSearch } from "./users";
import type { TournamentPlayerEnv } from "./tournament/player";
import {
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
	handleReorderSlots,
	handleRevokeTournamentAdmin,
	handleRetroEditMatch,
	handleStartTournament,
	handleTransitionChampionship,
} from "./tournament/admin";
import type { TournamentAdminEnv } from "./tournament/admin";

interface Env
	extends
		AuthEnv,
		GamesEnv,
		CollectionsEnv,
		OnlineIdsEnv,
		TournamentPublicEnv,
		TournamentPlayerEnv,
		TournamentAdminEnv,
		ShareLegacyEnv,
		SecurityEventsEnv {
	SHARE_BUCKET: R2Bucket;
	SHARE_DB: D1Database;
	SESSIONS_KV: KVNamespace;
	ALLOWED_ORIGIN: string;
	ALLOWED_ORIGINS: string;
	DISCORD_CLIENT_ID: string;
	DISCORD_CLIENT_SECRET: string;
	SESSION_COOKIE_NAME: string;
}

// === Router ===
//
// Routes are declared as a typed table so the dispatch loop can:
//   (a) match by exact path or regex,
//   (b) set the route pattern (e.g. "GET /v1/games/:id") on the log
//       context for stable per-route grouping in Logpush,
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
		handler: (r, e, m) => handleGameDetail(m![1], r, e),
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

	// CSP violation reports — unauthenticated; the browser POSTs here
	// directly when the page's CSP triggers. See cloud/src/csp.ts.
	{
		method: "POST",
		match: { kind: "path", path: "/v1/csp-report" },
		route: "POST /v1/csp-report",
		handler: (r) => handleCspReport(r),
	},

	// Cloud rewrite: /v1/tournaments/* — more-specific patterns first
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
			regex: /^\/v1\/tournaments\/([A-Za-z0-9_-]{21})\/rounds$/,
		},
		route: "GET /v1/tournaments/:id/rounds",
		handler: (r, e, m) => handleTournamentRounds(m![1], r, e),
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
		method: "GET",
		match: { kind: "path", path: "/v1/users/me/matches" },
		route: "GET /v1/users/me/matches",
		handler: (r, e) => handleMyMatches(r, e),
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

	// Legacy: /v1/share/*
	{
		method: "POST",
		match: { kind: "path", path: "/v1/share" },
		route: "POST /v1/share",
		handler: (r, e) => handleUpload(r, e),
	},
	{
		method: "GET",
		match: { kind: "regex", regex: /^\/v1\/share\/([A-Za-z0-9_-]{21})$/ },
		route: "GET /v1/share/:id",
		handler: (r, e, m) => handleDownload(m![1], r, e),
	},
	{
		method: "DELETE",
		match: { kind: "regex", regex: /^\/v1\/share\/([A-Za-z0-9_-]{21})$/ },
		route: "DELETE /v1/share/:id",
		handler: (r, e, m) => handleDelete(m![1], r, e),
	},
];

// Cloud paths use credentialed (echo-Origin) CORS so cookies traverse
// per-ankh.app ↔ api.per-ankh.app. Legacy /v1/share uses single-origin.
// /v1/csp-report rides cloud-CORS too — browsers don't preflight CSP
// reports, but listing it here keeps OPTIONS responses correct for any
// tooling that does.
function isCloudPath(pathname: string): boolean {
	return (
		pathname.startsWith("/v1/auth/") ||
		pathname === "/v1/games" ||
		pathname.startsWith("/v1/games/") ||
		pathname === "/v1/collections" ||
		pathname.startsWith("/v1/users/") ||
		pathname === "/v1/csp-report" ||
		pathname === "/v1/tournaments" ||
		pathname.startsWith("/v1/tournaments/")
	);
}

function dispatch(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	const url = new URL(request.url);
	for (const r of ROUTES) {
		if (r.method !== request.method) continue;
		if (r.match.kind === "path") {
			if (r.match.path !== url.pathname) continue;
			setRoute(r.route);
			return r.handler(request, env, null, ctx);
		}
		const m = url.pathname.match(r.match.regex);
		if (!m) continue;
		setRoute(r.route);
		return r.handler(request, env, m, ctx);
	}
	// 404 — pick CORS based on path so error responses still allow the
	// origin that asked. The cloud helper echoes the request Origin; the
	// legacy helper returns the single ALLOWED_ORIGIN.
	const cors = isCloudPath(url.pathname)
		? cloudCorsHeaders(env, request)
		: legacyCorsHeaders(env);
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
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		return runWithLogContext(request, async () => {
			const url = new URL(request.url);
			let response: Response;

			try {
				if (request.method === "OPTIONS") {
					const headers = isCloudPath(url.pathname)
						? cloudCorsHeaders(env, request)
						: legacyCorsHeaders(env);
					response = new Response(null, { status: 204, headers });
				} else {
					response = await dispatch(request, env, ctx);
				}
			} catch (err) {
				// Top-level safety net. Any uncaught throw becomes a 500 with
				// the request_id in the body so the caller can include it in
				// a bug report. Error class is captured for the access log.
				logError("unhandled_handler_error", err);
				const requestId = getRequestId();
				const cors = isCloudPath(url.pathname)
					? cloudCorsHeaders(env, request)
					: legacyCorsHeaders(env);
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
			emitSecurityEvent(request, response, env, ctx);
			return response;
		});
	},

	async scheduled(
		controller: ScheduledController,
		env: Env,
		_ctx: ExecutionContext,
	): Promise<void> {
		// No runWithLogContext: log.ts is safe without a request context
		// (request_id logs as null, which is accurate for a cron run).
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
} satisfies ExportedHandler<Env>;
