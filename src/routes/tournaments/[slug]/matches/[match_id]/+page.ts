import { error } from "@sveltejs/kit";
import {
	ApiError,
	cloudApi,
	type StandingsResponse,
	type TournamentDetail,
	type TournamentMatch,
} from "$lib/api-cloud";
import type { FullGameData } from "$lib/parser/types";
import type { PageLoad } from "./$types";

interface MatchLoadResult {
	tournament: TournamentDetail;
	match: TournamentMatch;
	game: FullGameData | null;
	standings: StandingsResponse;
	slotLabels: Record<string, string>;
	meta: { title: string; description: string };
}

export const load: PageLoad = async ({
	params,
	fetch,
}): Promise<MatchLoadResult> => {
	let tournament: TournamentDetail;
	try {
		tournament = await cloudApi.getTournament(params.slug, { fetch });
	} catch (err) {
		if (err instanceof ApiError && err.status === 404) {
			throw error(404, "Tournament not found");
		}
		throw err;
	}

	let match: TournamentMatch;
	try {
		match = await cloudApi.getTournamentMatch(
			tournament.tournament_id,
			params.match_id,
			{ fetch },
		);
	} catch (err) {
		if (err instanceof ApiError && err.status === 404) {
			throw error(404, "Match not found");
		}
		throw err;
	}

	// Standings is the cheapest source of slot identity (returns
	// discord_username per slot). Use it to build labels for the match page.
	const standings = await cloudApi.getTournamentStandings(
		tournament.tournament_id,
		{ fetch },
	);
	const slotLabels: Record<string, string> = {};
	for (const division of ["A", "B"] as const) {
		for (const s of standings.divisions[division].standings) {
			if (s.discord_username) slotLabels[s.slot_id] = s.discord_username;
		}
	}

	let game: FullGameData | null = null;
	if (match.game_id) {
		try {
			game = await cloudApi.getPublicGame(match.game_id, { fetch });
		} catch (err) {
			// Game was attached but is no longer accessible (deleted, made
			// private after tournament completion, etc.). Surface a "save
			// unavailable" state rather than failing the page.
			if (!(err instanceof ApiError)) throw err;
		}
	}

	const description = match.map_script
		? `${tournament.name} — Match on ${match.map_script}`
		: `${tournament.name} — Tournament match`;

	return {
		tournament,
		match,
		game,
		standings,
		slotLabels,
		meta: {
			title: `${tournament.name} match — Per-Ankh`,
			description,
		},
	};
};
