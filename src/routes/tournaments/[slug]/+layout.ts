import { error } from "@sveltejs/kit";
import { ApiError, cloudApi } from "$lib/api-cloud";
import type { LayoutLoad } from "./$types";

// Shared tournament data for every page under /tournaments/[slug] (the overview
// and the schedule view both need the tournament, standings, bracket, and match
// list). Loaded once here so child pages don't refetch; each page contributes
// only its own page meta. SvelteKit merges this layout data into page data.
export const load: LayoutLoad = async ({ params, fetch }) => {
	// Public — shared tournament URLs render for anonymous visitors.
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
	};
};
