import type { TournamentMatch } from "$lib/api-cloud";
import type { TableState } from "$lib/game-detail/helpers";
import { matchSlotUsername } from "./match-occupant";

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
		key: "scheduled_at",
		label: "Scheduled start",
		// Default ordering: scheduled matches first (by date, future → past), then
		// unscheduled, then completed. Encoded as one ascending numeric key —
		// scheduled → -epoch (later dates first), the others → sentinels after them.
		sortValue: (m) => {
			const g = matchStatusGroup(m);
			if (g === "scheduled")
				return -new Date(m.scheduled_at as string).getTime();
			if (g === "unscheduled") return 1e15;
			return 2e15; // completed
		},
	},
	{
		key: "player_a",
		label: "First player",
		sortValue: (m, ctx) =>
			(matchSlotUsername(m, "a", ctx.slotLabels) ?? "").toLowerCase(),
	},
	{
		key: "player_b",
		label: "Second player",
		sortValue: (m, ctx) =>
			(matchSlotUsername(m, "b", ctx.slotLabels) ?? "").toLowerCase(),
	},
	{
		key: "caster",
		label: "Caster",
		sortValue: (m) => (m.caster_name ?? "").toLowerCase(),
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
