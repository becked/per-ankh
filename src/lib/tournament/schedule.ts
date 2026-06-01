import type { TournamentMatch } from "$lib/api-cloud";

export type ScheduleZone = "utc" | "local";

export interface SchedulePartition {
	// Pending matches that carry a time, soonest first.
	scheduled: TournamentMatch[];
	// Pending matches still awaiting a time (no scheduled_at yet).
	unscheduled: TournamentMatch[];
}

// Splits the match list into the two schedule-page sections. Only pending
// matches are relevant — completed/forfeit/bye matches have already happened.
// scheduled_at is an ISO-8601 instant, so lexical order is chronological.
export function partitionSchedule(
	matches: TournamentMatch[],
): SchedulePartition {
	const pending = matches.filter((m) => m.status === "pending");
	const scheduled = pending
		.filter((m) => m.scheduled_at != null)
		.slice()
		.sort((a, b) => (a.scheduled_at ?? "").localeCompare(b.scheduled_at ?? ""));
	const unscheduled = pending.filter((m) => m.scheduled_at == null);
	return { scheduled, unscheduled };
}

// Calendar bucketing key: the day an instant falls on in the active zone, as
// "YYYY-MM-DD". A 23:00 UTC match lands on a different local day for a western
// viewer, so the key must follow the toggle. "en-CA" yields ISO date order.
export function scheduledDayKey(
	iso: string | null | undefined,
	zone: ScheduleZone,
): string | null {
	if (!iso) return null;
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return null;
	return d.toLocaleDateString("en-CA", {
		timeZone: zone === "utc" ? "UTC" : undefined,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	});
}
