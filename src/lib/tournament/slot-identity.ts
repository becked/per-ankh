import type { BracketResponse, StandingsResponse } from "$lib/api-cloud";

// Per-slot identity lookups (display name / linked user / avatar) keyed by
// slot_id. A slot can appear in both the Swiss standings and the championship
// bracket during the championship phase, so each map unions the two sources —
// the bracket entry wins on overlap (it's the later, more authoritative
// snapshot).
export interface SlotMaps {
	labels: Record<string, string>;
	userIds: Record<string, string | null>;
	avatars: Record<string, string | null>;
	// Each slot's signup answer (timezone/availability), admin-only — null for
	// non-admin viewers and slots that never answered. Only the Swiss standings
	// carry it (the bracket doesn't), so it's keyed off standings alone.
	signupAnswers: Record<string, string | null>;
}

// Builds the slot identity maps consumed by the match detail popover and the
// schedule rows. Union of per-division Swiss standings and bracket slots; only
// real display names land in `labels` (callers fall back to a truncated slot
// id).
export function buildSlotMaps(
	standings: StandingsResponse,
	bracket: BracketResponse,
): SlotMaps {
	const labels: Record<string, string> = {};
	const userIds: Record<string, string | null> = {};
	const avatars: Record<string, string | null> = {};
	const signupAnswers: Record<string, string | null> = {};

	for (const div of ["A", "B"] as const) {
		for (const s of standings.divisions[div].standings) {
			if (s.display_name) labels[s.slot_id] = s.display_name;
			userIds[s.slot_id] = s.user_id;
			avatars[s.slot_id] = s.avatar_url;
			signupAnswers[s.slot_id] = s.signup_answer;
		}
	}
	for (const s of bracket.slots) {
		if (s.display_name) labels[s.slot_id] = s.display_name;
		userIds[s.slot_id] = s.user_id;
		avatars[s.slot_id] = s.avatar_url;
	}

	return { labels, userIds, avatars, signupAnswers };
}
