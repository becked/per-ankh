import { cloudApi } from "$lib/api-cloud";
import type { PageLoad } from "./$types";

// Tournament stats view. The tournament itself comes from the [slug] layout
// load; the two stats payloads are fetched here (Plane A competition + Plane B1
// save-content). Public and setup-gated: a pre-signup setup tournament already
// 404s from the layout's getTournament, so a reachable page always has visible
// stats. Both reads are independent → fetched in parallel.
export const load: PageLoad = async ({ parent, fetch }) => {
	const { tournament } = await parent();
	const [competition, games] = await Promise.all([
		cloudApi.getTournamentStats(tournament.tournament_id, { fetch }),
		cloudApi.getTournamentGamesStats(tournament.tournament_id, { fetch }),
	]);
	return {
		competition,
		games,
		meta: {
			title: `${tournament.name} · Stats - Per-Ankh`,
			description: `Statistics for ${tournament.name} on Per-Ankh.`,
		},
	};
};
