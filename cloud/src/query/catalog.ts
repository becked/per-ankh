// The semantic layer's vocabulary: every column a user-composed question may
// name, the grain it lives at, and the joins that are legal from it.
//
// Nothing outside this file is nameable. A selection carries catalog *keys*,
// never column names and never SQL, so the compiler's input is a set of
// identifiers this module minted — which is what makes three properties
// structural rather than enforced per request:
//
//   * The catalog is the PII allowlist. `player_name` is in it: it is already
//     on screen in tournament match tables and the records boards, and
//     loadRecordIdentity (stats/aggregate.ts) selects it while refusing
//     `online_id` in the same query. `online_id`, `discord_id`, `email` and
//     the raw `user_id` of an unlinked seat are not in it, and a column absent
//     from the catalog cannot be named by any selection. Stronger than
//     filtering a query, because there is no query text to filter.
//   * No user-authored SQL reaches the engine. Injection stops being a runtime
//     question: the compiler concatenates only strings written here.
//   * A measure declares its unit once, here, rather than at each question.
//     Both players uploading one save makes two rows in `games`
//     (dedupeSeatRecords, stats/aggregate.ts; ratings/duels.ts; the played-games
//     board in stats/handlers.ts all collapse them on `xml_game_id`), so a
//     count whose unit is a match must dedupe and a count whose unit is a save
//     must not. A count can say DISTINCT; an average and a sum have no such
//     form, so they narrow the rows instead (ONE_UPLOAD_PER_MATCH_SQL below,
//     applied by needsOneUploadPerMatch in compile.ts). Getting
//     either wrong is invisible in the output — the number looks right — so it
//     is a property of the catalog entry and not of the person asking.
//
// The catalog is curated, not generated. `game_player_turn` has 38 columns and
// listing all of them twice (per-turn and cumulative) would be a vocabulary
// nobody can read; what is here is the subset that answers questions people
// actually ask, and adding to it is a one-line change with a label attached.

import {
	compositionGameIdsSql,
	noChallengeRunsSql,
	TOURNAMENT_GAME_IDS_SQL,
	TOURNAMENT_ROSTER_SQL,
} from "../games-scope";
import { UNAMBIGUOUS_ONLINE_ID_OWNERS_SQL } from "../online-ids";
import { displayNameSql } from "../identity";

// ---------- Bounds ----------
//
// Compiled in, so no expressible selection returns the whole of
// `game_player_turn`: every selection is an aggregate over a GROUP BY (there
// is no raw-row projection in the grammar at all), and the row cap bounds what
// comes back from one. The caps on dimensions, filters and values bound the
// *statement* rather than the result — a selection naming forty filters is a
// forty-term WHERE whatever it returns.

export const MAX_ROWS = 200;
export const DEFAULT_ROWS = 50;
export const MAX_DIMENSIONS = 3;
export const MAX_FILTERS = 8;
export const MAX_FILTER_VALUES = 20;

// ---------- Identity ----------

/**
 * The account a seat belongs to, or NULL when nothing resolves it.
 *
 * Two credit paths, the same two the played-games board unions
 * (stats/handlers.ts): the uploader's own claimed seat is their account, and
 * any seat whose `online_id` resolves to exactly one user is that user's.
 * The board can UNION them because its unit is a (user, match) pair; a
 * GROUP BY query has one row per seat and needs one expression, so the arms
 * collapse into a COALESCE here.
 *
 * The uploader's claim is tried first. It is an explicit act by a signed-in
 * user — they picked that seat in the upload modal — where the online-id link
 * is captured implicitly from whichever seat they picked. The two agree by
 * construction in the ordinary case (captureOnlineIds links the claimed seat's
 * id to the claimer); the order only decides a seat whose id was later linked
 * to somebody else, and there the person who said "this is me" wins.
 *
 * The ambiguity rule comes from UNAMBIGUOUS_ONLINE_ID_OWNERS_SQL (online-ids.ts)
 * and is not restated: an id two accounts claim resolves to nobody, because
 * crediting both hands one player the other's history. One definition, read
 * here, by the played-games board and by the rating model.
 *
 * NULL is a real outcome — an AI seat has no account, and neither does a human
 * seat nobody has linked. A question grouped on this expression drops those
 * seats (compileQuery): they all share the one NULL key, so they arrive as a
 * single row that names nobody and, on the default sort, leads the ranking. A
 * filter on this expression excludes them too, by plain IN/NOT IN semantics
 * rather than by a rule of its own.
 */
export const PLAYER_USER_ID_SQL =
	"COALESCE(CASE WHEN ps.is_uploader = 1 THEN g.user_id END, uo.user_id)";

// The two joins PLAYER_USER_ID_SQL needs, added only when a selection names an
// identity entry. `ps.online_id IS NOT NULL` is the same guard the board's
// online-id arm carries; the empty string needs none, because captureOnlineIds
// refuses to write a link row for it.
export const IDENTITY_JOIN_SQL = `LEFT JOIN (${UNAMBIGUOUS_ONLINE_ID_OWNERS_SQL}) uo
	   ON uo.online_id = ps.online_id AND ps.online_id IS NOT NULL
	 LEFT JOIN users ud ON ud.user_id = ${PLAYER_USER_ID_SQL}`;

