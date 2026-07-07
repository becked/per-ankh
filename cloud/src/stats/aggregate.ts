// Aggregate a StatsCorpus into a ChartBundle.
//
// Three SQL passes pull the raw data:
//   1. Base join (games × player_summaries) — per-(game, player) rows
//      for every human player in the corpus. Drives the bulk of the
//      charts.
//   2. Per-turn yield averages (game_player_turn) — restricted to the
//      uploader's player_index.
//   3. Tech / law event distributions — full event rows for the
//      corpus.
//
// D1's prepared statements cap bound params at ~100; gameIds is
// chunked at CHUNK_SIZE to stay well under that. Each chunk's results
// merge into a single aggregation; the order of merge doesn't matter
// because all the aggregates are commutative.

import { LAW_CLASSES } from "../generated/law-classes";
import type { StatsCorpus } from "./resolve";
import type { ChartBundle, ChartBundleCore, Nullable } from "./types";

export interface AggregateEnv {
	SHARE_DB: D1Database;
}

// Which roster rows count as the corpus's "focal" players — the set every
// per-player aggregate is computed over. "uploader" (user corpus) keeps only
// the uploader's own row per game; "humans" (tournament corpus) widens to every
// human, so both sides of a 1v1 contribute. The convention lives in exactly two
// places (buildSelfMembership + loadYieldCurves' selfClause), threaded from
// here rather than forked into a parallel aggregation path.
export type Focal = "uploader" | "humans";

// D1 bind-parameter cap is 100. Leave headroom for joins with literal
// params (we never need more than a few literals per statement). Exported
// (with chunk) for other batched IN-list loaders, e.g. the tournament
// player_summaries batch in tournament/public.ts.
export const CHUNK_SIZE = 50;

// Nation key for the cross-nation aggregate rows the bundle carries alongside
// per-nation rows (tech charts). Mirrors the frontend ALL_NATIONS sentinel in
// charts/helpers.ts — kept in sync by eye (no shared module across packages).
const ALL_NATIONS = "__all__";

// Succession laws (the inheritance rule, one class flagged bSuccession in the
// game data) are a different kind of law from civic laws — they start at turn 1
// and change mainly via forced events — so they're excluded from the law-adoption
// and opening-laws charts. Derived at the call site from the baked law→class map.
const SUCCESSION_LAWS = new Set<string>(
	Object.values(LAW_CLASSES)
		.filter((c) => c.succession)
		.flatMap((c) => c.laws),
);

interface BaseRow {
	game_id: string;
	player_index: number;
	nation: string | null;
	family_classes: string | null; // JSON array of strings
	is_human: number;
	is_uploader: number;
	starting_ruler_archetype: string | null;
	final_points: number | null;
	cities_total: number | null;
	fifth_city_turn: number | null;
	tenth_city_turn: number | null;
	is_winner: number;
	user_nation: string | null;
	total_turns: number;
}

// One raw game_player_turn row (a single game's focal player at one turn),
// keyed by column name. We pull raw rows rather than SQL AVG so we can
// compute per-turn percentile bands Worker-side.
type YieldRawRow = { turn: number } & Record<string, number | null>;

// Series key → (per-turn-rate column, cumulative column). The two stocks
// (military_power, legitimacy) are levels with no cumulative column; their
// cumulative band mirrors the level so the bundle shape stays uniform.
const YIELD_COLUMNS: Array<
	[key: string, rateCol: string, cumCol: string | null]
> = [
	["food_per_turn", "food_per_turn", "food_cumulative"],
	["growth_per_turn", "growth_per_turn", "growth_cumulative"],
	["science_per_turn", "science_per_turn", "science_cumulative"],
	["culture_per_turn", "culture_per_turn", "culture_cumulative"],
	["civics_per_turn", "civics_per_turn", "civics_cumulative"],
	["training_per_turn", "training_per_turn", "training_cumulative"],
	["money_per_turn", "money_per_turn", "money_cumulative"],
	["orders_per_turn", "orders_per_turn", "orders_cumulative"],
	["happiness_per_turn", "happiness_per_turn", "happiness_cumulative"],
	["discontent_per_turn", "discontent_per_turn", "discontent_cumulative"],
	["iron_per_turn", "iron_per_turn", "iron_cumulative"],
	["stone_per_turn", "stone_per_turn", "stone_cumulative"],
	["wood_per_turn", "wood_per_turn", "wood_cumulative"],
	["maintenance_per_turn", "maintenance_per_turn", "maintenance_cumulative"],
	["military_power", "military_power", null],
	["legitimacy", "legitimacy", null],
];

