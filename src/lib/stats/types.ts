// Mirrors cloud/src/stats/types.ts. The Worker is the canonical source —
// when the bundle shape changes there, mirror the change here.

export type Nullable<T> = T | null;

// Per-turn distribution band for one yield series; arrays aligned to
// `yieldCurves.turns`.
export interface YieldBand {
	p25: Array<Nullable<number>>;
	p50: Array<Nullable<number>>;
	p75: Array<Nullable<number>>;
}

// One cohort's per-turn curves, index-aligned to `yieldCurves.turns`.
export interface YieldCohort {
	counts: number[];
	series: Record<string, { rate: YieldBand; cumulative: YieldBand }>;
}

export interface ChartBundleMeta {
	// Number of games aggregated (after visibility / scope filtering).
	game_count: number;
	// Echoed so the frontend can verify it's rendering data built against
	// the same parser version it expects.
	parser_version: string;
}

// Summary tiles common to both corpora (per-game facts).
export interface ChartBundleSummaryCore {
	total_games: number;
	avg_total_turns: Nullable<number>;
}

// User-corpus summary adds the "most X" tiles (one-focal-per-game); the
// tournament bundle (ChartBundleCore) omits them.
export interface ChartBundleSummary extends ChartBundleSummaryCore {
	top_nation: Nullable<{ nation: string; count: number }>;
	top_archetype: Nullable<{ archetype: string; count: number }>;
}

// Chart-fields core, returned by both the user and tournament stats endpoints.
// ChartBundle (user) extends it with the Overview fields.
export interface ChartBundleCore {
	meta: ChartBundleMeta;

	summary: ChartBundleSummaryCore;

	// Per-game; correct over either focal set (final home on the tournament
	// page is deferred).
	save_dates: Array<{
		date: string;
		nation: string | null;
		game_id: string;
		game_name: string | null;
		display_name: string | null;
		total_turns: number;
	}>;
	favorite_day_of_week: Nullable<number>;
	nations: Array<{ nation: string; games_played: number }>;

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

	familyByNation: Array<{
		nation: string;
		class: string;
		count: number;
		wins: number;
	}>;

	// `outcome` is the winner/loser split of the same curves, restricted to
	// games with a decided winner; null when the corpus has none.
	yieldCurves: {
		turns: number[];
		counts: number[];
		series: Record<string, { rate: YieldBand; cumulative: YieldBand }>;
		outcome: Nullable<{ winners: YieldCohort; losers: YieldCohort }>;
	};

	lawTiming: Array<{
		nation: string;
		law: string;
		median_turn: number;
		p25_turn: Nullable<number>;
		p75_turn: Nullable<number>;
		count: number;
	}>;

	openingLaws: Array<{ nation: string; laws: string[]; count: number }>;

	expansionWinRate: Array<{
		bucket: string;
		games: number;
		wins: number;
		rate: number;
	}>;

	techFirst: Array<{ nation: string; tech: string; count: number }>;

	techTiming: Array<{
		nation: string;
		tech: string;
		median_turn: number;
		count: number;
	}>;
}

// User-corpus bundle: the core plus the Overview fields (one focal player per
// game). A structural subtype of ChartBundleCore — no discriminant field.
export interface ChartBundle extends ChartBundleCore {
	summary: ChartBundleSummary;

	// --- Overview (user corpus) — folded from the retired /v1/stats ---
	win_rate: Nullable<number>;
	games_with_outcome: number;
}

// The single scope selection for the user corpus (mirrors the Worker's
// UserScope; collection id is a string in the URL/client layer, a number
// server-side). One mutually-exclusive slice of a user's library.
export type UserScope =
	| "all"
	| "public"
	| "vs_ai"
	| "mp"
	| "tournament"
	| string;

export type StatsCategory =
	| "nations"
	| "families"
	| "yields"
	| "laws"
	| "cities"
	| "tech";

export interface ChartSpec {
	id: string;
	category: StatsCategory;
	title: string;
	subtitle?: string;
	// True when the chart can be rendered. False → empty-state card.
	hasData: (bundle: ChartBundle) => boolean;
	// Empty-state copy when hasData is false. Falls back to a generic
	// message if not provided.
	emptyMessage?: (bundle: ChartBundle) => string;
	// Container height override. Horizontal-bar charts with many categories
	// need room to breathe — return a CSS height scaled to the row count.
	// Falls back to the default 400px when absent.
	height?: (bundle: ChartBundle) => string;
}
