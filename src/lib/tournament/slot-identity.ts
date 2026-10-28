import type { BracketResponse, StandingsResponse } from "$lib/api-cloud";
import { formatTimeZone } from "$lib/utils/formatting";

// Per-slot identity lookups (display name / linked user / avatar) keyed by
// slot_id. A slot can appear in both the Swiss standings and the championship
// bracket during the championship phase, so each map unions the two sources —
// the bracket entry wins on overlap (it's the later, more authoritative
// snapshot).
export interface SlotMaps {
	labels: Record<string, string>;
	userIds: Record<string, string | null>;
	// Each linked user's profile slug — the companion to `userIds` that
	// lets a link resolve straight to /u/<slug> instead of the id URL's 307.
	// Null for an unclaimed slot and for an occupant who has none;
	// either way the pair still renders (ProfileLink falls back to the id).
	slugs: Record<string, string | null>;
	avatars: Record<string, string | null>;
	// What the scheduling DM prints as each slot occupant's timezone — see
	// schedulingZone below for the order. Admin-only (the server nulls both
	// halves of it for everyone else) and null when nothing is known, which is
	// where the DM says "(timezone TBD)".
	schedulingZones: Record<string, string | null>;
}

// The timezone line the scheduling DM pairs with a player's name.
//
// `timezone` arrives already resolved account-first by the worker (slotTimezone
// in cloud/src/tournament/data.ts), so the one choice left here is the fallback
// to the free-text signup answer — which is the only thing this DM ever had
// before the zone columns existed, and still the only thing a tournament that
// never asked for a zone can offer. An IANA zone is written out with its
// abbreviation and offset, because stating the offset is the point of storing
// a zone instead of whatever label the player typed.
function schedulingZone(slot: {
	timezone: string | null;
	signup_answer?: string | null;
}): string | null {
	if (slot.timezone !== null) return formatTimeZone(slot.timezone);
	const answer = slot.signup_answer?.trim();
	return answer != null && answer.length > 0 ? answer : null;
}

// The standings half of the maps, on its own — everything the Swiss standings
// know about who holds each slot.
//
// Separate from buildSlotMaps because a caller that has no bracket to overlay
// still needs the names: a pending match comes back from
// GET /tournaments/:id/matches with slot_a_display_name / slot_b_display_name
// NULL (the payload snapshots those at report time), so any surface listing
// upcoming sittings has to look the occupants up. The home page's Upcoming
// panel is one, and it reads this rather than passing an empty bracket in —
// a synthetic `{ slots: [] }` would be a shape the API never returns, and
// re-walking the divisions locally would be the same loop twice.
export function slotMapsFromStandings(standings: StandingsResponse): SlotMaps {
	const labels: Record<string, string> = {};
	const userIds: Record<string, string | null> = {};
	const slugs: Record<string, string | null> = {};
	const avatars: Record<string, string | null> = {};
	const schedulingZones: Record<string, string | null> = {};

	for (const div of ["A", "B"] as const) {
		for (const s of standings.divisions[div].standings) {
			if (s.display_name) labels[s.slot_id] = s.display_name;
			userIds[s.slot_id] = s.user_id;
			slugs[s.slot_id] = s.slug;
			avatars[s.slot_id] = s.avatar_url;
			schedulingZones[s.slot_id] = schedulingZone(s);
		}
	}

	return { labels, userIds, slugs, avatars, schedulingZones };
}

// Builds the slot identity maps consumed by the match detail popover and the
// schedule rows. Union of per-division Swiss standings and bracket slots; only
// real display names land in `labels` (callers fall back to a truncated slot
// id).
export function buildSlotMaps(
	standings: StandingsResponse,
	bracket: BracketResponse,
): SlotMaps {
	const { labels, userIds, slugs, avatars, schedulingZones } =
		slotMapsFromStandings(standings);

	// The bracket wins on overlap — it's the later, more authoritative
	// snapshot — which is why the overlay runs second rather than the two
	// sources merging. A championship slot is a different slot_id from the
	// Swiss seat its occupant came from, so in practice this adds entries
	// rather than replacing them; its zone has no signup answer behind it
	// (the transition copies neither) and resolves from the account alone.
	for (const s of bracket.slots) {
		if (s.display_name) labels[s.slot_id] = s.display_name;
		userIds[s.slot_id] = s.user_id;
		slugs[s.slot_id] = s.slug;
		avatars[s.slot_id] = s.avatar_url;
		schedulingZones[s.slot_id] = schedulingZone(s);
	}

	return { labels, userIds, slugs, avatars, schedulingZones };
}
