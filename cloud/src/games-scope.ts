// Shared "what's in scope" predicates over the games table.
//
// Three selections live here:
//
//   * buildUserScopeWhere — which of one user's saves a viewer sees. The
//     Games tab (handleGameList) and the Stats/Overview ChartBundle
//     (resolveUserCorpus) must agree on it, or the games table and the
//     aggregate numbers desync. Both query `FROM games`, so it builds the
//     AND-fragments that follow a base `WHERE user_id = ?` clause using
//     bare column names.
//   * buildGlobalSliceWhere — which composition of game a public /stats
//     slice covers. Composition only: the global corpus has no owner, so
//     its is_public=1 visibility is the resolver's base clause, not the
//     slice's.
//   * buildAdminGameFilterWhere — which slice of the whole corpus an admin
//     sweep acts on. Shared by both admin list endpoints.
//
// Scope is a single mutually-exclusive selection (UserScope) — the scope
// row presents it as one dropdown. Identity visibility (visitors only
// ever see is_public=1) composes on top.

import type { GlobalSlice, UserScope } from "./stats/types";

export interface UserScopeOpts {
	scope: UserScope;
	// Owner sees private+public and may select a specific collection or
	// the public subset; a visitor/anon is forced to is_public=1 and can't
	// select a private collection (the existence of private collections
	// must not leak via 0-count splits).
	viewerOwnsTarget: boolean;
}

// The game-type buckets a user's library is cut into. One fragment each,
// shared with the scope-count SQL in collections.ts so the dropdown's counts
// and its filter can't disagree on what a bucket holds.
//
// A game is a tournament match, a challenge run, or neither; the neither
// bucket splits by human count into vs_ai / mp. Challenge runs are excluded
// from vs_ai even though they are single-human by construction — they're
// played to a rule set, not to the end, and belong on their own shelf.
export const TOURNAMENT_LINKED_GAME_IDS_SQL =
	"SELECT game_id FROM tournament_matches WHERE game_id IS NOT NULL";
export const CHALLENGE_GAME_IDS_SQL =
	"SELECT game_id FROM challenge_submissions";
const SOLO_GAME_IDS_SQL =
	"SELECT game_id FROM player_summaries WHERE is_human = 1 GROUP BY game_id HAVING COUNT(*) = 1";
const MULTI_HUMAN_GAME_IDS_SQL =
	"SELECT game_id FROM player_summaries WHERE is_human = 1 GROUP BY game_id HAVING COUNT(*) > 1";

// The predicate for each game-type bucket, over a bare `game_id` column.
export const GAME_TYPE_PREDICATES: Record<
	Extract<UserScope, "tournament" | "challenge" | "vs_ai" | "mp">,
	string
> = {
	tournament: `game_id IN (${TOURNAMENT_LINKED_GAME_IDS_SQL})`,
	challenge: `game_id IN (${CHALLENGE_GAME_IDS_SQL})`,
	vs_ai: `game_id NOT IN (${TOURNAMENT_LINKED_GAME_IDS_SQL}) AND game_id NOT IN (${CHALLENGE_GAME_IDS_SQL}) AND game_id IN (${SOLO_GAME_IDS_SQL})`,
	mp: `game_id NOT IN (${TOURNAMENT_LINKED_GAME_IDS_SQL}) AND game_id NOT IN (${CHALLENGE_GAME_IDS_SQL}) AND game_id IN (${MULTI_HUMAN_GAME_IDS_SQL})`,
};

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
	} else if (scope !== "all") {
		parts.push(GAME_TYPE_PREDICATES[scope]);
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
		raw === "tournament" ||
		raw === "challenge"
	) {
		return raw;
	}
	if (raw && /^\d+$/.test(raw)) return parseInt(raw, 10);
	return "all";
}

