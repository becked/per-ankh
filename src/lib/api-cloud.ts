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
	created_at: string;
}

export interface GameListResponse {
	games: GameListItem[];
	total: number;
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
}

async function request(
	path: string,
	init: RequestInit & CallOpts = {},
): Promise<Response> {
	const { fetch: customFetch, ...rest } = init;
	const f = customFetch ?? fetch;
	const res = await f(`${API_BASE}${path}`, {
		...rest,
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

export const cloudApi = {
	// --- Auth ---
	discordStart: (redirectUri: string, opts?: CallOpts) =>
		postJson<{ authorize_url: string }>(
			"/auth/discord/start",
			{ redirect_uri: redirectUri },
			opts,
		),

	discordCallback: (code: string, state: string, redirectUri: string, opts?: CallOpts) =>
		postJson<UserMe>(
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

	getGame: async (id: string, opts?: CallOpts): Promise<FullGameData> => {
		const res = await request(`/games/${id}`, opts);
		return res.json() as Promise<FullGameData>;
	},

	uploadGame: async (
		formData: FormData,
		opts?: CallOpts,
	): Promise<{ game_id: string; url: string }> => {
		// Important: do NOT set Content-Type — the browser sets it with the
		// multipart boundary. Setting it manually breaks parsing.
		const res = await request("/games", {
			...opts,
			method: "POST",
			body: formData,
		});
		return res.json() as Promise<{ game_id: string; url: string }>;
	},

	deleteGame: async (id: string, opts?: CallOpts): Promise<void> => {
		await request(`/games/${id}`, { ...opts, method: "DELETE" });
	},

	getMyOnlineIds: async (opts?: CallOpts): Promise<string[]> => {
		const res = await request("/users/me/online-ids", opts);
		const body = (await res.json()) as { online_ids: string[] };
		return body.online_ids;
	},

	// --- Stats ---
	getStats: async (opts?: CallOpts): Promise<StatsResponse> => {
		const res = await request("/stats", opts);
		return res.json() as Promise<StatsResponse>;
	},
} as const;