// The accounts a question can be asked about: the ones PLAYER_USER_ID_SQL
// resolves a seat to somewhere in the corpus a question runs over, by name.
//
// Scoped to that corpus for the reason TOURNAMENT_ROSTER_SQL is scoped to
// played matches — every other account is a filter value that selects nothing,
// and offering one is offering an empty answer. So the predicate is the same
// pair compileQuery puts in every WHERE (`is_public = 1`, no challenge runs),
// written here against the same expression rather than restated: a roster that
// drifted from the filter would offer a player whose own row is empty.
//
// Viewer-independent, which is what lets the catalog carry it, and no PII it
// does not already publish: `GET /v1/stats/players` is anonymous and serves
// user_id, display name and avatar_url for this same population. The display
// name is the effective one (displayNameSql), so an operator-set alias is what
// the picker shows — the name the rest of the site shows for that account.
//
// `discord_id` and `avatar_hash` are read for the avatar and folded into one
// URL by buildAvatarUrl (handleQueryCatalog), never serialized as fields of
// their own — the select-use-don't-serialize shape that stats/handlers.ts and
// users.ts both spell out. The snowflake does travel inside that URL, as it
// does on every other payload that renders an avatar; the handle
// (discord_username) is the field the PII stance keeps out, and it is not read
// here.
export const PLAYER_ROSTER_SQL = `SELECT ud.user_id, ${displayNameSql("ud")} AS display_name,
	          ud.discord_id, ud.avatar_hash
	   FROM users ud
	  WHERE EXISTS (
	          SELECT 1 FROM player_summaries ps
	            JOIN games g ON g.game_id = ps.game_id
	            LEFT JOIN (${UNAMBIGUOUS_ONLINE_ID_OWNERS_SQL}) uo
	              ON uo.online_id = ps.online_id AND ps.online_id IS NOT NULL
	           WHERE g.is_public = 1
	             AND ${noChallengeRunsSql("g")}
	             AND ${PLAYER_USER_ID_SQL} = ud.user_id)
	  ORDER BY ${displayNameSql("ud")} COLLATE NOCASE`;

// One upload per match, as a predicate over `g`.
//
// Both players uploading one match makes two rows in `games` carrying the same
// seats, the same events and the same turns: 160 of the 851 public matches in
// the 2026-11-10 snapshot have more than one upload, and 330 of the 2,035
// human seat rows over them are a second copy of a seat already counted. A
// count answers that with DISTINCT (countSqlFor, compile.ts). AVG and SUM have
// no such form. Each reads however many rows it was handed — an average
// divides by them, a sum adds them up — so the rows have to be narrowed to one
// upload per match before either runs. Which aggregates those are is
// needsOneUploadPerMatch (compile.ts).
//
// The survivor is the upload that saw more turns, which is the same match with
// more of it recorded, and on the tie the lower game_id. The tie is the normal
// outcome rather than the edge case: 154 of those 160 matches carry one
// total_turns across every upload. That is dedupeSeatRecords' rule
// (stats/aggregate.ts) read off `games.total_turns` instead of the seat's own
// last turn, which keeps every seat of one match coming from one upload. Any
// total order would do; what matters is that it is a property of the corpus
// and not D1's row order, which would let one question answer differently
// between two runs.
//
// The pick runs over the corpus the question runs over, which is the pair
// compileQuery puts in every WHERE, rather than over all of `games`. That is
// the reason PLAYER_ROSTER_SQL carries the pair too. Picking first and
// filtering after would let a private upload win the pick and then be filtered
// out, which drops the match from the answer entirely.
//
// What this does not see is a filter the uploads of one match disagree on: a
// question narrowed to the upload that lost the pick answers over neither. Of
// the 851 matches in that snapshot, 160 have more than one upload, and the
// disagreements among them fall into two kinds. On 88 matches the uploads
// differ on `difficulty` and on one they differ on `victory_type` because one
// upload recorded the value and the other did not — a parser-version
// difference rather than two readings of the game. On 19 they differ on
// `played`, on six on `total_turns` and on two on `winner_nation`, where both
// uploads recorded a value and the values are not the same. `map_class`,
// `map_size` and `opponent_level` agree on every match, and so does the
// `game_mode` filter, which compiles to a predicate over the roster rather
// than to a column and both uploads of a match carry the same roster. A seat's
// columns follow the pick, because it is made per match.
//
// ROW_NUMBER rather than a self-join on `games`: the NOT EXISTS spelling reads
// the table once per candidate upload, and over the November snapshot the same
// per-nation average took 82ms against 6ms for this one.
export const ONE_UPLOAD_PER_MATCH_SQL = `g.game_id IN (
	        SELECT game_id FROM (
	          SELECT game_id,
	                 ROW_NUMBER() OVER (PARTITION BY xml_game_id
	                                        ORDER BY total_turns DESC, game_id ASC) AS rn
	            FROM games
	           WHERE is_public = 1
	             AND ${noChallengeRunsSql()})
	         WHERE rn = 1)`;

// ---------- Entry shapes ----------

// Which aliases an entry's expression needs in scope. `games` is always in
// scope; `player` pulls in `player_summaries ps`; `identity` pulls in ps plus
// the two joins above. A source declares which of these it can reach, and an
// entry a source cannot reach is not in its catalog.
export type Reach = "games" | "player" | "identity" | "source";