// Parse a ?nation= query param into a nation zType, or null for "no nation
// filter". A shape check, not a roster check: the worker bakes only the two
// nations whose display name differs from their token (generated/nation-names.ts),
// so there is nothing here to match a full roster against — and a token that
// shapes right but names no nation selects nothing, which is the same answer
// an unknown value would get.
//
// Shared by the Games tab's nation chip (handleGameList, filtering
// games.user_nation) and the /stats nation facet (handleGlobalStats, narrowing
// on player_summaries.nation). Both ask the same question of the same
// vocabulary, so they ask it once.
export function parseNationParam(raw: string | null): string | null {
	if (!raw || raw.length > 64 || !/^[A-Z_]+$/.test(raw)) return null;
	return raw;
}

// ---------- Global composition slices ----------
//
// The public /stats corpus is sliced by roster composition alone — no owner,
// no collection, no visibility. The fragments below follow the same base
// `WHERE` a global resolver opens with (`is_public = 1`), in the same bare-
// column form buildUserScopeWhere returns.
//
// They count *players*, where the vs_ai/mp fragments above filter
// `WHERE is_human = 1` and only then count. Each reading is right for its
// surface: a 2-human, 4-AI save is multiplayer to the person who played it,
// and it is not a duel — counting only its humans would call it one. So a
// duel is `COUNT(*) = 2 AND SUM(is_human) = 2` — the same composition test
// the `duel-event-titles` admin sweep applies. The two forms stay apart
// deliberately; migrating the user page onto this vocabulary is issue #228.
//
// The three compositions do not partition the corpus: a game with 2 humans
// and any AI is too few humans for FFA, too many for single-player and too
// many players for a duel. That is why "all" applies no composition filter
// rather than unioning the other three.
const COMPOSITION_GAME_IDS_SQL: Record<Exclude<GlobalSlice, "all">, string> = {
	duel: "SELECT game_id FROM player_summaries GROUP BY game_id HAVING COUNT(*) = 2 AND SUM(is_human) = 2",
	ffa: "SELECT game_id FROM player_summaries GROUP BY game_id HAVING SUM(is_human) >= 3",
	single_player:
		"SELECT game_id FROM player_summaries GROUP BY game_id HAVING SUM(is_human) = 1",
};

// Returns the SQL fragment to append after the global corpus's base clause
// (begins with " AND " when non-empty, else ""). No binds — every fragment is
// constant SQL.
//
// Challenge runs are out of every slice, "all" included: they're played to a
// rule set on a fixed map and stop when it's met, so their yields, techs and
// turn counts describe the challenge, not how the game is played.
export function buildGlobalSliceWhere(slice: GlobalSlice): string {
	const noRuns = ` AND game_id NOT IN (${CHALLENGE_GAME_IDS_SQL})`;
	if (slice === "all") return noRuns;
	return `${noRuns} AND game_id IN (${COMPOSITION_GAME_IDS_SQL[slice]})`;
}

// Parse the ?slice= query param into a GlobalSlice, the /stats sibling of
// parseScopeParam above and deliberately as forgiving: a known value passes
// through, anything else — a stale bookmark, a hand-edited URL, a slice this
// version no longer has — falls back to the default rather than 400ing.
//
// The default is the duel slice, not "all". 94% of the public corpus is 1v1,
// so the all-public numbers *are* the duel numbers; landing on the label that
// describes the distribution beats landing on a superset whose name implies a
// breadth it doesn't have.
export const DEFAULT_GLOBAL_SLICE: GlobalSlice = "duel";

export function parseSliceParam(raw: string | null): GlobalSlice {
	if (
		raw === "all" ||
		raw === "duel" ||
		raw === "ffa" ||
		raw === "single_player"
	) {
		return raw;
	}
	return DEFAULT_GLOBAL_SLICE;
}

// ---------- Admin sweep filters ----------
//
// The admin reparse/reindex page runs its sweeps in sections rather than over
// the whole corpus in one sitting. A section is one owner, one tournament, or a
// range of upload dates. Both list endpoints take the same filters, so the
// parse and the predicate live here once.
//
// Columns are `g.`-qualified: handleAdminListOutOfDate joins `users u`, where a
// bare `user_id` would be ambiguous.

