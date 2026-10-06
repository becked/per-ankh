import type {
	MapPoolEntry,
	TournamentMatch,
	TournamentMatchPart,
	TournamentMatchPartCaster,
	TournamentMatchPartStream,
	UserMe,
} from "$lib/api-cloud";
import { nationName } from "$lib/utils/formatting";
import {
	isMatchParticipant,
	matchSlotDisplayName,
	matchSlotNation,
	matchupLabel,
} from "./match-occupant";
import {
	matchDisplayStatus,
	matchParts,
	matchSittingPart,
	type MatchDisplayStatus,
} from "./parts";

// Shared model for the tournament match table (MatchTable.svelte). One column
// registry, one row shape, and one set of sort/search helpers back every match
// surface (the matches page, the Cast view, the overview's Up Next and Next
// Match panels) so they can never visually or behaviourally drift.

// The status buckets the matches table filters/sorts by — the same four
// display statuses used on the bracket cards (scheduled / in_progress /
// completed / unscheduled), so the table and bracket never disagree. Byes are
// excluded (auto-resolved, never scheduled or played) — matchDisplayStatus
// returns null for them so they drop out of the table entirely.
export type MatchStatusGroup = MatchDisplayStatus;

export function matchStatusGroup(m: TournamentMatch): MatchStatusGroup | null {
	return matchDisplayStatus(m);
}

// The instant a timed match sorts by: the time of the sitting the match reads by
// (matchSittingPart) — the next one still ahead for a scheduled match or a split
// match mid-schedule, falling back to the most recently started one in the
// true-overdue case, since WHEN it went overdue is exactly what an admin chasing
// reports needs. Null for unscheduled/completed — and for the table cell, which
// renders it for overdue rows so "In progress" keeps its timestamp.
export function matchSortInstant(m: TournamentMatch): string | null {
	const group = matchStatusGroup(m);
	if (group !== "scheduled" && group !== "in_progress") return null;
	return matchSittingPart(m)?.scheduled_at ?? null;
}

// ─── Tournament context ──────────────────────────────────────────────
//
// Everything the table (MatchTable + CastControls) reads off the tournament a
// row belongs to: the two division names (matchBracketLabel), the map pool (the
// map label under the matchup), and the id the inline cast controls post to.
//
// Declared here rather than beside the wire types because it's the table's prop
// contract, not any endpoint's response: satisfied structurally, so the
// per-tournament surfaces keep passing their whole `TournamentDetail` while a
// surface spanning tournaments (the player profile's Tournaments tab) hands each
// group its own compact context. Adding a field here is a change to what the
// table needs — it must not double as an edit to a documented response shape.
export interface MatchTableTournament {
	tournament_id: string;
	division_a_name: string;
	division_b_name: string;
	map_pool: MapPoolEntry[];
}

// ─── Rows ────────────────────────────────────────────────────────────
//
// A single table row. Two granularities share one shape:
//   • match row — `part` is null; the row stands for the whole match. This is
//     the matches page's census: it includes unscheduled and completed matches,
//     which have no single meaningful sitting time.
//   • part row  — `part` is a specific sitting; the row stands for one scheduled
//     sitting (the cast + up-next surfaces, where a split match legitimately
//     appears once per sitting). A NumberedPart is structurally a part row, so
//     those callers pass their existing NumberedPart[] straight through.
export interface MatchRow {
	match: TournamentMatch;
	part: TournamentMatchPart | null;
	partNumber: number | null; // 1-based sitting index; null for match rows
	split: boolean; // match has ≥2 sittings
}

// One row per non-bye match (byes auto-resolve — matchStatusGroup filters them
// to null so they never reach the table).
export function toMatchRows(matches: TournamentMatch[]): MatchRow[] {
	return matches
		.filter((m) => matchStatusGroup(m) !== null)
		.map((m) => ({
			match: m,
			part: null,
			partNumber: null,
			split: matchParts(m).length >= 2,
		}));
}

