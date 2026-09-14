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
import { WONDER_CULTURE_PREREQ, cultureRank } from "../generated/wonders";
import type { StatsCorpus } from "./resolve";
import type {
	ChartBundle,
	ChartBundleCore,
	Nullable,
	YieldCohort,
} from "./types";
import type { QueryableD1 } from "../d1";

export interface AggregateEnv {
	SHARE_DB: QueryableD1;
}

// Which roster rows count as the corpus's "focal" players — the set every
// per-player aggregate is computed over. "uploader" (user corpus) keeps only
// the uploader's own row per game; "humans" (tournament corpus) widens to every
// human, so both sides of a 1v1 contribute. The convention lives in exactly two
// places (buildSelfMembership + loadYieldCurves' selfClause), threaded from
// here rather than forked into a parallel aggregation path. A global corpus's
// nation facet (StatsCorpus.focalNations) narrows the same set further, at
// those same two places and nowhere else.
export type Focal = "uploader" | "humans";

// D1 bind-parameter cap is 100. Leave headroom for the params a statement
// binds alongside the ids — the widest is loadYieldCurves under a nation
// facet, one bind per selected nation (13 playable), so 63 of the 100. Exported
// (with chunk) for other batched IN-list loaders, e.g. the tournament
// player_summaries batch in tournament/public.ts.
export const CHUNK_SIZE = 50;

// Nation key for the cross-nation aggregate rows the bundle carries alongside
// per-nation rows (tech charts). Mirrors the frontend ALL_NATIONS sentinel in
// charts/helpers.ts — kept in sync by eye (no shared module across packages).
const ALL_NATIONS = "__all__";

// A character's archetype is itself a trait, flagged bArchetype in the game
// data and suffixed _ARCHETYPE (TRAIT_SCHEMER_ARCHETYPE). It rides along in
// starting_ruler_traits; the leader charts split the two apart.
const ARCHETYPE_TRAIT = /_ARCHETYPE$/;

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
	capital_family_class: string | null;
	is_human: number;
	is_uploader: number;
	starting_ruler_archetype: string | null;
	starting_ruler_traits: string | null; // JSON array of strings
	best_culture_level: string | null;
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
// compute per-turn percentile bands Worker-side. game_id/is_winner ride along
// to cohort the row by outcome.
type YieldRawRow = {
	turn: number;
	game_id: string;
	player_index: number;
	is_winner: number;
} & Record<string, number | string | null>;

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
	// Not a yield: GDP is derived at index time from the money and commodity
	// rates priced at each turn's market rate (migration 0044). Its cumulative
	// column is a running sum of the rate — a flow's total is lifetime output,
	// never a stockpile.
	["gdp_per_turn", "gdp_per_turn", "gdp_cumulative"],
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

