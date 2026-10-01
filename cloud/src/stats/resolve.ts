// Corpus resolvers — translate a stats request into a concrete StatsCorpus the
// aggregator can run against.
//
//   user:       games WHERE user_id = ? [AND is_public=1 for visitor view]
//               [AND game-type filter — vs AI / MP / tournament / all]
//   tournament: the saves linked to a tournament's completed matches
//   global:     games WHERE is_public = 1 [AND composition slice]
//               [AND nation]
//
// StatsCorpus is the set of in-scope game ids the aggregator runs over, plus
// the nation restriction a faceted global corpus applies within them.

import {
	TOURNAMENT_GAME_IDS_SQL,
	buildGlobalSliceWhere,
	buildUserScopeWhere,
	periodCutoff,
} from "../games-scope";
import type {
	GlobalPeriod,
	GlobalSlice,
	UserScope,
	UserStatsScope,
} from "./types";
import type { QueryableD1 } from "../d1";

export interface ResolveEnv {
	SHARE_DB: QueryableD1;
}

export interface StatsCorpus {
	gameIds: string[];
	// Nations the focal set is restricted to; absent (or empty) is every focal
	// seat. It rides on the corpus rather than on buildChartBundle's `focal`
	// argument because a nation selection narrows the games *and* the seats
	// within them: resolving both here is what stops a caller from narrowing
	// one and not the other — a Rome corpus feeding the Greek's rows into the
	// yield bands.
	focalNations?: string[];
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

// Resolve a tournament's corpus: the saves linked to its completed matches,
// via the shared TOURNAMENT_GAME_IDS_SQL (the admin sweep filters on the same
// set). status='complete' is deliberate: a retro-edit can leave a linked game
// on a forfeit match, and such a save is an aborted/adjudicated game whose
// content would pollute the distributions (byes never carry a game_id; the 0013
// trigger nulls game_id on game deletion, so nothing dangles). Unlike
// resolveUserCorpus there's no viewerScope/scope (tournaments are public) and no
// existence probe — the handler has already loaded the tournament for the setup
// gate.
export async function resolveTournamentCorpus(
	env: ResolveEnv,
	tournamentId: string,
): Promise<StatsCorpus> {
	const rows = await env.SHARE_DB.prepare(TOURNAMENT_GAME_IDS_SQL)
		.bind(tournamentId)
		.all<{ game_id: string }>();

	return {
		gameIds: (rows.results ?? []).map((r) => r.game_id),
	};
}

// Every public game of one composition slice — the set both the corpus below
// and its nation list narrow from. Written once so the two cannot disagree on
// which games a slice covers. The trailing clause is a bare `WHERE`, so a
// caller may append further ` AND` fragments to it.
const globalSliceGamesSql = (slice: GlobalSlice): string =>
	`SELECT game_id FROM games WHERE is_public = 1${buildGlobalSliceWhere(slice)}`;

// Resolve a global corpus: every public game of one composition slice,
// optionally narrowed to the games one or more nations were played in.
//
// is_public = 1 is the whole visibility rule. It already covers both "public
// because the uploader said so" and "public because it is a tournament game" —
// linkTournamentMatch forces the flag on linked uploads — so no union with the
// tournament game ids is needed. Composition is the slice's half of the
// predicate, from the shared fragments in games-scope.ts.
//
// A nation selection narrows twice (global-stats design §4.2): the games become
// those holding at least one seat of a selected nation, and the focal set
// becomes those seats' rows, carried on `focalNations`. The game half
// qualifies on a *human* seat so the two halves stay in step — a game admitted
// for its AI Rome would report in meta.game_count while contributing no focal
// row at all. The seat's nation comes from player_summaries, not
// games.user_nation, which names the uploader's seat and so would miss the
// other side of a duel.
//
// `nations` is a set even though the UI is single-select, so widening to
// multi-select later costs the nightly precompute table rather than this
// signature. Sorted and deduped here, so the corpus carries one canonical form.
export async function resolveGlobalCorpus(
	env: ResolveEnv,
	slice: GlobalSlice,
	opts: { nations: string[]; period: GlobalPeriod },
): Promise<StatsCorpus> {
	const nations = [...new Set(opts.nations)].sort();
	const nationClause =
		nations.length > 0
			? ` AND game_id IN (SELECT game_id FROM player_summaries
			     WHERE is_human = 1 AND nation IN (${nations.map(() => "?").join(", ")}))`
			: "";

	const cutoff = periodCutoff(opts.period);
	const periodClause = cutoff === null ? "" : " AND save_date >= ?";

	const rows = await env.SHARE_DB.prepare(
		`${globalSliceGamesSql(slice)}${nationClause}${periodClause}`,
	)
		.bind(...nations, ...(cutoff === null ? [] : [cutoff]))
		.all<{ game_id: string }>();

	// focalNations carries the nation half only. A window narrows the games and
	// nothing else — every seat of a recent game is a recent seat — where a
	// nation selection narrows the seats too (§4.2).
	return {
		gameIds: (rows.results ?? []).map((r) => r.game_id),
		focalNations: nations.length > 0 ? nations : undefined,
	};
}

// The nations the nightly precompute builds a faceted bundle for: those
// actually seated somewhere in the slice, not the whole playable roster. A
// nation absent from a slice resolves to an empty corpus, and the request path
// already returns the empty bundle for that on a miss without touching the
// aggregator — so precomputing it would buy nothing and cost a KV write.
//
// Human seats only, matching the game half of the narrowing above: a slice
// whose only Rome is an AI's has no Rome bundle to build, because no focal set
// could hold that seat.
export async function listGlobalSliceNations(
	env: ResolveEnv,
	slice: GlobalSlice,
): Promise<string[]> {
	const rows = await env.SHARE_DB.prepare(
		`SELECT DISTINCT nation FROM player_summaries
		 WHERE is_human = 1 AND nation IS NOT NULL
		   AND game_id IN (${globalSliceGamesSql(slice)})
		 ORDER BY nation`,
	).all<{ nation: string }>();

	return (rows.results ?? []).map((r) => r.nation);
}
