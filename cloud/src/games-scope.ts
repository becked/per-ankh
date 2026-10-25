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
//
// Beside the three, the vocabulary they are built from is exported where a
// second surface has to ask the same question in the same words:
// COMPOSITION_GAME_IDS_SQL, remoteGameModeSql, and noChallengeRunsSql — the
// last read by every surface that counts games as games played and so has to
// leave challenge runs out: the home page's discovery feed
// (handlePublicRecentGames), the played-games board (stats/handlers.ts) and the
// profile header (users.ts), none of which narrows by game type otherwise.
//
// The uploader's seat, at the foot of the file, is here for that same reason,
// and is a projection rather than a predicate: five readers across two trees
// take it as correlated SQL (uploaderPlayerIndexSql) and two more read it for
// one game_id (loadUploaderSeat), and `scripts/` can import this module where
// it cannot import games.ts.

import type { QueryableD1 } from "./d1";
import type { GlobalPeriod, GlobalSlice, UserScope } from "./stats/types";

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
const CHALLENGE_GAME_IDS_SQL = "SELECT game_id FROM challenge_submissions";
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
// the `duel-event-titles` admin sweep applies, and the one the rating model
// selects the games it rates with (ratings/duels.ts), which is why `duel` is
// exported. The two forms stay apart deliberately; migrating the user page
// onto this vocabulary is issue #228.
//
// The three compositions do not partition the corpus: a game with 2 humans
// and any AI is too few humans for FFA, too many for single-player and too
// many players for a duel. That is why "all" applies no composition filter
// rather than unioning the other three.
export const COMPOSITION_GAME_IDS_SQL: Record<
	Exclude<GlobalSlice, "all">,
	string
> = {
	duel: "SELECT game_id FROM player_summaries GROUP BY game_id HAVING COUNT(*) = 2 AND SUM(is_human) = 2",
	ffa: "SELECT game_id FROM player_summaries GROUP BY game_id HAVING SUM(is_human) >= 3",
	single_player:
		"SELECT game_id FROM player_summaries GROUP BY game_id HAVING SUM(is_human) = 1",
};

// Whether a game was played apart rather than at one machine, as a predicate
// over `games` under the caller's alias — the same aliased-fragment shape
// displayNameSql uses.
//
// Two modes are promoted rather than a list of local ones demoted, for the
// reason the played-games board gives at length (stats/handlers.ts): game_mode
// is the save's `@_GameMode` read verbatim and nothing validates it against an
// enum, so a mode the game adds later must not be able to pass for a remote
// game. Hotseat and LAN are two people at one machine, which is why that board
// files a two-human hotseat under `other` rather than under duels, and why the
// rating model (ratings/duels.ts) does not rate one.
export function remoteGameModeSql(alias: string): string {
	return `${alias}.game_mode IN ('NETWORK', 'PLAY_BY_CLOUD')`;
}

// Whether a game is not a challenge run, as a predicate over `games` under the
// caller's alias — or over a bare `game_id` when the alias is omitted.
//
// Both forms exist because the callers are split down the middle: the board and
// the discovery feed select `FROM games g`, while buildGlobalSliceWhere below
// and the profile header's three reads query an unaliased `games`. One helper
// rather than two, because the question is one question — an alias is a detail
// of the query that asks it.
//
// A run is out wherever a surface counts games as *games played*: it is one
// fixed map replayed to a rule set, every run on a challenge carrying that
// map's GameId (checkIdentity, challenges/scoring.ts) and stopping when the
// rule is met. Ranking runs against each other is what the challenge page is
// for; on a board or a header that counts matches they displace the thing being
// counted. GAME_TYPE_PREDICATES is the deliberate exception — its `challenge`
// bucket is the user library's own shelf for them, which is why it asks for
// runs with IN rather than excluding them here.
export function noChallengeRunsSql(alias?: string): string {
	const column = alias === undefined ? "game_id" : `${alias}.game_id`;
	return `${column} NOT IN (${CHALLENGE_GAME_IDS_SQL})`;
}

