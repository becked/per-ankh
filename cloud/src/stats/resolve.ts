// Corpus resolver — translates a "/v1/users/:id/stats" request into a
// concrete StatsCorpus the aggregator can run against.
//
//   user: games WHERE user_id = ? [AND is_public=1 for visitor view]
//         [AND game-type filter — vs AI / MP / tournament / all]
//
// StatsCorpus is the set of in-scope game ids the aggregator runs over.

import { buildUserScopeWhere } from "../games-scope";
import type { UserScope, UserStatsScope } from "./types";

export interface ResolveEnv {
	SHARE_DB: D1Database;
}

export interface StatsCorpus {
	gameIds: string[];
}

interface UserRow {
	user_id: string;
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
		"SELECT user_id FROM users WHERE user_id = ?",
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
	};
}

// Resolve a tournament's corpus: the saves linked to its completed matches.
// The join through tournament_rounds is required — tournament_matches has no
// tournament_id column. status='complete' is deliberate: a retro-edit can leave
// a linked game on a forfeit match, and such a save is an aborted/adjudicated
// game whose content would pollute the distributions (byes never carry a
// game_id; the 0013 trigger nulls game_id on game deletion, so nothing dangles).
// Unlike resolveUserCorpus there's no viewerScope/scope (tournaments are public)
// and no existence probe — the handler has already loaded the tournament for the
// setup gate.
export async function resolveTournamentCorpus(
	env: ResolveEnv,
	tournamentId: string,
): Promise<StatsCorpus> {
	const rows = await env.SHARE_DB.prepare(
		`SELECT DISTINCT m.game_id FROM tournament_matches m
		 JOIN tournament_rounds r ON r.round_id = m.round_id
		 WHERE r.tournament_id = ? AND m.game_id IS NOT NULL
		   AND m.status = 'complete'`,
	)
		.bind(tournamentId)
		.all<{ game_id: string }>();

	return {
		gameIds: (rows.results ?? []).map((r) => r.game_id),
	};
}
