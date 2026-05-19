// Cloud API client — fetch wrapper for the Per-Ankh Worker. Consumed by
// all cloud pages (`/`, `/auth/callback`, `/games`, `/games/[id]`,
// `/upload`).
//
// Configure via VITE_API_URL (see .env.example).

import type { FullGameData } from "$lib/parser/types";

const DEFAULT_API_BASE = "https://api.per-ankh.app/v1";
const API_BASE = (import.meta.env.VITE_API_URL ?? DEFAULT_API_BASE) as string;

// Result row returned by cloudApi.searchUsers — drives the
// SlotUsernameAutocomplete. Intentionally narrow: discord_username for
// matching, display_name for human-recognizable disambiguation in the
// dropdown, discord_id + user_id for the eventual slot pre-link payload.
// No email, no avatar, no timestamps.
export interface UserSearchResult {
	user_id: string;
	discord_id: string;
	discord_username: string;
	display_name: string;
}

export interface UserMe {
	user_id: string;
	discord_id: string;
	display_name: string;
	// Lowercased Discord handle (mirrors the value stored on
	// tournament_slots.discord_username). Used by the SignupModal to show
	// "Signed in as @username" so players know the exact identity they'll
	// be entered under.
	discord_username: string;
	avatar_url: string;
	// True iff the user is on the tournament beta allowlist. Drives the
	// header's Tournaments link visibility and skips layout-load tournament
	// fetches for non-beta users. Not load-bearing for security — the
	// worker re-checks on every tournament endpoint.
	is_beta: boolean;
}