// Returns the SQL fragment to append after the global corpus's base clause
// (begins with " AND " when non-empty, else ""). No binds — every fragment is
// constant SQL.
//
// Challenge runs are out of every slice, "all" included: they're played to a
// rule set on a fixed map and stop when it's met, so their yields, techs and
// turn counts describe the challenge, not how the game is played.
export function buildGlobalSliceWhere(slice: GlobalSlice): string {
	const noRuns = ` AND ${noChallengeRunsSql()}`;
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

// ---------- Recency window ----------
//
// A second facet ANDed with the slice: how recently the game was PLAYED, from
// games.save_date, not how recently it was uploaded. An eight-year-old save
// dragged in last week is old-meta evidence whatever its created_at says, and
// the question the window answers is "what does the game look like now".
//
// save_date is an ISO date string, so the comparison is a plain string one —
// lexicographic order is chronological, which is measured rather than assumed:
// 802 of the 803 public games in the 2026-10-04 snapshot carry a 10-character
// YYYY-MM-DD, and the one that doesn't carries nothing at all. A game with no
// save_date (that one) is not datable and drops out of every window; the
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
	{ ok: true; filter: AdminGameFilter } | { ok: false; message: string };

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

// ---------- The uploader's seat ----------

/**
 * Correlated subquery yielding the uploader's `player_index` for a game, or
 * NULL when the original upload was an observer (no `is_uploader` row).
 *
 * This is the uploader's identity. `games.user_nation` is derived *from* it
 * and cannot stand in for it: the game lets two humans claim the same nation
 * — `Game.IsValidNationForIndex` returns true outright under
 * `TEAMNATION_ALLOW_DUPLICATES`, and under the multi-human default
 * (`TEAMNATION_TEAM_UNIQUE`) rejects a duplicate only when the two share a
 * team, so a 1v1 mirror matchup is legal — and a nation then names two seats.
 *
 * At most one row per game carries the flag — every writer binds one, and
 * migration 0053's partial unique index holds them to it — so the bare
 * subquery needs no LIMIT. (0002's column comment, `many TRUE allowed`, is
 * the stale half of that pair; no writer ever did.)
 *
 * Spelled once for five readers, across both trees: the four handlers in
 * games.ts that serve the seat to the reparse surfaces, and the headless
 * sweep that posts it back (`scripts/admin/commands/reparse.ts`), which
 * queries D1 through wrangler and imports this the way
 * `scripts/ux-review/discover.ts` imports `screenshots/scope.ts`. A
 * divergence between any two of them is a reparse that changes whose game it
 * is. It lives here rather than in games.ts because a `tsx` script can import
 * this module — its imports are types — where importing games.ts would drag
 * in the valibot schemas, `./session` and the generated tables.
 *
 * Two more readers bind a single `game_id` instead of correlating against a
 * games alias, which is the same question in a different shape, so it is
 * `loadUploaderSeat` below rather than a second spelling in each of them.
 */
export function uploaderPlayerIndexSql(gamesAlias: string): string {
	return `(SELECT ps.player_index FROM player_summaries ps
	   WHERE ps.game_id = ${gamesAlias}.game_id AND ps.is_uploader = 1)`;
}

/**
 * The same seat for one game_id, or null when the upload was an observer.
 *
 * Two readers ask it in this shape: the re-import claim guard, which has a
 * game_id and no games alias to correlate against (`handleGameUpload`), and
 * the admin reindex, which rebuilds the `is_uploader` flags from the seat the
 * original upload recorded (`handleAdminReindex`).
 */
export async function loadUploaderSeat(
	db: QueryableD1,
	gameId: string,
): Promise<number | null> {
	const row = await db
		.prepare(
			"SELECT player_index FROM player_summaries WHERE game_id = ? AND is_uploader = 1",
		)
		.bind(gameId)
		.first<{ player_index: number }>();
	return row?.player_index ?? null;
}