// How the builder offers a filter on this entry, how it renders a value, and
// how the compiler binds one.
//
// `enum` means the value is a game zType — so a client displays it through the
// game's own name for it rather than raw — and is independent of whether
// `vocabulary` names a roster to pick from. Several zType columns have no
// baked roster (family classes, opponent levels, techs) and are still zTypes.
// `text` is the two columns that are genuinely free text: a seat's in-save
// `player_name`, and the year off a save date.
export type ValueType =
	| "enum"
	| "text"
	| "number"
	| "boolean"
	| "date"
	| "identity"
	| "tournament"
	| "game_mode";

export interface CatalogDimension {
	key: string;
	label: string;
	reach: Reach;
	type: ValueType;
	// The grouping expression. An identity dimension also carries `labelSql`
	// and `keyColumns`, because the thing grouped on (a user_id) is not the
	// thing displayed (their name) — grouping on the name instead would merge
	// two accounts that happen to share one.
	sql: string;
	labelSql?: string;
	// Extra columns carried alongside an identity dimension so the result can
	// link to a profile. Declared, not inferred, so the response shape is
	// readable from the catalog.
	keyColumns?: { suffix: string; sql: string }[];
	// Names a value list the builder can offer. Resolved client-side against
	// the baked tables in `src/lib/generated/` — the Worker has no name tables
	// for most of these, and shipping the roster in every catalog response
	// would be a second copy of data the frontend already holds.
	vocabulary?: string;
	// Whether a selection may filter on it. False where a filter would be a
	// second spelling of one the catalog already has: `played_year` is the
	// `played` date range written as a string, and a question narrowed by a
	// year would have two ways to ask it with different operators.
	filterable: boolean;
}

// What one counted or averaged thing is. The compiler derives a count's
// DISTINCT key from it.
export type MeasureUnit = "match" | "save" | "seat" | "event";

export interface CatalogMeasure {
	key: string;
	label: string;
	reach: Reach;
	unit: MeasureUnit;
	// Three shapes, in the order the compiler tries them:
	//   both absent ⇒ a count of distinct `unit`s;
	//   `agg`       ⇒ that aggregate over the expression, with `unit` saying
	//                 what one contributing row is;
	//   `countSql`  ⇒ a complete aggregate expression, for the one measure
	//                 that is a count with a predicate rather than either.
	//
	// Adding a function to this union is a type error in
	// `needsOneUploadPerMatch` (compile.ts) until it says whether the new
	// aggregate needs the corpus narrowed, which is the one question an
	// aggregate cannot be added without answering.
	agg?: { fn: "AVG" | "SUM" | "MIN" | "MAX"; sql: string };
	countSql?: string;
}

export interface CatalogFilter {
	key: string;
	label: string;
	reach: Reach;
	type: ValueType;
	// The column expression a value is compared against. Absent for
	// `tournament` and `game_mode`, whose predicates are subqueries rather
	// than comparisons.
	sql?: string;
	vocabulary?: string;
	ops: readonly FilterOp[];
}

export type FilterOp = "in" | "not_in" | "gte" | "lte";

const SET_OPS: readonly FilterOp[] = ["in", "not_in"];
const RANGE_OPS: readonly FilterOp[] = ["gte", "lte"];

export interface QuerySource {
	key: string;
	label: string;
	// The heading this source sits under in the builder's source picker.
	// Required rather than optional so a source added later states where it
	// belongs: `SelectOptions` is a list of groups or a list of bare options
	// and not a mix, so one ungrouped source would have nowhere to render.
	// `SOURCE_DEFS` is ordered by group then label, alphabetically, which is
	// what lets the picker build its groups from this order alone — a run of
	// one group is that group. Pinned in catalog.test.ts.
	group: string;
	table: string;
	alias: string;
	// Whether `player_summaries` (and so identity) is reachable. A source with
	// no `player_index` cannot name a seat, which is what keeps a per-game
	// average from being silently weighted by roster size.
	joinsPlayer: boolean;
	// The match-scoped identity of one row, for the `event` unit. Every one of
	// these leads with `g.xml_game_id` rather than `g.game_id`: a row of
	// `wonder_events` exists once per *save*, so a match both players uploaded
	// has two of them, and a count that did not dedupe would report the
	// tournament's wonders twice over.
	eventKeySql: string;
	dimensions: CatalogDimension[];
	measures: CatalogMeasure[];
	filters: CatalogFilter[];
}

// ---------- Shared entries: games ----------

const GAME_DIMENSIONS: CatalogDimension[] = [
	{
		key: "map_class",
		label: "Map script",
		reach: "games",
		type: "enum",
		sql: "g.map_class",
		vocabulary: "map_class",
		filterable: true,
	},
	{
		key: "map_size",
		label: "Map size",
		reach: "games",
		type: "enum",
		sql: "g.map_size",
		vocabulary: "map_size",
		filterable: true,
	},
	{
		// Labelled Prosperity, which is what the game calls the setting
		// (TEXT_SP_SETUP_ADVANCED_DIFFICULTY). The key stays `difficulty`: it
		// is the column name, and it is already in every shared link. Not the
		// headline Difficulty preset, which this corpus does not carry.
		key: "difficulty",
		label: "Prosperity",
		reach: "games",
		type: "enum",
		sql: "g.difficulty",
		vocabulary: "prosperity",
		filterable: true,
	},
	{
		// "AI Aggression" is the label the setup screen's OpponentLevel row
		// carries (SETUP_PARAMETERS, $lib/generated/game-setup-sections).
		key: "opponent_level",
		label: "AI Aggression",
		reach: "games",
		type: "enum",
		sql: "g.opponent_level",
		vocabulary: "opponent_level",
		filterable: true,
	},
	{
		key: "victory_type",
		label: "Victory type",
		reach: "games",
		type: "enum",
		sql: "g.victory_type",
		vocabulary: "victory_type",
		filterable: true,
	},
	{
		key: "winner_nation",
		label: "Winning nation",
		reach: "games",
		type: "enum",
		sql: "g.winner_nation",
		vocabulary: "nation",
		filterable: true,
	},
	{
		key: "played_year",
		label: "Year played",
		reach: "games",
		type: "text",
		// save_date is an ISO date string and the comparison is a plain string
		// one — games-scope.ts measured that: 802 of the 803 public games in
		// the 2026-10-04 snapshot carry a 10-character YYYY-MM-DD and the one
		// that doesn't carries nothing at all, so the prefix is the year.
		sql: "substr(g.save_date, 1, 4)",
		filterable: false,
	},
];

