import type {
	TournamentDetail,
	TournamentMatch,
	TournamentMatchPart,
	TournamentMatchPartCaster,
	TournamentMatchPartStream,
} from "$lib/api-cloud";
import { formatEnum } from "$lib/utils/formatting";
import { matchBracketLabel } from "./bracket-label";
import { mapPoolLabel, poolEntryById } from "./map-script-options";
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

// The caster shown for a row: the specific sitting's streamer for a part row,
// else the first caster across all sittings for a match row. The cell and the
// sort read this one definition so they can't disagree.
export function rowCaster(
	row: MatchRow,
): TournamentMatchPartCaster | undefined {
	if (row.part) return row.part.casters[0];
	return matchParts(row.match).find((p) => p.casters.length > 0)?.casters[0];
}

// The stream link shown for a row, with the same part-vs-match rule as rowCaster.
export function rowStream(
	row: MatchRow,
): TournamentMatchPartStream | undefined {
	if (row.part) return row.part.streams[0];
	return matchParts(row.match)
		.flatMap((p) => p.streams)
		.at(0);
}

// The instant a row displays/sorts by: the sitting's own time for a part row,
// else the match's next-sitting/overdue instant.
export function rowInstant(row: MatchRow): string | null {
	return row.part ? row.part.scheduled_at : matchSortInstant(row.match);
}

// ─── Columns ─────────────────────────────────────────────────────────

// Context the sort comparators (and the map/bracket cells) need beyond the row
// itself: the live slot→name map for the matchup column, and the tournament for
// bracket/map resolution. `tournament`/`distinguishing` are optional because the
// surfaces that sort (the matches page) don't sort by those columns.
export interface MatchSortContext {
	slotLabels: Record<string, string>;
	tournament?: TournamentDetail;
	distinguishing?: ReadonlySet<string>;
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
	number: {
		key: "number",
		label: "#",
		sortValue: (row) => row.match.match_number ?? null,
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
	bracket: {
		key: "bracket",
		label: "Bracket",
		sortValue: (row, ctx) =>
			ctx.tournament
				? matchBracketLabel(ctx.tournament, row.match).toLowerCase()
				: "",
	},
	map: {
		key: "map",
		label: "Map",
		sortValue: (row, ctx) => {
			if (!ctx.tournament) return "";
			const entry = poolEntryById(
				ctx.tournament.map_pool,
				row.match.map_pool_id,
			);
			return entry
				? mapPoolLabel(
						entry,
						ctx.distinguishing ?? new Set(),
						true,
					).toLowerCase()
				: "";
		},
	},
	caster: {
		key: "caster",
		label: "Caster",
		sortValue: (row) => {
			const c = rowCaster(row);
			return (c?.display_name ?? c?.name ?? "").toLowerCase();
		},
	},
	stream: {
		key: "stream",
		label: "Streams",
		sortValue: (row) => (rowStream(row) ? 1 : 0),
	},
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
