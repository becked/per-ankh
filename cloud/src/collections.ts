// /v1/collections endpoints — list user's collections (with per-collection
// game counts plus a public_count) and create a new collection.
//
// Per-user scoping mirrors handleGamePatch: every read/write is gated on
// session.data.user_id from sessionFromRequest. The "Personal" default is
// seeded in handleDiscordCallback (cloud/src/auth.ts) on first login, so
// listCollections always returns at least one row for an authenticated user.

import * as v from "valibot";
import { CreateCollectionSchema } from "./schemas/collection";
import {
	cloudCorsHeaders,
	errorResponse,
	jsonResponse,
} from "./util";
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
	if (!session) return errorResponse("Unauthorized", 401, cors, "UNAUTHORIZED");
	const userId = session.data.user_id;

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

	const publicRow = await env.SHARE_DB.prepare(
		"SELECT COUNT(*) AS count FROM games WHERE user_id = ? AND is_public = 1",
	)
		.bind(userId)
		.first<{ count: number }>();

	const collections = (collectionsRes.results ?? []).map((r) => ({
		collection_id: r.collection_id,
		name: r.name,
		is_default: r.is_default === 1,
		game_count: r.game_count,
	}));

	return jsonResponse(
		{ collections, public_count: publicRow?.count ?? 0 },
		200,
		cors,
	);
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