const GAME_MEASURES: CatalogMeasure[] = [
	{
		key: "matches",
		label: "Matches",
		reach: "games",
		unit: "match",
	},
	{
		key: "avg_turns",
		label: "Average game length",
		reach: "games",
		// A match rather than a save: the average runs over one upload per match
		// (ONE_UPLOAD_PER_MATCH_SQL). `max_turns` beside it keeps `save`, because
		// it reads every upload and the longest game is the longest game however
		// many of them record it.
		unit: "match",
		agg: { fn: "AVG", sql: "g.total_turns" },
	},
	{
		key: "max_turns",
		label: "Longest game",
		reach: "games",
		unit: "save",
		agg: { fn: "MAX", sql: "g.total_turns" },
	},
];

const GAME_FILTERS: CatalogFilter[] = [
	{
		// Single-player, duel or FFA — how many humans sat down to the game,
		// which is what someone picking a game mode here is after.
		//
		// NOT the `games.game_mode` column, which this entry replaced. That
		// column is the save's `@_GameMode` read verbatim: how the players
		// connected, not how many of them there were, so it cannot tell a duel
		// from an FFA. In the 2026-11-10 snapshot its 678 NETWORK games are 668
		// duels, four FFAs, four single-human games and two with two humans and
		// AI beside them, and its 71 HOTSEAT games split 36 single-human to 31
		// duels. No relabelling of that column produces the three modes people
		// ask for, so the filter is built on the roster instead. The column
		// stays where it answers its own question — the game-detail Settings
		// tab, and the remote/local split the rating model and the played-games
		// board read (remoteGameModeSql).
		//
		// The three values are the roster compositions the /stats slices
		// already cut the corpus by (COMPOSITION_GAME_IDS_SQL, games-scope.ts),
		// under the names that selector already gives them. One vocabulary
		// across both surfaces: a duel there and a duel here are the same test
		// on the same corpus.
		//
		// A filter and not a dimension, because the three do not partition the
		// corpus — a game with two humans and any AI matches none of them, five
		// games in that snapshot — so a grouping would carry a NULL row for a
		// bucket with no name. As a filter those games match no value, which is
		// the answer /stats gives them too.
		key: "game_mode",
		label: "Game mode",
		reach: "games",
		type: "game_mode",
		// No `sql`: a value names one of three subqueries over `game_id` rather
		// than a column to compare against, which is how `tournament` below
		// compiles too.
		vocabulary: "game_mode",
		ops: SET_OPS,
	},
	{
		key: "tournament",
		label: "Tournament",
		reach: "games",
		type: "tournament",
		// The one vocabulary the Worker supplies rather than the client: a
		// tournament's name is in D1 and nowhere in src/lib/generated/, which
		// is the same "the roster lives where the data is" rule that keeps the
		// zType rosters client-side. Served as `rosters.tournament` below.
		vocabulary: "tournament",
		ops: ["in"],
	},
	{
		// One key with both bounds rather than a `played_from` and a
		// `played_to`: the column is the same and the operator is what tells
		// the bounds apart, which is how `total_turns` already reads. A window
		// is still two rows, because a key takes each operator once.
		//
		// The builder offers `gte` alone, as a window dropdown that carries
		// the day inside it (QueryBuilder.svelte). `lte` reaches here from a
		// hand-written or bookmarked URL.
		key: "played",
		label: "Played",
		reach: "games",
		type: "date",
		sql: "g.save_date",
		ops: RANGE_OPS,
	},
	{
		key: "total_turns",
		label: "Game length (turns)",
		reach: "games",
		type: "number",
		sql: "g.total_turns",
		ops: RANGE_OPS,
	},
];

// ---------- Shared entries: seats ----------

