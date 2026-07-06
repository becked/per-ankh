// Plane A competition stats — tournament-native pure compute.
//
// These aggregate the tournament tables (matches + the parts JSON), never a
// save file. The genuinely pure piece lives here for unit tests beside source;
// the env-taking assembly (computeCompetitionStats) lives in public.ts next to
// computeStandingsResponse, which it reuses.

import { parseParts, type MatchRow } from "./data";
import type { UserIdentity } from "./public";

// One row of the caster leaderboard: how many part-appearances a caster racked
// up across the tournament, with identity resolved for linked users.
export interface CasterLeaderboardEntry {
	// The Per-Ankh user_id when the caster was picked from the roster, else null
	// (a free-text caster). The grouping key is user_id ?? name.
	user_id: string | null;
	// Storage/edit value: canonical username when linked, free text otherwise.
	name: string | null;
	// Rendered label: the linked user's current display name, else the name.
	display_name: string | null;
	// Avatar of the linked user, or null for free-text casters.
	avatar_url: string | null;
	appearances: number;
}

// Tally caster appearances across every part of every match. Each part a caster
// appears on counts once (a match cast across several sittings counts each
// sitting). Grouping is by user_id when the caster is a linked user, else by the
// free-text name — so the same person split across linked and unlinked entries
// (or a renamed unclaimed occupant) can appear twice; an accepted edge that
// mirrors the slot identity model. Identity enrichment reuses the batch map
// serializeMatch builds (loadUserIdentitiesForMatches) — no new user rows load
// here.
export function computeCasterLeaderboard(
	matches: MatchRow[],
	identityByUserId: Map<string, UserIdentity>,
): CasterLeaderboardEntry[] {
	const byKey = new Map<
		string,
		{ user_id: string | null; name: string | null; appearances: number }
	>();
	for (const m of matches) {
		for (const part of parseParts(m)) {
			for (const caster of part.casters) {
				// parseParts drops casters with neither user_id nor name, so the else
				// branch's name is always present.
				const key =
					caster.user_id != null
						? `uid:${caster.user_id}`
						: `name:${caster.name}`;
				const existing = byKey.get(key);
				if (existing) {
					existing.appearances += 1;
				} else {
					byKey.set(key, {
						user_id: caster.user_id,
						name: caster.name,
						appearances: 1,
					});
				}
			}
		}
	}

	const out = [...byKey.values()].map((c) => {
		const identity = c.user_id ? identityByUserId.get(c.user_id) : undefined;
		return {
			user_id: c.user_id,
			name: c.name,
			display_name: identity?.display_name ?? c.name,
			avatar_url: identity?.avatar_url ?? null,
			appearances: c.appearances,
		};
	});
	// Most-active first; a stable label tiebreak keeps equal-appearance casters
	// in a deterministic order.
	out.sort(
		(a, b) =>
			b.appearances - a.appearances ||
			(a.display_name ?? "").localeCompare(b.display_name ?? ""),
	);
	return out;
}
