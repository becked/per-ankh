import type { BracketResponse, TournamentMatch } from "$lib/api-cloud";

// Walk the bracket payload and synthesize one TournamentMatch per future
// round cell the backend hasn't generated yet. Future rounds are materialized
// server-side only after the prior round fully reports — so the bracket
// tree's render and the page-level match-popover lookup both need a
// client-side projection of those cells (e.g. the final between the two
// semifinal winners, before both semis report). A synthesized cell carries
// `is_placeholder=true`; its slot ids prefill from the corresponding feeder
// match's `winner_slot_id` when that feeder is decided, otherwise stay null
// and render as "TBD" downstream.
//
// Returns one TournamentMatch per synthetic cell, flat (callers can re-group
// by round_number if needed). Returns an empty list when the bracket has no
// rounds yet — nothing to synthesize from.
export function synthesizeChampionshipPlaceholders(
	bracket: BracketResponse,
): TournamentMatch[] {
	const real = [...bracket.rounds].sort(
		(a, b) => a.round_number - b.round_number,
	);
	if (real.length === 0) return [];

	const r1Count = real[0].matches.length;
	const totalRounds = Math.round(Math.log2(r1Count)) + 1;
	if (real.length >= totalRounds) return [];

	const out: TournamentMatch[] = [];
	// Track each round's match list as we go so later synthesized rounds can
	// feed off earlier synthesized rounds.
	const matchesByRoundIndex: {
		winner_slot_id: string | null;
		match_id: string;
	}[][] = real.map((r) =>
		r.matches.map((m) => ({
			winner_slot_id: m.winner_slot_id,
			match_id: m.match_id,
		})),
	);

	for (
		let roundNumber = real.length + 1;
		roundNumber <= totalRounds;
		roundNumber++
	) {
		const prior = matchesByRoundIndex[roundNumber - 2];
		const synthRound: { winner_slot_id: string | null; match_id: string }[] =
			[];
		for (let k = 0; k < prior.length / 2; k++) {
			const feederA = prior[2 * k];
			const feederB = prior[2 * k + 1];
			const matchId = `placeholder-r${roundNumber}-m${k}`;
			synthRound.push({ winner_slot_id: null, match_id: matchId });
			out.push({
				match_id: matchId,
				round_number: roundNumber,
				phase: "championship",
				division: null,
				slot_a_id: feederA?.winner_slot_id ?? "",
				slot_b_id: feederB?.winner_slot_id ?? null,
				map_pool_id: null,
				map_script: null,
				pick_order_winner_slot_id: null,
				status: "pending",
				winner_slot_id: null,
				game_id: null,
				reported_by_user_id: null,
				reported_at: null,
				notes: null,
				slot_a_username: null,
				slot_a_user_id: null,
				slot_a_avatar_url: null,
				slot_a_nation: null,
				slot_b_username: null,
				slot_b_user_id: null,
				slot_b_avatar_url: null,
				slot_b_nation: null,
				is_placeholder: true,
			});
		}
		matchesByRoundIndex.push(synthRound);
	}
	return out;
}