const PLAYER_DIMENSIONS: CatalogDimension[] = [
	{
		key: "player",
		label: "Player",
		reach: "identity",
		type: "identity",
		sql: PLAYER_USER_ID_SQL,
		labelSql: displayNameSql("ud"),
		keyColumns: [
			{ suffix: "id", sql: PLAYER_USER_ID_SQL },
			{ suffix: "slug", sql: "ud.slug" },
		],
		// Named for the filter `filtersFromDimensions` derives from this entry,
		// not for the grouping: a filter value is a user_id, which nobody can
		// type, so the picker needs the roster PLAYER_ROSTER_SQL serves. The
		// grouping has no use for it — `labelSql` already selects the name, and
		// `valueLabel` passes an identity value through unchanged.
		vocabulary: "player",
		filterable: true,
	},
	{
		key: "player_name",
		label: "Player name (in save)",
		reach: "player",
		type: "text",
		sql: "ps.player_name",
		filterable: true,
	},
	{
		key: "nation",
		label: "Nation",
		reach: "player",
		type: "enum",
		sql: "ps.nation",
		vocabulary: "nation",
		filterable: true,
	},
	{
		key: "starting_archetype",
		label: "Starting ruler archetype",
		reach: "player",
		type: "enum",
		sql: "ps.starting_ruler_archetype",
		vocabulary: "archetype",
		filterable: true,
	},
	{
		key: "capital_family_class",
		label: "Capital family class",
		reach: "player",
		type: "enum",
		sql: "ps.capital_family_class",
		vocabulary: "family_class",
		filterable: true,
	},
	{
		key: "best_culture_level",
		label: "Best culture level",
		reach: "player",
		type: "enum",
		sql: "ps.best_culture_level",
		vocabulary: "culture_level",
		filterable: true,
	},
	{
		key: "is_human",
		label: "Human",
		reach: "player",
		type: "boolean",
		sql: "ps.is_human",
		filterable: true,
	},
	{
		key: "is_winner",
		label: "Won",
		reach: "player",
		type: "boolean",
		sql: "ps.is_winner",
		filterable: true,
	},
	{
		key: "is_uploader",
		label: "Uploader",
		reach: "player",
		type: "boolean",
		sql: "ps.is_uploader",
		filterable: true,
	},
];

const PLAYER_MEASURES: CatalogMeasure[] = [
	{
		// Named for what it counts, which is runs and not people: the `seat`
		// unit compiles to COUNT(DISTINCT match:player_index) (countSqlFor,
		// compile.ts), so grouped by nation it answers how many times that
		// nation was played. "Players" said it counted people, and read as a
		// tautology beside the `player` dimension. This is `wins` without the
		// predicate, so the two labels are a pair at one grain, under the
		// game-grain `matches` above.
		key: "seats",
		label: "Matches played",
		reach: "player",
		unit: "seat",
	},
	{
		key: "wins",
		label: "Matches won",
		reach: "player",
		unit: "seat",
		// A count with a predicate, which neither of the other two shapes
		// expresses. SUM(ps.is_winner) would be the obvious spelling and is
		// wrong here for the reason the unit exists: a seat appears twice when
		// its match was uploaded twice, and summing the flag counts it twice.
		countSql:
			"COUNT(DISTINCT CASE WHEN ps.is_winner = 1 THEN g.xml_game_id || ':' || ps.player_index END)",
	},
	{
		key: "avg_points",
		label: "Average final points",
		reach: "player",
		unit: "seat",
		agg: { fn: "AVG", sql: "ps.final_points" },
	},
	{
		key: "max_points",
		label: "Highest final points",
		reach: "player",
		unit: "seat",
		agg: { fn: "MAX", sql: "ps.final_points" },
	},
	{
		key: "avg_techs",
		label: "Average techs completed",
		reach: "player",
		unit: "seat",
		agg: { fn: "AVG", sql: "ps.techs_completed" },
	},
	{
		key: "avg_cities",
		label: "Average cities held",
		reach: "player",
		unit: "seat",
		agg: { fn: "AVG", sql: "ps.cities_total" },
	},
	{
		key: "avg_military",
		label: "Average final military power",
		reach: "player",
		unit: "seat",
		agg: { fn: "AVG", sql: "ps.final_military_power" },
	},
];

const PLAYER_FILTERS: CatalogFilter[] = [
	{
		key: "final_points",
		label: "Final points",
		reach: "player",
		type: "number",
		sql: "ps.final_points",
		ops: RANGE_OPS,
	},
	{
		key: "techs_completed",
		label: "Techs completed",
		reach: "player",
		type: "number",
		sql: "ps.techs_completed",
		ops: RANGE_OPS,
	},
	{
		key: "cities_total",
		label: "Cities held",
		reach: "player",
		type: "number",
		sql: "ps.cities_total",
		ops: RANGE_OPS,
	},
];

// ---------- Sources ----------

// A filter derived from a dimension, so the column and its label are written
// once. A dimension that is not `filterable` contributes none.
function filtersFromDimensions(dims: CatalogDimension[]): CatalogFilter[] {
	return dims
		.filter((d) => d.filterable)
		.map((d) => ({
			key: d.key,
			label: d.label,
			reach: d.reach,
			type: d.type,
			sql: d.sql,
			vocabulary: d.vocabulary,
			ops: d.type === "number" ? [...SET_OPS, ...RANGE_OPS] : SET_OPS,
		}));
}

