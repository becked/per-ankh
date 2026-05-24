// Shared "what's in scope" predicate for a user's games.
//
// The Games tab (handleGameList) and the Stats/Overview ChartBundle
// (resolveUserCorpus) must agree on exactly which of a user's saves are
// in scope, or the games table and the aggregate numbers desync. Both
// query `FROM games`, so this builds the AND-fragments that follow a
// base `WHERE user_id = ?` clause using bare column names.
//
// Scope is a single mutually-exclusive selection (UserScope) — the scope
// row presents it as one dropdown. Identity visibility (visitors only
// ever see is_public=1) composes on top.

import type { UserScope } from "./stats/types";

export interface UserScopeOpts {
	scope: UserScope;
	// Owner sees private+public and may select a specific collection or
	// the public subset; a visitor/anon is forced to is_public=1 and can't
	// select a private collection (the existence of private collections
	// must not leak via 0-count splits).
	viewerOwnsTarget: boolean;
}

// Returns the SQL fragment to append after `user_id = ?` (begins with
// " AND " when non-empty, else "") plus the positional binds it adds
// (only a numeric collection_id; game-type subqueries are constant SQL).
export function buildUserScopeWhere(opts: UserScopeOpts): {
	clause: string;
	binds: number[];
} {
	const parts: string[] = [];
	const binds: number[] = [];

	// Identity visibility — independent of the selection.
	if (!opts.viewerOwnsTarget) {
		parts.push("is_public = 1");
	}

	const scope = opts.scope;
	if (scope === "public") {
		// Owner viewing their public subset. (A visitor is already forced
		// to is_public=1 above, so this is a no-op for them.)
		if (opts.viewerOwnsTarget) parts.push("is_public = 1");
	} else if (typeof scope === "number") {
		// Collection selection is owner-only.
		if (opts.viewerOwnsTarget) {
			parts.push("collection_id = ?");
			binds.push(scope);
		}
	} else if (scope === "tournament") {
		parts.push(
			"game_id IN (SELECT game_id FROM tournament_matches WHERE game_id IS NOT NULL)",
		);
	} else if (scope === "vs_ai") {
		// Not tournament-linked AND exactly one human.
		parts.push(
			"game_id NOT IN (SELECT game_id FROM tournament_matches WHERE game_id IS NOT NULL)",
		);
		parts.push(
			"game_id IN (SELECT game_id FROM player_summaries WHERE is_human = 1 GROUP BY game_id HAVING COUNT(*) = 1)",
		);
	} else if (scope === "mp") {
		// Not tournament-linked AND ≥2 humans (freeform multiplayer).
		parts.push(
			"game_id NOT IN (SELECT game_id FROM tournament_matches WHERE game_id IS NOT NULL)",
		);
		parts.push(
			"game_id IN (SELECT game_id FROM player_summaries WHERE is_human = 1 GROUP BY game_id HAVING COUNT(*) > 1)",
		);
	}
	// scope === "all" → no additional predicate.

	const clause = parts.length > 0 ? ` AND ${parts.join(" AND ")}` : "";
	return { clause, binds };
}

// Parse the ?scope query param into a UserScope. A run of digits → that
// collection_id; the known keywords pass through; anything else → "all".
export function parseScopeParam(raw: string | null): UserScope {
	if (
		raw === "public" ||
		raw === "vs_ai" ||
		raw === "mp" ||
		raw === "tournament"
	) {
		return raw;
	}
	if (raw && /^\d+$/.test(raw)) return parseInt(raw, 10);
	return "all";
}