// Linear-interpolated percentile over an ascending-sorted array (numpy
// "type 7"); null for an empty sample.
function percentile(sortedAsc: number[], p: number): Nullable<number> {
	const n = sortedAsc.length;
	if (n === 0) return null;
	if (n === 1) return sortedAsc[0];
	const idx = (p / 100) * (n - 1);
	const lo = Math.floor(idx);
	const hi = Math.ceil(idx);
	if (lo === hi) return sortedAsc[lo];
	return sortedAsc[lo] * (hi - idx) + sortedAsc[hi] * (idx - lo);
}

interface TechEventRow {
	game_id: string;
	player_index: number;
	tech: string;
	turn: number;
}

interface LawEventRow {
	game_id: string;
	player_index: number;
	law: string;
	turn: number;
}

export function chunk<T>(arr: T[], size: number): T[][] {
	if (arr.length === 0) return [];
	const out: T[][] = [];
	for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
	return out;
}

function placeholders(n: number): string {
	return Array(n).fill("?").join(",");
}

// JSON columns are stored as TEXT — parse defensively. A bad blob row
// shouldn't take down the whole chart bundle.
function parseJsonArray(raw: string | null): string[] {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed))
			return parsed.filter((x) => typeof x === "string");
		return [];
	} catch {
		return [];
	}
}

// The corpus's focal (game_id, player_index) tuples, encoded as
// `${game_id}|${player_index}` strings for quick membership checks. "uploader"
// keeps only the uploader's own row per game; "humans" keeps every human row
// (baseRows are already is_human=1, so that's all of them).
function buildSelfMembership(baseRows: BaseRow[], focal: Focal): Set<string> {
	const self = new Set<string>();
	for (const r of baseRows) {
		const isFocal = focal === "humans" ? r.is_human === 1 : r.is_uploader === 1;
		if (isFocal) self.add(`${r.game_id}|${r.player_index}`);
	}
	return self;
}

// Median of a numeric array — used for tech/law timing distributions.
function median(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	if (sorted.length % 2 === 0) {
		return (sorted[mid - 1] + sorted[mid]) / 2;
	}
	return sorted[mid];
}

function cityTurnBucket(turn: number | null): string {
	if (turn == null) return "never";
	if (turn <= 25) return "≤25";
	if (turn <= 50) return "26–50";
	if (turn <= 75) return "51–75";
	if (turn <= 100) return "76–100";
	if (turn <= 150) return "101–150";
	return "151+";
}

// Load every per-(game, player) base row. We grab is_human=TRUE for
// both corpus modes — user-corpus filtering to is_uploader-only happens
// in the JS layer where we walk these rows. Slightly more data over
// the wire but keeps the SQL single-shot per chunk.
async function loadBaseRows(
	env: AggregateEnv,
	gameIds: string[],
): Promise<BaseRow[]> {
	const out: BaseRow[] = [];
	for (const ids of chunk(gameIds, CHUNK_SIZE)) {
		const res = await env.SHARE_DB.prepare(
			`SELECT ps.game_id, ps.player_index,
			        ps.nation, ps.family_classes, ps.is_human, ps.is_uploader,
			        ps.starting_ruler_archetype,
			        ps.final_points, ps.cities_total,
			        ps.fifth_city_turn, ps.tenth_city_turn,
			        ps.is_winner,
			        g.user_nation, g.total_turns
			 FROM player_summaries ps
			 JOIN games g ON g.game_id = ps.game_id
			 WHERE ps.is_human = 1
			   AND ps.game_id IN (${placeholders(ids.length)})`,
		)
			.bind(...ids)
			.all<BaseRow>();
		out.push(...((res.results ?? []) as BaseRow[]));
	}
	return out;
}

