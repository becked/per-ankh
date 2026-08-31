// Shared "what's in scope" predicates over the games table.
//
// Four selections live here:
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
//   * periodCutoff — how recently a public /stats game was played. A second
//     facet ANDed with the slice, filtering games.save_date; it returns the
//     window's opening date rather than a fragment, because the resolver
//     binds it.
//   * buildAdminGameFilterWhere — which slice of the whole corpus an admin
//     sweep acts on. Shared by both admin list endpoints.
//
// Scope is a single mutually-exclusive selection (UserScope) — the scope
// row presents it as one dropdown. Identity visibility (visitors only
// ever see is_public=1) composes on top.

import type { GlobalPeriod, GlobalSlice, UserScope } from "./stats/types";

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
export function buildGlobalSliceWhere(slice: GlobalSlice): string {
	if (slice === "all") return "";
	return ` AND game_id IN (${COMPOSITION_GAME_IDS_SQL[slice]})`;
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

// ---------- Recency window ----------
//
// A second facet ANDed with the slice: how recently the game was PLAYED, from
// games.save_date, not how recently it was uploaded. An eight-year-old save
// dragged in last week is old-meta evidence whatever its created_at says, and
// the question the window answers is "what does the game look like now".
//
// save_date is an ISO date string, so the comparison is a plain string one —
// lexicographic order is chronological. A game with no save_date (three of the
// 816 in the local corpus) is not datable and drops out of every window; the
// all-time view is where it still counts.
export const DEFAULT_GLOBAL_PERIOD: GlobalPeriod = "all";

export function parsePeriodParam(raw: string | null): GlobalPeriod {
	if (raw === "all" || raw === "12m" || raw === "6m") return raw;
	return DEFAULT_GLOBAL_PERIOD;
}

// The window's opening date, or null for "all time".
//
// Resolved per build rather than baked into the cache key, which keys on the
// token instead. Keying on the date would roll the key daily and so defeat
// serve-stale — the suffix walk would never match yesterday's entry — for the
// sake of an edge that moves by one day. Entries live 24h, so the window's
// start can trail the clock by that much, which is not a distinction "the last
// six months" is making.
//
// The day is clamped to the target month's length. Setting the month alone
// would land on a date the target month does not have and JS would roll it
// forward: six months before 31 August is 31 February, which normalizes to
// 3 March, silently opening the window three days late. `now` is a parameter
// so that edge is testable rather than only reachable on the ~10 days a month
// it occurs.
export function periodCutoff(
	period: GlobalPeriod,
	now: Date = new Date(),
): string | null {
	if (period === "all") return null;
	const months = period === "6m" ? 6 : 12;
	const year = now.getUTCFullYear();
	const month = now.getUTCMonth() - months;
	// Day 0 of the following month is the last day of this one.
	const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
	const day = Math.min(now.getUTCDate(), lastDay);
	return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
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
