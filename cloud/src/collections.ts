// /v1/collections endpoints — list user's collections (with per-collection
// game counts plus scope_counts for the home-page scope selector) and
// create a new collection.
//
// Per-user scoping mirrors handleGamePatch: every read/write is gated on
// session.data.user_id from sessionFromRequest. The "Personal" default is
// seeded in handleDiscordCallback (cloud/src/auth.ts) on first login, so
// listCollections always returns at least one row for an authenticated user.

import * as v from "valibot";
import { CreateCollectionSchema } from "./schemas/collection";
import { cloudCorsHeaders, errorResponse, jsonResponse } from "./util";
import { sessionFromRequest } from "./session";
import type { SessionEnv } from "./session";

export interface CollectionsEnv extends SessionEnv {
	SHARE_DB: D1Database;
	ALLOWED_ORIGINS: string;
}

interface CollectionRow {
	collection_id: number;
	name: string;
	is_default: number;
	game_count: number;
}

export async function handleCollectionsList(
	request: Request,
	env: CollectionsEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);

	const session = await sessionFromRequest(env, request);
	const url = new URL(request.url);

	// ?user_id selects whose collections to list. Collections are an
	// owner-only organizational tool in v1 — visitor / anon view returns
	// an empty collections array (scope_counts are still computed, scoped
	// to the target's public games, for the visitor's scope selector).
	const targetParam = url.searchParams.get("user_id");
	let userId: string;
	let viewerOwnsTarget: boolean;
	if (targetParam !== null) {
		if (!/^[A-Za-z0-9_-]{21}$/.test(targetParam)) {
			return errorResponse("Invalid user_id", 400, cors, "INVALID_USER_ID");
		}
		userId = targetParam;
		viewerOwnsTarget = session?.data.user_id === userId;
	} else {
		if (!session) {
			return errorResponse("Unauthorized", 401, cors, "UNAUTHORIZED");
		}
		userId = session.data.user_id;
		viewerOwnsTarget = true;
	}

	// Per-scope game counts for the home-page scope selector — one count
	// per built-in slice (all / public / vs_ai / mp / tournament), shown
	// on each option like collections show theirs. Computed in one pass;
	// the visibility clause keeps a visitor's counts to public games only.
	// The game-type predicates mirror buildUserScopeWhere.
	const visClause = viewerOwnsTarget ? "" : " AND is_public = 1";
	const countsRow = await env.SHARE_DB.prepare(
		`SELECT
		   COUNT(*) AS all_count,
		   SUM(CASE WHEN is_public = 1 THEN 1 ELSE 0 END) AS public_count,
		   SUM(CASE WHEN game_id IN (SELECT game_id FROM tournament_matches WHERE game_id IS NOT NULL)
		            THEN 1 ELSE 0 END) AS tournament_count,
		   SUM(CASE WHEN game_id NOT IN (SELECT game_id FROM tournament_matches WHERE game_id IS NOT NULL)
		             AND game_id IN (SELECT game_id FROM player_summaries WHERE is_human = 1 GROUP BY game_id HAVING COUNT(*) = 1)
		            THEN 1 ELSE 0 END) AS vs_ai_count,
		   SUM(CASE WHEN game_id NOT IN (SELECT game_id FROM tournament_matches WHERE game_id IS NOT NULL)
		             AND game_id IN (SELECT game_id FROM player_summaries WHERE is_human = 1 GROUP BY game_id HAVING COUNT(*) > 1)
		            THEN 1 ELSE 0 END) AS mp_count
		 FROM games WHERE user_id = ?${visClause}`,
	)
		.bind(userId)
		.first<{
			all_count: number;
			public_count: number | null;
			tournament_count: number | null;
			vs_ai_count: number | null;
			mp_count: number | null;
		}>();

	const scope_counts = {
		all: countsRow?.all_count ?? 0,
		public: countsRow?.public_count ?? 0,
		vs_ai: countsRow?.vs_ai_count ?? 0,
		mp: countsRow?.mp_count ?? 0,
		tournament: countsRow?.tournament_count ?? 0,
	};

	if (!viewerOwnsTarget) {
		return jsonResponse({ collections: [], scope_counts }, 200, cors);
	}

	const collectionsRes = await env.SHARE_DB.prepare(
		`SELECT c.collection_id, c.name, c.is_default,
		        COUNT(g.game_id) AS game_count
		 FROM collections c
		 LEFT JOIN games g ON g.collection_id = c.collection_id
		 WHERE c.user_id = ?
		 GROUP BY c.collection_id, c.name, c.is_default, c.created_at
		 ORDER BY c.is_default DESC, c.created_at ASC`,
	)
		.bind(userId)
		.all<CollectionRow>();

	const collections = (collectionsRes.results ?? []).map((r) => ({
		collection_id: r.collection_id,
		name: r.name,
		is_default: r.is_default === 1,
		game_count: r.game_count,
	}));

	return jsonResponse({ collections, scope_counts }, 200, cors);
}

export async function handleCollectionCreate(
	request: Request,
	env: CollectionsEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);

	const session = await sessionFromRequest(env, request);
	if (!session) return errorResponse("Unauthorized", 401, cors, "UNAUTHORIZED");
	const userId = session.data.user_id;

	let parsed: unknown;
	try {
		parsed = await request.json();
	} catch {
		return errorResponse("Invalid JSON body", 400, cors, "INVALID_JSON");
	}
	const validation = v.safeParse(CreateCollectionSchema, parsed);
	if (!validation.success) {
		return errorResponse(
			`Invalid body: ${validation.issues[0]?.message ?? "unknown"}`,
			400,
			cors,
			"INVALID_BODY",
		);
	}
	const { name } = validation.output;

	try {
		const inserted = await env.SHARE_DB.prepare(
			`INSERT INTO collections (user_id, name, is_default) VALUES (?, ?, 0)
			 RETURNING collection_id, name, is_default`,
		)
			.bind(userId, name)
			.first<{ collection_id: number; name: string; is_default: number }>();

		if (!inserted) {
			return errorResponse(
				"Insert returned no row",
				500,
				cors,
				"INSERT_FAILED",
			);
		}

		return jsonResponse(
			{
				collection_id: inserted.collection_id,
				name: inserted.name,
				is_default: inserted.is_default === 1,
				game_count: 0,
			},
			201,
			cors,
		);
	} catch (err) {
		// D1 surfaces UNIQUE-constraint failures via the error message.
		// Match on substring rather than relying on a structured error code.
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes("UNIQUE") || msg.includes("constraint")) {
			return errorResponse(
				"A collection with that name already exists",
				409,
				cors,
				"DUPLICATE_NAME",
			);
		}
		throw err;
	}
}