interface WonderEventRow {
	game_id: string;
	player_index: number;
	wonder: string;
	turn: number;
	// Carried rather than filtered in SQL: an AI's build is excluded from the
	// stats but still has to be visible, because it takes the wonder off the
	// board for the humans in that game. See the wonders section below.
	is_human: number;
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
// (baseRows are already is_human=1, so that's all of them). A faceted global
// corpus keeps only the seats playing one of its nations — the JS half of the
// restriction loadYieldCurves applies in SQL.
function buildSelfMembership(
	baseRows: BaseRow[],
	focal: Focal,
	focalNations: string[] | null,
): Set<string> {
	const nations = focalNations === null ? null : new Set(focalNations);
	const self = new Set<string>();
	for (const r of baseRows) {
		const isFocal = focal === "humans" ? r.is_human === 1 : r.is_uploader === 1;
		if (!isFocal) continue;
		if (nations !== null && (r.nation === null || !nations.has(r.nation)))
			continue;
		self.add(`${r.game_id}|${r.player_index}`);
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
			        ps.nation, ps.family_classes, ps.capital_family_class,
			        ps.is_human, ps.is_uploader,
			        ps.starting_ruler_archetype, ps.starting_ruler_traits,
			        ps.best_culture_level,
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

// Games with a decided winner. `player_summaries.is_winner` is NOT NULL
// DEFAULT FALSE, so a game that never resolved is indistinguishable from one
// everybody lost. Only games appearing here can be split by outcome.
async function loadDecidedGames(
	env: AggregateEnv,
	gameIds: string[],
): Promise<Set<string>> {
	const decided = new Set<string>();
	for (const ids of chunk(gameIds, CHUNK_SIZE)) {
		const res = await env.SHARE_DB.prepare(
			`SELECT DISTINCT game_id FROM player_summaries
			 WHERE is_winner = 1 AND game_id IN (${placeholders(ids.length)})`,
		)
			.bind(...ids)
			.all<{ game_id: string }>();
		for (const row of res.results ?? []) decided.add(row.game_id);
	}
	return decided;
}

// ─── Records ─────────────────────────────────────────────────────────
//
// The leaderboard behind the bands: for each series, who posted the biggest
// number, and in which game.
//
// Two things make a naive "max per series" board useless, both measured on
// the corpus rather than guessed (becked/per-ankh#211):
//
//   Yields compound, so a raw whole-game max is a LONGEST-GAME board — 14 of
//   16 series records belonged to one game, the longest in the corpus. The
//   fixed-turn checkpoints are the answer: everyone who reached T40 is
//   compared at T40, which is length-blind without needing a normaliser the
//   reader then has to interpret.
//
//   "Cumulative" is the stockpile HELD, not lifetime production. Growth,
//   science, culture and orders never decrease, so for those it does mean
//   produced; money, food, iron, stone and wood are spent, so for those the
//   record is the largest treasury anyone sat on. The two claims share a
//   column, so the UI has to name them apart — the bundle just carries both.
//
// Ranking is per PLAYER-GAME, not per row: a long game would otherwise take
// all three places on one board with three adjacent turns.
// Checkpoint turns, chosen from the corpus rather than by eye. Share of games
// reaching each, on the 813-game local corpus (median game 74 turns):
// T20 99%, T40 92%, T60 71%, T80 42%, T100 18%. T20 earns its place — an
// opening board asks a different question from a late one — and T100 stays
// despite the thin field because each board ships its own sample count, so a
// reader can see it is a fifth of the corpus rather than all of it.
const RECORD_CHECKPOINTS = [20, 40, 60, 80, 100] as const;
const RECORD_TOP_N = 10;

// Series with no record board. A leaderboard asserts "biggest is best", and
// for these three the biggest number is a burden, not an achievement — the
// largest maintenance bill and the most unrest are not records anyone set out
// to break, and happiness only reads against the discontent it offsets. They
// still get bands, which make no such claim.
const RECORD_EXCLUDED = new Set([
	"maintenance_per_turn",
	"happiness_per_turn",
	"discontent_per_turn",
]);

type RecordWhen = "peak" | "final" | `t${(typeof RECORD_CHECKPOINTS)[number]}`;

export interface PlayerGameRecord {
	gameId: string;
	playerIndex: number;
	// Per series key: the best value seen and the turn it happened.
	peak: Map<string, { value: number; turn: number }>;
	// The latest turn seen, and that turn's values — the end-of-game board.
	lastTurn: number;
	final: Map<string, number>;
	// Values at each checkpoint turn, when the game reached it.
	at: Map<number, Map<string, number>>;
}

export function emptyPlayerGame(
	gameId: string,
	playerIndex: number,
): PlayerGameRecord {
	return {
		gameId,
		playerIndex,
		peak: new Map(),
		lastTurn: -1,
		final: new Map(),
		at: new Map(),
	};
}

// Fold one row into its player-game accumulator, for one measure.
export function foldRecordRow(
	acc: PlayerGameRecord,
	turn: number,
	values: Map<string, number>,
): void {
	for (const [key, value] of values) {
		const best = acc.peak.get(key);
		if (!best || value > best.value) acc.peak.set(key, { value, turn });
	}
	if (turn > acc.lastTurn) {
		acc.lastTurn = turn;
		acc.final = new Map(values);
	}
	if ((RECORD_CHECKPOINTS as readonly number[]).includes(turn)) {
		acc.at.set(turn, new Map(values));
	}
}

// Both sides of a duel upload the same save, so one match arrives as two
// game_ids carrying the same seats. Collapse them here, before any ranking:
// deduping per board instead would let one match's "peak" come from one upload
// and its "final" from the other, and would leave recordCounts advertising a
// population twice the size of the one the boards actually rank.
//
// The survivor is the upload that saw more turns — same match, more of it.
export function dedupePlayerGames(
	accs: Map<string, PlayerGameRecord>,
	xmlGameId: Map<string, string>,
): PlayerGameRecord[] {
	const best = new Map<string, PlayerGameRecord>();
	for (const acc of accs.values()) {
		const key = `${xmlGameId.get(acc.gameId) ?? acc.gameId}|${acc.playerIndex}`;
		const held = best.get(key);
		if (!held || acc.lastTurn > held.lastTurn) best.set(key, acc);
	}
	return [...best.values()];
}

// Rank the deduped player-games into a top-N per series per board.
export function rankRecords(
	accs: readonly PlayerGameRecord[],
	seatOf: Map<string, { nation: string | null; name: string | null }>,
	turnsOf: Map<string, number>,
): {
	records: ChartBundleCore["records"];
	recordGames: ChartBundleCore["recordGames"];
	recordCounts: ChartBundleCore["recordCounts"];
} {
	const boards: ChartBundleCore["records"] = {};
	// How many player-games each board could draw on — the T100 board is a
	// fifth of the corpus, and saying so is the difference between a record
	// and a misleading one.
	const counts: Record<string, number> = {};
	const push = (
		key: string,
		when: RecordWhen,
		row: { game_id: string; player_index: number; turn: number; value: number },
	) => {
		const series = (boards[key] ??= {});
		(series[when] ??= []).push(row);
	};
	for (const acc of accs) {
		counts.peak = (counts.peak ?? 0) + 1;
		counts.final = (counts.final ?? 0) + 1;
		for (const cp of RECORD_CHECKPOINTS) {
			if (acc.at.has(cp)) counts[`t${cp}`] = (counts[`t${cp}`] ?? 0) + 1;
		}
		for (const [key, best] of acc.peak) {
			push(key, "peak", {
				game_id: acc.gameId,
				player_index: acc.playerIndex,
				turn: best.turn,
				value: best.value,
			});
		}
		for (const [key, value] of acc.final) {
			push(key, "final", {
				game_id: acc.gameId,
				player_index: acc.playerIndex,
				turn: acc.lastTurn,
				value,
			});
		}
		for (const cp of RECORD_CHECKPOINTS) {
			const at = acc.at.get(cp);
			if (!at) continue;
			for (const [key, value] of at) {
				push(key, `t${cp}` as RecordWhen, {
					game_id: acc.gameId,
					player_index: acc.playerIndex,
					turn: cp,
					value,
				});
			}
		}
	}
	for (const series of Object.values(boards)) {
		for (const when of Object.keys(series)) {
			series[when] = series[when]
				.sort((a, b) => b.value - a.value)
				.slice(0, RECORD_TOP_N);
		}
	}

	// Identity for the games that actually made a board, as a lookup rather
	// than repeated on every row — the same game holds many records, and the
	// rows outnumber the games several times over.
	const recordGames: ChartBundleCore["recordGames"] = {};
	for (const series of Object.values(boards)) {
		for (const rows of Object.values(series)) {
			for (const r of rows) {
				recordGames[r.game_id] ??= {
					turns: turnsOf.get(r.game_id) ?? 0,
					seats: {},
				};
			}
		}
	}
	// Every seat, not just the record holder's, so a row can name both sides.
	for (const [key, info] of seatOf) {
		const sep = key.lastIndexOf("|");
		const entry = recordGames[key.slice(0, sep)];
		if (!entry) continue;
		entry.seats[Number(key.slice(sep + 1))] = info;
	}
	return { records: boards, recordGames, recordCounts: counts };
}

// Everything the record rows need beyond the numbers: (game_id|player_index) →
// seat, game_id → total turns, and game_id → the save's own id (which is what
// collapses the two uploads of one match). All three are small — one row per
// seat, one per game — so they are read once rather than carried on every turn
// row.
export async function loadRecordIdentity(
	env: AggregateEnv,
	gameIds: string[],
): Promise<{
	seat: Map<string, { nation: string | null; name: string | null }>;
	turns: Map<string, number>;
	xmlGameId: Map<string, string>;
}> {
	const seat = new Map<
		string,
		{ nation: string | null; name: string | null }
	>();
	const turns = new Map<string, number>();
	const xmlGameId = new Map<string, string>();
	for (const ids of chunk(gameIds, CHUNK_SIZE)) {
		// player_name is the handle the SAVE records, and is what every public
		// game page already prints beside the nation. online_id is the platform
		// identifier and is the field stripped for anonymous share viewers
		// (src/CLAUDE.md § Game / user identity & PII) — it is deliberately not
		// selected here, and must never enter a cached bundle.
		const seats = await env.SHARE_DB.prepare(
			`SELECT game_id, player_index, nation, player_name FROM player_summaries
			 WHERE game_id IN (${placeholders(ids.length)})`,
		)
			.bind(...ids)
			.all<{
				game_id: string;
				player_index: number;
				nation: string | null;
				player_name: string | null;
			}>();
		for (const row of seats.results ?? []) {
			seat.set(`${row.game_id}|${row.player_index}`, {
				nation: row.nation,
				name: row.player_name,
			});
		}
		const games = await env.SHARE_DB.prepare(
			`SELECT game_id, total_turns, xml_game_id FROM games
			 WHERE game_id IN (${placeholders(ids.length)})`,
		)
			.bind(...ids)
			.all<{
				game_id: string;
				total_turns: number | null;
				xml_game_id: string | null;
			}>();
		for (const row of games.results ?? []) {
			if (row.total_turns != null) turns.set(row.game_id, row.total_turns);
			if (row.xml_game_id != null) xmlGameId.set(row.game_id, row.xml_game_id);
		}
	}
	return { seat, turns, xmlGameId };
}

// Per-turn yield distribution curves. Restricted to the corpus's focal rows so
// the curves represent the focal players, not enemy AI. Returns the median +
// P25/P75 band per turn for each series (rate and cumulative), plus the sample
// size (n games) at each turn — pooled, and split by outcome.
async function loadYieldCurves(
	env: AggregateEnv,
	gameIds: string[],
	focal: Focal,
	focalNations: string[] | null,
): Promise<{
	curves: ChartBundleCore["yieldCurves"];
	records: ChartBundleCore["records"];
	recordGames: ChartBundleCore["recordGames"];
	recordCounts: ChartBundleCore["recordCounts"];
}> {
	if (gameIds.length === 0)
		return {
			curves: { turns: [], counts: [], series: {}, outcome: null },
			records: {},
			recordGames: {},
			recordCounts: {},
		};

	// Columns to pull: each series' rate column plus its cumulative column
	// (deduped — stocks share their single column).
	const columns = new Set<string>();
	for (const [, rateCol, cumCol] of YIELD_COLUMNS) {
		columns.add(rateCol);
		if (cumCol) columns.add(cumCol);
	}
	const selectList = [...columns].map((c) => `gpt.${c}`).join(", ");

	// The focal-player filter — the second (and last) site the focal
	// convention lives, mirroring buildSelfMembership. The rows are filtered in
	// SQL rather than after the fact because they are what the memory bound is
	// denominated in: a nation facet should never pull the other seats' rows
	// into the isolate just to drop them.
	const selfClause =
		focal === "humans" ? "ps.is_human = 1" : "ps.is_uploader = 1";
	const nationClause =
		focalNations === null
			? ""
			: ` AND ps.nation IN (${focalNations.map(() => "?").join(", ")})`;
	const nationBinds = focalNations ?? [];

	// Per turn: a value sample per field (rate + cumulative) and a row count.
	type Bucket = {
		count: number;
		rate: Map<string, number[]>;
		cum: Map<string, number[]>;
	};
	type Cohort = Map<number, Bucket>;
	// Three disjoint cohorts rather than pooled + winners + losers: a decided
	// row belongs to exactly one of them, so it is stored once instead of
	// twice. The pooled bands are the merge of all three at band time — the
	// same multiset per turn, so the same percentiles. Halving what the samples
	// retain is what keeps a whole-corpus aggregation inside the 128 MB isolate.
	const winners: Cohort = new Map();
	const losers: Cohort = new Map();
	const undecided: Cohort = new Map();

	const decided = await loadDecidedGames(env, gameIds);
	// One accumulator per player-game, folded in the same pass as the bands.
	const byPlayerGame = new Map<string, PlayerGameRecord>();

	// Fold one row into one cohort, creating the turn's bucket on first sight.
	const accumulate = (cohort: Cohort, turn: number, row: YieldRawRow) => {
		let bucket = cohort.get(turn);
		if (!bucket) {
			bucket = {
				count: 0,
				rate: new Map(YIELD_COLUMNS.map(([k]) => [k, []])),
				cum: new Map(YIELD_COLUMNS.map(([k]) => [k, []])),
			};
			cohort.set(turn, bucket);
		}
		bucket.count += 1;
		for (const [key, rateCol, cumCol] of YIELD_COLUMNS) {
			const rateVal = row[rateCol];
			if (typeof rateVal === "number") bucket.rate.get(key)!.push(rateVal);
			// Stocks have no cumulative column → reuse the level.
			const cumVal = cumCol ? row[cumCol] : row[rateCol];
			if (typeof cumVal === "number") bucket.cum.get(key)!.push(cumVal);
		}
	};

	for (const ids of chunk(gameIds, CHUNK_SIZE)) {
		const res = await env.SHARE_DB.prepare(
			`SELECT gpt.turn, gpt.game_id, gpt.player_index, ps.is_winner, ${selectList}
			 FROM game_player_turn gpt
			 JOIN player_summaries ps ON ps.game_id = gpt.game_id
			                          AND ps.player_index = gpt.player_index
			 WHERE ${selfClause}${nationClause}
			   AND gpt.game_id IN (${placeholders(ids.length)})`,
		)
			.bind(...nationBinds, ...ids)
			.all<YieldRawRow>();

		for (const row of (res.results ?? []) as YieldRawRow[]) {
			// Records ride the same rows the bands are built from: one pass,
			// no second query.
			const pgKey = `${row.game_id}|${row.player_index}`;
			let pg = byPlayerGame.get(pgKey);
			if (!pg) {
				pg = emptyPlayerGame(row.game_id, row.player_index);
				byPlayerGame.set(pgKey, pg);
			}
			const values = new Map<string, number>();
			for (const [key, rateCol, cumCol] of YIELD_COLUMNS) {
				if (RECORD_EXCLUDED.has(key)) continue;
				const rateVal = row[rateCol];
				if (typeof rateVal === "number") values.set(key, rateVal);
				// A level has no cumulative column. The bands mirror the level
				// into the cumulative series to keep their shape uniform; a
				// record board can't borrow that, because mirroring would ship
				// a second leaderboard identical to the first under a name that
				// claims otherwise.
				if (!cumCol) continue;
				const cumVal = row[cumCol];
				if (typeof cumVal === "number") values.set(`${key}:cum`, cumVal);
			}
			foldRecordRow(pg, row.turn, values);

			// Undecided games stay out of the outcome split — their all-zero
			// is_winner would read as a clean sweep of losses — but they are
			// still part of the pooled merge.
			accumulate(
				!decided.has(row.game_id)
					? undecided
					: row.is_winner === 1
						? winners
						: losers,
				row.turn,
				row,
			);
		}
	}

	// Every turn any cohort saw is the shared x-axis; a cohort with no sample
	// at one of them carries nulls there, so all of them stay index-aligned.
	const turns = [
		...new Set([...winners.keys(), ...losers.keys(), ...undecided.keys()]),
	].sort((a, b) => a - b);

	// One cohort, or the merge of several — pooled is all three at once.
	// flatMap already returns a fresh array, so sorting it in place leaves the
	// accumulated samples untouched for the next band.
	const bandsFor = (...cohorts: Cohort[]): YieldCohort => {
		const series: YieldCohort["series"] = {};
		for (const [key] of YIELD_COLUMNS) {
			const band = (which: "rate" | "cum") => {
				const p25: Nullable<number>[] = [];
				const p50: Nullable<number>[] = [];
				const p75: Nullable<number>[] = [];
				for (const t of turns) {
					const sorted = cohorts
						.flatMap((c) => c.get(t)?.[which].get(key) ?? [])
						.sort((a, b) => a - b);
					p25.push(percentile(sorted, 25));
					p50.push(percentile(sorted, 50));
					p75.push(percentile(sorted, 75));
				}
				return { p25, p50, p75 };
			};
			series[key] = { rate: band("rate"), cumulative: band("cum") };
		}
		return {
			counts: turns.map((t) =>
				cohorts.reduce((n, c) => n + (c.get(t)?.count ?? 0), 0),
			),
			series,
		};
	};

	const identity = await loadRecordIdentity(env, gameIds);
	const records = rankRecords(
		dedupePlayerGames(byPlayerGame, identity.xmlGameId),
		identity.seat,
		identity.turns,
	);

	const all = bandsFor(winners, losers, undecided);
	return {
		curves: {
			turns,
			counts: all.counts,
			series: all.series,
			outcome:
				decided.size === 0
					? null
					: { winners: bandsFor(winners), losers: bandsFor(losers) },
		},
		...records,
	};
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

// Wonder completions across the corpus. Unlike techs and laws these aren't
// per-player choices from a menu everyone shares: a wonder is unique within a
// game, so at most one row exists per (game, wonder) — whoever finished it.
//
// Non-human builders come back too, unlike the tech and law loaders above.
// They're excluded from the stats, but a wonder an AI finished is gone for
// everyone else in that game, which the eligibility denominator has to know.
async function loadWonderEvents(
	env: AggregateEnv,
	gameIds: string[],
): Promise<WonderEventRow[]> {
	const out: WonderEventRow[] = [];
	for (const ids of chunk(gameIds, CHUNK_SIZE)) {
		const res = await env.SHARE_DB.prepare(
			`SELECT we.game_id, we.player_index, we.wonder, we.turn, ps.is_human
			 FROM wonder_events we
			 JOIN player_summaries ps ON ps.game_id = we.game_id
			                          AND ps.player_index = we.player_index
			 WHERE we.game_id IN (${placeholders(ids.length)})`,
		)
			.bind(...ids)
			.all<WonderEventRow>();
		out.push(...((res.results ?? []) as WonderEventRow[]));
	}
	return out;
}

// The wonders enabled in each game (parser 2.12.0+ blobs only). Games missing
// from this table carry no pool and are excluded from wonder eligibility.
async function loadWonderPool(
	env: AggregateEnv,
	gameIds: string[],
): Promise<Map<string, Set<string>>> {
	const out = new Map<string, Set<string>>();
	for (const ids of chunk(gameIds, CHUNK_SIZE)) {
		const res = await env.SHARE_DB.prepare(
			`SELECT game_id, wonder FROM game_wonder_pool
			 WHERE game_id IN (${placeholders(ids.length)})`,
		)
			.bind(...ids)
			.all<{ game_id: string; wonder: string }>();
		for (const row of res.results ?? []) {
			const set = out.get(row.game_id) ?? new Set<string>();
			set.add(row.wonder);
			out.set(row.game_id, set);
		}
	}
	return out;
}

interface FamilyCityRow {
	game_id: string;
	player_index: number;
	family_class: string;
	cities: number;
	first_founded_turn: number | null;
}

// Per-(game, player, family class) city footprint — at most three rows per
// player, so this is a small join even over a large corpus.
async function loadFamilyCities(
	env: AggregateEnv,
	gameIds: string[],
): Promise<FamilyCityRow[]> {
	const out: FamilyCityRow[] = [];
	for (const ids of chunk(gameIds, CHUNK_SIZE)) {
		const res = await env.SHARE_DB.prepare(
			`SELECT fc.game_id, fc.player_index, fc.family_class, fc.cities,
			        fc.first_founded_turn
			 FROM player_family_cities fc
			 JOIN player_summaries ps ON ps.game_id = fc.game_id
			                          AND ps.player_index = fc.player_index
			 WHERE ps.is_human = 1
			   AND fc.game_id IN (${placeholders(ids.length)})`,
		)
			.bind(...ids)
			.all<FamilyCityRow>();
		out.push(...((res.results ?? []) as FamilyCityRow[]));
	}
	return out;
}

interface SaveDateRow {
	date: string;
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

// One row per in-scope game with a save_date — feeds the Overview calendar
// heatmap and nothing else. (The games-by-nation bar reads the self rows'
// nationCount, not this; and the modal weekday this used to compute went with
// favorite_day_of_week.) nation falls back to the first human player, the same
// COALESCE handleGameList uses.
//
// Called only on the uploader focal path: save_dates is a ChartBundle field,
// not a ChartBundleCore one, so an all-humans corpus has nowhere to put the
// result and skipping the call is what makes that bundle cost eight chunked
// query loops instead of nine.
async function loadSaveDates(
	env: AggregateEnv,
	gameIds: string[],
): Promise<SaveDateRow[]> {
	const out: SaveDateRow[] = [];
	for (const ids of chunk(gameIds, CHUNK_SIZE)) {
		const res = await env.SHARE_DB.prepare(
			`SELECT substr(g.save_date, 1, 10) AS date,
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

// Rows the opening-laws chart can reach: openingLawsOption
// (src/lib/stats/charts/laws.ts) ranks and takes the top 15 in both its
// per-nation and its "All nations" reading. Kept in sync by eye, like
// ALL_NATIONS — no module is shared across the worker/frontend boundary.
export const OPENING_LAWS_TOP_N = 15;

type OpeningLawRow = ChartBundleCore["openingLaws"][number];

// Bound `openingLaws` to what the chart can show. It is the one bundle field
// sized by the corpus rather than by the turn axis — distinct (nation,
// four-law-set) rows grew 139 → 270 → 469 across 143, 286 and 572 public games,
// two thirds of them singletons — so left alone it is what makes the bundle
// scale with game count.
//
// Not a per-nation slice(), because the "All nations" view sums a set's counts
// across nations *before* ranking: a row outside its own nation's top N can
// still place in the aggregate. Keeping the input to both readings — every
// nation's own top N, plus every row of a set that places in the top N once
// summed — leaves both rendering what they would render unbounded, save for
// rows tied at the cut.
//
// Exported for unit tests.
export function boundOpeningLaws(rows: OpeningLawRow[]): OpeningLawRow[] {
	const setKey = (r: OpeningLawRow) => r.laws.join("|");
	const rowKey = (r: OpeningLawRow) => `${r.nation}|${setKey(r)}`;
	// Ties are the common case at this tail, and D1 returns rows unordered, so
	// the ranking breaks ties on the law set — otherwise which rows survive the
	// cut would vary from one build of the same corpus to the next.
	const byCount = (a: OpeningLawRow, b: OpeningLawRow) =>
		b.count - a.count || setKey(a).localeCompare(setKey(b));

	const keep = new Set<string>();

	const byNation = new Map<string, OpeningLawRow[]>();
	for (const row of rows) {
		const forNation = byNation.get(row.nation) ?? [];
		forNation.push(row);
		byNation.set(row.nation, forNation);
	}
	for (const forNation of byNation.values())
		for (const row of forNation.sort(byCount).slice(0, OPENING_LAWS_TOP_N))
			keep.add(rowKey(row));

	// Every nation's row for a top set, not just the ones that got it there:
	// the aggregate view's count for a set is that whole sum.
	const summed = new Map<string, number>();
	for (const row of rows)
		summed.set(setKey(row), (summed.get(setKey(row)) ?? 0) + row.count);
	const topSets = new Set(
		[...summed]
			.sort(([ka, a], [kb, b]) => b - a || ka.localeCompare(kb))
			.slice(0, OPENING_LAWS_TOP_N)
			.map(([k]) => k),
	);
	for (const row of rows) if (topSets.has(setKey(row))) keep.add(rowKey(row));

	// Source order: row order is not part of the field's contract, and every
	// consumer re-ranks.
	return rows.filter((row) => keep.has(rowKey(row)));
}

// focal "uploader" → the full user ChartBundle (core + Overview extension).
// focal "humans" → the tournament ChartBundleCore, with the one-focal-per-game
// Overview fields (win_rate/games_with_outcome, summary.top_nation/top_archetype)
// excluded by the return type, not nulled at runtime. Either mode narrows
// further to corpus.focalNations when the corpus carries one; the per-game
// facts (meta.game_count, summary.total_games, avg_total_turns) stay the
// corpus's own and don't move with it.
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
					save_dates: [],
				});
	}

	// A faceted global corpus restricts the focal set to its nations' seats;
	// empty and absent read alike, so no caller can express "restricted to
	// nothing".
	const focalNations = corpus.focalNations?.length ? corpus.focalNations : null;

	const [
		baseRows,
		yieldData,
		techEvents,
		lawEvents,
		wonderEvents,
		wonderPool,
		familyCityRows,
		saveDateRows,
	] = await Promise.all([
		loadBaseRows(env, corpus.gameIds),
		loadYieldCurves(env, corpus.gameIds, focal, focalNations),
		loadTechEvents(env, corpus.gameIds),
		loadLawEvents(env, corpus.gameIds),
		loadWonderEvents(env, corpus.gameIds),
		loadWonderPool(env, corpus.gameIds),
		loadFamilyCities(env, corpus.gameIds),
		focal === "uploader"
			? loadSaveDates(env, corpus.gameIds)
			: Promise.resolve<SaveDateRow[]>([]),
	]);

	const { curves: yieldCurves, records, recordGames, recordCounts } = yieldData;

	const selfMembership = buildSelfMembership(baseRows, focal, focalNations);
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

	// Calendar heatmap data. Empty on the all-humans path, where the loader
	// above never ran and the field is off the returned type anyway.
	const saveDates = saveDateRows.map((r) => ({
		date: r.date,
		nation: r.nation,
		game_id: r.game_id,
		game_name: r.game_name,
		display_name: r.display_name,
		total_turns: r.total_turns,
	}));

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

	// --- Starting leader: archetype + starting traits -----------------
	// One row per focal player, keyed off the leader who first held the throne
	// (player_summaries.starting_ruler_*). Old World rolls that leader's
	// archetype and personality traits at game start rather than letting the
	// player pick them, so these read as "how did this draw fare", not "what
	// did players choose" — the same wins/games shape as nationWinRate, so the
	// bar doubles as the distribution.
	// The archetype trait itself is excluded from the trait tally: every leader
	// has exactly one and it's already the other chart's whole dimension.
	const archetypeStats = new Map<string, { games: number; wins: number }>();
	const traitStats = new Map<string, { games: number; wins: number }>();
	const bumpOutcome = (
		stats: Map<string, { games: number; wins: number }>,
		key: string,
		won: boolean,
	) => {
		const s = stats.get(key) ?? { games: 0, wins: 0 };
		s.games += 1;
		if (won) s.wins += 1;
		stats.set(key, s);
	};
	for (const r of selfRows) {
		const won = r.is_winner === 1;
		if (r.starting_ruler_archetype) {
			bumpOutcome(archetypeStats, r.starting_ruler_archetype, won);
		}
		for (const t of parseJsonArray(r.starting_ruler_traits)) {
			if (ARCHETYPE_TRAIT.test(t)) continue;
			bumpOutcome(traitStats, t, won);
		}
	}
	const startingArchetypeWinRate = [...archetypeStats.entries()].map(
		([archetype, { games, wins }]) => ({
			archetype,
			games,
			wins,
			rate: games > 0 ? wins / games : 0,
		}),
	);
	const startingTraitWinRate = [...traitStats.entries()].map(
		([trait, { games, wins }]) => ({
			trait,
			games,
			wins,
			rate: games > 0 ? wins / games : 0,
		}),
	);

	// --- Wonders ------------------------------------------------------
	// Per wonder: how often it got built out of how often it *could* be, how
	// those builders fared, and when it lands. The denominator is the point —
	// a wonder passed over reads nothing like one that was never on the board.
	//
	// Three gates, all required.
	//
	// 1. The pool. Old World enables only a subset of the wonders per game (a
	//    base save disables 15 of 28), so the wonder has to be in that game's
	//    pool. Blobs predating the parser that captures the pool have no rows in
	//    it; they contribute no denominator rather than a wrong one. Gate 1 is
	//    the one gate that also scopes the *numerator*: a corpus mixing pooled
	//    and poolless games would otherwise divide every build it saw by the
	//    eligibility only the pooled games could supply, and the chart reads the
	//    two as one fraction ("Built in N of E games"). So a wonder that has a
	//    denominator reports the builds from pooled games only, and a wonder
	//    that has none (eligible: null) reports every build — each row's numbers
	//    describe one population, named by whether `eligible` is null.
	// 2. Culture. A wonder's only build requirement is a city at its
	//    <CulturePrereq>, so the player has to have reached that level
	//    (best_culture_level — see derive-player-summary.ts for what that
	//    measures and where it errs).
	// 3. Still on the board. A wonder someone else already finished can't be
	//    built, and the stats only count human builders — so a wonder taken by
	//    a non-human has to leave the denominator too, or an AI rushing it on
	//    turn 20 reads as the human passing it over all game. Only the
	//    user-stats corpus mixes AI games in (scope=all); a tournament corpus
	//    is human-only.
	//
	// Gate 3 stops at non-humans deliberately. When a *human* rival takes a
	// wonder the numerator can still fire, so both sides stay in the
	// denominator, and the rate reads "of the players who could have started
	// this, how many finished it" — which in a 1v1 with both sides eligible
	// tops out near 50%. Narrowing it to "could have finished it" would need to
	// know whether the rival had reached the culture level *before* the build
	// turn, and the blob carries only an end-state culture level.
	//
	// Focal rows that won their game, for crediting a wonder's builder.
	const winnerRows = new Set(
		selfRows
			.filter((r) => r.is_winner === 1)
			.map((r) => `${r.game_id}|${r.player_index}`),
	);
	// game_id → wonders a non-human finished there (gate 3).
	const takenByNonHuman = new Map<string, Set<string>>();
	for (const w of wonderEvents) {
		if (w.is_human === 1) continue;
		const taken = takenByNonHuman.get(w.game_id) ?? new Set<string>();
		taken.add(w.wonder);
		takenByNonHuman.set(w.game_id, taken);
	}
	// Build turns and builder wins, tallied over the pooled subset and over
	// every game. Which pair a wonder reports is decided below by whether it
	// has a denominator; the two are never mixed within a row (gate 1).
	const pooledTurns = new Map<string, number[]>();
	const pooledWins = new Map<string, number>();
	const allTurns = new Map<string, number[]>();
	const allWins = new Map<string, number>();
	for (const w of wonderEvents) {
		if (w.is_human !== 1) continue;
		if (!selfMembership.has(`${w.game_id}|${w.player_index}`)) continue;
		const won = winnerRows.has(`${w.game_id}|${w.player_index}`);
		const tally = (turns: Map<string, number[]>, wins: Map<string, number>) => {
			const t = turns.get(w.wonder) ?? [];
			t.push(w.turn);
			turns.set(w.wonder, t);
			if (won) wins.set(w.wonder, (wins.get(w.wonder) ?? 0) + 1);
		};
		tally(allTurns, allWins);
		if (wonderPool.has(w.game_id)) tally(pooledTurns, pooledWins);
	}
	// Wonders we have pool coverage for at all — named by at least one focal
	// row's game pool. Distinguishes "on the board, nobody qualified" (a real
	// zero) from "we don't know what this game enabled" (no answer). Without it
	// a wonder built only in pre-pool games reads as available to nobody while
	// its own build turns sit beside that in the tooltip.
	const coveredWonders = new Set<string>();
	const eligibleByWonder = new Map<string, number>();
	for (const r of selfRows) {
		const pool = wonderPool.get(r.game_id);
		if (!pool) continue;
		const taken = takenByNonHuman.get(r.game_id);
		const rank = cultureRank(r.best_culture_level);
		for (const wonder of pool) {
			if (taken?.has(wonder)) continue;
			coveredWonders.add(wonder);
			if (rank < 0) continue;
			// A pool row always names a baked wonder (the pool is derived from
			// that same table), but read the prereq explicitly rather than
			// leaning on cultureRank's -1 for a miss — that would read as
			// "eligible for everyone".
			const prereq = WONDER_CULTURE_PREREQ[wonder];
			if (prereq === undefined) continue;
			if (rank >= cultureRank(prereq)) {
				eligibleByWonder.set(wonder, (eligibleByWonder.get(wonder) ?? 0) + 1);
			}
		}
	}
	// Every wonder someone could have built or did build, so an available one
	// that nobody took still shows up with its zero.
	const wonderKeys = new Set([...eligibleByWonder.keys(), ...allTurns.keys()]);
	const wonderStats = [...wonderKeys].map((wonder) => {
		// Covered ⇔ some pooled game accounted for this wonder ⇔ `eligible` is a
		// number. That is exactly the condition for reporting the pooled builds.
		const covered = coveredWonders.has(wonder);
		const turns = ((covered ? pooledTurns : allTurns).get(wonder) ?? []).sort(
			(a, b) => a - b,
		);
		const eligible = covered ? (eligibleByWonder.get(wonder) ?? 0) : null;
		const wins = (covered ? pooledWins : allWins).get(wonder) ?? 0;
		return {
			wonder,
			culture_prereq: WONDER_CULTURE_PREREQ[wonder] ?? null,
			eligible,
			built: turns.length,
			rate: eligible !== null && eligible > 0 ? turns.length / eligible : null,
			wins,
			win_rate: turns.length > 0 ? wins / turns.length : null,
			median_turn: turns.length > 0 ? median(turns) : null,
			p25_turn: percentile(turns, 25),
			p75_turn: percentile(turns, 75),
		};
	});

	// --- Capital family ----------------------------------------------
	// Which family class runs the focal player's capital, and how those games
	// went. Distinct from familyByNation below, which asks whether a class was
	// among the player's three at all: the capital is where the early bonuses
	// compound, so its class is the sharper read. Same wins/games shape as
	// nationWinRate, so one bar carries both the distribution and the rate.
	const capitalStats = new Map<string, { games: number; wins: number }>();
	for (const r of selfRows) {
		if (!r.capital_family_class) continue;
		const s = capitalStats.get(r.capital_family_class) ?? { games: 0, wins: 0 };
		s.games += 1;
		if (r.is_winner === 1) s.wins += 1;
		capitalStats.set(r.capital_family_class, s);
	}
	const capitalFamilyWinRate = [...capitalStats.entries()].map(
		([family_class, { games, wins }]) => ({
			family_class,
			games,
			wins,
			rate: games > 0 ? wins / games : 0,
		}),
	);

	// --- Family classes ----------------------------------------------
	// Each player picks 3 family classes from their nation's pool. Per
	// (nation, class): how often it was picked, how many of those games were
	// won, how much of the empire it ended up running, and where it fell in the
	// player's founding order — the family that seeded your first city is a
	// different commitment from the one that showed up third.
	const familyCityByPlayer = new Map<string, FamilyCityRow[]>();
	for (const fc of familyCityRows) {
		const k = `${fc.game_id}|${fc.player_index}`;
		const arr = familyCityByPlayer.get(k) ?? [];
		arr.push(fc);
		familyCityByPlayer.set(k, arr);
	}

	const familyByNationMap = new Map<
		string,
		{
			nation: string;
			class: string;
			count: number;
			wins: number;
			// City-share running mean; a player missing city data contributes to
			// neither this nor the slot tally, so each carries its own sample.
			shareSum: number;
			shareCount: number;
			// Picks where this class was the player's 1st / 2nd / 3rd family, by
			// the turn its first city was founded.
			slotCounts: [number, number, number];
		}
	>();

	for (const r of selfRows) {
		if (!r.nation) continue;
		const own = familyCityByPlayer.get(`${r.game_id}|${r.player_index}`) ?? [];
		const ownCities = own.reduce((sum, fc) => sum + fc.cities, 0);
		// Founding order: the player's families ranked by when their first city
		// landed. Families with no founding turn (older blobs) rank last and
		// contribute no slot.
		const order = own
			.filter((fc) => fc.first_founded_turn != null)
			.sort((a, b) => (a.first_founded_turn ?? 0) - (b.first_founded_turn ?? 0))
			.map((fc) => fc.family_class);
		for (const c of parseJsonArray(r.family_classes)) {
			const k = `${r.nation}|${c}`;
			const fbn = familyByNationMap.get(k) ?? {
				nation: r.nation,
				class: c,
				count: 0,
				wins: 0,
				shareSum: 0,
				shareCount: 0,
				slotCounts: [0, 0, 0] as [number, number, number],
			};
			fbn.count += 1;
			if (r.is_winner === 1) fbn.wins += 1;
			const mine = own.find((fc) => fc.family_class === c);
			if (mine && ownCities > 0) {
				fbn.shareSum += mine.cities / ownCities;
				fbn.shareCount += 1;
			}
			// Only the first three slots are meaningful — a player runs three
			// families — so a later index (possible with captured cities) is left
			// uncounted rather than folded into "third".
			const slot = order.indexOf(c);
			if (slot >= 0 && slot < 3) fbn.slotCounts[slot] += 1;
			familyByNationMap.set(k, fbn);
		}
	}

	const familyByNation = [...familyByNationMap.values()].map((f) => ({
		nation: f.nation,
		class: f.class,
		count: f.count,
		wins: f.wins,
		avg_share: f.shareCount > 0 ? f.shareSum / f.shareCount : null,
		// The mean's own sample — picks with city data, which can be fewer than
		// `count`. The frontend weights by this when recombining nations, so a
		// nation with sparse city data doesn't pull the cross-nation mean.
		share_samples: f.shareCount,
		slot_counts: f.slotCounts,
	}));

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
		const k = `${e.game_id}|${e.player_index}`;
		// Focal seats only, as openingLaws below already does. A law event
		// belongs to the player who enacted it, so an opponent's is not part of
		// this corpus's timing however the corpus was drawn — and under a nation
		// facet it is the Greek's law landing in a Rome bundle.
		if (!selfMembership.has(k)) continue;
		const nation = nationByPlayer.get(k) ?? null;
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
	const openingLaws = boundOpeningLaws([...openingMap.values()]);

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
		// Focal seats only — the same restriction lawTiming above applies, and
		// for the same reason. Filtering here rather than at each consumer is
		// what keeps techTiming and techFirst on one population: everything
		// downstream of this loop is already focal.
		if (!selfMembership.has(k)) continue;
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
		nations,
		nationWinRate,
		nationAvgPoints,
		startingArchetypeWinRate,
		startingTraitWinRate,
		wonderStats,
		capitalFamilyWinRate,
		familyByNation,
		yieldCurves,
		records,
		recordGames,
		recordCounts,
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
		save_dates: saveDates,
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
		save_dates: ChartBundle["save_dates"];
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
		save_dates: overview.save_dates,
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
		nations: [],
		nationWinRate: [],
		nationAvgPoints: [],
		startingArchetypeWinRate: [],
		startingTraitWinRate: [],
		wonderStats: [],
		capitalFamilyWinRate: [],
		familyByNation: [],
		yieldCurves: { turns: [], counts: [], series: {}, outcome: null },
		records: {},
		recordGames: {},
		recordCounts: {},
		lawTiming: [],
		openingLaws: [],
		expansionWinRate: [],
		techFirst: [],
		techTiming: [],
	};
}