// Per-turn yield distribution curves. Restricted to the corpus's focal rows so
// the curves represent the focal players, not enemy AI. Returns the median +
// P25/P75 band per turn for each series (rate and cumulative), plus the sample
// size (n games) at each turn.
async function loadYieldCurves(
	env: AggregateEnv,
	gameIds: string[],
	focal: Focal,
): Promise<ChartBundleCore["yieldCurves"]> {
	if (gameIds.length === 0) return { turns: [], counts: [], series: {} };

	// Columns to pull: each series' rate column plus its cumulative column
	// (deduped — stocks share their single column).
	const columns = new Set<string>();
	for (const [, rateCol, cumCol] of YIELD_COLUMNS) {
		columns.add(rateCol);
		if (cumCol) columns.add(cumCol);
	}
	const selectList = [...columns].map((c) => `gpt.${c}`).join(", ");

	// The focal-player filter — the second (and last) site the focal
	// convention lives, mirroring buildSelfMembership.
	const selfClause =
		focal === "humans" ? "ps.is_human = 1" : "ps.is_uploader = 1";

	// Per turn: a value sample per field (rate + cumulative) and a row count.
	type Bucket = {
		count: number;
		rate: Map<string, number[]>;
		cum: Map<string, number[]>;
	};
	const byTurn = new Map<number, Bucket>();

	for (const ids of chunk(gameIds, CHUNK_SIZE)) {
		const res = await env.SHARE_DB.prepare(
			`SELECT gpt.turn, ${selectList}
			 FROM game_player_turn gpt
			 JOIN player_summaries ps ON ps.game_id = gpt.game_id
			                          AND ps.player_index = gpt.player_index
			 WHERE ${selfClause}
			   AND gpt.game_id IN (${placeholders(ids.length)})`,
		)
			.bind(...ids)
			.all<YieldRawRow>();

		for (const row of (res.results ?? []) as YieldRawRow[]) {
			const turn = row.turn;
			let bucket = byTurn.get(turn);
			if (!bucket) {
				bucket = {
					count: 0,
					rate: new Map(YIELD_COLUMNS.map(([k]) => [k, []])),
					cum: new Map(YIELD_COLUMNS.map(([k]) => [k, []])),
				};
				byTurn.set(turn, bucket);
			}
			bucket.count += 1;
			for (const [key, rateCol, cumCol] of YIELD_COLUMNS) {
				const rateVal = row[rateCol];
				if (rateVal != null) bucket.rate.get(key)!.push(rateVal);
				// Stocks have no cumulative column → reuse the level.
				const cumVal = cumCol ? row[cumCol] : row[rateCol];
				if (cumVal != null) bucket.cum.get(key)!.push(cumVal);
			}
		}
	}

	const turns = [...byTurn.keys()].sort((a, b) => a - b);
	const counts = turns.map((t) => byTurn.get(t)!.count);
	const series: ChartBundleCore["yieldCurves"]["series"] = {};
	for (const [key] of YIELD_COLUMNS) {
		const band = (which: "rate" | "cum") => {
			const p25: Nullable<number>[] = [];
			const p50: Nullable<number>[] = [];
			const p75: Nullable<number>[] = [];
			for (const t of turns) {
				const sorted = [...byTurn.get(t)![which].get(key)!].sort(
					(a, b) => a - b,
				);
				p25.push(percentile(sorted, 25));
				p50.push(percentile(sorted, 50));
				p75.push(percentile(sorted, 75));
			}
			return { p25, p50, p75 };
		};
		series[key] = { rate: band("rate"), cumulative: band("cum") };
	}

	return { turns, counts, series };
}

