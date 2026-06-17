// Cloud API client — fetch wrapper for the Per-Ankh Worker. Consumed by
// all cloud pages (`/`, `/auth/callback`, `/games`, `/games/[id]`,
// `/upload`).
//
// Configure via VITE_API_URL (see .env.example).

import type { FullGameData } from "$lib/parser/types";
import type { ChartBundle, UserScope } from "$lib/stats/types";

const DEFAULT_API_BASE = "https://api.per-ankh.app/v1";
const API_BASE = (import.meta.env.VITE_API_URL ?? DEFAULT_API_BASE) as string;

// Result row returned by cloudApi.searchUsers — drives the
// UserAutocomplete. Intentionally narrow: discord_username for
// matching, display_name for human-recognizable disambiguation in the
// dropdown, discord_id + user_id for the eventual slot pre-link payload.
// No email, no avatar, no timestamps.
export interface UserSearchResult {
	user_id: string;
	discord_id: string;
	discord_username: string;
	display_name: string;
}

// Public profile fields returned by GET /v1/users/:user_id. No-auth read;
// used by the /users/[user_id] page to render the chrome when a visitor
// views someone else's library.
export interface UserProfile {
	user_id: string;
	display_name: string;
	avatar_url: string;
	// All-time stats for the profile-header card — over ALL the user's
	// saves (visibility-scoped to the viewer), independent of the scope
	// selector on the page.
	summary: {
		total_games: number;
		win_rate: number | null;
		favorite_nation: string | null;
		favorite_day_of_week: number | null;
	};
}

export interface UserMe {
	user_id: string;
	discord_id: string;
	display_name: string;
	// Lowercased Discord handle (mirrors the value stored on
	// tournament_slots.discord_username). Used by the signup popover to show
	// "Signed in as @username" so players know the exact identity they'll
	// be entered under.
	discord_username: string;
	avatar_url: string;
	// True iff the user is on the tournament allowlist, i.e. may *create*
	// tournaments. Drives the create-button visibility on /tournaments.
	// (Reads, signup, and granted-admin actions are open to all users.)
	// Not load-bearing for security — the worker re-checks create on the
	// server. The "beta" name is retained from the private-beta era.
	is_beta: boolean;
	// True iff the user's discord_id matches the ADMIN_DISCORD_ID secret on
	// the Worker. Gates the /admin/* SvelteKit routes. Not load-bearing for
	// security — the worker re-checks on every admin endpoint.
	is_admin: boolean;
	// Default visibility applied to the user's newly uploaded saves. TRUE =
	// public by default (the product default); FALSE = the user opted into
	// private-by-default. Re-imports preserve the existing game's visibility
	// and tournament uploads are forced public regardless.
	default_game_public: boolean;
}

export interface GameListItem {
	game_id: string;
	game_name: string | null;
	// Owner's renamed title for the save (null = never renamed; fall back to
	// game_name and then the nation/turns derivation via formatGameTitle).
	display_name: string | null;
	save_date: string | null;
	total_turns: number;
	user_nation: string | null;
	user_won: boolean | null;
	winner_nation: string | null;
	victory_type: string | null;
	map_size: string | null;
	is_public: boolean;
	collection_id: number | null;
	created_at: string;
	parser_version: string;
}

export interface CollectionInfo {
	collection_id: number;
	name: string;
	is_default: boolean;
	game_count: number;
}

// Per-scope game counts for the home-page scope selector, shown on each
// built-in option the way collections show their own counts.
export interface ScopeCounts {
	all: number;
	public: number;
	vs_ai: number;
	mp: number;
	tournament: number;
}

export interface CollectionsListResponse {
	collections: CollectionInfo[];
	scope_counts: ScopeCounts;
}

export interface GameListResponse {
	games: GameListItem[];
	total: number;
}

// Admin view: same shape as GameListItem plus the owning user's user_id and
// display_name. Returned by GET /v1/admin/games/out-of-date.
export interface AdminGameListItem extends Omit<
	GameListItem,
	"is_public" | "collection_id"
> {
	user_id: string;
	owner_display_name: string;
	is_public: boolean;
	collection_id: number | null;
}

export interface AdminGameListResponse {
	games: AdminGameListItem[];
}

// Minimal id + display label per game. Returned by GET /v1/admin/games/all,
// which drives the reindex sweep.
export interface AdminGameIdListItem {
	game_id: string;
	game_name: string | null;
}

export interface AdminGameIdListResponse {
	games: AdminGameIdListItem[];
}

// Wire shape for GET /v1/games/public-recent — the marketing home's
// discovery feed. Includes the uploader's display name + a sparkline-ready
// per-turn victory-points series (`vp_series`) for each player.
export interface PublicRecentPlayer {
	player_index: number;
	player_name: string;
	nation: string | null;
	is_human: boolean;
	is_uploader: boolean;
	is_winner: boolean;
	final_points: number | null;
	cities_total: number | null;
	techs_completed: number | null;
	laws_count: number | null;
	vp_series: Array<{ turn: number; vp: number | null }>;
}

export interface PublicRecentGame {
	game_id: string;
	game_name: string | null;
	// Owner's renamed title (null = never renamed). RecentSaveCard doesn't
	// surface a formatted title today, but exposing it on the wire keeps
	// future home-page consumers consistent with the sidebar/header.
	display_name: string | null;
	user_nation: string | null;
	user_won: boolean | null;
	winner_nation: string | null;
	winner_name: string | null;
	victory_type: string | null;
	map_size: string | null;
	map_class: string | null;
	difficulty: string | null;
	total_turns: number;
	save_date: string | null;
	created_at: string;
	uploader_user_id: string;
	uploader_display_name: string;
	uploader_avatar_url: string;
	players: PublicRecentPlayer[];
}

export interface PublicRecentGamesResponse {
	games: PublicRecentGame[];
}

// Worker response for POST /v1/games. First-time uploads get 201 with the
// minimal shape; re-imports (file_hash collision + newer parser_version)
// get 200 with `reimported: true` plus the version pair, so the client can
// distinguish "Uploaded" from "Updated" copy.
export interface UploadGameResponse {
	game_id: string;
	url: string;
	reimported?: boolean;
	from_version?: string;
	to_version?: string;
}

export class ApiError extends Error {
	constructor(
		public status: number,
		public code: string | null,
		message: string,
		public payload?: unknown,
	) {
		super(message);
		this.name = "ApiError";
	}
}

export class UnauthorizedError extends ApiError {
	constructor() {
		super(401, "UNAUTHORIZED", "Unauthorized");
		this.name = "UnauthorizedError";
	}
}

