import { error } from "@sveltejs/kit";
import { ApiError, cloudApi } from "$lib/api-cloud";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ params, fetch }) => {
	let tournament;
	try {
		tournament = await cloudApi.getTournament(params.slug, { fetch });
	} catch (err) {
		if (err instanceof ApiError && err.status === 404) {
			throw error(404, "Tournament not found");
		}
		throw err;
	}

	// Parallel reads — standings + bracket + recent matches are independent.
	// Bracket is empty until championship phase; that's fine, the component
	// renders a placeholder.
	const [standings, bracket, matches] = await Promise.all([
		cloudApi.getTournamentStandings(tournament.tournament_id, { fetch }),
		cloudApi.getTournamentBracket(tournament.tournament_id, { fetch }),
		cloudApi.getTournamentMatches(tournament.tournament_id, {}, { fetch }),
	]);

	return {
		tournament,
		standings,
		bracket,
		matches: matches.matches,
		meta: {
			title: `${tournament.name} — Per-Ankh`,
			description: tournament.description ?? `${tournament.name} on Per-Ankh.`,
		},
	};
};