const SOURCE_DEFS: QuerySource[] = [
	{
		key: "games",
		label: "Games",
		group: "Games and players",
		table: "games",
		alias: "g",
		// No player_index, so no seat and no identity: an average over games
		// joined to seats would be weighted by roster size without saying so.
		joinsPlayer: false,
		eventKeySql: "g.xml_game_id",
		dimensions: [],
		measures: [],
		filters: [],
	},
	{
		key: "player_summaries",
		label: "Players",
		group: "Games and players",
		table: "player_summaries",
		alias: "ps",
		joinsPlayer: true,
		eventKeySql: "g.xml_game_id || ':' || ps.player_index",
		dimensions: [],
		measures: [],
		filters: [],
	},
	{
		key: "player_family_cities",
		label: "Family cities",
		group: "Leaders and families",
		table: "player_family_cities",
		alias: "pfc",
		joinsPlayer: true,
		eventKeySql:
			"g.xml_game_id || ':' || pfc.player_index || ':' || pfc.family_class",
		dimensions: [
			{
				key: "family_class",
				label: "Family class",
				reach: "source",
				type: "enum",
				sql: "pfc.family_class",
				vocabulary: "family_class",
				filterable: true,
			},
		],
		measures: [
			{
				key: "family_rows",
				label: "Family rows",
				reach: "source",
				unit: "event",
			},
			{
				key: "avg_family_cities",
				label: "Average cities of that class",
				reach: "source",
				unit: "event",
				agg: { fn: "AVG", sql: "pfc.cities" },
			},
			{
				key: "avg_first_founded",
				label: "Average first founding turn",
				reach: "source",
				unit: "event",
				agg: { fn: "AVG", sql: "pfc.first_founded_turn" },
			},
		],
		filters: [
			{
				key: "family_cities",
				label: "Cities of that class",
				reach: "source",
				type: "number",
				sql: "pfc.cities",
				ops: RANGE_OPS,
			},
		],
	},
	{
		key: "leader_reigns",
		label: "Leaders",
		group: "Leaders and families",
		table: "leader_reigns",
		alias: "lr",
		joinsPlayer: true,
		eventKeySql:
			"g.xml_game_id || ':' || lr.player_index || ':' || lr.character_xml_id",
		dimensions: [
			{
				key: "reign_archetype",
				label: "Leader archetype",
				reach: "source",
				type: "enum",
				sql: "lr.archetype",
				vocabulary: "archetype",
				filterable: true,
			},
		],
		measures: [
			{
				key: "reigns",
				label: "Reigns",
				reach: "source",
				unit: "event",
			},
			{
				key: "avg_accession_turn",
				label: "Average accession turn",
				reach: "source",
				unit: "event",
				agg: { fn: "AVG", sql: "lr.start_turn" },
			},
		],
		filters: [
			{
				key: "accession_turn",
				label: "Accession turn",
				reach: "source",
				type: "number",
				sql: "lr.start_turn",
				ops: RANGE_OPS,
			},
		],
	},
	{
		key: "law_events",
		label: "Laws adopted",
		group: "Techs and laws",
		table: "law_events",
		alias: "le",
		joinsPlayer: true,
		eventKeySql:
			"g.xml_game_id || ':' || le.player_index || ':' || le.law || ':' || le.turn",
		dimensions: [
			{
				key: "law",
				label: "Law",
				reach: "source",
				type: "enum",
				sql: "le.law",
				vocabulary: "law",
				filterable: true,
			},
		],
		measures: [
			{
				key: "adoptions",
				label: "Adoptions",
				reach: "source",
				unit: "event",
			},
			{
				key: "avg_law_turn",
				label: "Average turn adopted",
				reach: "source",
				unit: "event",
				agg: { fn: "AVG", sql: "le.turn" },
			},
			{
				key: "earliest_law_turn",
				label: "Earliest turn adopted",
				reach: "source",
				unit: "event",
				agg: { fn: "MIN", sql: "le.turn" },
			},
		],
		filters: [
			{
				key: "law_turn",
				label: "Turn adopted",
				reach: "source",
				type: "number",
				sql: "le.turn",
				ops: RANGE_OPS,
			},
		],
	},
	{
		key: "tech_events",
		label: "Techs researched",
		group: "Techs and laws",
		table: "tech_events",
		alias: "te",
		joinsPlayer: true,
		eventKeySql: "g.xml_game_id || ':' || te.player_index || ':' || te.tech",
		dimensions: [
			{
				key: "tech",
				label: "Tech",
				reach: "source",
				type: "enum",
				sql: "te.tech",
				vocabulary: "tech",
				filterable: true,
			},
		],
		measures: [
			{
				key: "techs_researched",
				label: "Techs researched",
				reach: "source",
				unit: "event",
			},
			{
				key: "avg_tech_turn",
				label: "Average turn researched",
				reach: "source",
				unit: "event",
				agg: { fn: "AVG", sql: "te.turn" },
			},
			{
				key: "earliest_tech_turn",
				label: "Earliest turn researched",
				reach: "source",
				unit: "event",
				agg: { fn: "MIN", sql: "te.turn" },
			},
		],
		filters: [
			{
				key: "tech_turn",
				label: "Turn researched",
				reach: "source",
				type: "number",
				sql: "te.turn",
				ops: RANGE_OPS,
			},
		],
	},
	{
		key: "game_player_turn",
		label: "Per-turn series",
		group: "Turn by turn",
		table: "game_player_turn",
		alias: "gpt",
		joinsPlayer: true,
		eventKeySql: "g.xml_game_id || ':' || gpt.player_index || ':' || gpt.turn",
		dimensions: [
			{
				key: "turn",
				label: "Turn",
				reach: "source",
				type: "number",
				sql: "gpt.turn",
				filterable: true,
			},
		],
		measures: [
			{
				key: "turn_rows",
				label: "Turn rows",
				reach: "source",
				unit: "event",
			},
			{
				key: "avg_military_power",
				label: "Average military power",
				reach: "source",
				unit: "event",
				agg: { fn: "AVG", sql: "gpt.military_power" },
			},
			{
				key: "max_military_power",
				label: "Peak military power",
				reach: "source",
				unit: "event",
				agg: { fn: "MAX", sql: "gpt.military_power" },
			},
			{
				key: "avg_legitimacy",
				label: "Average legitimacy",
				reach: "source",
				unit: "event",
				agg: { fn: "AVG", sql: "gpt.legitimacy" },
			},
			{
				key: "avg_science",
				label: "Average science per turn",
				reach: "source",
				unit: "event",
				agg: { fn: "AVG", sql: "gpt.science_per_turn" },
			},
			{
				// The running total rather than the rate, which is what "how
				// much science did they get" means and what `avg_science`
				// above cannot answer at any grouping.
				//
				// MAX is the end-of-game figure because the column only rises:
				// science spent on a tech is deducted from the stock, not from
				// the total earned. Measured over the 2026-11-10 snapshot —
				// 5 of 258,825 turn-to-turn steps go down, all 5 on one seat.
				// MIN-and-subtract would be the shape if it did fall, and it
				// is not available here: the grammar has one aggregate.
				key: "max_science",
				label: "Highest total science",
				reach: "source",
				unit: "event",
				agg: { fn: "MAX", sql: "gpt.science_cumulative" },
			},
			{
				key: "avg_money",
				label: "Average money per turn",
				reach: "source",
				unit: "event",
				agg: { fn: "AVG", sql: "gpt.money_per_turn" },
			},
		],
		filters: [],
	},
	{
		key: "player_units_produced",
		label: "Units produced",
		group: "Units",
		table: "player_units_produced",
		alias: "pup",
		joinsPlayer: true,
		// A match in which this unit type was built. The source offers no
		// `event`-unit measure — `units_produced` sums a column rather than
		// counting rows — so nothing compiles this today; the field is required
		// by `QuerySource`, and it is the key a count here would have to take.
		eventKeySql: "g.xml_game_id || ':' || pup.unit_type",
		dimensions: [
			{
				key: "unit",
				label: "Unit",
				reach: "source",
				type: "enum",
				sql: "pup.unit_type",
				vocabulary: "unit",
				filterable: true,
			},
		],
		measures: [
			{
				// The table's whole point: issue #272's Q3 is this measure
				// grouped by player and narrowed to a tournament.
				//
				// What it sums is the units a city finished training, and
				// nothing else: `Player.incrementUnitsProduced`
				// (Player.cs:10197) has one caller in the game's source, the
				// UNIT_BUILD branch of `City.finishBuild` (City.cs:8580). A
				// unit that arrived any other way — an event's grant, a
				// mercenary, a capture, a seat's starting units — never reaches
				// the counter, so this is narrower than every unit a player
				// ever had. Named for the tally the game's own stats screen
				// names "Military Units Produced"
				// (TEXT_UI_STATS_TOTAL_MILITARY, text-ui.xml).
				key: "units_produced",
				label: "Units produced",
				reach: "source",
				// A match rather than an event, mirroring `avg_turns`: the sum
				// runs over one upload per match (needsOneUploadPerMatch,
				// compile.ts), so a match is what one contributing row belongs
				// to. Documentation rather than behaviour — measureSql returns
				// on `agg` before it reaches countSqlFor — but a different
				// value would be a false statement in the catalog.
				unit: "match",
				agg: { fn: "SUM", sql: "pup.count" },
			},
		],
		filters: [
			{
				key: "unit_count",
				label: "Units of that type produced",
				reach: "source",
				type: "number",
				sql: "pup.count",
				ops: RANGE_OPS,
			},
		],
	},
	{
		key: "game_wonder_pool",
		label: "Wonders available",
		group: "Wonders",
		table: "game_wonder_pool",
		alias: "gwp",
		joinsPlayer: false,
		eventKeySql: "g.xml_game_id || ':' || gwp.wonder",
		dimensions: [
			{
				key: "pool_wonder",
				label: "Wonder",
				reach: "source",
				type: "enum",
				sql: "gwp.wonder",
				vocabulary: "wonder",
				filterable: true,
			},
		],
		measures: [
			{
				key: "wonders_available",
				label: "Wonders available",
				reach: "source",
				unit: "event",
			},
		],
		filters: [],
	},
	{
		key: "wonder_events",
		label: "Wonders built",
		group: "Wonders",
		table: "wonder_events",
		alias: "we",
		joinsPlayer: true,
		eventKeySql: "g.xml_game_id || ':' || we.wonder",
		dimensions: [
			{
				key: "wonder",
				label: "Wonder",
				reach: "source",
				type: "enum",
				sql: "we.wonder",
				vocabulary: "wonder",
				filterable: true,
			},
		],
		measures: [
			{
				key: "wonders_built",
				label: "Wonders built",
				reach: "source",
				unit: "event",
			},
			{
				key: "avg_wonder_turn",
				label: "Average turn completed",
				reach: "source",
				unit: "event",
				agg: { fn: "AVG", sql: "we.turn" },
			},
			{
				key: "earliest_wonder_turn",
				label: "Earliest turn completed",
				reach: "source",
				unit: "event",
				agg: { fn: "MIN", sql: "we.turn" },
			},
		],
		filters: [
			{
				key: "wonder_turn",
				label: "Turn completed",
				reach: "source",
				type: "number",
				sql: "we.turn",
				ops: RANGE_OPS,
			},
		],
	},
];

