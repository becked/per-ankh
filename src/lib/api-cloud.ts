// Cloud API client — fetch wrapper for the Per-Ankh Worker.
//
// This file is the cloud-rewrite counterpart of `src/lib/api.ts` (which
// uses Tauri's invoke() for desktop). During the transition both coexist;
// this file is consumed by all cloud-route pages (`/login`, `/auth/callback`,
// `/games`, `/games/[id]`, `/upload`).
//
// Configure via VITE_API_URL (see .env.example).

import type { FullGameData } from "$lib/parser/types";

const DEFAULT_API_BASE = "http://localhost:8787/v1";
const API_BASE = (import.meta.env.VITE_API_URL ?? DEFAULT_API_BASE) as string;

export interface UserMe {
	user_id: string;
	discord_id: string;
	display_name: string;
	avatar_url: string;
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
	// localhost:5173 ↔ localhost:8787 isn't same-eTLD+1, so SvelteKit's
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
				const body = payload as { code?: string; error?: string; message?: string };
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
			{ redirect_uri: redirectUri, next: next ?? undefined },
			opts,
		),

	discordCallback: (code: string, state: string, redirectUri: string, opts?: CallOpts) =>
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

	// Owner GET — returns the blob with an `is_public` flag injected by the
	// Worker so the visibility toggle has its initial state. The `is_public`
	// field is server-supplied metadata, not part of the parser's output.
	getGame: async (
		id: string,
		opts?: CallOpts,
	): Promise<FullGameData & { is_public?: boolean }> => {
		const res = await request(`/games/${id}`, opts);
		return res.json() as Promise<FullGameData & { is_public?: boolean }>;
	},

	// Anonymous public read — no credentials, no auto-redirect to login.
	// Used as a fallback when getGame() returns 401 (the user isn't signed in
	// or doesn't own the game). 401 from this path means the game is
	// genuinely private; 404 means it doesn't exist.
	getPublicGame: async (id: string, opts?: CallOpts): Promise<FullGameData> => {
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
		return res.json() as Promise<FullGameData>;
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
	// to /login. Throws ApiError(404) on private-not-owned (existence
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

	// --- Collections ---
	listCollections: async (opts?: CallOpts): Promise<CollectionsListResponse> => {
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
} as const;