// The sitting whose casters a row shows and whose id the cast controls target:
// for a part row, its own part; for a match row (the All tab's whole-match
// census), the sitting the match reads by — the same one its time cell names,
// because a row that advertises one sitting's time beside another's casters is
// telling a player their casted game needs a caster. Null when a match row has
// no scheduled sitting yet.
export function rowPart(row: MatchRow): TournamentMatchPart | null {
	return row.part ?? matchSittingPart(row.match);
}

// The casters shown for a row (streamer first, then co-casters), from the row's
// acted-on sitting. Empty when there's no caster (or no scheduled sitting).
export function rowCasters(row: MatchRow): TournamentMatchPartCaster[] {
	return rowPart(row)?.casters ?? [];
}

// The streams shown for a row: the sitting's own streams for a part row, else
// every sitting's streams (in part order) for a match row. The cell puts the
// first stream on the main line beside the caster and stacks the rest — a
// match's extra POVs/VODs, often labeled "part 2", "part 3" — as subtext below.
export function rowStreams(row: MatchRow): TournamentMatchPartStream[] {
	if (row.part) return row.part.streams;
	return matchParts(row.match).flatMap((p) => p.streams);
}

// Whether a row is a still-castable sitting: a pending, non-bye match with a
// concrete scheduled sitting to act on. Backs the "needs a caster" flag and the
// inline cast controls (CastControls), so they surface on the same rows across
// every match surface — the buttons additionally excluding the viewer's own
// match (rowIsCastableByViewer). The flag stays on it either way: the match
// genuinely does need a caster, just not that player.
export function rowIsPendingSitting(row: MatchRow): boolean {
	return (
		row.match.status === "pending" &&
		row.match.slot_b_id != null &&
		rowPart(row) != null
	);
}

// The two branches of the actions column. They split on whether the row has a
// time yet, so they can never both match: a match awaiting one gets Schedule,
// a scheduled sitting gets the cast buttons. Casting an unscheduled match is
// meaningless — there's nothing to turn up for — which is why the schedule side
// is the one that owns the no-time-yet row.

// Whether the viewer may set this row's time: a pending, non-bye match with no
// scheduled sitting at all, acted on by one of its two players or by a
// tournament admin (who schedules the whole field, not just their own game).
// Placeholder cells have no match row to PATCH, and a bye has no second player,
// so both are excluded (as `pending` already excludes every decided status).
export function rowCanSchedule(
	row: MatchRow,
	slotUserIds: Record<string, string | null>,
	user: UserMe | null,
	isAdmin: boolean,
): boolean {
	return (
		row.match.is_placeholder !== true &&
		row.match.status === "pending" &&
		row.match.slot_b_id != null &&
		rowPart(row) == null &&
		(isAdmin || isMatchParticipant(row.match, slotUserIds, user))
	);
}

// Whether the viewer may cast this row's sitting: a still-castable sitting they
// aren't playing in. Casting is third-party — a player can't cast their own
// game, and the worker rejects it with 403 PARTICIPANT_CANNOT_CAST — so the
// buttons come off your own match while the "needs a caster" flag stays on it.
// Admins are not excluded: an admin who isn't playing casts like anyone else,
// which is what keeps the Cast view usable for the people who run it.
export function rowIsCastableByViewer(
	row: MatchRow,
	slotUserIds: Record<string, string | null>,
	user: UserMe | null,
): boolean {
	return (
		rowIsPendingSitting(row) &&
		!isMatchParticipant(row.match, slotUserIds, user)
	);
}

// The instant a row displays/sorts by: the sitting's own time for a part row,
// else the match's next-sitting/overdue instant.
export function rowInstant(row: MatchRow): string | null {
	return row.part ? row.part.scheduled_at : matchSortInstant(row.match);
}

// ─── Columns ─────────────────────────────────────────────────────────

// Context the sort comparators need beyond the row itself: the live slot→name
// map, for the matchup column. (Match number, bracket, and map render inside the
// Match cell rather than as sortable columns, so nothing else is needed here.)
export interface MatchSortContext {
	slotLabels: Record<string, string>;
}

