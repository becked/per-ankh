import type { TournamentMatch } from "$lib/api-cloud";
import { scheduledParts, LIVE_WINDOW_MS, type NumberedPart } from "./parts";

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

export interface LiveAndUpcoming {
	// Sittings that have started but are still inside the live window — plausibly
	// still being streamed. Soonest-first.
	live: NumberedPart[];
	// Sittings still ahead. Soonest-first.
	upcoming: NumberedPart[];
}

// Split a tournament's scheduled sittings into the ones live right now and the
// ones still ahead. One definition shared by the overview's Live & Upcoming
// panel and the matches page's Live & Upcoming tab, so the two can't drift.
// `now` is passed in (callers thread the reactive nowMs()) so the result
// recomputes as the clock advances. A sitting is:
//   • upcoming — its start is still in the future.
//   • live     — started within LIVE_WINDOW_MS (plausibly still broadcasting).
//   • aged out — started longer ago than the window: the game has almost
//                certainly finished (and its ephemeral `…/live` link died), so
//                it belongs to neither list and drops off the schedule entirely.
// Both lists inherit partitionSchedule's soonest-first order.
export function liveAndUpcoming(
	matches: TournamentMatch[],
	now: number,
): LiveAndUpcoming {
	const live: NumberedPart[] = [];
	const upcoming: NumberedPart[] = [];
	for (const np of partitionSchedule(matches).scheduled) {
		const t = Date.parse(np.part.scheduled_at ?? "");
		if (Number.isNaN(t)) continue;
		if (t > now) upcoming.push(np);
		else if (t > now - LIVE_WINDOW_MS) live.push(np);
	}
	return { live, upcoming };
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