// The games linked to a tournament's completed matches. The join through
// tournament_rounds is required — tournament_matches has no tournament_id
// column. status='complete' matches resolveTournamentCorpus (which imports
// this), so a tournament sweep and that tournament's stats bundle act on the
// same set of saves.
export const TOURNAMENT_GAME_IDS_SQL = `SELECT DISTINCT m.game_id FROM tournament_matches m
	 JOIN tournament_rounds r ON r.round_id = m.round_id
	 WHERE r.tournament_id = ? AND m.game_id IS NOT NULL
	   AND m.status = 'complete'`;

export interface AdminGameFilter {
	userId: string | null;
	tournamentId: string | null;
	// Inclusive calendar-day bounds on games.created_at, 'YYYY-MM-DD'. The
	// column is written by datetime('now'), so the days are UTC. created_at is
	// preserved across re-import (handleGameUpload), so a game doesn't migrate
	// between sections as the sweep reparses it.
	from: string | null;
	to: string | null;
}

export type AdminGameFilterResult =
	| { ok: true; filter: AdminGameFilter }
	| { ok: false; message: string };

const NANOID_RE = /^[A-Za-z0-9_-]{21}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// Parse the filter query params. Absent and empty-string are both "no filter"
// (the page drops a filter by clearing its param). Present-but-malformed is an
// error rather than a silent no-op: a sweep that quietly widens to the whole
// corpus is the wrong failure mode. Callers turn `message` into a 400
// INVALID_QUERY, the same code both handlers already use for `version`.
export function parseAdminGameFilter(url: URL): AdminGameFilterResult {
	const filter: AdminGameFilter = {
		userId: null,
		tournamentId: null,
		from: null,
		to: null,
	};

	for (const [param, key] of [
		["user_id", "userId"],
		["tournament_id", "tournamentId"],
	] as const) {
		const raw = url.searchParams.get(param);
		if (raw === null || raw === "") continue;
		if (!NANOID_RE.test(raw)) {
			return { ok: false, message: `Invalid '${param}'` };
		}
		filter[key] = raw;
	}

	for (const param of ["from", "to"] as const) {
		const raw = url.searchParams.get(param);
		if (raw === null || raw === "") continue;
		if (!DAY_RE.test(raw)) {
			return { ok: false, message: `Invalid '${param}' — expected YYYY-MM-DD` };
		}
		filter[param] = raw;
	}

	return { ok: true, filter };
}

// Filters compose with AND; the page sends one at a time. Returned in both
// shapes the two callers need, so neither has to do string surgery on the
// other's: `clause` appends to a query that already has a WHERE (out-of-date
// filters on parser_version), `where` is the standalone clause for one that
// doesn't (the all-games list). Both are "" when no filter is set.
export function buildAdminGameFilterWhere(filter: AdminGameFilter): {
	clause: string;
	where: string;
	binds: string[];
} {
	const parts: string[] = [];
	const binds: string[] = [];

	if (filter.userId !== null) {
		parts.push("g.user_id = ?");
		binds.push(filter.userId);
	}
	if (filter.tournamentId !== null) {
		parts.push(`g.game_id IN (${TOURNAMENT_GAME_IDS_SQL})`);
		binds.push(filter.tournamentId);
	}
	if (filter.from !== null) {
		// 'YYYY-MM-DD HH:MM:SS' >= 'YYYY-MM-DD' compares as text: same prefix,
		// longer string sorts after, so the whole of `from` is included.
		parts.push("g.created_at >= ?");
		binds.push(filter.from);
	}
	if (filter.to !== null) {
		// Half-open upper bound at the next midnight, which makes `to` itself
		// inclusive without depending on the stored time component.
		parts.push("g.created_at < datetime(?, '+1 day')");
		binds.push(filter.to);
	}

	const joined = parts.join(" AND ");
	return {
		clause: parts.length > 0 ? ` AND ${joined}` : "",
		where: parts.length > 0 ? `WHERE ${joined}` : "",
		binds,
	};
}
