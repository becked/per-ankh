// Dashboard load — cross-game stats + the cloud user's full game list +
// per-collection counts. Sidebar (CloudGameSidebar) filters/searches the
// games list client-side; listGames is capped at 200 server-side, which
// is the de-facto ceiling for v1. If a user surpasses that, switch the
// sidebar to a server-side filter.

import { redirect } from "@sveltejs/kit";
import { cloudApi, UnauthorizedError } from "$lib/api-cloud";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, url }) => {
	try {
		const [stats, gamesRes, collectionsRes, myTournamentsRes, myMatchesRes] =
			await Promise.all([
				cloudApi.getStats({ fetch }),
				cloudApi.listGames({ fetch }),
				cloudApi.listCollections({ fetch }),
				cloudApi.getMyTournaments({ fetch }).catch(() => ({ tournaments: [] })),
				cloudApi.getMyMatches({ fetch }).catch(() => ({ matches: [] })),
			]);
		return {
			stats,
			games: gamesRes.games,
			collections: collectionsRes.collections,
			publicCount: collectionsRes.public_count,
			myTournaments: myTournamentsRes.tournaments,
			myMatches: myMatchesRes.matches,
		};
	} catch (err) {
		if (err instanceof UnauthorizedError) {
			throw redirect(303, `/?next=${encodeURIComponent(url.pathname)}`);
		}
		throw err;
	}
};
