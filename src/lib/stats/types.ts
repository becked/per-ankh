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
//
// avg_total_turns is `turnLength.mean` under its original name — the Worker
// computes it once and serves both. Read it from turnLength: that one is
// non-nullable whenever the distribution exists, so the Game length panel needs
// no branch for an average it always has.
export interface ChartBundleSummaryCore {
	total_games: number;
	avg_total_turns: Nullable<number>;
}

// The corpus's game-length distribution, over its distinct games. Order
// statistics and histogram both: min/max are single games (the public corpus's
// shortest duel is a real 4-turn rush), p25/median/p75 are where the mass is,
// and the histogram is the shape behind both.
export interface TurnLengthStats {
	// Distinct games behind every number here, and the histogram's denominator.
	games: number;
	min: number;
	p25: number;
	median: number;
	mean: number;
	p75: number;
	max: number;
	bucket_turns: number;
	// Contiguous from the bucket holding `min` to the one holding `max`; an
	// interior bucket with no game keeps its zero.
	histogram: Array<{ start: number; count: number }>;
}

// User-corpus summary adds the "most X" tiles (one-focal-per-game); the
// tournament bundle (ChartBundleCore) omits them.
export interface ChartBundleSummary extends ChartBundleSummaryCore {
	top_nation: Nullable<{ nation: string; count: number }>;
	top_archetype: Nullable<{ archetype: string; count: number }>;
}

// Chart-fields core, returned by both the user and tournament stats endpoints.
// ChartBundle (user) extends it with the Overview fields.
// One family class, over the player-games where its nation's pool contained it.
// Mirrors cloud/src/stats/family-keeps.ts.
export interface FamilyKeepRow {
	family_class: string;
	eligible: number;
	kept: number;
	kept_pct: number;
	// What indifference alone produces: a player fields three of the pool, so a
	// four-family nation keeps three of four by chance. Accumulated per game
	// because pools differ in size, which is why it isn't a constant.
	baseline_pct: number;
	// Above zero is kept more often than chance; below is a family refused.
	delta: number;
	z: number;
	// Survives Benjamini-Hochberg at q=0.05 across the classes in this table.
	significant: boolean;
}

export interface FamilyKeepTable {
	rows: FamilyKeepRow[];
	player_games: number;
	// Rosters that couldn't say what was chosen at setup, nations that field
	// their whole pool, and rows whose nation or classes aren't in the baked
	// pool. Rendered, not hidden.
	skipped_incomplete: number;
	skipped_forced_pool: number;
	skipped_unknown_pool: number;
}

// The overall table plus one per nation, each with its own false-discovery
// gate — looking at one nation is four tests, not ten.
export interface FamilyKeeps {
	overall: FamilyKeepTable;
	byNation: Array<{ nation: string } & FamilyKeepTable>;
}

export interface ChartBundleCore {
	meta: ChartBundleMeta;

	familyKeeps: FamilyKeeps;

	summary: ChartBundleSummaryCore;

	// How long this corpus's games ran. Null when no in-scope game produced a
	// seat row — no distribution rather than an empty one.
	turnLength: Nullable<TurnLengthStats>;

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

// The records payload — its own endpoint and its own cached entry beside the
// bundle, fetched when the Records tab opens rather than shipped with every
// stats request. Built in the same pass as the yield bands; the rationale for
// each field is on the canonical type.
export interface RecordsBundle {
	// series → board → rows, biggest first. A board is "peak", "final", or a
	// "t20"…"t100" checkpoint; a cumulative series is keyed "<series>:cum",
	// and whether that reads as produced or held is the `cumulative` field on
	// YIELD_SERIES (./charts/yields).
	records: Record<
		string,
		Record<
			string,
			Array<{
				game_id: string;
				player_index: number;
				turn: number;
				value: number;
			}>
		>
	>;

	// The games holding a record, and the record holders' own seats — nobody
	// else's. `name` is the handle the save records, which the game page
	// already prints; never online_id.
	recordGames: Record<
		string,
		{
			turns: number;
			seats: Record<number, { nation: string | null; name: string | null }>;
		}
	>;

	// Seats each board could draw on, so a thin late checkpoint says so.
	recordCounts: Record<string, number>;
}

// The single scope selection for the user corpus (mirrors the Worker's
// UserScope; collection id is a string in the URL/client layer, a number
// server-side). One mutually-exclusive slice of a user's library.
export type UserScope =
	"all" | "public" | "vs_ai" | "mp" | "tournament" | "challenge" | string;

// The composition slice the public /stats corpus is cut by (mirrors the
// Worker's GlobalSlice). Roster composition only: the global corpus has no
// owner, so its is_public = 1 visibility is not part of the selection. Paired
// with an optional nation facet — see $lib/stats/global-facets.
export type GlobalSlice = "all" | "duel" | "ffa" | "single_player";

// How recently a game was PLAYED (games.save_date), ANDed with the slice.
// "all" applies no window and is the default.
export type GlobalPeriod = "all" | "12m" | "6m";

export type StatsCategory =
	| "nations"
	| "leaders"
	| "wonders"
	| "families"
	| "family-fielded"
	| "yields"
	| "length"
	| "laws"
	| "cities"
	| "tech"
	| "records";

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
