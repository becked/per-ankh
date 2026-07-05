import type { TournamentMatch, TournamentMatchPart } from "$lib/api-cloud";
import { nowMs } from "$lib/stores/now.svelte";
import {
	CalendarDateTime,
	Time,
	type DateValue,
} from "@internationalized/date";

// Part-aware helpers over a match's scheduled parts (migration 0029). A match
// is one game played across one or more "parts" (sittings); each part carries
// its own time, caster, and stream links. The single-schedule surfaces (schedule
// page, matches table, sesh export) read a match's schedule through these.

export function matchParts(m: TournamentMatch): TournamentMatchPart[] {
	return m.parts ?? [];
}

// A match's status for display, refining the raw match status with parts info:
//   completed    — reported or forfeit.
//   in_progress  — pending, but a scheduled part's time has already passed, so
//                  play has started (single session underway, or split across
//                  sittings) and a result is pending.
//   scheduled    — pending with an upcoming (still-future) part and none started.
//   unscheduled  — pending, no part scheduled at all.
// Byes return null (auto-resolved, nothing to show).
export type MatchDisplayStatus =
	| "completed"
	| "in_progress"
	| "scheduled"
	| "unscheduled";

// Shared chip wording for the display statuses. Unscheduled matches don't get
// a chip (absence of a schedule isn't worth a badge), so it's not listed.
export const MATCH_STATUS_LABEL: Record<
	Exclude<MatchDisplayStatus, "unscheduled">,
	string
> = {
	scheduled: "Scheduled",
	in_progress: "In progress",
	completed: "Completed",
};

export function matchDisplayStatus(
	m: TournamentMatch,
): MatchDisplayStatus | null {
	if (m.status === "complete" || m.status === "forfeit") return "completed";
	if (m.status === "bye") return null;
	if (hasStartedPart(m)) return "in_progress";
	if (isMatchScheduled(m)) return "scheduled";
	return "unscheduled";
}

// True once any scheduled part's time has passed — the match is underway (or
// awaiting its result). Reactive: reads the shared clock (nowMs), so consumers
// reclassify as the current time crosses a part's scheduled instant.
export function hasStartedPart(m: TournamentMatch): boolean {
	const now = nowMs();
	return matchParts(m).some((p) => {
		if (p.scheduled_at == null) return false;
		const t = Date.parse(p.scheduled_at);
		return !Number.isNaN(t) && t <= now;
	});
}

// The next upcoming (still-future) part's instant (ISO-8601 UTC), or null when
// no part is still ahead. A match reads by when it will NEXT be played, so
// parts already in the past are skipped — a fully-past schedule with no result
// shows no time (and reads as in_progress via matchDisplayStatus, which checks
// hasStartedPart first). Reactive: reads the shared clock (nowMs), so a part
// drops out of "next" as its scheduled instant passes.
export function nextScheduledAt(m: TournamentMatch): string | null {
	const now = nowMs();
	let next: string | null = null;
	let nextT = Infinity;
	for (const p of matchParts(m)) {
		if (p.scheduled_at == null) continue;
		const t = Date.parse(p.scheduled_at);
		if (Number.isNaN(t) || t < now) continue; // unparseable or already passed
		if (t < nextT) {
			nextT = t;
			next = p.scheduled_at;
		}
	}
	return next;
}

// A match counts as scheduled once it has an upcoming part still ahead.
export function isMatchScheduled(m: TournamentMatch): boolean {
	return nextScheduledAt(m) != null;
}

// A part's display index within its match (1-based) and whether the match is
// split (≥2 parts). The "(Part K)" label is shown only for split matches — a
// single-session match reads as just "Match NNN".
export interface NumberedPart {
	match: TournamentMatch;
	part: TournamentMatchPart;
	partNumber: number; // 1-based position in the match's parts list
	split: boolean; // true when the match has ≥2 parts
}

// Flatten a match list into its individual scheduled parts, soonest first. Each
// entry knows its match, its 1-based part number, and whether the match is
// split (so callers can decide whether to render the "(Part K)" suffix).
export function scheduledParts(matches: TournamentMatch[]): NumberedPart[] {
	const out: NumberedPart[] = [];
	for (const match of matches) {
		const parts = matchParts(match);
		const split = parts.length >= 2;
		parts.forEach((part, i) => {
			if (part.scheduled_at == null) return;
			out.push({ match, part, partNumber: i + 1, split });
		});
	}
	out.sort((a, b) =>
		(a.part.scheduled_at ?? "").localeCompare(b.part.scheduled_at ?? ""),
	);
	return out;
}

// Combine a part's independent date + time controls into the stored UTC instant
// (ISO-8601) — the single source of truth shared by the editor's live preview
// and the popover's save, so the two can never disagree. A date is required; a
// cleared time defaults to midnight.
export function partToIso(
	date: DateValue | undefined,
	time: Time | undefined,
	tz: string,
): string | null {
	if (!date) return null;
	const t = time ?? new Time(0, 0);
	const dt = new CalendarDateTime(
		date.year,
		date.month,
		date.day,
		t.hour,
		t.minute,
	);
	return dt.toDate(tz).toISOString();
}

// The grace window the caster-facing surfaces use: a sitting stays "upcoming"
// (and so still claimable / still listed as needing a caster) for 2h past its
// start time, because a caster can still hop on to cast a match that began a
// little while ago. Shared so every cast surface uses the identical window.
export const CAST_GRACE_MS = 2 * 60 * 60 * 1000;

// How long after a sitting's scheduled start it still counts as "live" for the
// viewer-facing Live & Upcoming panel — roughly the length of a streamed Old
// World game. A sitting whose start is inside this window is plausibly still
// being broadcast, so it reads as live; once the window closes the game has
// almost certainly finished (and its ephemeral youtube/twitch `…/live` link has
// gone dead), so it ages out of the panel even if nobody has reported the result
// yet. Bounds how long a finished-but-unreported match can linger as "live".
export const LIVE_WINDOW_MS = 4 * 60 * 60 * 1000;

// Upcoming scheduled parts of still-pending, non-bye matches, soonest first.
// graceMs keeps a just-started sitting visible (e.g. the cast surfaces pass
// CAST_GRACE_MS so a match that began 20 minutes ago is still claimable); 0
// means strictly future. The one definition of "upcoming" shared by every
// surface that lists it (sesh export, caster sign-up), so they can't drift.
export function upcomingScheduledParts(
	matches: TournamentMatch[],
	graceMs = 0,
): NumberedPart[] {
	const cutoff = Date.now() - graceMs;
	const pending = matches.filter(
		(m) => m.status === "pending" && m.slot_b_id != null,
	);
	return scheduledParts(pending).filter((np) => {
		const t = Date.parse(np.part.scheduled_at as string);
		return !Number.isNaN(t) && t >= cutoff;
	});
}
