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
//     must not. Getting that wrong is invisible in the output — the number
//     looks right — so it is a property of the catalog entry and not of the
//     person asking.
//
// The catalog is curated, not generated. `game_player_turn` has 38 columns and
// listing all of them twice (per-turn and cumulative) would be a vocabulary
// nobody can read; what is here is the subset that answers questions people
// actually ask, and adding to it is a one-line change with a label attached.

import { TOURNAMENT_GAME_IDS_SQL } from "../games-scope";
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
 * NULL is a real answer and is never dropped — an AI seat has no account, and
 * neither does a human seat nobody has linked. The builder renders those rows
 * as "Unlinked seat" rather than filtering them out, because the failure mode
 * this guards against is an answer that looks complete and is short.
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
	"enum" | "text" | "number" | "boolean" | "date" | "identity" | "tournament";

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
	// Whether a selection may filter on it. False for a dimension whose values
	// are only meaningful as a grouping (the identity label).
	filterable: boolean;
	// Shown under the picker. One sentence, present only where the key does
	// not say the whole thing.
	help?: string;
}

// What one counted or averaged thing is. The compiler derives a count's
// DISTINCT key from it, and the builder shows `note` beside the column, so a
// number that is per-save rather than per-match says so where it is read.
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
	agg?: { fn: "AVG" | "MIN" | "MAX"; sql: string };
	countSql?: string;
	note: string;
}

export interface CatalogFilter {
	key: string;
	label: string;
	reach: Reach;
	type: ValueType;
	// The column expression a value is compared against. Absent for
	// `tournament`, whose predicate is a subquery rather than a comparison.
	sql?: string;
	vocabulary?: string;
	ops: readonly FilterOp[];
	help?: string;
}

export type FilterOp = "in" | "not_in" | "gte" | "lte";

const SET_OPS: readonly FilterOp[] = ["in", "not_in"];
const RANGE_OPS: readonly FilterOp[] = ["gte", "lte"];

export interface QuerySource {
	key: string;
	label: string;
	table: string;
	alias: string;
	// One line naming what a row is, shown above the builder. The grain, in
	// the words the issue's catalog needs it in.
	grain: string;
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

// ---------- Shared entries: the games grain ----------

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
		key: "game_mode",
		label: "Game mode",
		reach: "games",
		type: "enum",
		sql: "g.game_mode",
		vocabulary: "game_mode",
		filterable: true,
		help: "How the match was played. Multiplayer and Play By Cloud are the two remote modes.",
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
		help: "When the game was played, from the save's own date — not when it was uploaded.",
	},
];

const GAME_MEASURES: CatalogMeasure[] = [
	{
		key: "matches",
		label: "Matches",
		reach: "games",
		unit: "match",
		note: "Distinct matches. A match both players uploaded counts once.",
	},
	{
		key: "saves",
		label: "Saves uploaded",
		reach: "games",
		unit: "save",
		note: "Uploads, not matches. A match both players uploaded counts twice — which is the question when you are counting uploads.",
	},
	{
		key: "avg_turns",
		label: "Average game length",
		reach: "games",
		unit: "save",
		agg: { fn: "AVG", sql: "g.total_turns" },
		note: "Averaged over saves, so a match both players uploaded weighs twice. Turns.",
	},
	{
		key: "max_turns",
		label: "Longest game",
		reach: "games",
		unit: "save",
		agg: { fn: "MAX", sql: "g.total_turns" },
		note: "Turns. A maximum is unaffected by a match being uploaded twice.",
	},
];

const GAME_FILTERS: CatalogFilter[] = [
	{
		key: "tournament",
		label: "Tournament",
		reach: "games",
		type: "tournament",
		ops: ["in"],
	},
	{
		// One key with both bounds rather than a `played_from` and a
		// `played_to`: the column is the same and the operator is what the
		// comparison dropdown is for, which is how `total_turns` already reads.
		// A window is still two rows, because a key takes each operator once.
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

// ---------- Shared entries: the seat grain ----------

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
		filterable: false,
	},
	{
		key: "player_name",
		label: "Player name (in save)",
		reach: "player",
		type: "text",
		sql: "ps.player_name",
		filterable: true,
		help: "The name written in the save file. Free text, so one person can appear under several spellings — group by Player instead to count people.",
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
		help: "The ruler the seat opened with. Successors are in Leader reigns.",
	},
	{
		key: "capital_family_class",
		label: "Capital family class",
		reach: "player",
		type: "enum",
		sql: "ps.capital_family_class",
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
		help: "Highest level reached by any city the seat still held at the end.",
	},
	{
		key: "is_human",
		label: "Human seat",
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
		label: "Uploader's seat",
		reach: "player",
		type: "boolean",
		sql: "ps.is_uploader",
		filterable: true,
	},
];