async function loadTechEvents(
	env: AggregateEnv,
	gameIds: string[],
): Promise<TechEventRow[]> {
	const out: TechEventRow[] = [];
	for (const ids of chunk(gameIds, CHUNK_SIZE)) {
		const res = await env.SHARE_DB.prepare(
			`SELECT te.game_id, te.player_index, te.tech, te.turn
			 FROM tech_events te
			 JOIN player_summaries ps ON ps.game_id = te.game_id
			                          AND ps.player_index = te.player_index
			 WHERE ps.is_human = 1
			   AND te.game_id IN (${placeholders(ids.length)})`,
		)
			.bind(...ids)
			.all<TechEventRow>();
		out.push(...((res.results ?? []) as TechEventRow[]));
	}
	return out;
}

async function loadLawEvents(
	env: AggregateEnv,
	gameIds: string[],
): Promise<LawEventRow[]> {
	const out: LawEventRow[] = [];
	for (const ids of chunk(gameIds, CHUNK_SIZE)) {
		const res = await env.SHARE_DB.prepare(
			`SELECT le.game_id, le.player_index, le.law, le.turn
			 FROM law_events le
			 JOIN player_summaries ps ON ps.game_id = le.game_id
			                          AND ps.player_index = le.player_index
			 WHERE ps.is_human = 1
			   AND le.game_id IN (${placeholders(ids.length)})`,
		)
			.bind(...ids)
			.all<LawEventRow>();
		out.push(...((res.results ?? []) as LawEventRow[]));
	}
	return out;
}

interface SaveDateRow {
	date: string;
	weekday: number | null;
	nation: string | null;
	// Identity + title inputs for the Overview calendar's click-through. The
	// last three feed formatGameTitle on the frontend so a calendar cell links
	// to the same heading the game page shows; nation doubles as
	// save_owner_nation. total_turns is NOT NULL in the schema.
	game_id: string;
	game_name: string | null;
	display_name: string | null;
	total_turns: number;
}

// One row per in-scope game with a save_date — feeds the Overview
// calendar heatmap, the favorite-day stat, and the games-by-nation bar.
// weekday is computed in SQL (strftime '%w', 0=Sun..6=Sat) to preserve
// the semantics of the retired /v1/stats handler; nation falls back to
// the first human player (the same COALESCE handleGameList uses).
async function loadSaveDates(
	env: AggregateEnv,
	gameIds: string[],
): Promise<SaveDateRow[]> {
	const out: SaveDateRow[] = [];
	for (const ids of chunk(gameIds, CHUNK_SIZE)) {
		const res = await env.SHARE_DB.prepare(
			`SELECT substr(g.save_date, 1, 10) AS date,
			        CAST(strftime('%w', g.save_date) AS INTEGER) AS weekday,
			        g.game_id AS game_id,
			        g.game_name AS game_name,
			        g.display_name AS display_name,
			        g.total_turns AS total_turns,
			        COALESCE(g.user_nation, (
			            SELECT ps.nation FROM player_summaries ps
			            WHERE ps.game_id = g.game_id AND ps.is_human = 1
			            ORDER BY ps.player_index ASC LIMIT 1
			        )) AS nation
			 FROM games g
			 WHERE g.save_date IS NOT NULL
			   AND g.game_id IN (${placeholders(ids.length)})`,
		)
			.bind(...ids)
			.all<SaveDateRow>();
		out.push(...((res.results ?? []) as SaveDateRow[]));
	}
	return out;
}