// ─── Table chrome ────────────────────────────────────────────────────
//
// The framed-box table treatment MatchTable renders with: a raised header bar
// (surface-raised-hover, deliberately *lighter* than both zebra tones so it
// reads as chrome and never blends into a stripe — the page itself is the
// ramp's darkest tone), a contiguous zebra body with no per-cell rounding, and
// transparent cells so the row's stripe shows through.
//
// Named here, next to the column registry that decides what goes in them, so
// the table's structure and its chrome are edited in one place. MatchTable is
// the only consumer and layers its sticky/sortable modifiers on top.
export const MATCH_TABLE_TH_CLASS =
	"select-none whitespace-nowrap border-b border-black bg-surface-raised-hover px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-gray-100 shadow-lg";

// align-top so the multi-line Match/Time/Casters cells don't vertically center
// the shorter cells beside them.
export const MATCH_TABLE_TD_CLASS =
	"whitespace-nowrap px-3 py-2 text-left align-top text-tan";

// The <tr> carries the stripe + hover background (the cells stay transparent).
export const MATCH_TABLE_ROW_CLASS =
	"transition-colors odd:bg-surface even:bg-surface-raised hover:bg-surface-hover";

// The framed box the table sits in — rounded border on the wrapper, scroll
// contained so a wide table never widens the page.
export const MATCH_TABLE_FRAME_CLASS =
	"overflow-x-auto rounded-lg border border-black";

// Column identity + sort value only; the bespoke cell markup (crests, avatars,
// caster chips, stream links, action buttons) lives in MatchTable.svelte, keyed
// off `key`. Mirrors how the Cities tab splits column config from rendering.
export interface MatchColumn {
	key: string;
	label: string;
	sortValue: (row: MatchRow, ctx: MatchSortContext) => string | number | null;
}

// The full column registry. Each surface picks the subset it shows (in order)
// via pickColumns; the shared component renders whatever it's handed.
export const MATCH_COLUMN_DEFS: Record<string, MatchColumn> = {
	// The global "Match N" handle as its own sortable column (the stats page's
	// match list defaults to it). When present, the Match cell drops its inline
	// number so the handle isn't shown twice. Unnumbered matches (legacy)
	// pin last via the comparator's nulls-last rule.
	number: {
		key: "number",
		label: "#",
		sortValue: (row) => row.match.match_number,
	},
	matchup: {
		key: "matchup",
		label: "Match",
		// Sorts by the pairing text so the two players sort together. Byes never
		// reach the table (filtered out), so both sides resolve to a real name.
		sortValue: (row, ctx) =>
			matchupLabel(
				row.match,
				(side) => matchSlotDisplayName(row.match, side, ctx.slotLabels) ?? "",
			).toLowerCase(),
	},
	time: {
		key: "time",
		label: "Scheduled start",
		// Timed rows sort by their instant — the default ascending read is a
		// natural timeline: live/overdue first, then upcoming soonest-first.
		// Unscheduled/completed match rows return null so the comparator's
		// nulls-last rule pins them to the bottom in both directions.
		sortValue: (row) => {
			const iso = rowInstant(row);
			return iso ? new Date(iso).getTime() : null;
		},
	},
	// Casters + streams on one line ("{stream} by {caster}"), plus the "needs a
	// caster" flag (MatchTable renders the cell; the cast buttons live in the
	// separate actions column). Sorts by the streamer's name — the most-recent
	// scheduled sitting's for a match row — with casterless rows pinned last by
	// the comparator's nulls-last rule.
	broadcast: {
		key: "broadcast",
		label: "Casters & Streams",
		sortValue: (row) => {
			const c = rowCasters(row)[0];
			const name = c?.display_name ?? c?.name;
			return name ? name.toLowerCase() : null;
		},
	},
	// Link to the uploaded save's game page — the row's clickable access to the
	// game itself. Sorts by when the result landed (reported_at), most useful
	// descending; game-less rows (pending, forfeit without a save) pin last via
	// the comparator's nulls-last rule.
	game: {
		key: "game",
		label: "Game",
		sortValue: (row) =>
			row.match.game_id != null ? (row.match.reported_at ?? "") : null,
	},
	// Trailing, header-less column for the inline action buttons (the schedule
	// editor on your own pending match, else the cast buttons), right-aligned so
	// they line up across rows. Empty label → its header isn't clickable/sortable.
	actions: {
		key: "actions",
		label: "",
		sortValue: () => null,
	},
};