const PLAYER_MEASURES: CatalogMeasure[] = [
	{
		key: "seats",
		label: "Seats",
		reach: "player",
		unit: "seat",
		note: "Distinct seats in distinct matches. A match both players uploaded counts each seat once.",
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
		note: "Distinct winning seats in distinct matches. Counts a seat's win once however many uploads the match has.",
	},
	{
		key: "avg_points",
		label: "Average final points",
		reach: "player",
		unit: "seat",
		agg: { fn: "AVG", sql: "ps.final_points" },
		note: "Averaged over seat rows, so a match both players uploaded weighs twice.",
	},
	{
		key: "max_points",
		label: "Highest final points",
		reach: "player",
		unit: "seat",
		agg: { fn: "MAX", sql: "ps.final_points" },
		note: "A maximum is unaffected by a match being uploaded twice.",
	},
	{
		key: "avg_techs",
		label: "Average techs completed",
		reach: "player",
		unit: "seat",
		agg: { fn: "AVG", sql: "ps.techs_completed" },
		note: "Averaged over seat rows, so a match both players uploaded weighs twice.",
	},
	{
		key: "avg_cities",
		label: "Average cities held",
		reach: "player",
		unit: "seat",
		agg: { fn: "AVG", sql: "ps.cities_total" },
		note: "End-of-game holdings, averaged over seat rows.",
	},
	{
		key: "avg_military",
		label: "Average final military power",
		reach: "player",
		unit: "seat",
		agg: { fn: "AVG", sql: "ps.final_military_power" },
		note: "Averaged over seat rows, so a match both players uploaded weighs twice.",
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
			help: d.help,
		}));
}

const SOURCE_DEFS: QuerySource[] = [
	{
		key: "games",
		label: "Games",
		table: "games",
		alias: "g",
		grain: "One row per save uploaded.",
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
		table: "player_summaries",
		alias: "ps",
		grain: "One row per seat in a save — every player, human and AI.",
		joinsPlayer: true,
		eventKeySql: "g.xml_game_id || ':' || ps.player_index",
		dimensions: [],
		measures: [],
		filters: [],
	},
	{
		key: "wonder_events",
		label: "Wonders built",
		table: "wonder_events",
		alias: "we",
		grain:
			"One row per wonder completed in a save, with who built it and when.",
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
				note: "Distinct (match, wonder) pairs. A wonder is unique within a game, so this counts completions.",
			},
			{
				key: "avg_wonder_turn",
				label: "Average turn completed",
				reach: "source",
				unit: "event",
				agg: { fn: "AVG", sql: "we.turn" },
				note: "Averaged over rows, so a match both players uploaded weighs twice.",
			},
			{
				key: "earliest_wonder_turn",
				label: "Earliest turn completed",
				reach: "source",
				unit: "event",
				agg: { fn: "MIN", sql: "we.turn" },
				note: "A minimum is unaffected by a match being uploaded twice.",
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
	{
		key: "tech_events",
		label: "Techs researched",
		table: "tech_events",
		alias: "te",
		grain: "One row per tech a seat completed, with the turn it landed.",
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
				note: "Distinct (match, seat, tech) triples.",
			},
			{
				key: "avg_tech_turn",
				label: "Average turn researched",
				reach: "source",
				unit: "event",
				agg: { fn: "AVG", sql: "te.turn" },
				note: "Averaged over rows, so a match both players uploaded weighs twice.",
			},
			{
				key: "earliest_tech_turn",
				label: "Earliest turn researched",
				reach: "source",
				unit: "event",
				agg: { fn: "MIN", sql: "te.turn" },
				note: "A minimum is unaffected by a match being uploaded twice.",
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
		key: "law_events",
		label: "Laws adopted",
		table: "law_events",
		alias: "le",
		grain:
			"One row per adoption — a law repealed and re-adopted appears twice.",
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
				note: "Distinct (match, seat, law, turn) rows — a re-adoption is its own row, which is what the table's key says it is.",
			},
			{
				key: "avg_law_turn",
				label: "Average turn adopted",
				reach: "source",
				unit: "event",
				agg: { fn: "AVG", sql: "le.turn" },
				note: "Averaged over rows, so a match both players uploaded weighs twice.",
			},
			{
				key: "earliest_law_turn",
				label: "Earliest turn adopted",
				reach: "source",
				unit: "event",
				agg: { fn: "MIN", sql: "le.turn" },
				note: "A minimum is unaffected by a match being uploaded twice.",
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
		key: "leader_reigns",
		label: "Leader reigns",
		table: "leader_reigns",
		alias: "lr",
		grain:
			"One row per leader who held a seat's throne, and the turn they took it.",
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
				help: "Null for a leader the save records no archetype for — a child ruler, or a save old enough that the archetype can't be read.",
			},
		],
		measures: [
			{
				key: "reigns",
				label: "Reigns",
				reach: "source",
				unit: "event",
				note: "Distinct (match, seat, leader) triples — successors included, unlike the starting-ruler columns on a seat.",
			},
			{
				key: "avg_accession_turn",
				label: "Average accession turn",
				reach: "source",
				unit: "event",
				agg: { fn: "AVG", sql: "lr.start_turn" },
				note: "Averaged over rows, so a match both players uploaded weighs twice.",
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
		key: "player_family_cities",
		label: "Family city footprint",
		table: "player_family_cities",
		alias: "pfc",
		grain: "One row per (seat, family class) — at most three per seat.",
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
				filterable: true,
			},
		],
		measures: [
			{
				key: "family_rows",
				label: "Seat-family pairs",
				reach: "source",
				unit: "event",
				note: "Distinct (match, seat, family class) triples.",
			},
			{
				key: "avg_family_cities",
				label: "Average cities of that class",
				reach: "source",
				unit: "event",
				agg: { fn: "AVG", sql: "pfc.cities" },
				note: "End-of-game holdings, averaged over rows.",
			},
			{
				key: "avg_first_founded",
				label: "Average first founding turn",
				reach: "source",
				unit: "event",
				agg: { fn: "AVG", sql: "pfc.first_founded_turn" },
				note: "Earliest founding among that class's cities, averaged over rows.",
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
		key: "game_player_turn",
		label: "Per-turn series",
		table: "game_player_turn",
		alias: "gpt",
		grain:
			"One row per (seat, turn) — the widest table here, and the slowest to ask of.",
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
				note: "Distinct (match, seat, turn) triples.",
			},
			{
				key: "avg_military_power",
				label: "Average military power",
				reach: "source",
				unit: "event",
				agg: { fn: "AVG", sql: "gpt.military_power" },
				note: "Averaged over turn rows, so a match both players uploaded weighs twice.",
			},
			{
				key: "max_military_power",
				label: "Peak military power",
				reach: "source",
				unit: "event",
				agg: { fn: "MAX", sql: "gpt.military_power" },
				note: "A maximum is unaffected by a match being uploaded twice.",
			},
			{
				key: "avg_legitimacy",
				label: "Average legitimacy",
				reach: "source",
				unit: "event",
				agg: { fn: "AVG", sql: "gpt.legitimacy" },
				note: "Averaged over turn rows.",
			},
			{
				key: "avg_science",
				label: "Average science per turn",
				reach: "source",
				unit: "event",
				agg: { fn: "AVG", sql: "gpt.science_per_turn" },
				note: "Averaged over turn rows.",
			},
			{
				key: "avg_money",
				label: "Average money per turn",
				reach: "source",
				unit: "event",
				agg: { fn: "AVG", sql: "gpt.money_per_turn" },
				note: "Averaged over turn rows.",
			},
		],
		filters: [],
	},
	{
		key: "game_wonder_pool",
		label: "Wonders available",
		table: "game_wonder_pool",
		alias: "gwp",
		grain:
			"One row per wonder enabled in a save — the eligibility denominator, not a completion.",
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
				note: "Distinct (match, wonder) pairs. A save written before parser 2.12.0 has no rows and is absent from this source entirely.",
			},
		],
		filters: [],
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
	help?: string;
	// Present on an identity dimension: the extra column keys its rows carry.
	key_columns?: string[];
}