// focal "uploader" → the full user ChartBundle (core + Overview extension).
// focal "humans" → the tournament ChartBundleCore, with the one-focal-per-game
// Overview fields (win_rate/games_with_outcome, summary.top_nation/top_archetype)
// excluded by the return type, not nulled at runtime.
export function buildChartBundle(
	env: AggregateEnv,
	corpus: StatsCorpus,
	parserVersion: string,
	focal: "uploader",
): Promise<ChartBundle>;
export function buildChartBundle(
	env: AggregateEnv,
	corpus: StatsCorpus,
	parserVersion: string,
	focal: "humans",
): Promise<ChartBundleCore>;
export async function buildChartBundle(
	env: AggregateEnv,
	corpus: StatsCorpus,
	parserVersion: string,
	focal: Focal,
): Promise<ChartBundle | ChartBundleCore> {
	// Short-circuit: empty corpus returns a fully-shaped empty bundle.
	if (corpus.gameIds.length === 0) {
		const core = emptyCore(parserVersion);
		return focal === "humans"
			? core
			: withOverview(core, {
					top_nation: null,
					top_archetype: null,
					win_rate: null,
					games_with_outcome: 0,
				});
	}

	const [baseRows, yieldCurves, techEvents, lawEvents, saveDateRows] =
		await Promise.all([
			loadBaseRows(env, corpus.gameIds),
			loadYieldCurves(env, corpus.gameIds, focal),
			loadTechEvents(env, corpus.gameIds),
			loadLawEvents(env, corpus.gameIds),
			loadSaveDates(env, corpus.gameIds),
		]);

	const selfMembership = buildSelfMembership(baseRows, focal);
	const selfRows = baseRows.filter((r) =>
		selfMembership.has(`${r.game_id}|${r.player_index}`),
	);

	// --- Summary tiles + map-size win rate ----------------------------
	const totalGames = corpus.gameIds.length;

	const avgTurnsSum = baseRows.reduce(
		(acc, r) => acc + (r.total_turns ?? 0),
		0,
	);
	const distinctGameTurnLookup = new Map<string, number>();
	for (const r of baseRows) {
		if (!distinctGameTurnLookup.has(r.game_id)) {
			distinctGameTurnLookup.set(r.game_id, r.total_turns);
		}
	}
	const distinctGameTurnSum = [...distinctGameTurnLookup.values()].reduce(
		(a, b) => a + b,
		0,
	);
	const avgTotalTurns =
		distinctGameTurnLookup.size > 0
			? distinctGameTurnSum / distinctGameTurnLookup.size
			: null;
	// Silence unused-var lint; avgTurnsSum was computed for debug context.
	void avgTurnsSum;

	const nationCount = new Map<string, number>();
	const archetypeCount = new Map<string, number>();
	for (const r of selfRows) {
		if (r.nation) {
			nationCount.set(r.nation, (nationCount.get(r.nation) ?? 0) + 1);
		}
		if (r.starting_ruler_archetype) {
			archetypeCount.set(
				r.starting_ruler_archetype,
				(archetypeCount.get(r.starting_ruler_archetype) ?? 0) + 1,
			);
		}
	}
	const topNation = topEntry(nationCount, "nation");
	const topArchetype = topEntry(archetypeCount, "archetype");

	// --- Overview fields (folded from the retired /v1/stats) ----------
	// Win rate over self rows: for user corpus each self row is the
	// uploader's outcome for one game; observer-mode games have no
	// uploader row and so drop out (matching the old user_won IS NOT NULL
	// exclusion).
	const gamesWithOutcome = selfRows.length;
	const selfWins = selfRows.reduce(
		(acc, r) => acc + (r.is_winner === 1 ? 1 : 0),
		0,
	);
	const winRate = gamesWithOutcome > 0 ? selfWins / gamesWithOutcome : null;

	// Games per nation — reuse the self-row nationCount built above, same
	// buckets as nationWinRate so the Overview bar and the Stats nation
	// chart agree.
	const nations = [...nationCount.entries()]
		.map(([nation, games_played]) => ({ nation, games_played }))
		.sort((a, b) => b.games_played - a.games_played);

	// Calendar heatmap data + modal weekday.
	const saveDates = saveDateRows.map((r) => ({
		date: r.date,
		nation: r.nation,
		game_id: r.game_id,
		game_name: r.game_name,
		display_name: r.display_name,
		total_turns: r.total_turns,
	}));
	const weekdayCount = new Map<number, number>();
	for (const r of saveDateRows) {
		if (r.weekday != null) {
			weekdayCount.set(r.weekday, (weekdayCount.get(r.weekday) ?? 0) + 1);
		}
	}
	let favoriteDayOfWeek: number | null = null;
	let favoriteDayCount = -1;
	for (const [weekday, count] of weekdayCount) {
		// Tiebreak on the lower weekday for a stable result, matching the
		// old ORDER BY COUNT(*) DESC, weekday ASC.
		if (
			count > favoriteDayCount ||
			(count === favoriteDayCount && weekday < (favoriteDayOfWeek ?? Infinity))
		) {
			favoriteDayCount = count;
			favoriteDayOfWeek = weekday;
		}
	}

	// --- Nation win rate / avg points ---------------------------------
	const nationStats = new Map<
		string,
		{ games: number; wins: number; totalPoints: number; pointsCount: number }
	>();
	for (const r of selfRows) {
		if (!r.nation) continue;
		const s = nationStats.get(r.nation) ?? {
			games: 0,
			wins: 0,
			totalPoints: 0,
			pointsCount: 0,
		};
		s.games += 1;
		if (r.is_winner === 1) s.wins += 1;
		if (r.final_points != null) {
			s.totalPoints += r.final_points;
			s.pointsCount += 1;
		}
		nationStats.set(r.nation, s);
	}
	const nationWinRate = [...nationStats.entries()].map(
		([nation, { games, wins }]) => ({
			nation,
			games,
			wins,
			rate: games > 0 ? wins / games : 0,
		}),
	);
	const nationAvgPoints = [...nationStats.entries()]
		.filter(([, s]) => s.pointsCount > 0)
		.map(([nation, s]) => ({
			nation,
			games: s.games,
			avg_points: s.totalPoints / s.pointsCount,
		}));

	// --- Family classes ----------------------------------------------
	// Each player picks 3 family classes from their nation's pool. We track,
	// per (nation, class): how often it was picked and how many of those
	// games were won — enough to show pick rate and win rate per nation.
	const familyByNationMap = new Map<
		string,
		{ nation: string; class: string; count: number; wins: number }
	>();

	for (const r of selfRows) {
		if (!r.nation) continue;
		for (const c of parseJsonArray(r.family_classes)) {
			const k = `${r.nation}|${c}`;
			const fbn = familyByNationMap.get(k) ?? {
				nation: r.nation,
				class: c,
				count: 0,
				wins: 0,
			};
			fbn.count += 1;
			if (r.is_winner === 1) fbn.wins += 1;
			familyByNationMap.set(k, fbn);
		}
	}

	const familyByNation = [...familyByNationMap.values()];

	// Yield curves are computed in loadYieldCurves (median + P25/P75 band
	// per turn) and assigned to the bundle directly below.

	// --- Law / tech events -------------------------------------------
	// Drop succession laws and turn-1 adoptions up front so they appear in
	// neither the timing nor the opening-sequence charts. Succession laws
	// aren't civic choices; turn-1 adoptions are starting-law picks chosen at
	// game setup, not adoption-pace signal. Filtering before the first-three
	// slice keeps either from consuming a player's opening civic-law slots.
	const civicLawEvents = lawEvents.filter(
		(e) => !SUCCESSION_LAWS.has(e.law) && e.turn > 1,
	);

	// (game, player) → nation, shared by the per-nation law and tech charts.
	const nationByPlayer = new Map<string, string | null>();
	for (const r of baseRows) {
		nationByPlayer.set(`${r.game_id}|${r.player_index}`, r.nation);
	}

	// Law adoption timing per (nation, law), plus the ALL_NATIONS aggregate so
	// the frontend can show "all" without recombining medians.
	const lawTurns = new Map<
		string,
		{ nation: string; law: string; turns: number[] }
	>();
	for (const e of civicLawEvents) {
		const nation = nationByPlayer.get(`${e.game_id}|${e.player_index}`) ?? null;
		const buckets = nation ? [nation, ALL_NATIONS] : [ALL_NATIONS];
		for (const n of buckets) {
			const key = `${n}|${e.law}`;
			let g = lawTurns.get(key);
			if (!g) {
				g = { nation: n, law: e.law, turns: [] };
				lawTurns.set(key, g);
			}
			g.turns.push(e.turn);
		}
	}
	const lawTiming = [...lawTurns.values()].map(({ nation, law, turns }) => {
		const sorted = [...turns].sort((a, b) => a - b);
		return {
			nation,
			law,
			median_turn: median(sorted),
			// Turn spread (interquartile range) for the tooltip — tells whether a
			// law is adopted at a consistent time or all over the place.
			p25_turn: percentile(sorted, 25),
			p75_turn: percentile(sorted, 75),
			count: turns.length,
		};
	});

	// Opening laws: per player, the first 4 laws enacted as an
	// order-insensitive set, grouped by nation. Excludes succession laws but
	// (unlike the timing chart) keeps turn-1 laws — the four are meant to line
	// up with the in-game 4-law unit-unlock breakpoint, so a turn-1 starting
	// law counts. Order is dropped (sorted set) since the question is which
	// four laws a nation opens with, not the sequence.
	const OPENING_LAW_COUNT = 4;
	const openingLawEvents = lawEvents.filter((e) => !SUCCESSION_LAWS.has(e.law));
	const openingByPlayer = new Map<
		string,
		Array<{ law: string; turn: number }>
	>();
	for (const e of openingLawEvents) {
		const k = `${e.game_id}|${e.player_index}`;
		const arr = openingByPlayer.get(k) ?? [];
		arr.push({ law: e.law, turn: e.turn });
		openingByPlayer.set(k, arr);
	}
	const openingMap = new Map<
		string,
		{ nation: string; laws: string[]; count: number }
	>();
	for (const [k, arr] of openingByPlayer) {
		if (!selfMembership.has(k)) continue;
		const nation = nationByPlayer.get(k);
		if (!nation) continue; // observer / unknown nation — skip
		const first = arr
			.sort((a, b) => a.turn - b.turn)
			.slice(0, OPENING_LAW_COUNT);
		if (first.length < OPENING_LAW_COUNT) continue;
		// Order-insensitive: sort the law names so the same four collapse to one
		// key regardless of adoption order.
		const laws = first.map((e) => e.law).sort();
		const key = `${nation}|${laws.join("|")}`;
		const existing = openingMap.get(key) ?? { nation, laws, count: 0 };
		existing.count += 1;
		openingMap.set(key, existing);
	}
	const openingLaws = [...openingMap.values()];

	// Tech: first tech per player + median timing per tech, each broken down by
	// nation (the player's nation) with an extra ALL_NATIONS aggregate row so
	// the frontend can show "all" without recombining medians.
	// Drop turn-1 techs: each nation is granted its initial techs at game start,
	// so they're not a research choice or a timing signal.
	const researchedTechEvents = techEvents.filter((e) => e.turn > 1);

	// Timing: turn arrays per (nation, tech), plus the ALL_NATIONS aggregate.
	const techTurns = new Map<
		string,
		{ nation: string; tech: string; turns: number[] }
	>();
	const pushTechTurn = (nation: string | null, tech: string, turn: number) => {
		const buckets = nation ? [nation, ALL_NATIONS] : [ALL_NATIONS];
		for (const n of buckets) {
			const key = `${n}|${tech}`;
			let e = techTurns.get(key);
			if (!e) {
				e = { nation: n, tech, turns: [] };
				techTurns.set(key, e);
			}
			e.turns.push(turn);
		}
	};
	const techEventsByPlayer = new Map<
		string,
		Array<{ tech: string; turn: number }>
	>();
	for (const e of researchedTechEvents) {
		const k = `${e.game_id}|${e.player_index}`;
		pushTechTurn(nationByPlayer.get(k) ?? null, e.tech, e.turn);
		const parr = techEventsByPlayer.get(k) ?? [];
		parr.push({ tech: e.tech, turn: e.turn });
		techEventsByPlayer.set(k, parr);
	}
	const techTiming = [...techTurns.values()].map(({ nation, tech, turns }) => ({
		nation,
		tech,
		median_turn: median(turns),
		count: turns.length,
	}));

	// First researched tech per self player, tallied per (nation, tech) + ALL.
	const techFirstMap = new Map<
		string,
		{ nation: string; tech: string; count: number }
	>();
	const bumpFirst = (nation: string, tech: string) => {
		const key = `${nation}|${tech}`;
		const e = techFirstMap.get(key) ?? { nation, tech, count: 0 };
		e.count += 1;
		techFirstMap.set(key, e);
	};
	for (const [k, arr] of techEventsByPlayer) {
		if (!selfMembership.has(k)) continue;
		const first = arr.sort((a, b) => a.turn - b.turn)[0];
		if (!first) continue;
		const nation = nationByPlayer.get(k);
		if (nation) bumpFirst(nation, first.tech);
		bumpFirst(ALL_NATIONS, first.tech);
	}
	const techFirst = [...techFirstMap.values()];

	// --- Cities ------------------------------------------------------
	// Win rate by expansion speed: bucket each focal player by the turn they
	// founded their 5th city ("never" = fewer than 5 cities founded), then win
	// rate per bucket. Answers whether settling fast correlates with winning.
	// Over selfRows — the same outcome basis as the corpus win_rate.
	const expansionStats = new Map<string, { games: number; wins: number }>();
	for (const r of selfRows) {
		const b = cityTurnBucket(r.fifth_city_turn);
		const s = expansionStats.get(b) ?? { games: 0, wins: 0 };
		s.games += 1;
		if (r.is_winner === 1) s.wins += 1;
		expansionStats.set(b, s);
	}
	const expansionWinRate = [...expansionStats.entries()].map(([bucket, s]) => ({
		bucket,
		games: s.games,
		wins: s.wins,
		rate: s.games > 0 ? s.wins / s.games : 0,
	}));

	const core: ChartBundleCore = {
		meta: {
			game_count: totalGames,
			parser_version: parserVersion,
		},
		summary: {
			total_games: totalGames,
			avg_total_turns: avgTotalTurns,
		},
		save_dates: saveDates,
		favorite_day_of_week: favoriteDayOfWeek,
		nations,
		nationWinRate,
		nationAvgPoints,
		familyByNation,
		yieldCurves,
		lawTiming,
		openingLaws,
		expansionWinRate,
		techFirst,
		techTiming,
	};
	// The tournament corpus stops at the core; the broken-by-widening Overview
	// fields are excluded by the return type, not carried as misleading values.
	if (focal === "humans") return core;
	return withOverview(core, {
		top_nation: topNation,
		top_archetype: topArchetype,
		win_rate: winRate,
		games_with_outcome: gamesWithOutcome,
	});
}