// Each source's catalog is its own entries plus everything it can reach. Built
// once at module load rather than per request: it is constant data, and the
// per-source copies are what make the serialized catalog a list the builder
// can read without resolving reachability itself.
function resolveSource(def: QuerySource): QuerySource {
	const reachable = (r: Reach): boolean =>
		r === "games" ||
		r === "source" ||
		(def.joinsPlayer && (r === "player" || r === "identity"));

	const dimensions = [
		...def.dimensions,
		...PLAYER_DIMENSIONS.filter((d) => reachable(d.reach)),
		...GAME_DIMENSIONS,
	];
	const measures = [
		...def.measures,
		...PLAYER_MEASURES.filter((m) => reachable(m.reach)),
		...GAME_MEASURES,
	];
	const filters = [
		...filtersFromDimensions(def.dimensions),
		...def.filters,
		...PLAYER_FILTERS.filter((f) => reachable(f.reach)),
		...filtersFromDimensions(
			PLAYER_DIMENSIONS.filter((d) => reachable(d.reach)),
		),
		...GAME_FILTERS,
		...filtersFromDimensions(GAME_DIMENSIONS),
	];

	return { ...def, dimensions, measures, filters };
}

export const SOURCES: readonly QuerySource[] = SOURCE_DEFS.map(resolveSource);