export class DuplicateUploadError extends ApiError {
	constructor(public existingGameId: string) {
		super(409, "DUPLICATE", "You've already uploaded this save", {
			existing_game_id: existingGameId,
		});
		this.name = "DuplicateUploadError";
	}
}

export type FetchLike = typeof fetch;
export interface CallOpts {
	fetch?: FetchLike;
	// Explicit Cookie header for server-side load() calls in dev (where
	// localhost:1420 ↔ localhost:8787 isn't same-eTLD+1, so SvelteKit's
	// event.fetch won't auto-forward). Production uses the auto-forward
	// path between per-ankh.app and api.per-ankh.app.
	cookie?: string;
	// Caller-supplied abort signal. Lets the sidebar cancel an in-flight
	// next-page fetch when filters change so a stale response can't
	// overwrite the fresh accumulated array.
	signal?: AbortSignal;
}

export interface ListGamesOpts extends CallOpts {
	// Target user. Omitted → session user (legacy callers). When set ≠
	// session user, the Worker restricts results to is_public=1.
	userId?: string;
	limit?: number;
	offset?: number;
	// Scope row: a single selection ("all"/"public"/"vs_ai"/"mp"/
	// "tournament"/<collection_id>). The same scope drives the stats
	// bundle, so the Games tab and the charts stay in sync. Omitted → "all".
	scope?: UserScope;
	q?: string;
	nation?: string;
	result?: "win" | "loss";
	date?: string;
	// Games-tab sort key, e.g. "date_desc", "turns_asc", "name_asc".
	sort?: string;
}

async function request(
	path: string,
	init: RequestInit & CallOpts = {},
): Promise<Response> {
	const { fetch: customFetch, cookie, ...rest } = init;
	const f = customFetch ?? fetch;
	const headers = new Headers(rest.headers);
	if (cookie) headers.set("Cookie", cookie);
	const res = await f(`${API_BASE}${path}`, {
		...rest,
		headers,
		credentials: "include",
	});

	if (res.ok) return res;

	let code: string | null = null;
	let message = res.statusText;
	let payload: unknown = null;
	if (res.headers.get("content-type")?.includes("application/json")) {
		try {
			payload = await res.json();
			if (payload && typeof payload === "object") {
				const body = payload as {
					code?: string;
					error?: string;
					message?: string;
				};
				if (typeof body.code === "string") code = body.code;
				if (typeof body.error === "string") message = body.error;
				if (typeof body.message === "string") message = body.message;
			}
		} catch {
			/* fall through */
		}
	}

	if (res.status === 401) throw new UnauthorizedError();
	if (
		res.status === 409 &&
		code === "DUPLICATE" &&
		payload &&
		typeof payload === "object" &&
		typeof (payload as Record<string, unknown>).existing_game_id === "string"
	) {
		throw new DuplicateUploadError(
			(payload as Record<string, string>).existing_game_id,
		);
	}
	throw new ApiError(res.status, code, message, payload);
}

