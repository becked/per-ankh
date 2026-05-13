import { error, redirect } from "@sveltejs/kit";
import { ApiError, cloudApi } from "$lib/api-cloud";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ params, fetch, url }) => {
	// Admin pages require authentication. We don't have a "is this user
	// an admin of this tournament?" gate at load time — the API rejects
	// non-admin mutations with 403, and the UI surfaces that. The load
	// gate is just "are you signed in at all?".
	const user = await cloudApi.getMe({ fetch });
	if (!user) {
		throw redirect(303, `/?next=${encodeURIComponent(url.pathname)}`);
	}

	let tournament;
	try {
		tournament = await cloudApi.getTournament(params.slug, { fetch });
	} catch (err) {
		if (err instanceof ApiError && err.status === 404) {
			throw error(404, "Tournament not found");
		}
		throw err;
	}

	const [standings, bracket, rounds, matches] = await Promise.all([
		cloudApi.getTournamentStandings(tournament.tournament_id, { fetch }),
		cloudApi.getTournamentBracket(tournament.tournament_id, { fetch }),
		cloudApi.getTournamentRounds(tournament.tournament_id, { fetch }),
		cloudApi.getTournamentMatches(tournament.tournament_id, {}, { fetch }),
	]);

	return {
		user,
		tournament,
		standings,
		bracket,
		rounds: rounds.rounds,
		matches: matches.matches,
		meta: {
			title: `${tournament.name} admin — Per-Ankh`,
			description: `Admin panel for ${tournament.name}.`,
		},
	};
};
