// ChartBundle — the single JSON payload returned by the stats endpoint.
//
//   GET /v1/users/:user_id/stats — user corpus (their own saves; visitor
//     view restricted to is_public=1)
//
// One bundle covers all ~22 v1 charts. The frontend treats each named
// field as an opaque slice for its chart's ECharts option builder. Adding
// a chart means: add a field here, populate it in aggregate.ts, write
// the option builder under src/lib/stats/charts/.

// A bundle field is `null` when the corpus has no data for it; the
// frontend renders an empty-state card instead of the chart.
export type Nullable<T> = T | null;

// Per-turn distribution band for one yield series. Each array is aligned
// to `yieldCurves.turns`; an entry is null when no game has a value at
// that turn.
export interface YieldBand {
	p25: Array<Nullable<number>>;
	p50: Array<Nullable<number>>;
	p75: Array<Nullable<number>>;
}

export interface ChartBundleMeta {
	// Number of games actually aggregated (after visibility / game-type
	// filtering). The signal for whole-bundle "no data yet" empty states.
	game_count: number;
	// Echoed back so the frontend can verify it's rendering data built
	// against the same parser version it expects.
	parser_version: string;
}

export interface ChartBundle {
	meta: ChartBundleMeta;

	// --- Summary -----------------------------------------------------
	summary: {
		total_games: number;
		avg_total_turns: Nullable<number>;
		top_nation: Nullable<{ nation: string; count: number }>;
		top_archetype: Nullable<{ archetype: string; count: number }>;
	};

	// --- Overview ----------------------------------------------------
	// These feed the Overview tab and were previously served by the
	// standalone /v1/stats endpoint. Computed over the scoped corpus so
	// they track the collection + game-type selectors.

	// Win rate over games with a known outcome (the uploader's own
	// result). games_with_outcome excludes observer-mode uploads.
	win_rate: Nullable<number>;
	games_with_outcome: number;

	// One entry per in-scope game with a save_date, for the calendar
	// heatmap. nation falls back to the first human when user_nation is
	// null (matching the games-list COALESCE).
	save_dates: Array<{ date: string; nation: string | null }>;

	// Modal weekday of save dates (0=Sunday..6=Saturday), or null.
	favorite_day_of_week: Nullable<number>;

	// Games played per nation (the user's own picks), for the
	// games-by-nation bar. Same buckets as nationWinRate.
	nations: Array<{ nation: string; games_played: number }>;

	// --- Nations -----------------------------------------------------
	nationWinRate: Array<{
		nation: string;
		games: number;
		wins: number;
		rate: number;
	}>;

	nationAvgPoints: Array<{
		nation: string;
		games: number;
		avg_points: number;
	}>;

	// --- Families ----------------------------------------------------
	// Per (nation, class): games where the player picked that class for
	// that nation, and how many they won. The frontend derives pick rate
	// (count ÷ nation games) and win rate (wins ÷ count) per nation.
	familyByNation: Array<{
		nation: string;
		class: string;
		count: number;
		wins: number;
	}>;

	// --- Yields ------------------------------------------------------
	// Per-turn yield distributions across the corpus's focal-player rows.
	// The frontend renders one chart per series (median line + P25–P75
	// band); all series share the `turns` x-axis. `counts[i]` is the number
	// of games contributing at `turns[i]` (the sample size, which thins out
	// in the late game). Each series carries both the per-turn rate and the
	// cumulative band; for the stock series (military_power, legitimacy)
	// `cumulative` mirrors `rate`.
	yieldCurves: {
		turns: number[];
		counts: number[];
		series: Record<
			string,
			{
				rate: YieldBand;
				cumulative: YieldBand;
			}
		>;
	};

	// --- Laws --------------------------------------------------------
	// Per (nation, law) with an extra "__all__" aggregate row per law
	// (frontend ALL_NATIONS), like the tech charts.
	lawTiming: Array<{
		nation: string;
		law: string;
		median_turn: number;
		p25_turn: Nullable<number>;
		p75_turn: Nullable<number>;
		count: number;
	}>;

	// Opening laws per nation: the first four laws a player enacted as an
	// order-insensitive set (laws sorted), grouped by nation. count = players
	// who opened with exactly that set. Excludes succession laws; includes
	// turn-1 laws (the four track the in-game unit-unlock breakpoint).
	openingLaws: Array<{
		nation: string;
		laws: string[];
		count: number;
	}>;

	// --- Cities ------------------------------------------------------
	// Win rate bucketed by 5th-city founding turn (expansion speed).
	expansionWinRate: Array<{
		bucket: string;
		games: number;
		wins: number;
		rate: number;
	}>;

	// --- Tech --------------------------------------------------------
	// Broken down by the player's nation, with an extra "__all__" aggregate
	// row per tech (frontend ALL_NATIONS) so "all" needs no median recombining.
	// The first tech each player researches (post turn 1).
	techFirst: Array<{
		nation: string;
		tech: string;
		count: number;
	}>;

	techTiming: Array<{
		nation: string;
		tech: string;
		median_turn: number;
		count: number;
	}>;
}

// The single scope selection for the user corpus — one mutually-exclusive
// slice of a user's library, presented as one dropdown. "all" = entire
// library; "public" = the is_public=1 subset; "vs_ai" / "mp" /
// "tournament" = derived game-type buckets (they partition the library);
// a number = a stored collection_id.
export type UserScope =
	| "all"
	| "public"
	| "vs_ai"
	| "mp"
	| "tournament"
	| number;

// Visibility scope for user corpus — owner sees private+public, others
// see public only. Embedded in the cache key.
export type UserStatsScope = "self" | "public";
