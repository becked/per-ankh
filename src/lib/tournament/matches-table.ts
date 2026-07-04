import type { TournamentMatch } from "$lib/api-cloud";
import type { TableState } from "$lib/game-detail/helpers";
import { matchSlotDisplayName, matchupLabel } from "./match-occupant";
import {
	matchDisplayStatus,
	matchParts,
	nextScheduledAt,
	type MatchDisplayStatus,
} from "./parts";

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

// Context the sort comparators need beyond the match itself: the live slot→name
// map, for the player-name column.
export interface MatchSortContext {
	slotLabels: Record<string, string>;
}

export interface MatchColumn {
	key: string;
	label: string;
	sortValue: (
		m: TournamentMatch,
		ctx: MatchSortContext,
	) => string | number | null;
}

// Column identity + sort values only; the bespoke cell markup (crests, avatars,
// stream links) lives in the page, mirroring how the Cities tab splits column
// config from rendering. Order here is the rendered column order.
export const MATCH_COLUMNS: MatchColumn[] = [
	{
		key: "match",
		label: "Match",
		// One matchup column ("A v B"); sorts by the pairing text so the two
		// players sort together. Byes never reach the table (filtered out), so
		// both sides always resolve to a real name here.
		sortValue: (m, ctx) =>
			matchupLabel(
				m,
				(side) => matchSlotDisplayName(m, side, ctx.slotLabels) ?? "",
			).toLowerCase(),
	},
	{
		key: "scheduled_at",
		label: "Scheduled start",
		// Timed matches (in-progress or scheduled) sort by their instant — the
		// default ascending read is a natural timeline: live/overdue first, then
		// upcoming soonest-first. Unscheduled and completed return null so the
		// comparator's nulls-last rule — which runs before the asc/desc flip —
		// pins them to the bottom in both sort directions rather than floating
		// them to the top on descending.
		sortValue: (m) => {
			const instant = matchSortInstant(m);
			return instant ? new Date(instant).getTime() : null;
		},
	},
	{
		key: "caster",
		label: "Caster",
		// Sorts by the first caster (the streamer) across the match's parts.
		sortValue: (m) => {
			const first = matchParts(m).find((p) => p.casters.length > 0)?.casters[0];
			return (first?.display_name ?? first?.name ?? "").toLowerCase();
		},
	},
	{
		key: "streams",
		label: "Streams",
		sortValue: (m) => (matchParts(m).some((p) => p.streams.length > 0) ? 1 : 0),
	},
];

export const DEFAULT_MATCHES_TABLE_STATE: TableState = {
	search: "",
	sortColumn: "scheduled_at",
	sortDirection: "asc",
	filters: [],
};
