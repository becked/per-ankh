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

	// The focal players' starting leaders, split into what the game rolls for
	// them: the archetype (one each) and the personality traits they begin with
	// (archetype excluded). `games` is the distribution, `wins` the outcome.
	// Over an all-humans corpus the overall rate is ~50% by construction, so
	// the signal is the deviation per archetype/trait.
	startingArchetypeWinRate: Array<{
		archetype: string;
		games: number;
		wins: number;
		rate: number;
	}>;

	startingTraitWinRate: Array<{
		trait: string;
		games: number;
		wins: number;
		rate: number;
	}>;

	// Per wonder: how often the focal players built it, out of how many were
	// eligible — the wonder was enabled in their game (Old World enables only a
	// subset per game), they reached its culture prereq, and no AI had already
	// taken it. A wonder is unique per game, so the rate reads as "of those who
	// could have taken it, how many did". `win_rate` is the builders' share of
	// wins. Turn stats and win_rate are null when nobody in the corpus built it.
	//
	// `eligible`/`rate` are null when no game we have a wonder pool for
	// accounted for this wonder — no denominator rather than a zero one.
	wonderStats: Array<{
		wonder: string;
		culture_prereq: Nullable<string>;
		eligible: Nullable<number>;
		built: number;
		rate: Nullable<number>;
		wins: number;
		win_rate: Nullable<number>;
		median_turn: Nullable<number>;
		p25_turn: Nullable<number>;
		p75_turn: Nullable<number>;
	}>;

	// The family class holding each focal player's capital, and how those games
	// ended — distinct from familyByNation, which only asks whether a class was
	// among the player's three.
	capitalFamilyWinRate: Array<{
		family_class: string;
		games: number;
		wins: number;
		rate: number;
	}>;

	familyByNation: Array<{
		nation: string;
		class: string;
		count: number;
		wins: number;
		// Mean share of the player's end-of-game cities this class held. The
		// denominator counts only cities that carry a family — a city with no
		// family_class is skipped on both sides of the ratio — so it is a
		// narrower base than player_summaries.cities_total, which counts every
		// city matching the player's owner_nation. Null when no in-scope player
		// has city data for it: older blobs carry no family on their cities.
		avg_share: Nullable<number>;
		// Picks behind avg_share (those with city data) — the mean's own sample,
		// which the frontend weights by when recombining across nations.
		share_samples: number;
		// Picks where this class was the player's 1st / 2nd / 3rd family, ranked
		// by when its first city was founded. Sums to at most `count` — a pick
		// with no founding data contributes to none of them.
		slot_counts: [number, number, number];
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

	// The Overview tab's calendar heatmap. Per-game, so it would read fine
	// over the all-humans focal set too — it is user-only because only the
	// profile renders it, and because it is the one field that grows with the
	// corpus instead of with the turn axis.
	save_dates: Array<{
		date: string;
		nation: string | null;
		game_id: string;
		game_name: string | null;
		display_name: string | null;
		total_turns: number;
	}>;
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
	| "challenge"
	| string;

// The composition slice the public /stats corpus is cut by (mirrors the
// Worker's GlobalSlice). Roster composition only: the global corpus has no
// owner, so its is_public = 1 visibility is not part of the selection. Paired
// with an optional nation facet — see $lib/stats/global-facets.
export type GlobalSlice = "all" | "duel" | "ffa" | "single_player";

export type StatsCategory =
	| "nations"
	| "leaders"
	| "wonders"
	| "families"
	| "yields"
	| "laws"
	| "cities"
	| "tech";

// A chart in the catalog. Its predicates take ChartBundleCore, not
// ChartBundle: none of them reads an Overview field, so one registry serves
// every corpus — a user library, a tournament, and the global slices — and a
// ChartBundle still satisfies them.
export interface ChartSpec {
	id: string;
	category: StatsCategory;
	title: string;
	subtitle?: string;
	// True when the chart can be rendered. False → empty-state card.
	hasData: (bundle: ChartBundleCore) => boolean;
	// Empty-state copy when hasData is false. Falls back to a generic
	// message if not provided.
	emptyMessage?: (bundle: ChartBundleCore) => string;
	// Container height override. Horizontal-bar charts with many categories
	// need room to breathe — return a CSS height scaled to the row count.
	// Falls back to the default 400px when absent.
	height?: (bundle: ChartBundleCore) => string;
}
