import type { TournamentMatch, TournamentMatchPart } from "$lib/api-cloud";

// Part-aware helpers over a match's scheduled parts (migration 0029). A match
// is one game played across one or more "parts" (sittings); each part carries
// its own time, caster, and VOD links. The single-schedule surfaces (schedule
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
// awaiting its result). Recomputed at render (depends on now).
export function hasStartedPart(m: TournamentMatch): boolean {
	const now = Date.now();
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
// hasStartedPart first). Recomputed at render (depends on now).
export function nextScheduledAt(m: TournamentMatch): string | null {
	const now = Date.now();
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

// The label to render for a VOD link: the author's tag when set, else a hint
// from the host ("YouTube"/"Twitch"), else a bare "VOD".
export function vodDisplayLabel(vod: {
	url: string;
	label: string | null;
}): string {
	if (vod.label && vod.label.trim()) return vod.label.trim();
	try {
		const host = new URL(vod.url).hostname.replace(/^(www|m)\./, "");
		if (host.includes("youtu")) return "YouTube";
		if (host.includes("twitch")) return "Twitch";
	} catch {
		/* fall through to the generic label */
	}
	return "VOD";
}