export interface GameListItem {
	game_id: string;
	game_name: string | null;
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

export interface CollectionsListResponse {
	collections: CollectionInfo[];
	public_count: number;
}

export interface GameListResponse {
	games: GameListItem[];
	total: number;
}

// Wire shape for GET /v1/games/public-recent — the marketing home's
// discovery feed. Includes the uploader's display name + a sparkline-ready
// per-turn legitimacy ("VP") series for each human player.
export interface PublicRecentPlayer {
	player_index: number;
	player_name: string;
	nation: string | null;
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
	user_nation: string | null;
	user_won: boolean | null;
	winner_nation: string | null;
	winner_name: string | null;
	victory_type: string | null;
	map_size: string | null;
	map_class: string | null;
	total_turns: number;
	save_date: string | null;
	created_at: string;
	uploader_display_name: string;
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

// Cross-game stats for the cloud /dashboard. Mirrors desktop GameStatistics
// + SaveDateEntry shapes so the same chart-building helpers render both.
export interface StatsResponse {
	total_games: number;
	nations: Array<{ nation: string; games_played: number }>;
	save_dates: Array<{ date: string; nation: string | null }>;
	win_rate: number | null;
	games_with_outcome: number;
	favorite_day_of_week: number | null; // 0=Sunday..6=Saturday
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
	discordStart: (
		redirectUri: string,
		next: string | null,
		inviteCode: string | null,
		opts?: CallOpts,
	) =>
		postJson<{ authorize_url: string }>(
			"/auth/discord/start",
			{
				redirect_uri: redirectUri,
				next: next ?? undefined,
				invite_code: inviteCode ?? undefined,
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

	// --- Games ---
	listGames: async (opts?: CallOpts): Promise<GameListResponse> => {
		const res = await request("/games", opts);
		return res.json() as Promise<GameListResponse>;
	},

	// Owner GET — returns the blob with `is_public` and `user_nation`
	// injected by the Worker. `is_public` drives the visibility toggle's
	// initial state; `user_nation` is the uploader's picked nation (null in
	// observer mode) and lets the detail view label the page with the
	// uploader's choice instead of the alphabetical-first-human heuristic.
	getGame: async (
		id: string,
		opts?: CallOpts,
	): Promise<
		FullGameData & { is_public?: boolean; user_nation?: string | null }
	> => {
		const res = await request(`/games/${id}`, opts);
		return res.json() as Promise<
			FullGameData & { is_public?: boolean; user_nation?: string | null }
		>;
	},

	// Anonymous public read — no credentials, no auto-redirect to login.
	// Used as a fallback when getGame() returns 401 (the user isn't signed in
	// or doesn't own the game). 401 from this path means the game is
	// genuinely private; 404 means it doesn't exist.
	getPublicGame: async (
		id: string,
		opts?: CallOpts,
	): Promise<FullGameData & { user_nation?: string | null }> => {
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
			FullGameData & { user_nation?: string | null }
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
	getStats: async (opts?: CallOpts): Promise<StatsResponse> => {
		const res = await request("/stats", opts);
		return res.json() as Promise<StatsResponse>;
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
		opts?: CallOpts,
	): Promise<CollectionsListResponse> => {
		const res = await request("/collections", opts);
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

	dismissTournamentBanner: async (
		tournamentId: string,
		opts?: CallOpts,
	): Promise<void> => {
		await request(`/users/me/tournaments/${tournamentId}/dismiss-banner`, {
			...opts,
			method: "POST",
		});
	},

	// --- Tournaments (create — any signed-in user) ---
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

	bulkCreateSlots: async (
		tournamentId: string,
		slots: Array<{
			division: Division;
			discord_username: string;
			swiss_seed?: number;
			// Optional pre-link via SlotUsernameAutocomplete. When set, the
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

	// User-prefix search — powers the SlotUsernameAutocomplete on the
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

	// Self-service tournament signup. The player picks a division; the
	// server creates a tournament_slots row keyed to their session user.
	// Gated server-side on status='setup' AND signups_open=1.
	signupForTournament: async (
		tournamentId: string,
		division: Division,
		opts?: CallOpts,
	): Promise<{
		slot: { slot_id: string; division: Division; swiss_seed: number };
	}> => {
		const res = await request(`/tournaments/${tournamentId}/signup`, {
			...opts,
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ division }),
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
		body: { map_script?: string },
		opts?: CallOpts,
	): Promise<void> => {
		await request(`/tournaments/${tournamentId}/matches/${matchId}/map`, {
			...opts,
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
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
}

export interface TournamentListResponse {
	tournaments: TournamentListItem[];
	limit: number;
	offset: number;
}

// Per-script option overrides keyed by MAPCLASS_* → option zType →
// value. Values are either a string (one of the option's <Choices>)
// or boolean (toggles). Sparse — a missing option key means "use the
// XML <Default>" at render time. Pre-populated by the server with XML
// defaults whenever a script enters allowed_map_scripts.
export type MapScriptOptions = Record<string, Record<string, string | boolean>>;

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
	allowed_map_scripts: string[];
	map_script_options: MapScriptOptions;
	slot_counts: {
		swiss: number;
		championship: number;
		// Per-division swiss counts so the SignupModal can show "Division A
		// (5 players)" without an extra query.
		swiss_by_division: { A: number; B: number };
	};
	// True iff status='setup' AND the admin has opened signups. Drives the
	// "Sign up" CTA on the detail page and the visibility of setup-phase
	// tournaments to non-admins.
	signups_open: boolean;
	// The caller's swiss slot in this tournament, if any. Drives the "you're
	// signed up" strip and Withdraw button. Null when the caller has no slot,
	// when there's no session, or when only a championship slot exists.
	viewer_slot: {
		slot_id: string;
		division: Division;
		swiss_seed: number;
	} | null;
	is_viewer_admin: boolean;
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
	allowed_map_scripts?: string[];
	map_script_options?: MapScriptOptions;
	// Toggle self-service signups. Only valid in setup; PATCH rejects
	// re-opening once status moves past setup. handleStartTournament auto-
	// clears the flag on the setup → swiss transition.
	signups_open?: boolean;
}

// Mirrors cloud/src/schemas/tournament.ts:CreateTournamentSchema. Only
// name + allowed_map_scripts are required; the public UI omits `slug`
// and lets the server derive one from `name`, while the admin CLI sends
// an explicit slug. Everything else falls back to the SQL defaults in
// cloud/migrations/0006_tournaments.sql.
export interface CreateTournamentBody {
	name: string;
	allowed_map_scripts: string[];
	slug?: string;
	description?: string;
	division_a_name?: string;
	division_b_name?: string;
	swiss_wins_to_advance?: number;
	swiss_losses_to_eliminate?: number;
	swiss_max_rounds?: number;
	map_script_options?: MapScriptOptions;
}

export interface SlotStanding {
	slot_id: string;
	wins: number;
	losses: number;
	status: "active" | "advanced" | "eliminated";
	buchholz_cut1: number;
	cumulative: number;
	h2h: number;
	rank: number;
	tied_with: string[];
	discord_username: string | null;
	user_id: string | null;
	swiss_seed: number | null;
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
	cumulative: number;
	division: "A" | "B" | null;
	discord_username: string | null;
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
	discord_username: string | null;
	user_id: string | null;
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
	map_script: string | null;
	pick_order_winner_slot_id: string | null;
	status: "pending" | "complete" | "forfeit" | "bye";
	winner_slot_id: string | null;
	game_id: string | null;
	reported_by_user_id: string | null;
	reported_at: string | null;
	notes: string | null;
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
		slot_a_username: string | null;
		slot_b_username: string | null;
	};
}
