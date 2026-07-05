import type {
	TournamentMatch,
	TournamentMatchPart,
	TournamentMatchPartCaster,
	TournamentMatchPartStream,
} from "$lib/api-cloud";
import { formatEnum } from "$lib/utils/formatting";
import {
	matchSlotDisplayName,
	matchSlotNation,
	matchupLabel,
} from "./match-occupant";
import {
	matchDisplayStatus,
	matchParts,
	nextScheduledAt,
	type MatchDisplayStatus,
} from "./parts";

// Shared model for the tournament match table (MatchTable.svelte). One column
// registry, one row shape, and one set of sort/search helpers back all three
// match surfaces (the matches page, the Cast view, the overview's Up Next
// panel) so they can never visually or behaviourally drift.

// The status buckets the matches table filters/sorts by — the same four
// display statuses used on the bracket cards (scheduled / in_progress /
// completed / unscheduled), so the table and bracket never disagree. Byes are
// excluded (auto-resolved, never scheduled or played) — matchDisplayStatus
// returns null for them so they drop out of the table entirely.
export type MatchStatusGroup = MatchDisplayStatus;

export function matchStatusGroup(m: TournamentMatch): MatchStatusGroup | null {
	return matchDisplayStatus(m);
}

// The instant a timed match sorts by: any match with an upcoming part sorts by
// that next sitting (a scheduled match, or a split match mid-schedule whose next
// part is still ahead). Only when no part is still future — the true-overdue
// case — does an in-progress match fall back to its most recently started part,
// since WHEN it went overdue is exactly what an admin chasing reports needs.
// Null for unscheduled/completed — and for the table cell, which renders it for
// overdue rows so "In progress" keeps its timestamp.
export function matchSortInstant(m: TournamentMatch): string | null {
	const group = matchStatusGroup(m);
	if (group !== "scheduled" && group !== "in_progress") return null;
	const next = nextScheduledAt(m);
	if (next) return next;
	let latest: string | null = null;
	for (const p of matchParts(m)) {
		if (p.scheduled_at == null) continue;
		if (Number.isNaN(Date.parse(p.scheduled_at))) continue;
		if (latest === null || p.scheduled_at > latest) latest = p.scheduled_at;
	}
	return latest;
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

// The sitting a row acts on for casters/streams: for a part row, its own part;
// for a match row (the All tab's whole-match census), the match's most recent
// *scheduled* sitting — "who's on now / last" rather than an arbitrary first
// part. Null when a match row has no scheduled sitting yet.
function mostRecentScheduledPart(
	m: TournamentMatch,
): TournamentMatchPart | null {
	let best: TournamentMatchPart | null = null;
	let bestT = -Infinity;
	for (const p of matchParts(m)) {
		if (p.scheduled_at == null) continue;
		const t = Date.parse(p.scheduled_at);
		if (Number.isNaN(t)) continue;
		// >= so equal times keep the later part in list order.
		if (t >= bestT) {
			bestT = t;
			best = p;
		}
	}
	return best;
}

// The sitting whose casters a row shows and whose id the cast controls target.
export function rowPart(row: MatchRow): TournamentMatchPart | null {
	return row.part ?? mostRecentScheduledPart(row.match);
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
// concrete scheduled sitting to act on. Backs both the "needs a caster" flag and
// the inline cast controls (CastControls), so they surface on exactly the same
// rows across every match surface.
export function rowIsPendingSitting(row: MatchRow): boolean {
	return (
		row.match.status === "pending" &&
		row.match.slot_b_id != null &&
		rowPart(row) != null
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
	// Trailing, header-less column for the inline cast buttons (CastControls),
	// right-aligned so they line up across rows. Empty label → its header isn't
	// clickable/sortable.
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
		return n != null && formatEnum(n, "NATION_").toLowerCase().includes(t);
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

// Search + sort + active filter entries for the matches page. Tournament-owned
// (was borrowed from game-detail's cities table) so the two tables can evolve
// independently.
export interface MatchTableState {
	search: string;
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
	search: "",
	sortColumn: "time",
	sortDirection: "asc",
	filters: [],
};
