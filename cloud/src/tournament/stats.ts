// Plane A competition stats — tournament-native pure compute.
//
// These aggregate the tournament tables (matches + the parts JSON), never a
// save file. The genuinely pure piece lives here for unit tests beside source;
// the env-taking assembly (computeCompetitionStats) lives in public.ts next to
// computeStandingsResponse, which it reuses.

import { parseParts, type MatchPart, type MatchRow } from "./data";
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
	// Parts parsed once by the caller (shared with loadUserIdentitiesForMatches).
	// Omitted → parsed here (unit tests).
	partsByMatchId?: Map<string, MatchPart[]>,
): CasterLeaderboardEntry[] {
	const byKey = new Map<
		string,
		{ user_id: string | null; name: string | null; appearances: number }
	>();
	for (const m of matches) {
		for (const part of partsByMatchId?.get(m.match_id) ?? parseParts(m)) {
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

// One nation a participant has fielded, with their record on it.
export interface PlayerPickNation {
	nation: string;
	games: number;
	wins: number;
}

// One participant's civ portfolio across the tournament's completed games.
// Keyed like the caster leaderboard (user_id when the slot is claimed, else the
// frozen 0024 snapshot username) so the same person is one row across matches
// and substitutions can't split a claimed player. picks are the nations they've
// fielded, most-used first.
export interface PlayerPicksEntry {
	user_id: string | null;
	name: string | null;
	display_name: string | null;
	avatar_url: string | null;
	picks: PlayerPickNation[];
	total_games: number;
	total_wins: number;
}

// A roster row's nation + win flag, keyed `${game_id}:${player_index}` — the
// save-content half of a pick (loaded by loadPlayerSummaryFieldsForMatches).
export type PickSummary = { nation: string | null; is_winner: number | null };

// Per-participant nation picks across the completed, game-linked matches. Each
// match side maps to a person via the 0024 snapshot (slot_x_user_id/username)
// and to a roster row via slot_x_player_index → player_summaries(game_id,
// player_index), from which we read the nation fielded and whether they won.
// Byes and forfeits carry no eligible game, so only status='complete' matches
// with a game_id contribute (the same corpus filter Plane B1 uses).
//
// Rows are ordered by standings rank (rankBySlotId — the rank of the slot the
// side played as), so the picks read top-down like the standings chart above
// them; a participant with no ranked slot sorts after the ranked ones, then by
// games played. Identity enrichment reuses the batch map the caster leaderboard
// uses — no new user rows load here.
export function computePlayerPicks(
	matches: MatchRow[],
	summaryByGamePlayer: Map<string, PickSummary>,
	identityByUserId: Map<string, UserIdentity>,
	rankBySlotId: Map<string, number>,
): PlayerPicksEntry[] {
	const byKey = new Map<
		string,
		{
			user_id: string | null;
			name: string | null;
			// Best (lowest) standings rank across this participant's played slots;
			// Infinity until a ranked slot is seen. Ordering only — not serialized.
			bestRank: number;
			nations: Map<string, { games: number; wins: number }>;
			total_games: number;
			total_wins: number;
		}
	>();

	for (const m of matches) {
		if (m.status !== "complete" || !m.game_id) continue;
		const sides = [
			{
				slot_id: m.slot_a_id,
				player_index: m.slot_a_player_index,
				user_id: m.slot_a_user_id,
				name: m.slot_a_username,
			},
			{
				slot_id: m.slot_b_id,
				player_index: m.slot_b_player_index,
				user_id: m.slot_b_user_id,
				name: m.slot_b_username,
			},
		];
		for (const side of sides) {
			if (side.player_index == null) continue;
			// user_id when claimed, else the frozen snapshot username.
			const key = side.user_id ?? side.name;
			if (key == null) continue; // no occupant to attribute the pick to
			const summary = summaryByGamePlayer.get(
				`${m.game_id}:${side.player_index}`,
			);
			const nation = summary?.nation;
			if (!nation) continue; // no roster row / unknown nation — nothing to plot
			const won = summary?.is_winner === 1;

			let p = byKey.get(key);
			if (!p) {
				p = {
					user_id: side.user_id,
					name: side.name,
					bestRank: Infinity,
					nations: new Map(),
					total_games: 0,
					total_wins: 0,
				};
				byKey.set(key, p);
			}
			const n = p.nations.get(nation) ?? { games: 0, wins: 0 };
			n.games += 1;
			if (won) n.wins += 1;
			p.nations.set(nation, n);
			p.total_games += 1;
			if (won) p.total_wins += 1;
			const rank = side.slot_id ? rankBySlotId.get(side.slot_id) : undefined;
			if (rank != null && rank < p.bestRank) p.bestRank = rank;
		}
	}

	const out = [...byKey.values()].map((p) => {
		const identity = p.user_id ? identityByUserId.get(p.user_id) : undefined;
		const picks = [...p.nations.entries()]
			.map(([nation, r]) => ({ nation, games: r.games, wins: r.wins }))
			// Dominant civ first; nation name as a stable tiebreak.
			.sort((a, b) => b.games - a.games || a.nation.localeCompare(b.nation));
		return {
			entry: {
				user_id: p.user_id,
				name: p.name,
				display_name: identity?.display_name ?? p.name,
				avatar_url: identity?.avatar_url ?? null,
				picks,
				total_games: p.total_games,
				total_wins: p.total_wins,
			} satisfies PlayerPicksEntry,
			bestRank: p.bestRank,
		};
	});

	// Rank asc (unranked last — Infinity−Infinity is NaN, falsy, so the chain
	// falls through), then most games, then a stable label tiebreak.
	out.sort(
		(a, b) =>
			a.bestRank - b.bestRank ||
			b.entry.total_games - a.entry.total_games ||
			(a.entry.display_name ?? "").localeCompare(b.entry.display_name ?? ""),
	);
	return out.map((o) => o.entry);
}