export interface CatalogMeasureWire {
	key: string;
	label: string;
	unit: MeasureUnit;
	note: string;
}

export interface CatalogFilterWire {
	key: string;
	label: string;
	type: ValueType;
	ops: FilterOp[];
	vocabulary?: string;
	help?: string;
}

export interface CatalogSourceWire {
	key: string;
	label: string;
	grain: string;
	dimensions: CatalogDimensionWire[];
	measures: CatalogMeasureWire[];
	filters: CatalogFilterWire[];
}

export interface CatalogWire {
	sources: CatalogSourceWire[];
	limits: {
		max_rows: number;
		default_rows: number;
		max_dimensions: number;
		max_filters: number;
		max_filter_values: number;
	};
}

export function serializeCatalog(): CatalogWire {
	return {
		sources: SOURCES.map((s) => ({
			key: s.key,
			label: s.label,
			grain: s.grain,
			dimensions: s.dimensions.map((d) => ({
				key: d.key,
				label: d.label,
				type: d.type,
				...(d.vocabulary ? { vocabulary: d.vocabulary } : {}),
				...(d.help ? { help: d.help } : {}),
				...(d.keyColumns
					? { key_columns: d.keyColumns.map((k) => `${d.key}_${k.suffix}`) }
					: {}),
			})),
			measures: s.measures.map((m) => ({
				key: m.key,
				label: m.label,
				unit: m.unit,
				note: m.note,
			})),
			filters: s.filters.map((f) => ({
				key: f.key,
				label: f.label,
				type: f.type,
				ops: [...f.ops],
				...(f.vocabulary ? { vocabulary: f.vocabulary } : {}),
				...(f.help ? { help: f.help } : {}),
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

// Re-exported so the compiler reads the tournament predicate from the one
// place that defines it rather than restating the join through
// tournament_rounds.
export { TOURNAMENT_GAME_IDS_SQL };
