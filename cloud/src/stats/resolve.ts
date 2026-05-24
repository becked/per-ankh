// Corpus resolver — translates a "/v1/users/:id/stats" request into a
// concrete StatsCorpus the aggregator can run against.
//
//   user: games WHERE user_id = ? [AND is_public=1 for visitor view]
//         [AND game-type filter — vs AI / MP / tournament / all]
//
// StatsCorpus carries everything the aggregator needs to compute the
// bundle without re-querying the users table.

import { buildUserScopeWhere } from "../games-scope";
import type { UserScope, UserStatsScope } from "./types";

export interface ResolveEnv {
	SHARE_DB: D1Database;
}

export interface StatsCorpus {
	gameIds: string[];
	userId: string;
	display_name: string;
}

interface UserRow {
	user_id: string;
	display_name: string;
}

// Resolve the user corpus. Returns null if the target user doesn't
// exist (handler turns that into a 404). The caller passes the viewer
// vs target ownership check; this function only knows the scope and
// game-type filter to apply.
export async function resolveUserCorpus(
	env: ResolveEnv,
	userId: string,
	viewerScope: UserStatsScope,
	scope: UserScope,
): Promise<StatsCorpus | null> {
	const userRow = await env.SHARE_DB.prepare(
		"SELECT user_id, display_name FROM users WHERE user_id = ?",
	)
		.bind(userId)
		.first<UserRow>();
	if (!userRow) return null;

	// Same scope predicate the Games tab uses so the aggregated bundle and
	// the games list agree on the in-scope set. viewerScope === "self" ⇔
	// the viewer owns the target.
	const { clause, binds } = buildUserScopeWhere({
		scope,
		viewerOwnsTarget: viewerScope === "self",
	});

	const rows = await env.SHARE_DB.prepare(
		`SELECT game_id FROM games WHERE user_id = ?${clause}`,
	)
		.bind(userId, ...binds)
		.all<{ game_id: string }>();

	return {
		gameIds: (rows.results ?? []).map((r) => r.game_id),
		userId: userRow.user_id,
		display_name: userRow.display_name,
	};
}
