import type { TournamentMatch } from "$lib/api-cloud";
import { scheduledParts, type NumberedPart } from "./parts";

export type ScheduleZone = "utc" | "local";

export interface SchedulePartition {
	// Individual scheduled parts of pending matches, soonest first. A match
	// split across several days contributes one entry per scheduled part.
	scheduled: NumberedPart[];
}

// The calendar's data: every scheduled part of a still-pending match, flattened
// so a multi-part match appears on each day it's played. Completed/forfeit/bye
// matches have already happened and stay off the calendar.
export function partitionSchedule(
	matches: TournamentMatch[],
): SchedulePartition {
	const pending = matches.filter((m) => m.status === "pending");
	return { scheduled: scheduledParts(pending) };
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
