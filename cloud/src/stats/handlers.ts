// HTTP handler for the stats endpoint.
//
//   GET /v1/users/:user_id/stats           — user corpus
//
// Resolve corpus → check cache → compute on miss → return bundle.

import { CURRENT_PARSER_VERSION } from "../schemas/game";
import { sessionFromRequest } from "../session";
import type { SessionEnv } from "../session";
import { cloudCorsHeaders, errorResponse, jsonResponse } from "../util";
import { parseScopeParam } from "../games-scope";
import { buildChartBundle } from "./aggregate";
import { getCached, putCached } from "./cache";
import { resolveUserCorpus } from "./resolve";
import type { UserStatsScope } from "./types";

export interface UserStatsEnv extends SessionEnv {
	SHARE_DB: D1Database;
	SESSIONS_KV: KVNamespace;
	ALLOWED_ORIGINS: string;
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
	const cached = await getCached(env, cacheKey);
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

	const bundle = await buildChartBundle(env, corpus, CURRENT_PARSER_VERSION);
	await putCached(env, cacheKey, bundle);
	return jsonResponse(bundle as unknown as Record<string, unknown>, 200, cors);
}