async function postJson<T>(
	path: string,
	body: unknown,
	opts: CallOpts = {},
): Promise<T> {
	const res = await request(path, {
		...opts,
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	return res.json() as Promise<T>;
}

export interface CallbackResponse extends UserMe {
	// Server-validated post-login destination. Always a same-origin path.
	next: string;
}

export const cloudApi = {
	// --- Auth ---
	discordStart: (redirectUri: string, next: string | null, opts?: CallOpts) =>
		postJson<{ authorize_url: string }>(
			"/auth/discord/start",
			{
				redirect_uri: redirectUri,
				next: next ?? undefined,
			},
			opts,
		),

	discordCallback: (
		code: string,
		state: string,
		redirectUri: string,
		opts?: CallOpts,
	) =>
		postJson<CallbackResponse>(
			"/auth/discord/callback",
			{ code, state, redirect_uri: redirectUri },
			opts,
		),

	getMe: async (opts?: CallOpts): Promise<UserMe | null> => {
		try {
			const res = await request("/auth/me", opts);
			return res.json() as Promise<UserMe>;
		} catch (err) {
			if (err instanceof UnauthorizedError) return null;
			throw err;
		}
	},

	logout: async (opts?: CallOpts): Promise<void> => {
		await request("/auth/logout", { ...opts, method: "POST" });
	},

	// Update account preferences. Currently just the default visibility for
	// new uploads; returns the persisted value so callers can reconcile.
	updateSettings: async (
		settings: { default_game_public: boolean },
		opts?: CallOpts,
	): Promise<{ default_game_public: boolean }> => {
		const res = await request("/auth/settings", {
			...opts,
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(settings),
		});
		return res.json() as Promise<{ default_game_public: boolean }>;
	},

	// --- Games ---
	listGames: async (opts?: ListGamesOpts): Promise<GameListResponse> => {
		const params = new URLSearchParams();
		if (opts?.userId) params.set("user_id", opts.userId);
		if (opts?.limit != null) params.set("limit", String(opts.limit));
		if (opts?.offset != null) params.set("offset", String(opts.offset));
		if (opts?.scope != null && opts.scope !== "all") {
			params.set("scope", String(opts.scope));
		}
		if (opts?.q) params.set("q", opts.q);
		if (opts?.nation) params.set("nation", opts.nation);
		if (opts?.result) params.set("result", opts.result);
		if (opts?.date) params.set("date", opts.date);
		if (opts?.sort) params.set("sort", opts.sort);
		const qs = params.toString();
		const res = await request(`/games${qs ? `?${qs}` : ""}`, {
			fetch: opts?.fetch,
			cookie: opts?.cookie,
			signal: opts?.signal,
		});
		return res.json() as Promise<GameListResponse>;
	},

	// Every game in the signed-in user's library whose stored parser_version
	// differs from `currentVersion`. Unpaginated — drives the account-page
	// bulk reparse, which must cover the whole library (listGames defaults to
	// 50 rows, so it can't be used here).
	listOutOfDate: async (
		currentVersion: string,
		opts?: CallOpts,
	): Promise<GameListResponse> => {
		const res = await request(
			`/games/out-of-date?version=${encodeURIComponent(currentVersion)}`,
			opts,
		);
		return res.json() as Promise<GameListResponse>;
	},

	// Public profile lookup. Returns null on 404 so the /users/[user_id]
	// page can render its own not-found view without exceptions.
	getUserProfile: async (
		userId: string,
		opts?: CallOpts,
	): Promise<UserProfile | null> => {
		try {
			const res = await request(`/users/${userId}`, opts);
			return res.json() as Promise<UserProfile>;
		} catch (err) {
			if (err instanceof ApiError && err.status === 404) return null;
			throw err;
		}
	},

	// Owner GET — returns the blob with `is_public` and the uploader-identity
	// triple (`user_nation`, `user_won`, `user_display_name`) injected by the
	// Worker. `is_public` drives the visibility toggle's initial state; the
	// uploader fields let the detail view surface "becked (Tamil)" even when
	// the save itself has an empty winner_name.
	getGame: async (
		id: string,
		opts?: CallOpts,
	): Promise<
		FullGameData & {
			is_public?: boolean;
			// Uploader's opaque profile id — links the breadcrumb back to
			// /users/:id. Optional for legacy/observer-mode safety.
			user_id?: string | null;
			user_nation?: string | null;
			user_won?: boolean | null;
			user_display_name?: string | null;
			display_name?: string | null;
		}
	> => {
		const res = await request(`/games/${id}`, opts);
		return res.json() as Promise<
			FullGameData & {
				is_public?: boolean;
				user_id?: string | null;
				user_nation?: string | null;
				user_won?: boolean | null;
				user_display_name?: string | null;
				display_name?: string | null;
			}
		>;
	},

	// Anonymous public read — no credentials, no auto-redirect to login.
	// Used as a fallback when getGame() returns 401 (the user isn't signed in
	// or doesn't own the game). 401 from this path means the game is
	// genuinely private; 404 means it doesn't exist.
	getPublicGame: async (
		id: string,
		opts?: CallOpts,
	): Promise<
		FullGameData & {
			user_id?: string | null;
			user_nation?: string | null;
			user_won?: boolean | null;
			user_display_name?: string | null;
			display_name?: string | null;
		}
	> => {
		const f = opts?.fetch ?? fetch;
		const headers = new Headers();
		// No credentials: include — anonymous read.
		const res = await f(`${API_BASE}/games/${id}`, { headers });
		if (res.status === 401) throw new UnauthorizedError();
		if (res.status === 404)
			throw new ApiError(404, "NOT_FOUND", "Game not found");
		if (!res.ok) {
			throw new ApiError(res.status, null, res.statusText);
		}
		return res.json() as Promise<
			FullGameData & {
				user_id?: string | null;
				user_nation?: string | null;
				user_won?: boolean | null;
				user_display_name?: string | null;
				display_name?: string | null;
			}
		>;
	},

	toggleVisibility: async (
		id: string,
		isPublic: boolean,
		opts?: CallOpts,
	): Promise<{ game_id: string; is_public: boolean }> => {
		const res = await request(`/games/${id}`, {
			...opts,
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ is_public: isPublic }),
		});
		return res.json() as Promise<{ game_id: string; is_public: boolean }>;
	},

	// Rename (or clear) the owner-editable display title. Pass a trimmed,
	// non-empty string to set; pass null to clear (formatGameTitle then falls
	// back to the save's original game_name and ultimately the nation/turns
	// derivation). Empty / whitespace strings are rejected by the worker —
	// the caller should normalize to `null` before calling.
	renameGame: async (
		id: string,
		displayName: string | null,
		opts?: CallOpts,
	): Promise<{ game_id: string; display_name: string | null }> => {
		const res = await request(`/games/${id}`, {
			...opts,
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ display_name: displayName }),
		});
		return res.json() as Promise<{
			game_id: string;
			display_name: string | null;
		}>;
	},

	// Download the raw save .zip for a game. Auth required (any logged-in
	// user); the Worker enforces is_public-or-owner. Throws
	// UnauthorizedError on 401 — caller should bounce anonymous viewers
	// to /. Throws ApiError(404) on private-not-owned (existence
	// hidden) and ApiError(429) on rate limit.
	downloadGame: async (
		id: string,
		opts?: CallOpts,
	): Promise<{ blob: Blob; filename: string }> => {
		const res = await request(`/games/${id}/download`, opts);
		const blob = await res.blob();
		const cd = res.headers.get("content-disposition") ?? "";
		// RFC 6266: prefer filename*=UTF-8'' over plain filename when both
		// are present so non-ASCII game names land correctly.
		const utf8Match = cd.match(/filename\*=UTF-8''([^;]+)/i);
		const asciiMatch = cd.match(/filename="([^"]+)"/);
		let filename = `${id}.zip`;
		if (utf8Match) {
			try {
				filename = decodeURIComponent(utf8Match[1]);
			} catch {
				if (asciiMatch) filename = asciiMatch[1];
			}
		} else if (asciiMatch) {
			filename = asciiMatch[1];
		}
		return { blob, filename };
	},

	uploadGame: async (
		formData: FormData,
		opts?: CallOpts,
	): Promise<UploadGameResponse> => {
		// Important: do NOT set Content-Type — the browser sets it with the
		// multipart boundary. Setting it manually breaks parsing.
		const res = await request("/games", {
			...opts,
			method: "POST",
			body: formData,
		});
		return res.json() as Promise<UploadGameResponse>;
	},

	deleteGame: async (id: string, opts?: CallOpts): Promise<void> => {
		await request(`/games/${id}`, { ...opts, method: "DELETE" });
	},

	// --- Admin (site-admin only; non-admin requests get 404) ---

	adminListOutOfDate: async (
		currentVersion: string,
		opts?: CallOpts,
	): Promise<AdminGameListResponse> => {
		const res = await request(
			`/admin/games/out-of-date?version=${encodeURIComponent(currentVersion)}`,
			opts,
		);
		return res.json() as Promise<AdminGameListResponse>;
	},

	adminDownloadGame: async (
		id: string,
		opts?: CallOpts,
	): Promise<{ blob: Blob; filename: string }> => {
		const res = await request(`/admin/games/${id}/download`, opts);
		const blob = await res.blob();
		const cd = res.headers.get("content-disposition") ?? "";
		const utf8Match = cd.match(/filename\*=UTF-8''([^;]+)/i);
		const asciiMatch = cd.match(/filename="([^"]+)"/);
		let filename = `${id}.zip`;
		if (utf8Match) {
			try {
				filename = decodeURIComponent(utf8Match[1]);
			} catch {
				if (asciiMatch) filename = asciiMatch[1];
			}
		} else if (asciiMatch) {
			filename = asciiMatch[1];
		}
		return { blob, filename };
	},

	adminReparseUpload: async (
		userId: string,
		formData: FormData,
		opts?: CallOpts,
	): Promise<UploadGameResponse> => {
		const res = await request(`/admin/games/${userId}/reparse-upload`, {
			...opts,
			method: "POST",
			body: formData,
		});
		return res.json() as Promise<UploadGameResponse>;
	},

	// Every game's id + display label, for the admin reindex sweep.
	adminListAllGames: async (
		opts?: CallOpts,
	): Promise<AdminGameIdListResponse> => {
		const res = await request("/admin/games/all", opts);
		return res.json() as Promise<AdminGameIdListResponse>;
	},

	// Rebuild a single game's derived D1 tables from its stored R2 blob —
	// no re-parse, games row untouched. Backfills child-table columns added
	// after upload (e.g. game_player_turn.points).
	adminReindexGame: async (
		id: string,
		opts?: CallOpts,
	): Promise<{ reindexed: boolean }> => {
		const res = await request(`/admin/games/${id}/reindex`, {
			...opts,
			method: "POST",
		});
		return res.json() as Promise<{ reindexed: boolean }>;
	},

	getMyOnlineIds: async (opts?: CallOpts): Promise<string[]> => {
		const res = await request("/users/me/online-ids", opts);
		const body = (await res.json()) as { online_ids: string[] };
		return body.online_ids;
	},

	// DELETE /users/me/online-ids/:online_id — remove a manually-managed
	// link. Idempotent on the server, so callers don't need to handle 404.
	// IDs auto-relink on the next upload that contains them.
	removeOnlineId: async (onlineId: string, opts?: CallOpts): Promise<void> => {
		await request(`/users/me/online-ids/${encodeURIComponent(onlineId)}`, {
			...opts,
			method: "DELETE",
		});
	},

	// --- Stats ---
	// Aggregate ChartBundle for the user corpus — feeds Overview + Stats.
	// Owner sees private+public; visitor / anon sees public-only. Scoped
	// by the single scope selection (the scope row). Worker caches per
	// (user_id, viewerScope, scope); first-after-mutation is a miss, then
	// cached for subsequent reads.
	getUserStats: async (
		userId: string,
		opts?: CallOpts & { scope?: UserScope },
	): Promise<ChartBundle> => {
		const qs =
			opts?.scope != null && opts.scope !== "all"
				? `?scope=${encodeURIComponent(String(opts.scope))}`
				: "";
		const res = await request(`/users/${userId}/stats${qs}`, opts);
		return res.json() as Promise<ChartBundle>;
	},

	// Anonymous discovery feed for the marketing home (/). Returns the 20
	// most recent is_public=1 games + uploader display name + human-player
	// per-turn legitimacy series for the home page's sparkline cards.
	listPublicRecent: async (
		opts?: CallOpts,
	): Promise<PublicRecentGamesResponse> => {
		const res = await request("/games/public-recent", opts);
		return res.json() as Promise<PublicRecentGamesResponse>;
	},

	// --- Collections ---
	listCollections: async (
		opts?: CallOpts & { userId?: string },
	): Promise<CollectionsListResponse> => {
		const qs = opts?.userId ? `?user_id=${opts.userId}` : "";
		const res = await request(`/collections${qs}`, opts);
		return res.json() as Promise<CollectionsListResponse>;
	},

	createCollection: async (
		name: string,
		opts?: CallOpts,
	): Promise<CollectionInfo> => {
		const res = await request("/collections", {
			...opts,
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name }),
		});
		return res.json() as Promise<CollectionInfo>;
	},

	moveGameToCollection: async (
		gameId: string,
		collectionId: number,
		opts?: CallOpts,
	): Promise<void> => {
		await request(`/games/${gameId}`, {
			...opts,
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ collection_id: collectionId }),
		});
	},

	// --- Tournaments (public reads) ---
	listTournaments: async (
		params: { status?: string; limit?: number; offset?: number } = {},
		opts?: CallOpts,
	): Promise<TournamentListResponse> => {
		const qs = new URLSearchParams();
		if (params.status) qs.set("status", params.status);
		if (params.limit !== undefined) qs.set("limit", String(params.limit));
		if (params.offset !== undefined) qs.set("offset", String(params.offset));
		const path = qs.toString() ? `/tournaments?${qs}` : "/tournaments";
		const res = await request(path, opts);
		return res.json() as Promise<TournamentListResponse>;
	},

	getTournament: async (
		slug: string,
		opts?: CallOpts,
	): Promise<TournamentDetail> => {
		const res = await request(`/tournaments/${slug}`, opts);
		return res.json() as Promise<TournamentDetail>;
	},

	getTournamentStandings: async (
		tournamentId: string,
		opts?: CallOpts,
	): Promise<StandingsResponse> => {
		const res = await request(`/tournaments/${tournamentId}/standings`, opts);
		return res.json() as Promise<StandingsResponse>;
	},

	getTournamentBracket: async (
		tournamentId: string,
		opts?: CallOpts,
	): Promise<BracketResponse> => {
		const res = await request(`/tournaments/${tournamentId}/bracket`, opts);
		return res.json() as Promise<BracketResponse>;
	},

	// Admin-only CSV export — returns a zip Blob (standings.csv + matches.csv).
	// Binary, so it returns the Blob rather than parsed JSON; `request` still
	// applies the shared auth + typed-error handling.
	exportTournament: async (
		tournamentId: string,
		opts?: CallOpts,
	): Promise<Blob> => {
		const res = await request(`/tournaments/${tournamentId}/export`, opts);
		return res.blob();
	},

	getTournamentMatches: async (
		tournamentId: string,
		params: {
			round_id?: string;
			phase?: string;
			division?: string;
			slot_id?: string;
		} = {},
		opts?: CallOpts,
	): Promise<{ tournament_id: string; matches: TournamentMatch[] }> => {
		const qs = new URLSearchParams();
		for (const [k, v] of Object.entries(params)) {
			if (v) qs.set(k, v);
		}
		const path = qs.toString()
			? `/tournaments/${tournamentId}/matches?${qs}`
			: `/tournaments/${tournamentId}/matches`;
		const res = await request(path, opts);
		return res.json() as Promise<{
			tournament_id: string;
			matches: TournamentMatch[];
		}>;
	},

	getGameTournamentLink: async (
		gameId: string,
		opts?: CallOpts,
	): Promise<{ link: GameTournamentLink | null }> => {
		const res = await request(`/games/${gameId}/tournament-link`, opts);
		return res.json() as Promise<{ link: GameTournamentLink | null }>;
	},

	getTournamentMatch: async (
		tournamentId: string,
		matchId: string,
		opts?: CallOpts,
	): Promise<TournamentMatch & { tournament_id: string }> => {
		const res = await request(
			`/tournaments/${tournamentId}/matches/${matchId}`,
			opts,
		);
		return res.json() as Promise<TournamentMatch & { tournament_id: string }>;
	},

	// --- Tournaments (authenticated player) ---
	getMyTournaments: async (
		opts?: CallOpts,
	): Promise<{ tournaments: MyTournamentEntry[] }> => {
		const res = await request("/users/me/tournaments", opts);
		return res.json() as Promise<{ tournaments: MyTournamentEntry[] }>;
	},

	getMyAdminTournaments: async (
		opts?: CallOpts,
	): Promise<{ tournaments: MyAdminTournamentEntry[] }> => {
		const res = await request("/users/me/admin-tournaments", opts);
		return res.json() as Promise<{ tournaments: MyAdminTournamentEntry[] }>;
	},

	getMyMatches: async (
		opts?: CallOpts,
	): Promise<{ matches: MyMatchEntry[] }> => {
		const res = await request("/users/me/matches", opts);
		return res.json() as Promise<{ matches: MyMatchEntry[] }>;
	},

	// --- Tournaments (create — allowlisted users only) ---
	createTournament: async (
		body: CreateTournamentBody,
		opts?: CallOpts,
	): Promise<{ tournament: TournamentDetail }> => {
		const res = await request("/tournaments", {
			...opts,
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		return res.json() as Promise<{ tournament: TournamentDetail }>;
	},

	// --- Tournaments (per-tournament admin) ---
	patchTournament: async (
		tournamentId: string,
		body: PatchTournamentBody,
		opts?: CallOpts,
	): Promise<{ tournament: TournamentDetail }> => {
		const res = await request(`/tournaments/${tournamentId}`, {
			...opts,
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		return res.json() as Promise<{ tournament: TournamentDetail }>;
	},

	// Admin roster for the in-app management UI. Admin-gated; unlike the
	// public detail's owner/admins fields, this returns user_ids so the remove
	// controls have something to act on.
	listTournamentAdmins: async (
		tournamentId: string,
		opts?: CallOpts,
	): Promise<{ admins: TournamentAdmin[] }> => {
		const res = await request(`/tournaments/${tournamentId}/admins`, {
			...opts,
			method: "GET",
		});
		return res.json() as Promise<{ admins: TournamentAdmin[] }>;
	},

	// Grant another Per-Ankh user admin on this tournament. A granted admin can
	// act regardless of beta status — beta now gates only tournament creation.
	grantTournamentAdmin: async (
		tournamentId: string,
		userId: string,
		opts?: CallOpts,
	): Promise<{ admin: TournamentAdmin }> => {
		const res = await request(`/tournaments/${tournamentId}/admins`, {
			...opts,
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ user_id: userId }),
		});
		return res.json() as Promise<{ admin: TournamentAdmin }>;
	},

	// Revoke an admin. Server returns 409 CANNOT_REMOVE_CREATOR if userId is
	// the tournament creator.
	revokeTournamentAdmin: async (
		tournamentId: string,
		userId: string,
		opts?: CallOpts,
	): Promise<void> => {
		await request(`/tournaments/${tournamentId}/admins/${userId}`, {
			...opts,
			method: "DELETE",
		});
	},

	// Delete (cancel) a tournament. Server authorizes creator or site admin and
	// rejects completed tournaments (409 CANNOT_DELETE_COMPLETED — those are
	// CLI-only). The structure cascades; uploaded game blobs are kept.
	deleteTournament: async (
		tournamentId: string,
		opts?: CallOpts,
	): Promise<void> => {
		await request(`/tournaments/${tournamentId}`, {
			...opts,
			method: "DELETE",
		});
	},

	bulkCreateSlots: async (
		tournamentId: string,
		slots: Array<{
			division: Division;
			discord_username: string;
			swiss_seed?: number;
			// Optional pre-link via UserAutocomplete. When set, the
			// worker resolves the canonical discord_id + discord_username
			// from the users table — body's discord_username is treated as
			// a hint only. Slot is INSERTed as "claimed" (user_id populated)
			// with no OAuth-callback round trip needed.
			user_id?: string;
		}>,
		opts?: CallOpts,
	): Promise<{
		created: Array<{ slot_id: string; division: Division; swiss_seed: number }>;
	}> => {
		const res = await request(`/tournaments/${tournamentId}/slots`, {
			...opts,
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(slots),
		});
		return res.json() as Promise<{
			created: Array<{
				slot_id: string;
				division: Division;
				swiss_seed: number;
			}>;
		}>;
	},

	patchSlot: async (
		tournamentId: string,
		slotId: string,
		body: {
			discord_username?: string;
			division?: Division;
			swiss_seed?: number;
			// Pre-link a substitution to a registered user (from the slot
			// autocomplete). When set, the worker resolves the canonical
			// discord_username + discord_id and links the slot immediately —
			// no OAuth-callback claim needed.
			user_id?: string;
			// Player's answer to the tournament's optional signup question,
			// edited by an admin on the slots panel. null clears it; omit to
			// leave it untouched.
			signup_answer?: string | null;
		},
		opts?: CallOpts,
	): Promise<void> => {
		await request(`/tournaments/${tournamentId}/slots/${slotId}`, {
			...opts,
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
	},

	deleteSlot: async (
		tournamentId: string,
		slotId: string,
		opts?: CallOpts,
	): Promise<void> => {
		await request(`/tournaments/${tournamentId}/slots/${slotId}`, {
			...opts,
			method: "DELETE",
		});
	},

	// Drag-and-drop reorder of swiss-phase slots. divisions.A and .B are the
	// desired display order (slot_ids); server renumbers swiss_seed = 1..N
	// within each and reassigns division for slots that moved across.
	// Setup-only on the server — call returns 409 if status !== "setup".
	reorderSlots: async (
		tournamentId: string,
		divisions: { A: string[]; B: string[] },
		opts?: CallOpts,
	): Promise<void> => {
		await request(`/tournaments/${tournamentId}/slots/reorder`, {
			...opts,
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ divisions }),
		});
	},

	// User-prefix search — powers the UserAutocomplete on the
	// admin's add-slot form. Beta-gated; returns up to `limit` users whose
	// lowercased discord_username starts with `q`. Returns an empty list
	// for q.length < 2 (still-typing floor; doesn't burn the per-user rate
	// limit). Throws ApiError(429, RATE_LIMIT_USER_SEARCH) past the ceiling.
	searchUsers: async (
		q: string,
		opts?: { limit?: number } & CallOpts,
	): Promise<{ users: UserSearchResult[] }> => {
		const params = new URLSearchParams({ q });
		if (opts?.limit !== undefined) {
			params.set("limit", String(opts.limit));
		}
		const res = await request(`/users/search?${params.toString()}`, {
			...opts,
			method: "GET",
		});
		return res.json() as Promise<{ users: UserSearchResult[] }>;
	},

	// Self-service tournament signup. The player picks a division and may
	// answer the tournament's optional signup question; the server creates a
	// tournament_slots row keyed to their session user. Gated server-side on
	// status='setup' AND signups_open=1.
	signupForTournament: async (
		tournamentId: string,
		division: Division,
		signupAnswer?: string,
		opts?: CallOpts,
	): Promise<{
		slot: { slot_id: string; division: Division; swiss_seed: number };
	}> => {
		const body: { division: Division; signup_answer?: string } = { division };
		if (signupAnswer !== undefined && signupAnswer.trim().length > 0) {
			body.signup_answer = signupAnswer.trim();
		}
		const res = await request(`/tournaments/${tournamentId}/signup`, {
			...opts,
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		return res.json() as Promise<{
			slot: { slot_id: string; division: Division; swiss_seed: number };
		}>;
	},

	// Self-withdraw from a tournament. Allowed any time status='setup' —
	// even after the admin has closed signups, so a dropped-out player can
	// always vacate their slot before the tournament starts.
	withdrawFromTournament: async (
		tournamentId: string,
		opts?: CallOpts,
	): Promise<void> => {
		await request(`/tournaments/${tournamentId}/signup`, {
			...opts,
			method: "DELETE",
		});
	},

	// Single admin gate that flips setup → swiss and generates Round 1
	// for both divisions in one batch. Subsequent rounds advance
	// automatically on the server when a round's last match reports.
	startTournament: async (
		tournamentId: string,
		opts?: CallOpts,
	): Promise<{
		tournament: TournamentDetail;
		rounds: { division: Division; round_id: string; matches: number }[];
	}> => {
		const res = await request(`/tournaments/${tournamentId}/start`, {
			...opts,
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "{}",
		});
		return res.json() as Promise<{
			tournament: TournamentDetail;
			rounds: { division: Division; round_id: string; matches: number }[];
		}>;
	},

	patchMatchMap: async (
		tournamentId: string,
		matchId: string,
		body: { map_pool_id?: string },
		opts?: CallOpts,
	): Promise<void> => {
		await request(`/tournaments/${tournamentId}/matches/${matchId}/map`, {
			...opts,
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
	},

	// Set scheduling metadata on a pending match (admin or participant). Every
	// field is optional; send null to clear. caster_user_id pre-links a
	// Per-Ankh user (server snapshots the canonical username); caster_name
	// alone is a free-text caster.
	patchMatchSchedule: async (
		tournamentId: string,
		matchId: string,
		body: {
			scheduled_at?: string | null;
			stream_url?: string | null;
			caster_user_id?: string | null;
			caster_name?: string | null;
		},
		opts?: CallOpts,
	): Promise<{ match: TournamentMatch }> => {
		const res = await request(
			`/tournaments/${tournamentId}/matches/${matchId}/schedule`,
			{
				...opts,
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			},
		);
		return res.json() as Promise<{ match: TournamentMatch }>;
	},

	retroEditMatch: async (
		tournamentId: string,
		matchId: string,
		body: {
			winner_slot_id?: string | null;
			status?: "pending" | "complete" | "forfeit" | "bye";
			game_id?: string | null;
			notes?: string;
		},
		opts?: CallOpts,
	): Promise<{ match: TournamentMatch }> => {
		const res = await request(
			`/tournaments/${tournamentId}/matches/${matchId}`,
			{
				...opts,
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			},
		);
		return res.json() as Promise<{ match: TournamentMatch }>;
	},

	transitionChampionship: async (
		tournamentId: string,
		body: { override_ranks?: string[] } = {},
		opts?: CallOpts,
	): Promise<{
		status: "championship";
		round_id: string;
		matches: number;
		qualifier_count: number;
		bracket_size: number;
		byes: number;
		seed_order: string[];
	}> => {
		const res = await request(
			`/tournaments/${tournamentId}/transition-championship`,
			{
				...opts,
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			},
		);
		return res.json() as Promise<{
			status: "championship";
			round_id: string;
			matches: number;
			qualifier_count: number;
			bracket_size: number;
			byes: number;
			seed_order: string[];
		}>;
	},
} as const;

// --- Tournament types ---

export type TournamentStatus = "setup" | "swiss" | "championship" | "complete";
export type TournamentPhase = "swiss" | "championship";
export type Division = "A" | "B";

export interface TournamentListItem {
	tournament_id: string;
	slug: string;
	name: string;
	status: TournamentStatus;
	// True iff status='setup' AND the admin has opened signups. Used to drive
	// the "Open for signups" grouping in the list page and the badge on the
	// tournament card.
	signups_open: boolean;
	created_at: string;
	updated_at: string;
	// Swiss-phase config, mirrored from the tournaments row so the list card
	// can render a "Format" stat box without a second round-trip.
	swiss_wins_to_advance: number;
	swiss_losses_to_eliminate: number;
	swiss_max_rounds: number;
	// Length of the tournament's map_pool JSON array, parsed at
	// the worker. Zero when the JSON is corrupt (matches the detail page's
	// public-read leniency for the same column).
	map_pool_size: number;
	// Slot count for the tournament's current phase: championship/complete
	// → bracket size; setup/swiss → swiss signups.
	player_count: number;
	// Aggregated match progress for the highest-numbered round in the
	// tournament's current phase. Null for setup/complete tournaments and
	// for in-flight tournaments whose latest round has no matches yet.
	active_round: {
		round_number: number;
		matches_total: number;
		matches_reported: number;
	} | null;
	// Champion identity for completed tournaments. Pulls the winner of the
	// final championship match through tournament_slots → users. Null for
	// any non-complete tournament or when the final match has no winner
	// recorded yet.
	champion: {
		display_name: string;
		avatar_url: string | null;
	} | null;
}

export interface TournamentListResponse {
	tournaments: TournamentListItem[];
	limit: number;
	offset: number;
}

// One entry in a tournament's map_pool: an instance of a map script with its
// own options. The same script may appear in multiple entries (e.g. Continent
// @ Duel and Continent @ Tiny). `options` is keyed by option zType → value
// (string choice or boolean toggle); the server pre-populates every applicable
// option with its XML default, so it's dense rather than sparse.
export interface MapPoolEntry {
	id: string;
	script: string;
	options: Record<string, string | boolean>;
}

// Input shape for create/patch: `id` is optional — the server assigns one to
// any entry that arrives without it (new entries added in the maps panel).
export type MapPoolEntryInput = {
	id?: string;
	script: string;
	options?: Record<string, string | boolean>;
};

// One external link in a tournament's "Links" menu. `url` is always an http(s)
// link (server-validated; see cloud LinkUrlSchema), rendered as an <a href>.
export interface TournamentLink {
	label: string;
	url: string;
}

export interface TournamentDetail {
	tournament_id: string;
	slug: string;
	name: string;
	description: string | null;
	status: TournamentStatus;
	division_a_name: string;
	division_b_name: string;
	swiss_wins_to_advance: number;
	swiss_losses_to_eliminate: number;
	swiss_max_rounds: number;
	map_pool: MapPoolEntry[];
	// Admin-curated external links shown in the header's "Links" menu (empty
	// array when none configured).
	links: TournamentLink[];
	slot_counts: {
		swiss: number;
		championship: number;
		// Per-division swiss counts so the signup popover can show "Division A
		// (5 players)" without an extra query.
		swiss_by_division: { A: number; B: number };
	};
	// True iff status='setup' AND the admin has opened signups. Drives the
	// "Sign up" CTA on the detail page and the visibility of setup-phase
	// tournaments to non-admins.
	signups_open: boolean;
	// Optional freeform prompt shown on the signup form. Null when no question
	// is configured.
	signup_question: string | null;
	// The caller's swiss slot in this tournament, if any. Drives the "you're
	// signed up" strip and Withdraw button. Null when the caller has no slot,
	// when there's no session, or when only a championship slot exists.
	viewer_slot: {
		slot_id: string;
		division: Division;
		swiss_seed: number;
	} | null;
	is_viewer_admin: boolean;
	// True iff the viewer is the tournament's creator. Combined with the global
	// user.is_admin flag, gates the in-app delete control.
	is_viewer_creator: boolean;
	// Admin roster for the header meta strip. owner = the creator (earliest
	// tournament_admins.granted_at); admins = co-admins added afterward (may be
	// empty). display_name + avatar_url are always present. owner is null only
	// for the degenerate case of a tournament with no admin rows.
	owner: { display_name: string; avatar_url: string } | null;
	admins: { display_name: string; avatar_url: string }[];
	// Admin-announced start time (full ISO instant; display date-only), shown
	// while in setup/sign-ups. Null until set.
	starts_at: string | null;
	// Set once when the tournament completes; shown as "Ended <date>". Null for
	// any non-complete tournament.
	completed_at: string | null;
	created_at: string;
	updated_at: string;
}

// Mirrors cloud/src/schemas/tournament.ts:PatchTournamentSchema. Narrower
// than Partial<TournamentDetail> on purpose: PATCH only accepts
// metadata/config edits, not the derived fields (slot_counts,
// is_viewer_admin) or immutable fields (tournament_id, slug, created_at).
// Valibot strips unknown keys server-side anyway, so this is type-hygiene
// rather than a security boundary.
export interface PatchTournamentBody {
	name?: string;
	description?: string | null;
	division_a_name?: string;
	division_b_name?: string;
	swiss_wins_to_advance?: number;
	swiss_losses_to_eliminate?: number;
	swiss_max_rounds?: number;
	map_pool?: MapPoolEntryInput[];
	// Full replacement of the tournament's links list (≤16). Each url must be an
	// http(s) link (server-enforced). Editable in every phase.
	links?: TournamentLink[];
	// Toggle self-service signups. Only valid in setup; PATCH rejects
	// re-opening once status moves past setup. handleStartTournament auto-
	// clears the flag on the setup → swiss transition.
	signups_open?: boolean;
	// Admin-announced start time as a full ISO-8601 instant, or null to clear.
	// Server validates via v.isoTimestamp(); send new Date(local).toISOString().
	starts_at?: string | null;
	// Optional freeform signup prompt, or null to clear.
	signup_question?: string | null;
}

// A tournament admin as returned by listTournamentAdmins / grantTournamentAdmin.
export interface TournamentAdmin {
	user_id: string;
	display_name: string;
	avatar_url: string;
	// The creator can't be removed from the admin list.
	is_creator: boolean;
}

// Mirrors cloud/src/schemas/tournament.ts:CreateTournamentSchema. `name`
// is the only required field — the public modal asks for name +
// description only and lets the server derive `slug` and apply SQL
// defaults from cloud/migrations/0006_tournaments.sql for everything
// else. `map_pool` may be omitted at create time; the setup → swiss
// transition enforces non-empty before match generation. The admin CLI
// uses the same shape and passes a richer payload.
export interface CreateTournamentBody {
	name: string;
	map_pool?: MapPoolEntryInput[];
	slug?: string;
	description?: string;
	division_a_name?: string;
	division_b_name?: string;
	swiss_wins_to_advance?: number;
	swiss_losses_to_eliminate?: number;
	swiss_max_rounds?: number;
}

export interface SlotStanding {
	slot_id: string;
	wins: number;
	losses: number;
	status: "active" | "advanced" | "eliminated";
	buchholz_cut1: number;
	opponents_buchholz: number;
	cumulative: number;
	h2h: number;
	rank: number;
	tied_with: string[];
	// Display label resolved server-side: the claiming user's Discord display
	// name, falling back to the slot's stored name for unclaimed slots (the
	// name the admin typed when adding the player).
	display_name: string | null;
	user_id: string | null;
	// Discord avatar URL of the claiming user, or null when the slot is
	// unclaimed (render the EFFECTUNIT_ENLIST_ICON fallback in that case).
	avatar_url: string | null;
	swiss_seed: number | null;
	// The player's answer to the tournament's optional signup question. Only
	// populated for admin viewers (null for everyone else); null also when the
	// player didn't answer. Admin-only display in the roster.
	signup_answer: string | null;
	// The slot's raw stored Discord handle. Only populated for admin viewers
	// (null for everyone else). The occupant editor seeds and compares against
	// this — never display_name — so editing the signup answer can't rewrite the
	// handle and unlink the slot. null also for unclaimed slots is fine (the
	// editor falls back to display_name, which equals the typed name there).
	discord_username: string | null;
}

// One entry in the combined-ranking response field. Spans both divisions
// in seeding-cascade order; used by the championship-transition preview
// to show admins exactly who will get which bracket seat.
export interface CombinedQualifier {
	slot_id: string;
	rank: number;
	wins: number;
	losses: number;
	status: "active" | "advanced" | "eliminated";
	h2h: number;
	buchholz_cut1: number;
	opponents_buchholz: number;
	cumulative: number;
	division: "A" | "B" | null;
	// Same server-resolved display label as SlotStanding.display_name.
	display_name: string | null;
	avatar_url: string | null;
	swiss_seed: number | null;
}

export interface StandingsResponse {
	tournament_id: string;
	divisions: {
		A: { name: string; standings: SlotStanding[] };
		B: { name: string; standings: SlotStanding[] };
	};
	// Present once the tournament is past 'setup'. Undefined during setup.
	combined_qualifier_ranking?: CombinedQualifier[];
}

export interface BracketSlot {
	slot_id: string;
	championship_seed: number | null;
	// Same server-resolved display label as SlotStanding.display_name.
	display_name: string | null;
	user_id: string | null;
	avatar_url: string | null;
}

export interface BracketRound {
	round_id: string;
	round_number: number;
	status: "pending" | "in_progress" | "complete";
	matches: TournamentMatch[];
}

export interface BracketResponse {
	tournament_id: string;
	slots: BracketSlot[];
	rounds: BracketRound[];
}

export interface TournamentMatch {
	match_id: string;
	round_id?: string;
	round_number?: number;
	phase?: TournamentPhase;
	division?: Division | null;
	slot_a_id: string;
	slot_b_id: string | null;
	// Assigned map_pool instance id; resolve options from tournament.map_pool.
	// map_script is the denormalized played MAPCLASS label. Both null for byes.
	map_pool_id: string | null;
	map_script: string | null;
	pick_order_winner_slot_id: string | null;
	status: "pending" | "complete" | "forfeit" | "bye";
	winner_slot_id: string | null;
	game_id: string | null;
	reported_by_user_id: string | null;
	reported_at: string | null;
	notes: string | null;
	// Linked game's turn count, surfaced on bracket matches only (the complete
	// header's "won the final in N turns" line). Null when no game was uploaded
	// for the match, and absent from non-bracket match payloads.
	total_turns?: number | null;
	// Display labels for the slot-occupant snapshot taken at report time
	// (migration 0024): resolved server-side from the snapshot user_id (the
	// occupant's *current* display name — presentation follows the profile,
	// identity stays pinned), falling back to the report-time name for
	// occupants who never claimed an account. Null for pending matches (no
	// snapshot) — renderers prefer these for non-pending matches and fall
	// through to the live slot-identity maps otherwise, so a later
	// substitution doesn't rewrite historical names/avatars.
	slot_a_display_name: string | null;
	slot_a_user_id: string | null;
	slot_b_display_name: string | null;
	slot_b_user_id: string | null;
	// Raw stored Discord handle of each side's LIVE slot occupant (not the
	// snapshot). Only populated for admin viewers (null otherwise, and null for
	// pending/bye sides). The substitute editor seeds and compares against this
	// so opening it on a claimed slot can't rewrite the handle to the display
	// name and unlink the slot.
	slot_a_discord_username: string | null;
	slot_b_discord_username: string | null;
	// Avatar URLs resolved server-side from the snapshot user_ids. Null for
	// pending matches (no snapshot) and for slots whose occupant had no
	// claimed discord_id at report time — frontend falls through to live
	// data in those cases.
	slot_a_avatar_url: string | null;
	slot_b_avatar_url: string | null;
	// Nation each slot played, resolved server-side via the slot↔player_index
	// mapping against the linked game's player_summaries. Null when no save is
	// linked or the nation is unknown (bye, forfeit, admin-set, legacy match) —
	// the crest is shown only when this is present.
	slot_a_nation: string | null;
	slot_b_nation: string | null;
	// Scheduling metadata (migration 0025). Editable on pending matches by an
	// admin or either participant. scheduled_at is a full ISO-8601 instant
	// (UTC); stream_url a youtube/twitch link. Caster is modeled like a slot
	// occupant: caster_user_id links a Per-Ankh user when picked (else null);
	// caster_name is the storage/edit value (canonical username when linked,
	// free text otherwise). caster_display_name is the rendered label — the
	// linked user's display name, falling back to caster_name — and
	// caster_avatar_url resolves server-side from caster_user_id (null for
	// a free-text caster or one with no claimed avatar).
	scheduled_at: string | null;
	stream_url: string | null;
	caster_user_id: string | null;
	caster_name: string | null;
	caster_display_name: string | null;
	caster_avatar_url: string | null;
	// Client-only flag: true for synthesized future-round bracket cells that
	// don't yet correspond to a real tournament_matches row. The server never
	// sets this. MatchPopover uses it to render a stripped-down preview view
	// (no map name / no retro-edit / no upload actions; substitute pencil
	// only on resolved sides).
	is_placeholder?: boolean;
}

export interface MyTournamentEntry {
	tournament_id: string;
	slug: string;
	name: string;
	status: TournamentStatus;
	slot_id: string;
	division: Division | null;
	claim_banner_dismissed_at: string | null;
}

export interface MyAdminTournamentEntry {
	tournament_id: string;
	slug: string;
	name: string;
	status: TournamentStatus;
}

// Hand-rolled to match the SELECT in cloud handleMyMatches exactly. Does NOT
// extend TournamentMatch — that endpoint returns a narrower projection (no
// pick_order_winner_slot_id, reported_by_user_id, notes) and pretending
// otherwise would surface undefined under non-optional fields.
export interface MyMatchEntry {
	match_id: string;
	round_id: string;
	slot_a_id: string;
	slot_b_id: string | null;
	map_script: string | null;
	status: "pending" | "complete" | "forfeit" | "bye";
	winner_slot_id: string | null;
	game_id: string | null;
	reported_at: string | null;
	tournament_id: string;
	phase: TournamentPhase;
	division: Division | null;
	round_number: number;
	round_status: "pending" | "in_progress" | "complete";
	tournament_slug: string;
	tournament_name: string;
}

export interface GameTournamentLink {
	tournament: {
		tournament_id: string;
		slug: string;
		name: string;
		status: TournamentStatus;
	};
	match: {
		match_id: string;
		phase: TournamentPhase;
		division: Division | null;
		round_number: number;
		map_script: string | null;
		status: "pending" | "complete" | "forfeit" | "bye";
		slot_a_id: string;
		slot_b_id: string | null;
		winner_slot_id: string | null;
		// Server-resolved display labels (claiming user's display name, stored
		// name fallback for unclaimed slots).
		slot_a_display_name: string | null;
		slot_b_display_name: string | null;
	};
}