const SOURCE_BY_KEY = new Map(SOURCES.map((s) => [s.key, s]));

export function sourceByKey(key: string): QuerySource | null {
	return SOURCE_BY_KEY.get(key) ?? null;
}

export function dimensionByKey(
	source: QuerySource,
	key: string,
): CatalogDimension | null {
	return source.dimensions.find((d) => d.key === key) ?? null;
}

export function measureByKey(
	source: QuerySource,
	key: string,
): CatalogMeasure | null {
	return source.measures.find((m) => m.key === key) ?? null;
}

export function filterByKey(
	source: QuerySource,
	key: string,
): CatalogFilter | null {
	return source.filters.find((f) => f.key === key) ?? null;
}

// ---------- The wire shape ----------
//
// What GET /v1/query/catalog answers with. Deliberately not the module's own
// objects: `sql` is the half of every entry that must never leave the Worker,
// and a serializer that picks fields is what keeps a column expression from
// reaching a client through a JSON.stringify somebody added later.

export interface CatalogDimensionWire {
	key: string;
	label: string;
	type: ValueType;
	vocabulary?: string;
	// Present on an identity dimension: the extra column keys its rows carry.
	key_columns?: string[];
}

export interface CatalogMeasureWire {
	key: string;
	label: string;
	unit: MeasureUnit;
}

export interface CatalogFilterWire {
	key: string;
	label: string;
	type: ValueType;
	ops: FilterOp[];
	vocabulary?: string;
}

export interface CatalogSourceWire {
	key: string;
	label: string;
	// The picker heading. Sources sharing one arrive contiguously, so a client
	// groups them by walking the list.
	group: string;
	dimensions: CatalogDimensionWire[];
	measures: CatalogMeasureWire[];
	filters: CatalogFilterWire[];
}

// One value a filter can take, where the Worker is what knows the name for it.
export interface CatalogRosterOption {
	value: string;
	label: string;
	// The picture that names the value, where it has one: for the player roster,
	// the account's Discord avatar. A zType vocabulary's icon is a baked sprite
	// the client resolves against `src/lib/generated/` ($lib/query/vocabularies),
	// so only a served roster carries one here.
	icon?: string;
}

export interface CatalogWire {
	sources: CatalogSourceWire[];
	// The vocabularies the Worker supplies, keyed by the `vocabulary` an entry
	// names. Only the ones whose values live in D1 — a tournament, an account —
	// are here; a zType roster is resolved client-side against the baked tables
	// in `src/lib/generated/`, because a second copy of those here would be the
	// drift the catalog exists to prevent. A vocabulary absent from this map
	// and unknown to the client is a filter that takes a typed token.
	rosters: Record<string, CatalogRosterOption[]>;
	limits: {
		max_rows: number;
		default_rows: number;
		max_dimensions: number;
		max_filters: number;
		max_filter_values: number;
	};
}

export function serializeCatalog(
	rosters: Record<string, CatalogRosterOption[]> = {},
): CatalogWire {
	return {
		rosters,
		sources: SOURCES.map((s) => ({
			key: s.key,
			label: s.label,
			group: s.group,
			dimensions: s.dimensions.map((d) => ({
				key: d.key,
				label: d.label,
				type: d.type,
				...(d.vocabulary ? { vocabulary: d.vocabulary } : {}),
				...(d.keyColumns
					? { key_columns: d.keyColumns.map((k) => `${d.key}_${k.suffix}`) }
					: {}),
			})),
			measures: s.measures.map((m) => ({
				key: m.key,
				label: m.label,
				unit: m.unit,
			})),
			filters: s.filters.map((f) => ({
				key: f.key,
				label: f.label,
				type: f.type,
				ops: [...f.ops],
				...(f.vocabulary ? { vocabulary: f.vocabulary } : {}),
			})),
		})),
		limits: {
			max_rows: MAX_ROWS,
			default_rows: DEFAULT_ROWS,
			max_dimensions: MAX_DIMENSIONS,
			max_filters: MAX_FILTERS,
			max_filter_values: MAX_FILTER_VALUES,
		},
	};
}

// Re-exported so the compiler reads the tournament predicate, and the catalog
// handler the roster that matches it, from the one place that defines them
// rather than restating the join through tournament_rounds. The composition
// lookup travels the same way, so that the parser and the compiler both read
// the filter's vocabulary from the module the filter is declared in.
export {
	compositionGameIdsSql,
	TOURNAMENT_GAME_IDS_SQL,
	TOURNAMENT_ROSTER_SQL,
};
