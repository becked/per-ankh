import type { TournamentMatch } from "$lib/api-cloud";
import type { TableState } from "$lib/game-detail/helpers";
import { matchSlotDisplayName } from "./match-occupant";

// The three status buckets the matches table can show. Byes are excluded
// (auto-resolved, never scheduled or played) — matchStatusGroup returns null
// for them so they drop out of the table entirely.
export type MatchStatusGroup = "scheduled" | "unscheduled" | "completed";

export function matchStatusGroup(m: TournamentMatch): MatchStatusGroup | null {
	if (m.status === "pending") {
		return m.scheduled_at != null ? "scheduled" : "unscheduled";
	}
	if (m.status === "complete" || m.status === "forfeit") return "completed";
	return null; // bye
}

// Caster presence, as a filter group parallel to the status toggle: a match
// either has a caster assigned or it doesn't.
export type MatchCasterGroup = "casted" | "uncasted";

export function matchCasterGroup(m: TournamentMatch): MatchCasterGroup {
	return m.caster_display_name ? "casted" : "uncasted";
}

// Context the sort comparators need beyond the match itself: the live slot→name
// map (player-name columns) and the bracket label fn (depends on the tournament's
// division names, so it's supplied by the page rather than hardcoded here).
export interface MatchSortContext {
	slotLabels: Record<string, string>;
	phaseLabel: (m: TournamentMatch) => string;
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
		sortValue: (m, ctx) => {
			const a = matchSlotDisplayName(m, "a", ctx.slotLabels) ?? "";
			const b = matchSlotDisplayName(m, "b", ctx.slotLabels) ?? "";
			return `${a} v ${b}`.toLowerCase();
		},
	},
	{
		key: "scheduled_at",
		label: "Scheduled start",
		// Only scheduled matches get a sort key (-epoch → later dates first).
		// Unscheduled and completed return null so the comparator's nulls-last
		// rule — which runs before the asc/desc flip — pins them to the bottom in
		// both sort directions rather than floating them to the top on descending.
		sortValue: (m) => {
			const g = matchStatusGroup(m);
			if (g === "scheduled")
				return -new Date(m.scheduled_at as string).getTime();
			return null; // unscheduled + completed → always last
		},
	},
	{
		key: "bracket",
		label: "Bracket",
		sortValue: (m, ctx) => ctx.phaseLabel(m).toLowerCase(),
	},
	{
		key: "round",
		label: "Round",
		sortValue: (m) => m.round_number ?? null,
	},
	{
		key: "caster",
		label: "Caster",
		sortValue: (m) => (m.caster_display_name ?? "").toLowerCase(),
	},
	{
		key: "stream",
		label: "Stream",
		sortValue: (m) => (m.stream_url ? 1 : 0),
	},
];

export const DEFAULT_MATCHES_TABLE_STATE: TableState = {
	search: "",
	sortColumn: "scheduled_at",
	sortDirection: "asc",
	filters: [],
};