// Extend a core bundle with the user-only Overview fields (the "most X" summary
// tiles + win rate). One helper so the empty and full paths build the extension
// identically.
function withOverview(
	core: ChartBundleCore,
	overview: {
		top_nation: ChartBundle["summary"]["top_nation"];
		top_archetype: ChartBundle["summary"]["top_archetype"];
		win_rate: Nullable<number>;
		games_with_outcome: number;
	},
): ChartBundle {
	return {
		...core,
		summary: {
			...core.summary,
			top_nation: overview.top_nation,
			top_archetype: overview.top_archetype,
		},
		win_rate: overview.win_rate,
		games_with_outcome: overview.games_with_outcome,
	};
}

function topEntry<T extends "nation" | "archetype">(
	m: Map<string, number>,
	key: T,
): Nullable<{ count: number } & Record<T, string>> {
	let best: { name: string; count: number } | null = null;
	for (const [name, count] of m) {
		if (!best || count > best.count) best = { name, count };
	}
	if (!best) return null;
	return { [key]: best.name, count: best.count } as { count: number } & Record<
		T,
		string
	>;
}

function emptyCore(parserVersion: string): ChartBundleCore {
	return {
		meta: {
			game_count: 0,
			parser_version: parserVersion,
		},
		summary: {
			total_games: 0,
			avg_total_turns: null,
		},
		save_dates: [],
		favorite_day_of_week: null,
		nations: [],
		nationWinRate: [],
		nationAvgPoints: [],
		familyByNation: [],
		yieldCurves: { turns: [], counts: [], series: {} },
		lawTiming: [],
		openingLaws: [],
		expansionWinRate: [],
		techFirst: [],
		techTiming: [],
	};
}