// Resolve an ordered list of column keys to their definitions (unknown keys
// dropped), preserving order.
export function pickColumns(keys: readonly string[]): MatchColumn[] {
	return keys.map((k) => MATCH_COLUMN_DEFS[k]).filter(Boolean);
}

// ─── Search + sort ───────────────────────────────────────────────────

// The matches page's free-text search over a row: either player's live name or
// played nation, or any sitting's caster. Match rows search across all sittings;
// part rows carry the whole match, so the same walk applies either way.
export function matchRowMatchesSearch(
	row: MatchRow,
	term: string,
	slotLabels: Record<string, string>,
): boolean {
	const t = term.toLowerCase();
	const m = row.match;
	const nameHit = (side: "a" | "b") =>
		(matchSlotDisplayName(m, side, slotLabels) ?? "").toLowerCase().includes(t);
	const nationHit = (side: "a" | "b") => {
		const n = matchSlotNation(m, side);
		return n != null && nationName(n).toLowerCase().includes(t);
	};
	return (
		nameHit("a") ||
		nameHit("b") ||
		nationHit("a") ||
		nationHit("b") ||
		matchParts(m).some((p) =>
			p.casters.some((c) =>
				(c.display_name ?? c.name ?? "").toLowerCase().includes(t),
			),
		)
	);
}

// Status faceting for MatchTableState.filters: keep rows whose display-status
// bucket is among the active keys. An empty selection means "no filter" — every
// row shows (the same convention the game-detail tables give the field), so
// toggling the last chip off widens to everything rather than emptying the
// table.
export function filterMatchRows(
	rows: MatchRow[],
	filters: string[],
): MatchRow[] {
	if (filters.length === 0) return rows;
	return rows.filter((row) => {
		const group = matchStatusGroup(row.match);
		return group !== null && filters.includes(group);
	});
}

// The matches table comparator: nulls last (applied before the asc/desc flip so
// they stay pinned to the bottom in either direction), localeCompare for
// strings, numeric diff otherwise.
export function sortMatchRows(
	rows: MatchRow[],
	sortColumn: string,
	direction: "asc" | "desc",
	ctx: MatchSortContext,
): MatchRow[] {
	const column = MATCH_COLUMN_DEFS[sortColumn];
	if (!column) return rows;
	return [...rows].sort((a, b) => {
		const av = column.sortValue(a, ctx);
		const bv = column.sortValue(b, ctx);
		if (av == null && bv == null) return 0;
		if (av == null) return 1;
		if (bv == null) return -1;
		const cmp =
			typeof av === "string" && typeof bv === "string"
				? av.localeCompare(bv)
				: (av as number) - (bv as number);
		return direction === "asc" ? cmp : -cmp;
	});
}

// ─── Table state ─────────────────────────────────────────────────────

// Sort + active filter entries for the matches page. Tournament-owned (was
// borrowed from game-detail's cities table) so the two tables can evolve
// independently. Search is not table-scoped here — it's page-level state shared
// across the matches page's view tabs (live/all/cast), so it lives there.
export interface MatchTableState {
	sortColumn: string;
	sortDirection: "asc" | "desc";
	filters: string[];
}

// Header click: flip direction on the active column, else switch column (asc).
export function toggleMatchSort(
	state: MatchTableState,
	columnKey: string,
): void {
	if (state.sortColumn === columnKey) {
		state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
	} else {
		state.sortColumn = columnKey;
		state.sortDirection = "asc";
	}
}

export const DEFAULT_MATCHES_TABLE_STATE: MatchTableState = {
	sortColumn: "time",
	sortDirection: "asc",
	filters: [],
};
